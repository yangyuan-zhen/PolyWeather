const CACHE_NAME = "polyweather-v2";
const CACHEABLE_PUBLIC_ASSETS = [
  "/favicon.ico",
  "/favicon-16x16.png",
  "/favicon-32x32.png",
  "/apple-touch-icon.png",
  "/android-chrome-192x192.png",
  "/android-chrome-512x512.png",
  "/manifest.webmanifest",
  "/site.webmanifest",
];

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== CACHE_NAME)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Do not cache-first Next.js build chunks. A user can keep an old app shell
  // open across deployments; if checkout UI is loaded later, stale/missing
  // chunks surface as a generic page fault. Let the browser/Vercel handle
  // immutable _next/static asset caching instead.
  if (CACHEABLE_PUBLIC_ASSETS.includes(url.pathname)) {
    event.respondWith(
      caches.open(CACHE_NAME).then((cache) =>
        cache.match(event.request).then(
          (cached) =>
            cached ||
            fetch(event.request).then((response) => {
              if (response.ok) {
                cache.put(event.request, response.clone());
              }
              return response;
            }),
        ),
      ),
    );
    return;
  }

  event.respondWith(
    fetch(event.request).catch(() =>
      caches.match(event.request).then((cached) => cached || Response.error()),
    ),
  );
});
