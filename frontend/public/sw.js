const CACHE_NAME = "origami-plans-v3";
const APP_SHELL = [
  "/",
  "/index.html",
  "/manifest.webmanifest"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  const isHttpRequest = url.protocol === "http:" || url.protocol === "https:";
  if (!isHttpRequest) return;
  const isSameOrigin = url.origin === self.location.origin;

  const isHtmlNavigation = request.mode === "navigate";

  // Let API requests (both /api/* and direct backend paths) pass through
  // to the network without SW interception. React Query handles caching.
  const isApiRequest =
    url.pathname.startsWith("/api/") ||
    url.pathname.startsWith("/calendar") ||
    url.pathname.startsWith("/activities") ||
    url.pathname.startsWith("/communications") ||
    url.pathname.startsWith("/users/");
  if (isApiRequest) return;

  if (isHtmlNavigation) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (isSameOrigin && response && response.ok) {
            const responseClone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, responseClone)).catch(() => undefined);
          }
          return response;
        })
        .catch(async () => {
          const cached = await caches.match(request);
          return cached || caches.match("/index.html");
        })
    );
    return;
  }

  // Static assets: cache-first with network fallback
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request)
        .then((response) => {
          if (isSameOrigin && response && response.status === 200 && response.type === "basic") {
            const responseClone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, responseClone)).catch(() => undefined);
          }
          return response;
        })
        .catch(() => new Response("", { status: 503, statusText: "Offline" }));
    })
  );
});
