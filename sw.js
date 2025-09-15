const CACHE = 'gg-cache-v4';
const ASSETS = [
  '/', '/index.html', '/styles.css', '/app.js',
  '/beep.ogg', '/accepted.ogg', '/error.ogg',
  '/icon-192.png', '/icon-512.png', '/manifest.json'
];

self.addEventListener('install', e=>{
  e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)));
});

self.addEventListener('activate', e=>{
  e.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(k => k !== CACHE).map(k => caches.delete(k))
    ))
  );
});

self.addEventListener('fetch', e=>{
  e.respondWith(
    caches.match(e.request).then(r => r || fetch(e.request))
  );
});
