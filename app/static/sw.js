// Voltlog service worker.
// HTML pages are network-first (so updates show immediately when online);
// static assets are cache-first; API responses are never cached.

const CACHE = "voltlog-shell-v5";
const SHELL = [
  "/",
  "/pack",
  "/quads",
  "/quad",
  "/flights",
  "/maintenance",
  "/static/manifest.webmanifest",
  "/static/icon.svg",
  "https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Never cache API calls — always go to the network.
  if (url.pathname.startsWith("/api/")) return;
  if (request.method !== "GET") return;

  const isHTML = request.mode === "navigate" || request.destination === "document";

  if (isHTML) {
    // Network-first: always try the live page so version bumps take effect,
    // falling back to a cached copy only when offline.
    event.respondWith(
      fetch(request)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
          return res;
        })
        .catch(() => caches.match(request).then((c) => c || caches.match("/")))
    );
    return;
  }

  // Cache-first for static assets (versioned URLs fetch fresh on change).
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((res) => {
        if (res.ok && url.origin === location.origin) {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
        }
        return res;
      }).catch(() => cached);
    })
  );
});
