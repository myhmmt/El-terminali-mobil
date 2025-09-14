const CACHE = 'gg-terminal-v3';
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
    caches.keys().then(keys=>Promise.all(keys.map(k=>k===CACHE?null:caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', e=>{
  const req = e.request;
  e.respondWith(
    caches.match(req).then(r=> r || fetch(req).then(res=>{
      // runtime cache (isteğe bağlı)
      const copy = res.clone();
      caches.open(CACHE).then(c=>c.put(req, copy));
      return res;
    }).catch(()=> caches.match('./index.html')))
  );
});
