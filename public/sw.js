self.addEventListener("install", (event) => {
  event.waitUntil(caches.open("codex-mobile-v1").then((cache) => cache.addAll(["/", "/styles.css", "/app.js", "/manifest.json", "/icon.svg"])));
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.pathname.startsWith("/api/")) return;
  event.respondWith(caches.match(event.request).then((cached) => cached || fetch(event.request)));
});
