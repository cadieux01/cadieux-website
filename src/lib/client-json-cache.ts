"use client";

// A module-level dedupe + TTL cache for small public GET endpoints that more
// than one component reads.
//
// Why this exists: /checkout renders both the checkout page and the cart
// summary, and each mounted its own usePreorderMode() + useProductFloors().
// Both fetched with `cache: "no-store"`, so nothing collapsed them —
// measured on live prod, /checkout fired /api/preorder-mode and
// /api/product-floors TWICE on 2 of 3 cold loads, the second pair landing
// 60–350 ms after the first and costing 282–540 ms each.
//
// Two callers of the same URL in the same tick now share one request, and a
// repeat within `ttlMs` is served from memory. This is a per-tab cache in a
// module closure: it dies with the tab and is never shared between users.

type Entry = { at: number; value: unknown };

const cache = new Map<string, Entry>();
const inFlight = new Map<string, Promise<unknown>>();

/** Fetch `url` as JSON, collapsing concurrent callers and reusing a result
 *  newer than `ttlMs`. Pass `force` to bypass the TTL (but still share an
 *  in-flight request). A rejection caches nothing, so the next caller
 *  retries. */
export function cachedJson<T>(
  url: string,
  ttlMs: number,
  force = false,
): Promise<T> {
  if (!force) {
    const hit = cache.get(url);
    if (hit && Date.now() - hit.at < ttlMs) {
      return Promise.resolve(hit.value as T);
    }
  }

  const pending = inFlight.get(url);
  if (pending) return pending as Promise<T>;

  const request = (async () => {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = (await res.json()) as T;
    cache.set(url, { at: Date.now(), value: json });
    return json;
  })().finally(() => {
    inFlight.delete(url);
  });

  inFlight.set(url, request);
  return request as Promise<T>;
}
