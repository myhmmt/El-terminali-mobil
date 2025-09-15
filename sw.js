// Basit PWA önbelleği
const CACHE = 'gg-terminal-v3';
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
        // sadece GET ve aynı origin ise dinamik ekle
        if(req.method==='GET' && new URL(req.url).origin===location.origin){
          const resClone=res.clone();
          caches.open(CACHE).then(c=>c.put(req,resClone));
        }
        return res;
      }).catch(()=>cached || new Response('Çevrimdışı', {status:503, statusText:'offline'}));
    })
  );
});
