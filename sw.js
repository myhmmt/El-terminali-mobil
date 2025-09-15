const V='gg-terminal-v12';
const CORE=[
  './',
  'index.html',
  'app.js',
  'manifest.json',
  'beep.ogg',
  'error.ogg'
];

self.addEventListener('install', e=>{
  e.waitUntil(caches.open(V).then(c=>c.addAll(CORE)));
  self.skipWaiting();
});

self.addEventListener('activate', e=>{
  e.waitUntil(
    caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==V).map(k=>caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', e=>{
  const req=e.request;
  if(req.method!=='GET'){ return; }
  e.respondWith(
    caches.match(req).then(cached=>{
      if(cached) return cached;
      return fetch(req).then(res=>{
        const copy=res.clone();
        caches.open(V).then(c=>c.put(req,copy)).catch(()=>{});
        return res;
      }).catch(()=>caches.match('./'));
    })
  );
});
