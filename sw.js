// Genç Gross Mobil Terminal — Service Worker (offline desteği)
const CACHE_NAME = 'gg-terminal-v15';

const FILES_TO_CACHE = [
  './',
  './index.html',
  './app.js?v=15',
  './manifest.json?v=15',
  './beep.ogg',
  './error.ogg',
  './icon-192.png',
  './icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(FILES_TO_CACHE))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keyList) => {
      return Promise.all(
        keyList.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request, {ignoreSearch:true}).then((response) => {
      return response || fetch(event.request);
    })
  );
});
