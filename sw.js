// Basit offline cache
const CACHE = 'gg-terminal-v2';
const ASSETS = [
  './',
  './index.html',
  './app.js',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './beep.ogg',
  './error.ogg'
];

self.addEventListener('install', (e)=>{
  e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)));
  self.skipWaiting();
});
self.addEventListener('activate', (e)=>{
  e.waitUntil(
    caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k))))
  );
  self.clients.claim();
});
self.addEventListener('fetch', (e)=>{
  const req = e.request;
  // Önce cache, yoksa ağ; ağ da yoksa cachete ne varsa
  e.respondWith(
    caches.match(req).then(res=> res || fetch(req).catch(()=>caches.match('./index.html')))
  );
});
