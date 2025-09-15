const CACHE = "gg-mobil-v5";

// Önbelleğe alınacak çekirdek dosyalar
const CORE = [
  "index.html",
  "app.js",
  "manifest.json",
  "icon-192.png",
  "icon-512.png",
  "beep.ogg",
  "error.ogg"
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(CORE)));
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

// Stale-while-revalidate
self.addEventListener("fetch", (e) => {
  const req = e.request;
  e.respondWith(
    caches.match(req).then(cached => {
      const fetchPromise = fetch(req).then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(req, copy));
        return res;
      }).catch(()=>cached || Promise.reject("offline"));
      return cached || fetchPromise;
    })
  );
});
