self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== "codex-mobile-v2").map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open("codex-mobile-v2").then((cache) => cache.addAll(["/", "/styles.css", "/app.js", "/manifest.json", "/icon.svg"])));
  self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.pathname.startsWith("/api/") || event.request.method !== "GET") return;
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const copy = response.clone();
        caches.open("codex-mobile-v2").then((cache) => cache.put(event.request, copy));
        return response;
      })
      .catch(() => caches.match(event.request)),
  );
});
