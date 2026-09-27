// Unit tests for public/sw.js: runs the real service worker file in a sandbox with fake
// caches/fetch and checks what it intercepts, caches and serves offline.
// Run: npm run test:sw
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const ORIGIN = "https://algoverse.example";
const SW_SOURCE = readFileSync(new URL("../../public/sw.js", import.meta.url), "utf8");

function makeEnv({ online = true, pages = {} } = {}) {
  const stores = new Map(); // cacheName -> Map(url -> Response)
  const keyOf = (r) => (typeof r === "string" ? new URL(r, ORIGIN).href : r.url);
  const cacheFor = (name) => {
    if (!stores.has(name)) stores.set(name, new Map());
    const m = stores.get(name);
    return {
      put: async (req, res) => void m.set(keyOf(req), res),
      match: async (req) => m.get(keyOf(req))?.clone(),
      keys: async () => [...m.keys()].map((u) => new Request(u)),
      delete: async (req) => m.delete(keyOf(req)),
      add: async (url) => {
        const res = await env.fetch(new Request(new URL(url, ORIGIN)));
        if (!res.ok) throw new Error("bad");
        m.set(keyOf(url), res);
      },
    };
  };
  const fetched = [];
  const env = {
    online,
    fetched,
    stores,
    fetch: async (input) => {
      const url = typeof input === "string" ? new URL(input, ORIGIN).href : input.url;
      fetched.push(url);
      if (!env.online) throw new TypeError("Failed to fetch");
      const path = new URL(url).pathname;
      if (path === "/offline")
        return new Response('<html><link href="/_next/static/css/app.css"><script src="/_next/static/chunks/main.js"></script>offline</html>', { headers: { "Content-Type": "text/html" } });
      if (path.startsWith("/_next/static/")) return new Response(`asset ${path}`, { headers: { "Content-Type": "text/plain" } });
      if (pages[path]) return new Response(pages[path], { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "private, no-cache, no-store" } });
      if (path.startsWith("/icons/") || path === "/manifest.webmanifest" || path === "/favicon.ico" || path === "/icon.svg")
        return new Response(`file ${path}`);
      return new Response("not found", { status: 404 });
    },
  };
  const listeners = {};
  const self = {
    location: new URL(ORIGIN + "/sw.js"),
    registration: { navigationPreload: null },
    clients: { claim: async () => {} },
    skipWaiting: async () => {},
    addEventListener: (type, fn) => (listeners[type] = fn),
  };
  const caches = {
    open: async (name) => cacheFor(name),
    keys: async () => [...stores.keys()],
    delete: async (name) => stores.delete(name),
    match: async (req, opts = {}) => {
      const names = opts.cacheName ? [opts.cacheName] : [...stores.keys()];
      for (const n of names) {
        const hit = stores.get(n)?.get(keyOf(req));
        if (hit) return hit.clone();
      }
      return undefined;
    },
  };
  // Response objects in Node are same-origin "basic" only via this shim.
  const BasicResponse = new Proxy(Response, {});
  const ctx = vm.createContext({ self, caches, fetch: (...a) => env.fetch(...a), Response: BasicResponse, Request, URL, Promise, Set, Boolean, console });
  vm.runInContext(SW_SOURCE, ctx);

  async function lifecycle(type) {
    let p;
    listeners[type]({ waitUntil: (x) => (p = x) });
    await p;
  }
  async function dispatch(path, { method = "GET", mode = "cors", headers = {}, origin = ORIGIN } = {}) {
    const request = new Request(new URL(path, origin), { method, headers });
    Object.defineProperty(request, "mode", { value: mode });
    let responded;
    const waits = [];
    listeners.fetch({ request, preloadResponse: Promise.resolve(undefined), respondWith: (p) => (responded = p), waitUntil: (p) => waits.push(p) });
    if (!responded) return { intercepted: false };
    const res = await responded;
    await Promise.all(waits);
    return { intercepted: true, res, text: await res.clone().text() };
  }
  return { env, lifecycle, dispatch };
}

// Node's Response objects have type "default"; the worker only caches "basic" (same-origin)
// responses, so patch the getter for these tests.
Object.defineProperty(Response.prototype, "type", { get: () => "basic" });

