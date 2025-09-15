// Basit PWA Service Worker – offline çalışma
const CACHE = 'gg-terminal-v6';
const ASSETS = [
  './',
  './index.html',
  './app.js',
  './manifest.json',
  './beep.ogg',
  './error.ogg',
  './icon-192.png',
  './icon-512.png'
];

self.addEventListener('install', e=>{
  e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)).then(()=>self.skipWaiting()));
});

self.addEventListener('activate', e=>{
  e.waitUntil(
    caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))))
  self.clients.claim();
});

self.addEventListener('fetch', e=>{
  const req = e.request;
  // önce cache, sonra ağ
  e.respondWith(
    caches.match(req).then(res=> res || fetch(req).then(net=>{
      // GET ve aynı origin ise cache’e koy
      try{
        if(req.method==='GET' && new URL(req.url).origin===location.origin){
          const clone = net.clone();
          caches.open(CACHE).then(c=>c.put(req, clone));
        }
      }catch{}
      return net;
    }).catch(()=>caches.match('./index.html')))
  );
});
