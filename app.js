/* ==== Kalıcı anahtarlar ==== */
const KEY_DB   = 'gg_productDB_v3';   // ürün sözlüğü (kalıcı)
const KEY_LIST = 'gg_items_v3';       // sayım listesi (kalıcı)

/* ==== Elemanlar ==== */
const el = {
  video: q('#video'), cam: q('#cameraSelect'),
  st: q('#scanStatus'), tech: q('#tech'), fps: q('#fps'),
  barcode: q('#barcode'), qty: q('#qty'),
  btnStart: q('#btnStart'), btnStop: q('#btnStop'), btnOne: q('#btnOneShot'),
  btnManualOk: q('#btnManualOk'), btnClearCode: q('#btnClearCode'),
  btnPlus: q('#btnPlus'), btnMinus: q('#btnMinus'),
  btnAdd: q('#btnAdd'), btnUndo: q('#btnUndo'),
  filename: q('#filename'), btnExport: q('#btnExport'), btnCSV: q('#btnCSV'), btnClearList: q('#btnClearList'),
  file: q('#fileInput'), btnClearDB: q('#btnClearDB'), dbCount: q('#dbCount'),
  tbody: q('#tbody'), totalRows: q('#totalRows'), totalQty: q('#totalQty'),
  pName: q('#pName'), pPrice: q('#pPrice'),
  ok: q('#beepOk'), err: q('#beepErr'),
};
function q(s){return document.querySelector(s)}

/* ==== Durum ==== */
let productMap = load(KEY_DB) || {  // { aliasBarcode: {name, price, k: canonical} }
  __unique__: []                    // benzersiz kanonik seti saymak için
};
let items = load(KEY_LIST) || {};    // { canonicalBarcode: qty }
let scanning=false, ms=null, det=null, raf=null;

/* ==== Yardımcılar ==== */
function save(k,v){ localStorage.setItem(k, JSON.stringify(v)); }
function load(k){ try{ return JSON.parse(localStorage.getItem(k)||''); }catch{ return null; } }
function play(a){ try{ a.currentTime=0; a.play(); }catch{} }
function vibrate(ms){ navigator.vibrate?.(ms||30); }

function canonical(code){
  const c = String(code||'').replace(/\D/g,'');
  if(c.length>=13) return c.slice(-13);
  if(c.length===8) return c;
  return c; // diğerleri olduğu gibi
}
function aliases(code){
  const c = String(code||'').replace(/\D/g,'');
  const set = new Set([c, c.slice(-13), c.slice(-8)]);
  if(c.length<13 && c) set.add(c.padStart(13,'0'));
  return [...set].filter(Boolean);
}
function fmtPrice(n){ return (n==null||isNaN(n)) ? '—' : Number(n).toFixed(2).replace('.',','); }

/* ==== UI durum ==== */
function updateDBCount(){
  const uniq = new Set(productMap.__unique__||[]);
  el.dbCount.textContent = uniq.size + ' ürün yüklü';
}
function renderList(){
  el.tbody.innerHTML=''; let sum=0;
  Object.entries(items).forEach(([code,qty])=>{
    sum += Number(qty)||0;
    const rec = productMap[code]; // kanonik anahtar üzerinden isim
    const name = rec?.name || '';
    const tr=document.createElement('tr');
    tr.innerHTML = `<td>${code}</td><td>${name}</td><td class="right">${qty}</td>
                    <td class="right"><button data-del="${code}">Sil</button></td>`;
    el.tbody.appendChild(tr);
  });
  el.totalRows.textContent = Object.keys(items).length;
  el.totalQty.textContent = sum;
}
el.tbody.addEventListener('click', e=>{
  const code = e.target.getAttribute?.('data-del'); if(!code) return;
  delete items[code]; save(KEY_LIST,items); renderList();
});

/* ==== Ürün göster ==== */
function showProduct(code){
  const keys = aliases(code);
  let rec=null;
  for(const k of keys){ if(productMap[k]){ rec=productMap[k]; break; } }
  if(rec){ el.pName.textContent=rec.name||'—'; el.pPrice.textContent=fmtPrice(rec.price); play(el.ok); vibrate(20); return true; }
  else   { el.pName.textContent='Ürün bulunamadı'; el.pPrice.textContent='—'; play(el.err); vibrate(60); return false; }
}

