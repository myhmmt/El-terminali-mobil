// Cache-first + offline fallback (GitHub Pages uyumlu)
const CACHE = 'gg-terminal-v5';
const ASSETS = [
  './',
  './index.html',
  './app.js',
  './manifest.json',
  './beep.ogg',
  './notfound.ogg',
  './icon-192.png',
  './icon-512.png'
];

self.addEventListener('install', e=>{
  e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)));
  self.skipWaiting();
});
self.addEventListener('activate', e=>{
  e.waitUntil(
    caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k))))
  );
  self.clients.claim();
});
self.addEventListener('fetch', e=>{
  if(e.request.method!=='GET'){ return; }
  e.respondWith(
    caches.match(e.request).then(cached=>{
      const net = fetch(e.request).then(res=>{
        caches.open(CACHE).then(c=>c.put(e.request, res.clone()));
        return res;
      }).catch(()=> cached || caches.match('./index.html'));
      return cached || net;
    })
  );
});
