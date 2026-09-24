/* AlgoVerse service worker.
 *
 * What it caches (and what it never touches):
 *   - Build assets under /_next/static/ (hashed, immutable)  → cache-first
 *   - Icons, favicon, manifest                               → stale-while-revalidate
 *   - Page navigations (HTML)                                → network-first; a copy of pages you
 *     visited is kept so they open offline; otherwise the /offline page is shown
 *   - /api/* (including the Gemini route /api/ai), non-GET requests, other origins and
 *     React Server Component fetches                         → NOT intercepted at all
 *
 * No secrets live here: the Gemini API key only exists on the server, and AI requests/answers
 * are never cached. Progress, bookmarks and notes stay in the page's localStorage.
 * Bump VERSION to drop every cache from earlier versions on the next visit.
 */
const VERSION = "algoverse-v1";
const PRECACHE = `${VERSION}-precache`;
const STATIC_CACHE = `${VERSION}-static`;
const PAGE_CACHE = `${VERSION}-pages`;
const OFFLINE_URL = "/offline";
const MAX_PAGES = 60;
const MAX_STATIC = 250;

const PRECACHE_URLS = [
  "/manifest.webmanifest",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/icon-maskable-512.png",
  "/icon.svg",
  "/favicon.ico",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(PRECACHE);
      // The offline page plus the CSS/JS it needs, so it renders fully without a network.
      const res = await fetch(OFFLINE_URL, { cache: "reload", credentials: "same-origin" });
      if (res.ok) {
        const html = await res.clone().text();
        await cache.put(OFFLINE_URL, res);
        const assets = new Set(html.match(/\/_next\/static\/[^"'\s)\\]+/g) || []);
        const staticCache = await caches.open(STATIC_CACHE);
        await Promise.all(
          [...assets].map((url) =>
            staticCache.add(url).catch(() => {
              /* one missing asset shouldn't block installation */
            })
          )
        );
      }
      await Promise.all(PRECACHE_URLS.map((url) => cache.add(url).catch(() => {})));
      await self.skipWaiting();
    })()
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((k) => k.startsWith("algoverse-") && !k.startsWith(`${VERSION}-`)).map((k) => caches.delete(k))
      );
      if (self.registration.navigationPreload) await self.registration.navigationPreload.enable();
      await self.clients.claim();
    })()
  );
});

async function trim(cacheName, max) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - max; i++) await cache.delete(keys[i]);
}

function isCacheableResponse(res) {
  return Boolean(res && res.ok && res.type === "basic");
}

async function networkFirstPage(event) {
  const { request } = event;
  try {
    const preloaded = await event.preloadResponse;
    const res = preloaded || (await fetch(request));
    // Pages are rendered per request (Next.js marks them no-store for CDNs), but their HTML
    // holds no personal data — progress lives in localStorage — so a copy is kept for offline.
    if (isCacheableResponse(res) && (res.headers.get("Content-Type") || "").includes("text/html")) {
      const copy = res.clone();
      event.waitUntil(
        caches
          .open(PAGE_CACHE)
          .then((c) => c.put(request, copy))
          .then(() => trim(PAGE_CACHE, MAX_PAGES))
      );
    }
    return res;
  } catch {
    const cached = (await caches.match(request, { cacheName: PAGE_CACHE })) || (await caches.match(OFFLINE_URL));
    return (
      cached ||
      new Response("<h1>AlgoVerse</h1><p>You're offline.</p>", {
        status: 503,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      })
    );
  }
}

async function cacheFirst(event) {
  const cached = await caches.match(event.request);
  if (cached) return cached;
  const res = await fetch(event.request);
  if (isCacheableResponse(res)) {
    const copy = res.clone();
    event.waitUntil(
      caches
        .open(STATIC_CACHE)
        .then((c) => c.put(event.request, copy))
        .then(() => trim(STATIC_CACHE, MAX_STATIC))
    );
  }
  return res;
}

async function staleWhileRevalidate(event) {
  const cached = await caches.match(event.request);
  const refresh = fetch(event.request)
    .then(async (res) => {
      if (isCacheableResponse(res)) await (await caches.open(STATIC_CACHE)).put(event.request, res.clone());
      return res;
    })
    .catch(() => undefined);
  if (cached) {
    event.waitUntil(refresh);
    return cached;
  }
  return (await refresh) || Response.error();
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // Never intercept API routes — the Gemini helper (/api/ai) always goes to the network.
  if (url.pathname.startsWith("/api/")) return;
  if (url.pathname === "/sw.js") return;
  // React Server Component payloads for client-side navigation: leave to the network. If they
  // fail offline, Next.js falls back to a full navigation, which is handled below.
  if (request.headers.get("RSC") || url.searchParams.has("_rsc")) return;

  if (request.mode === "navigate") {
    event.respondWith(networkFirstPage(event));
    return;
  }
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(cacheFirst(event));
    return;
  }
  if (
    url.pathname.startsWith("/icons/") ||
    url.pathname === "/favicon.ico" ||
    url.pathname === "/icon.svg" ||
    url.pathname.startsWith("/apple-icon") ||
    url.pathname === "/manifest.webmanifest"
  ) {
    event.respondWith(staleWhileRevalidate(event));
  }
  // Everything else: default browser behaviour (network).
});
