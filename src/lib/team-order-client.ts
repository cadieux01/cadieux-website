// Client-only helper for the shareable /register team-PIN link.
//
// Mirrors admin-client.ts but stores its token under a distinct
// localStorage key (`team_order_token`) so a device that has BOTH the
// admin gate unlocked (Sunny) and the team link open (a team member)
// keeps the two sessions strictly separate. The token is a signed
// `{p:"team_order",exp}` payload — it never carries the PIN itself
// and cannot satisfy isAdmin() on the server.

const TEAM_ORDER_TOKEN_KEY = "team_order_token";

export function getTeamOrderToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(TEAM_ORDER_TOKEN_KEY);
}

export function setTeamOrderToken(token: string): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(TEAM_ORDER_TOKEN_KEY, token);
}

export function clearTeamOrderToken(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(TEAM_ORDER_TOKEN_KEY);
}

// Best-effort client-side expiry check — same pattern as adminTokenValid.
// HMAC is only ever verified server-side; this is purely a UX gate so a
// stale token doesn't leave the operator staring at silent 401s.
export function teamOrderTokenValid(
  token: string | null = getTeamOrderToken(),
): boolean {
  if (!token) return false;
  const dot = token.indexOf(".");
  if (dot <= 0) return false;
  try {
    const b64 = token.slice(0, dot).replace(/-/g, "+").replace(/_/g, "/");
    const json = JSON.parse(atob(b64)) as { exp?: number; p?: string };
    return (
      json.p === "team_order" &&
      typeof json.exp === "number" &&
      json.exp > Date.now()
    );
  } catch {
    return false;
  }
}

export function teamOrderAuthHeaders(base?: HeadersInit): Headers {
  const headers = new Headers(base);
  const token = getTeamOrderToken();
  if (token && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  return headers;
}

export class TeamOrderFetchError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = "TeamOrderFetchError";
  }
}

export async function teamOrderFetch<T = unknown>(
  url: string,
  init: RequestInit = {},
): Promise<T> {
  const headers = teamOrderAuthHeaders(init.headers);
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
      /* leave json null */
    }
  }
  if (!res.ok) {
    const message =
      (json && typeof json === "object" && "error" in json
        ? String((json as { error: unknown }).error)
        : null) ?? `Request failed (${res.status})`;
    if (res.status === 401) {
      // Wipe the stale token so the /register PIN gate re-appears.
      clearTeamOrderToken();
      if (typeof window !== "undefined") {
        window.dispatchEvent(new Event("team-order-auth-logout"));
      }
    }
    throw new TeamOrderFetchError(res.status, message);
  }
  return (json as T) ?? (undefined as unknown as T);
}
