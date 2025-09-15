// PWA önbellek
const CACHE = 'gg-terminal-v7';
const ASSETS = [
  './','index.html','app.js','manifest.json',
  'beep.ogg','error.ogg'
];

self.addEventListener('install',e=>{
  e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)));
});

self.addEventListener('activate',e=>{
  e.waitUntil(
    caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k))))
  );
});

self.addEventListener('fetch',e=>{
  const req=e.request;
  e.respondWith(
    caches.match(req).then(cached=>{
      return cached || fetch(req).then(res=>{
        if(req.method==='GET'){
          const clone=res.clone();
          caches.open(CACHE).then(c=>c.put(req, clone)).catch(()=>{});
        }
        return res;
      }).catch(()=>cached || new Response('Çevrimdışı', {status:503, statusText:'offline'}));
    })
  );
});
