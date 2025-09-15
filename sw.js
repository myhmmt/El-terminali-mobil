const CACHE = "gg-mobil-terminal-v3";
const ASSETS = [
  "index.html",
  "app.js",
  "manifest.json",
  "icon-192.png",
  "icon-512.png",
  "beep.ogg",
  "error.ogg"
];

self.addEventListener("install", (e)=>{
  e.waitUntil(
    caches.open(CACHE).then(c=>c.addAll(ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (e)=>{
  e.waitUntil(
    caches.keys().then(keys=>Promise.all(
      keys.filter(k=>k!==CACHE).map(k=>caches.delete(k))
    ))
  );
  self.clients.claim();
});

self.addEventListener("fetch", (e)=>{
  const req = e.request;
  e.respondWith(
    caches.match(req).then(cached => cached || fetch(req).then(resp=>{
      // runtime cache: sadece GET istekleri
      if (req.method === "GET") {
        const copy = resp.clone();
        caches.open(CACHE).then(c=>c.put(req, copy));
      }
      return resp;
    }).catch(()=> cached))
  );
});