/* ==== Liste işlemleri ==== */
let lastOp=null;
function upsert(code, qty){
  if(!code) return;
  const key = canonical(code);
  const n = Math.max(1, Number(qty)||1);
  items[key] = (Number(items[key])||0)+n;
  lastOp={code:key, qty:n}; save(KEY_LIST,items); renderList();
}
function undo(){
  if(!lastOp) return;
  const cur = (Number(items[lastOp.code])||0)-lastOp.qty;
  if(cur>0) items[lastOp.code]=cur; else delete items[lastOp.code];
  lastOp=null; save(KEY_LIST,items); renderList();
}

/* ==== Dışa aktarma ==== */
function dl(name,content,type){ const a=document.createElement('a'); a.href=URL.createObjectURL(new Blob([content],{type})); a.download=name; a.click(); URL.revokeObjectURL(a.href); }
function exportTXT(){ const lines = Object.entries(items).map(([c,q])=>`${c};${q}`); dl((el.filename.value||'sayim')+'.txt', lines.join('\n'),'text/plain;charset=utf-8'); }
function exportCSV(){
  const lines = ['barkod,isim,adet', ...Object.entries(items).map(([c,q])=>{
    const nm = (productMap[c]?.name||'').replace(/"/g,'""'); return `"${c}","${nm}",${q}`;
  })];
  dl((el.filename.value||'sayim')+'.csv', lines.join('\n'),'text/csv;charset=utf-8');
}

/* ==== Ürün dosyası yükleme ==== */
function parsePrice(s){
  if(!s) return null;
  let t = String(s).trim().replace(/\s+/g,'').replace(/\./g,'').replace(',', '.');
  const n = Number(t); return isNaN(n)? null : n;
}
function parseFile(text){
  const out = {...productMap, __unique__: [...(productMap.__unique__||[])] };
  const uniq = new Set(out.__unique__);
  const lines = text.replace(/\r/g,'\n').split('\n');
  for(let raw of lines){
    if(!raw) continue;
    const line = raw.replace(/\uFEFF/g,'').trim(); if(!line) continue;
    let parts = line.split(';'); if(parts.length<2) parts=line.split('\t'); if(parts.length<2) parts=line.split(',');
    if(parts.length<2) continue;
    const rawCode = (parts[0]||'').replace(/\D/g,''); if(!rawCode) continue;
    const name = (parts[1]||'').toString().trim();
    const price = parsePrice(parts[2]);

    const k = canonical(rawCode); uniq.add(k);
    const rec = { name, price, k };

    // alias kayıtları (eşleşmeyi kolaylaştırır)
    for(const a of aliases(rawCode)){ out[a]=rec; }
    // kanonik anahtara da yaz (isim/price’ı buradan çekeriz)
    out[k]=rec;
  }
  out.__unique__ = [...uniq];
  return out;
}
el.file.addEventListener('change', async(e)=>{
  const f = e.target.files?.[0]; if(!f) return;
  const text = await f.text();
  productMap = parseFile(text);
  save(KEY_DB, productMap);
  updateDBCount();
  if(el.barcode.value) showProduct(el.barcode.value);
});
el.btnClearDB.onclick = ()=>{ if(confirm('Ürün verisini sil?')){ productMap={__unique__:[]}; save(KEY_DB,productMap); updateDBCount(); el.pName.textContent='—'; el.pPrice.textContent='—'; }};

/* ==== Kamera / BarcodeDetector ==== */
async function listCameras(){
  try{
    const devices = await navigator.mediaDevices.enumerateDevices();
    const cams = devices.filter(d=>d.kind==='videoinput');
    el.cam.innerHTML='';
    cams.forEach((d,i)=>{ const o=document.createElement('option'); o.value=d.deviceId; o.textContent=d.label||`camera ${i+1}`; el.cam.appendChild(o); });
    const rear = cams.find(d=>/back|rear|arka/i.test(d.label||'')) || cams[0];
    el.cam.value = rear?.deviceId || cams[0]?.deviceId || '';
  }catch{}
}
function stopCam(){
  scanning=false; cancelAnimationFrame(raf); raf=null; el.fps.textContent='FPS: -';
  const s = el.video.srcObject; if(s?.getTracks) s.getTracks().forEach(t=>t.stop());
  el.video.srcObject=null; el.st.textContent='Durduruldu';
}
async function startCam(){
  stopCam(); el.st.textContent='Kamera açılıyor...';
  try{
    const devId = el.cam.value;
    ms = await navigator.mediaDevices.getUserMedia({
      video: devId? {deviceId:{exact:devId}, width:{ideal:1920}, height:{ideal:1080}, focusMode:'continuous'}
                   : {facingMode:'environment', width:{ideal:1920}, height:{ideal:1080}, focusMode:'continuous'},
      audio:false
    });
    el.video.srcObject=ms; await el.video.play();
    det = det || new BarcodeDetector({formats:['ean_13','ean_8','code_128','code_39','itf','upc_e','upc_a']});
    scanning=true; el.st.textContent='Tarama aktif'; el.tech.textContent='Motor: BarcodeDetector';
    fpsLoop(); loop();
    unlockAudio(); // <== ses kilidini aç
  }catch(e){ el.st.textContent='Tarama başlatılamadı'; }
}
function fpsLoop(){ let frames=0,last=performance.now(); const tick=()=>{ if(!scanning) return; const now=performance.now(); if(++frames && now-last>=1000){ el.fps.textContent='FPS: '+frames; frames=0; last=now; } requestAnimationFrame(tick); }; tick(); }
function roi(){ const vw=el.video.videoWidth, vh=el.video.videoHeight; const rw=Math.floor(vw*0.7), rh=Math.floor(vh*0.32); const rx=Math.floor((vw-rw)/2), ry=Math.floor((vh-rh)/2); return {rx,ry,rw,rh}; }
function loop(){
  const off=document.createElement('canvas'); const ctx=off.getContext('2d',{willReadFrequently:true});
  const step=async()=>{ if(!scanning) return; const vw=el.video.videoWidth,vh=el.video.videoHeight;
    if(vw&&vh){ const {rx,ry,rw,rh}=roi(); off.width=rw; off.height=rh; ctx.drawImage(el.video,rx,ry,rw,rh,0,0,rw,rh);
      try{ const r=await det.detect(off); if(r&&r.length){ onScan((r[0].rawValue||'').trim()); } }catch{} }
    raf=requestAnimationFrame(step);
  }; step();
}
function onScan(text){
  const code = String(text||'').replace(/\D/g,''); if(!code) return;
  el.barcode.value = code; showProduct(code);
}

/* ==== Ses kilidi açma (mobile) ==== */
let audioUnlocked=false;
function unlockAudio(){
  if(audioUnlocked) return;
  audioUnlocked=true;
  // Kullanıcı aksiyonu sonrası kısık sesle çal-durdur
  [el.ok, el.err].forEach(a=>{ try{ a.volume=0.01; a.play().then(()=>a.pause()).catch(()=>{}); }catch{} });
}

/* ==== Etkileşimler ==== */
el.btnStart.onclick = async()=>{ await listCameras(); startCam(); };
el.btnStop.onclick = ()=> stopCam();
el.btnOne.onclick = async()=>{ await listCameras(); startCam(); /* tek okut = ilk yakalayınca Ekle yapmıyoruz, sadece dolduruyor */ };

el.btnPlus.onclick = ()=> el.qty.value = Math.max(1,(+el.qty.value||1)+1);
el.btnMinus.onclick = ()=> el.qty.value = Math.max(1,(+el.qty.value||1)-1);
el.btnAdd.onclick   = ()=>{ const code=el.barcode.value.trim(); if(!code) return; upsert(code, el.qty.value); el.qty.value=1; el.barcode.select(); };
el.btnUndo.onclick  = ()=> undo();

el.btnClearList.onclick = ()=>{ if(confirm('Listeyi temizlemek istiyor musun?')){ items={}; save(KEY_LIST,items); renderList(); } };
el.btnExport.onclick = ()=> exportTXT();
el.btnCSV.onclick = ()=> exportCSV();

el.btnManualOk.onclick = ()=>{ unlockAudio(); const code=el.barcode.value.trim(); if(!code) return; showProduct(code); el.qty.focus(); el.qty.select(); };
el.btnClearCode.onclick = ()=>{ el.barcode.value=''; el.pName.textContent='—'; el.pPrice.textContent='—'; el.barcode.focus(); };
el.barcode.addEventListener('keydown', e=>{ if(e.key==='Enter'){ e.preventDefault(); el.btnManualOk.click(); }});
el.qty.addEventListener('keydown', e=>{ if(e.key==='Enter'){ e.preventDefault(); el.btnAdd.click(); }});

/* ==== İlk yükleme ==== */
renderList(); updateDBCount();
listCameras();
