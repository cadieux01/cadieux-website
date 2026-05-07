// Cadieux service worker. Hand-rolled (no Workbox) so the bundle stays
// small and the cache logic is easy to audit.
//
// Strategies:
//   • /admin/*, /api/admin/*  → bypass entirely (never cached, never intercepted
//                               beyond network passthrough)
//   • /api/*                  → network-only (no caching for dynamic data)
//   • /_next/static/*, /icons/*, /splash/*, images, fonts
//                              → CacheFirst + cache-on-success
//   • navigations (HTML)      → NetworkFirst, fall back to runtime cache,
//                               then to /offline
//
// Versioning: bumping CACHE_VERSION on a deploy triggers cleanup of every
// older cache during `activate`, and `skipWaiting` + `clients.claim` make
// the new SW take over immediately. The page-side registration listens
// for `controllerchange` and prompts the user to reload.

const CACHE_VERSION = "v1";
const STATIC_CACHE  = `cadieux-static-${CACHE_VERSION}`;
const RUNTIME_CACHE = `cadieux-runtime-${CACHE_VERSION}`;

// Pages we want available offline. Listed routes are pre-fetched on install.
const OFFLINE_FALLBACK = "/offline";
const PRECACHE_URLS = [
  OFFLINE_FALLBACK,
  "/manifest.json",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => cache.addAll(PRECACHE_URLS)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(
          names
            .filter((n) => n.startsWith("cadieux-") && n !== STATIC_CACHE && n !== RUNTIME_CACHE)
            .map((n) => caches.delete(n))
        )
      )
      .then(() => self.clients.claim())
  );
});

// Routes the SW must NEVER touch. Returning undefined from the fetch
// handler lets the browser do its default thing.
function isAdminPath(url) {
  return url.pathname.startsWith("/admin") || url.pathname.startsWith("/api/admin");
}

function isApi(url) {
  return url.pathname.startsWith("/api/");
}

function isStaticAsset(url) {
  if (url.pathname.startsWith("/_next/static/")) return true;
  if (url.pathname.startsWith("/icons/")) return true;
  if (url.pathname.startsWith("/splash/")) return true;
  // Images, posters, fonts, etc.
  if (/\.(png|jpg|jpeg|webp|svg|gif|ico|woff2?|ttf)$/i.test(url.pathname)) return true;
  return false;
}

self.addEventListener("fetch", (event) => {
  const req = event.request;

  // Same-origin only. Cross-origin (Google Fonts CDN, Cloudflare Turnstile,
  // analytics, video CDNs) is left to the browser.
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Never intercept /admin or /api/admin — admin tooling should always hit
  // the network and never see stale data.
  if (isAdminPath(url)) return;

  // Only handle GET. POST/PUT/DELETE go straight through.
  if (req.method !== "GET") return;

  // Public APIs: network-only (we don't cache JSON since stock counts /
  // subscriptions / etc. change frequently and stale data is worse than
  // a clear network failure).
  if (isApi(url)) return;

  // Static assets: CacheFirst with background revalidation on miss.
  if (isStaticAsset(url)) {
    event.respondWith(cacheFirst(req));
    return;
  }

  // Navigations and everything else: NetworkFirst with offline fallback.
  if (req.mode === "navigate" || req.headers.get("accept")?.includes("text/html")) {
    event.respondWith(navigationHandler(req));
    return;
  }

  // Default: network with cache fallback.
  event.respondWith(networkFirst(req, RUNTIME_CACHE));
});

async function cacheFirst(req) {
  const cache = await caches.open(STATIC_CACHE);
  const cached = await cache.match(req);
  if (cached) return cached;
  try {
    const res = await fetch(req);
    if (res && res.ok) cache.put(req, res.clone());
    return res;
  } catch (err) {
    // If we have ANY cached version (different query string, etc.) return it.
    const fallback = await cache.match(req, { ignoreSearch: true });
    if (fallback) return fallback;
    throw err;
  }
}

async function networkFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const res = await fetch(req);
    if (res && res.ok) cache.put(req, res.clone());
    return res;
  } catch (err) {
    const cached = await cache.match(req);
    if (cached) return cached;
    throw err;
  }
}

async function navigationHandler(req) {
  try {
    const res = await fetch(req);
    // Only cache successful HTML responses. Don't cache redirects (they
    // confuse navigation state) or error pages.
    if (res && res.ok && res.type !== "opaqueredirect") {
      const cache = await caches.open(RUNTIME_CACHE);
      cache.put(req, res.clone());
    }
    return res;
  } catch (err) {
    const runtime = await caches.open(RUNTIME_CACHE);
    const cached = await runtime.match(req);
    if (cached) return cached;
    const fallbackCache = await caches.open(STATIC_CACHE);
    const offline = await fallbackCache.match(OFFLINE_FALLBACK);
    if (offline) return offline;
    throw err;
  }
}

// Allow the page to ask the SW to activate immediately on update.
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
});