test("install precaches the offline page, its CSS/JS and the icons", async () => {
  const { env, lifecycle } = makeEnv();
  await lifecycle("install");
  const all = [...env.stores.values()].flatMap((m) => [...m.keys()].map((u) => new URL(u).pathname));
  for (const p of ["/offline", "/_next/static/css/app.css", "/_next/static/chunks/main.js", "/icons/icon-192.png", "/manifest.webmanifest"]) {
    assert.ok(all.includes(p), `precached ${p}`);
  }
});

test("activate deletes caches from older versions only", async () => {
  const { env, lifecycle } = makeEnv();
  env.stores.set("algoverse-v0-pages", new Map());
  env.stores.set("someone-elses-cache", new Map());
  await lifecycle("install");
  await lifecycle("activate");
  const names = [...env.stores.keys()];
  assert.ok(!names.includes("algoverse-v0-pages"));
  assert.ok(names.includes("someone-elses-cache"));
});

test("never intercepts the Gemini route, other API routes, non-GET, cross-origin or RSC requests", async () => {
  const { dispatch } = makeEnv();
  assert.equal((await dispatch("/api/ai", { method: "POST" })).intercepted, false);
  assert.equal((await dispatch("/api/ai")).intercepted, false, "GET /api/ai (configured check) goes to the network");
  assert.equal((await dispatch("/api/anything")).intercepted, false);
  assert.equal((await dispatch("/problems", { method: "POST", mode: "navigate" })).intercepted, false);
  assert.equal((await dispatch("/problems/two-sum/", { origin: "https://leetcode.com" })).intercepted, false);
  assert.equal((await dispatch("/problems/53?_rsc=abc")).intercepted, false);
  assert.equal((await dispatch("/problems/53", { headers: { RSC: "1" } })).intercepted, false);
  assert.equal((await dispatch("/sw.js")).intercepted, false);
});

test("never intercepts or caches the YouTube player (Striver video embeds)", async () => {
  const { dispatch } = makeEnv();
  assert.equal((await dispatch("/embed/UXDSeD9mN-k?rel=0", { mode: "navigate", origin: "https://www.youtube-nocookie.com" })).intercepted, false);
  assert.equal((await dispatch("/watch?v=UXDSeD9mN-k", { origin: "https://www.youtube.com" })).intercepted, false);
  assert.equal((await dispatch("/vi/UXDSeD9mN-k/hqdefault.jpg", { origin: "https://i.ytimg.com" })).intercepted, false);
});

test("the service worker source contains no secrets", () => {
  assert.ok(!/GEMINI_API_KEY|AIza|generativelanguage|x-goog-api-key|process\.env/.test(SW_SOURCE));
});

test("navigation: network-first, saved for offline, falls back to the saved copy then /offline", async () => {
  const { env, lifecycle, dispatch } = makeEnv({ pages: { "/problems/53": "<html>two sum</html>" } });
  await lifecycle("install");
  const online = await dispatch("/problems/53", { mode: "navigate" });
  assert.equal(online.text, "<html>two sum</html>");
  env.online = false;
  const offlineVisited = await dispatch("/problems/53", { mode: "navigate" });
  assert.equal(offlineVisited.text, "<html>two sum</html>", "visited page opens offline");
  const offlineNew = await dispatch("/problems/99", { mode: "navigate" });
  assert.match(offlineNew.text, /offline/, "unvisited page shows the offline page");
});

test("static build assets are cache-first; icons stale-while-revalidate", async () => {
  const { env, dispatch } = makeEnv();
  await dispatch("/_next/static/chunks/page-abc.js");
  const before = env.fetched.length;
  env.online = false;
  const again = await dispatch("/_next/static/chunks/page-abc.js");
  assert.equal(again.text, "asset /_next/static/chunks/page-abc.js");
  assert.equal(env.fetched.length, before + 0, "served from cache without a network request");
  env.online = true;
  await dispatch("/icons/icon-512.png");
  env.online = false;
  assert.equal((await dispatch("/icons/icon-512.png")).text, "file /icons/icon-512.png");
});
