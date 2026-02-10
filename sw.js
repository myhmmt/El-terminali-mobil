const CACHE_NAME = "ggmt-v2.2";
const FILES_TO_CACHE = [
  "./",
  "./index.html",
  "./app.js?v=2.1",
  "./manifest.json",
  "./icon-192.png",
  "./icon-512.png",
  "./beep.ogg",
  "./error.ogg"
];

self.addEventListener("install", e=>{
  e.waitUntil(caches.open(CACHE_NAME).then(c=>c.addAll(FILES_TO_CACHE)));
});

self.addEventListener("activate", e=>{
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
});

// Bilgi.txt ve dış kaynaklar daima NETWORK (no-store)
self.addEventListener("fetch", e=>{
  const url = new URL(e.request.url);

  const isRemoteList =
    url.pathname.endsWith("/Bilgi.txt") ||
    url.hostname === "raw.githubusercontent.com" ||
    url.hostname === "cdn.jsdelivr.net" ||
    (url.hostname.endsWith("github.io") && url.pathname.includes("/El-terminali-mobil/") && url.pathname.endsWith("Bilgi.txt"));

  if (isRemoteList) {
    e.respondWith(fetch(e.request, { cache: "no-store" }));
    return;
  }

  // diğerleri cache-first
  e.respondWith(
    caches.match(e.request).then(r => r || fetch(e.request))
  );
});
