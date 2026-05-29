// Client-only helper for the admin pages.
//
// Authentication is the HttpOnly `admin_session` cookie set by
// /api/admin/login — it travels automatically on every same-origin
// fetch, so this wrapper just adds JSON content-type + cache:"no-store"
// semantics. We pass `credentials: "same-origin"` defensively in case
// a caller overrides the default.

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
  const res = await fetch(url, {
    ...init,
    headers,
    cache: "no-store",
    credentials: "same-origin",
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
