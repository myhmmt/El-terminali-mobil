// GENÇ GROSS – Offline Service Worker (v3)
const CACHE = "gg-cache-v3";
const ASSETS = [
  "./",
  "index.html",
  "app.js",
  "manifest.json",
  "beep.ogg",
  "error.ogg",
  "icon-192.png",
  "icon-512.png"
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (e) => {
  e.respondWith(
    fetch(e.request).then(res => {
      const copy = res.clone();
      caches.open(CACHE).then(c => c.put(e.request, copy));
      return res;
    }).catch(async () => {
      const cached = await caches.match(e.request);
      if (cached) return cached;
      if (e.request.mode === "navigate") return caches.match("index.html");
      return new Response("Offline", {status: 503, statusText: "Offline"});
    })
  );
});
