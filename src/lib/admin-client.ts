// Client-only helper for the admin pages.
//
// Primary auth is now a bearer token kept in localStorage: /api/admin/login
// returns the signed session token in its JSON body, we stash it, and send
// it as `Authorization: Bearer <token>` on every admin request. This
// sidesteps Safari ITP, which dropped the HttpOnly `admin_session` cookie
// across the cadieux.in -> www.cadieux.in redirect. The cookie is still set
// server-side and `credentials: "include"` is kept as a fallback for
// browsers that honour it.

import { ADMIN_SESSION_KEY } from "@/lib/admin-shared";

const ADMIN_TOKEN_KEY = "admin_token";
// Legacy sticky-login flag — no longer read by AdminShell but still
// cleared here so a stale value can't ever re-open the gate after a 401.
const LEGACY_ADMIN_AUTHED_FLAG = "admin_authenticated";

export function getAdminToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(ADMIN_TOKEN_KEY);
}

export function setAdminToken(token: string): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(ADMIN_TOKEN_KEY, token);
}

export function clearAdminToken(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(ADMIN_TOKEN_KEY);
}

// Best-effort client-side expiry check. The token is
// `base64url(JSON{p,exp}).hmac`; we can read `exp` without the secret, but
// the HMAC is only ever verified server-side, so this is purely a UX gate.
export function adminTokenValid(token: string | null = getAdminToken()): boolean {
  if (!token) return false;
  const dot = token.indexOf(".");
  if (dot <= 0) return false;
  try {
    const b64 = token.slice(0, dot).replace(/-/g, "+").replace(/_/g, "/");
    const json = JSON.parse(atob(b64)) as { exp?: number };
    return typeof json.exp === "number" && json.exp > Date.now();
  } catch {
    return false;
  }
}

// Build a Headers object carrying the admin bearer token. Use this for the
// few admin requests that can't go through `adminFetch` because they need
// the raw Response (status-code branching) or send FormData — so the token
// rides along on EVERY admin request, not just JSON ones routed via
// adminFetch. Without this they fall back to the cookie, which Safari ITP
// drops across the apex -> www redirect.
export function adminAuthHeaders(base?: HeadersInit): Headers {
  const headers = new Headers(base);
  const token = getAdminToken();
  if (token && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  return headers;
}

// Fired by the password gate the instant it stores a fresh token so any
// in-flight `adminFetch` waiting for auth can proceed immediately rather
// than waiting for the poll below to notice.
export const ADMIN_AUTH_EVENT = "admin-auth-change";

// Fired by adminFetch when a /api/admin/* call returns 401 so AdminShell
// can drop back to the PasswordGate instead of leaving the operator on
// a page full of blank tiles and silently-failing mutations. Also fired
// when the admin_session cookie has been rotated server-side (same 401).
export const ADMIN_AUTH_LOGOUT_EVENT = "admin-auth-logout";

export function notifyAdminAuthChange(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(ADMIN_AUTH_EVENT));
}

// Purge every scrap of client-side admin auth state and tell AdminShell
// to re-mount the PasswordGate. Called by adminFetch on 401 and available
// for direct callers (e.g. sign-out) that need the same clean slate.
export function clearAdminAuthAndSignal(): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(ADMIN_TOKEN_KEY);
    localStorage.removeItem(ADMIN_SESSION_KEY);
    sessionStorage.removeItem(ADMIN_SESSION_KEY);
    localStorage.removeItem(LEGACY_ADMIN_AUTHED_FLAG);
  } catch {
    /* storage unavailable — event still fires so the UI recovers */
  }
  window.dispatchEvent(new Event(ADMIN_AUTH_LOGOUT_EVENT));
}

// Every admin page fires its data `load()` on mount — which happens BEFORE
// the operator types the password, since the page component wraps
// <AdminShell> (the gate) rather than living inside it. Without this guard
// that eager request hits /api/admin/* with an empty localStorage and 401s,
// and because the effect never re-runs after login the page is left showing
// a stale "Unauthorized". Here we simply hold the request until a valid
// token exists (the gate is rendered on top meanwhile, so the user sees the
// login screen, not a hang). It resolves the moment PasswordGate stores the
// token. A ceiling prevents waiting forever if the operator never logs in —
// the eventual 401 is harmless because the gate is still covering the page.
function waitForAdminToken(timeoutMs = 10000): Promise<void> {
  if (typeof window === "undefined" || adminTokenValid()) return Promise.resolve();
  return new Promise<void>((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearInterval(poll);
      window.removeEventListener(ADMIN_AUTH_EVENT, onChange);
      window.removeEventListener("storage", onChange);
      resolve();
    };
    const onChange = () => {
      if (adminTokenValid()) finish();
    };
    // Poll is the safety net in case the event is missed (e.g. login in
    // another tab updating localStorage without dispatching here).
    const poll = setInterval(onChange, 300);
    const timer = setTimeout(finish, timeoutMs);
    window.addEventListener(ADMIN_AUTH_EVENT, onChange);
    window.addEventListener("storage", onChange);
  });
}

export class AdminFetchError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = "AdminFetchError";
  }
}

export async function adminFetch<T = unknown>(
  url: string,
  init: RequestInit = {},
): Promise<T> {
  // Hold the request until the operator has logged in and a token exists,
  // so the eager on-mount fetch every admin page runs doesn't 401 against
  // an empty localStorage (see waitForAdminToken).
  await waitForAdminToken();
  const headers = adminAuthHeaders(init.headers);
  // Never force JSON on FormData — the browser must set the multipart
  // boundary itself.
  if (
    init.body &&
    !(init.body instanceof FormData) &&
    !headers.has("Content-Type")
  ) {
    headers.set("Content-Type", "application/json");
  }
  const res = await fetch(url, {
    ...init,
    headers,
    cache: "no-store",
    credentials: "include",
  });
  const text = await res.text();
  let json: unknown = null;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      /* leave json null — text may be CSV etc. */
    }
  }
  if (!res.ok) {
    const message =
      (json && typeof json === "object" && "error" in json
        ? String((json as { error: unknown }).error)
        : null) ?? `Request failed (${res.status})`;
    // On 401 the server has rejected our credentials — the cookie has
    // expired (30-day TTL), or ADMIN_TOKEN was rotated, or the session
    // was invalidated. Wipe all client-side admin state and signal
    // AdminShell to drop back to the PasswordGate. This is one-shot per
    // request: we still throw AdminFetchError so callers behave normally
    // (no infinite retry), we just guarantee the UI recovers instead of
    // showing "Unauthorized" tiles until the operator manually signs out.
    // Non-401 responses are unaffected.
    if (res.status === 401) {
      clearAdminAuthAndSignal();
    }
    throw new AdminFetchError(res.status, message);
  }
  return (json as T) ?? (undefined as unknown as T);
}
