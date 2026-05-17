// Client-only helpers for the new admin pages. Wraps fetch() with the
// x-admin-token header so callers don't have to remember.

import { ADMIN_PASSWORD } from "@/lib/admin-shared";

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
  headers.set("x-admin-token", ADMIN_PASSWORD);
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const res = await fetch(url, {
    ...init,
    headers,
    cache: "no-store",
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
