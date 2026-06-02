// Client-only helper for the admin pages.
//
// Primary auth is now a bearer token kept in localStorage: /api/admin/login
// returns the signed session token in its JSON body, we stash it, and send
// it as `Authorization: Bearer <token>` on every admin request. This
// sidesteps Safari ITP, which dropped the HttpOnly `admin_session` cookie
// across the cadieux.in -> www.cadieux.in redirect. The cookie is still set
// server-side and `credentials: "include"` is kept as a fallback for
// browsers that honour it.

const ADMIN_TOKEN_KEY = "admin_token";

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
  const headers = new Headers(init.headers);
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const token = getAdminToken();
  if (token && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${token}`);
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
    throw new AdminFetchError(res.status, message);
  }
  return (json as T) ?? (undefined as unknown as T);
}
