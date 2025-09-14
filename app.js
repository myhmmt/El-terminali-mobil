/* ==== Durum ==== */
const S = {
  scanning:false, ms:null, det:null, raf:null, frames:0,
  items:{}, lastOp:null, products:new Map(), productCount:0
};

/* ==== Elemanlar ==== */
const selCam = document.getElementById('cameraSelect');
const video  = document.getElementById('video');
const st     = document.getElementById('st');
const eng    = document.getElementById('eng');
const fpsEl  = document.getElementById('fps');
const barcodeInp = document.getElementById('barcode');
const qtyInp     = document.getElementById('qty');
const tbody      = document.getElementById('tbody');
const totalRows  = document.getElementById('totalRows');
const totalQty   = document.getElementById('totalQty');
const pName      = document.getElementById('pName');
const pPrice     = document.getElementById('pPrice');
const filenameInp= document.getElementById('filename');
const beep       = document.getElementById('beep');
const productCountEl = document.getElementById('productCount');

/* ==== Yardımcılar ==== */
const vibrate = ms => navigator.vibrate?.(ms||30);
const trPrice = s => {
  // "11,90" → 11.90 — karışık metinlerde sonda kalan virgüllü sayı seçilir.
  if (typeof s !== 'string') return null;
  const m = s.match(/(\d{1,3}(?:\.\d{3})*|\d+),(?:\d{1,2})\s*$/);
  if (!m) return null;
  const norm = m[0].replace(/\./g,'').replace(',','.');
  return parseFloat(norm);
};
const fmtPrice = n => n==null || isNaN(n) ? '—' : n.toFixed(2).replace('.',',');

/* Kod normalize – EAN-8/13 kısa/uzun tutarlılığı */
function normCandidates(code){
  const c = String(code).replace(/\D/g,'');
  const arr = new Set([c, c.slice(-13), c.slice(-8)]);
  if (c.length<13) arr.add(c.padStart(13,'0'));
  return [...arr];
}

/* ==== Ürün verisi ==== */
function clearProducts(){
  S.products.clear(); S.productCount=0; productCountEl.textContent='0';
  pName.textContent='—'; pPrice.textContent='—';
  localStorage.removeItem('gg_products');
}

function loadProductsFromStorage(){
  const raw = localStorage.getItem('gg_products');
  if(!raw) return;
  try{
    const obj = JSON.parse(raw);
    S.products = new Map(obj.data);
    S.productCount = obj.count||S.products.size;
    productCountEl.textContent = String(S.productCount);
  }catch{}
}

async function handleFile(file){
  const text = await file.text();
  // satır satır: barkod;isim;fiyat
  const lines = text.split(/\r?\n/);
  let count = 0;
  for(const line of lines){
    if(!line.trim()) continue;
    const parts = line.split(';');
    const barkod = (parts[0]||'').trim();
    const isim   = (parts[1]||'').trim();
    const fiyatS = (parts[2]||'').trim();
    if(!barkod) continue;
    const fiyatN = trPrice(fiyatS);
    const rec = { barkod, isim, fiyat: fiyatN };
    for(const k of normCandidates(barkod)) {
      S.products.set(k, rec);
    }
    count++;
  }
  S.productCount = S.products.size;
  productCountEl.textContent = String(S.productCount);
  // kalıcı
  localStorage.setItem('gg_products', JSON.stringify({data:[...S.products], count:S.productCount}));
}

document.getElementById('fileInput').addEventListener('change', e=>{
  const f = e.target.files?.[0]; if(f) handleFile(f);
});
document.getElementById('btnClearProducts').onclick = clearProducts;

/* Barkoda göre ürün getir */
function showProduct(code){
  let rec=null;
  for(const k of normCandidates(code)){
    if(S.products.has(k)){ rec=S.products.get(k); break; }
  }
  if(rec){
    pName.textContent = rec.isim || '—';
    pPrice.textContent = fmtPrice(rec.fiyat);
  }else{
    pName.textContent='—'; pPrice.textContent='—';
  }
}

/* ==== Liste işlemleri ==== */
function saveList(){ localStorage.setItem('gg_items', JSON.stringify(S.items)); }
function loadList(){ try{ const r=localStorage.getItem('gg_items'); if(r) S.items=JSON.parse(r)||{}; }catch{}; render(); }
function render(){
  tbody.innerHTML='';
  let sum=0;
  for(const [code, row] of Object.entries(S.items)){
    sum += row.qty;
    const tr=document.createElement('tr');
    tr.innerHTML = `
      <td>${code}</td>
      <td>${row.name||''}</td>
      <td class="right">${row.qty}</td>
      <td class="right"><button class="mini warn" data-del="${code}">Sil</button></td>
    `;
    tbody.appendChild(tr);
  }
  totalRows.textContent = Object.keys(S.items).length;
  totalQty.textContent  = sum;
}
tbody.addEventListener('click', e=>{
  const code = e.target.getAttribute?.('data-del');
  if(!code) return;
  delete S.items[code]; saveList(); render();
});

function upsert(code, qty){
  if(!code) return;
  const n = Math.max(1, Number(qty)||1);
  const rec = S.products.get(code) || S.products.get(code.slice(-13)) || S.products.get(code.slice(-8)) || {};
  const curr = S.items[code]?.qty || 0;
  S.items[code] = { qty: curr + n, name: rec.isim || '' };
  S.lastOp = { code, qty:n };
  saveList(); render();
}
function undo(){
  const op=S.lastOp; if(!op) return;
  const cur = S.items[op.code]?.qty || 0;
  const left = cur - op.qty;
  if(left>0) S.items[op.code].qty = left; else delete S.items[op.code];
  S.lastOp=null; saveList(); render();
}

/* Dışa aktarma (TXT: barkod;qty, CSV: barkod,isim,qty) */
function dl(name,content,type){ const a=document.createElement('a'); a.href=URL.createObjectURL(new Blob([content],{type})); a.download=name; a.click(); URL.revokeObjectURL(a.href); }
function exportTXT(){
  const lines = Object.entries(S.items).map(([c,r])=>`${c};${r.qty}`);
  dl((filenameInp.value||'sayim')+'.txt', lines.join('\n'), 'text/plain');
}
function exportCSV(){
  const lines = ['barkod,isim,adet', ...Object.entries(S.items).map(([c,r])=>`${c},"${(r.name||'').replace(/"/g,'""')}",${r.qty}`)];
  dl((filenameInp.value||'sayim')+'.csv', lines.join('\n'), 'text/csv');
}

/* ==== Kamera & Okuma (BarcodeDetector) ==== */
async function listCameras(){
  try{
    const devices = await navigator.mediaDevices.enumerateDevices();
    const cams = devices.filter(d=>d.kind==='videoinput');
    selCam.innerHTML='';
    cams.forEach((d,i)=>{ const o=document.createElement('option'); o.value=d.deviceId; o.textContent=d.label||`camera ${i+1}`; selCam.appendChild(o); });
    const rear = cams.find(d=>/back|arka|rear/i.test(d.label||'')) || cams[0];
    selCam.value = rear?.deviceId || cams[0]?.deviceId || '';
  }catch{}
}

async function start(scanOnce=false){
  stop();
  st.textContent='Kamera açılıyor...';
  try{
    const constraints = selCam.value
      ? {video:{deviceId:{exact:selCam.value}, width:{ideal:1920}, height:{ideal:1080}, focusMode:'continuous'}, audio:false}
      : {video:{facingMode:{ideal:'environment'}, width:{ideal:1920}, height:{ideal:1080}, focusMode:'continuous'}, audio:false};
    S.ms = await navigator.mediaDevices.getUserMedia(constraints);
    video.srcObject = S.ms; await video.play();
    S.det = S.det || new BarcodeDetector({formats:['ean_13','ean_8','code_128','code_39','itf','upc_e','upc_a']});
    S.scanning = true; st.textContent='Tarama aktif'; eng.textContent='Motor: BarcodeDetector';
    S.frames=0; fpsLoop();

    if(scanOnce){ singleShotLoop(); } else { loop(); }
  }catch(e){
    st.textContent='Tarama başlatılamadı';
  }
}
function stop(){
  cancelAnimationFrame(S.raf); S.raf=null; fpsEl.textContent='FPS: -';
  const s = video.srcObject; if(s?.getTracks) s.getTracks().forEach(t=>t.stop());
  video.srcObject=null; S.scanning=false; st.textContent='Durduruldu';
}
function fpsLoop(){
  let last=performance.now();
  const tick=()=>{ if(!S.scanning) return;
    const now=performance.now(); if(now-last>=1000){ fpsEl.textContent='FPS: '+S.frames; S.frames=0; last=now; }
    requestAnimationFrame(tick);
  }; tick();
}
function roi(){ const vw=video.videoWidth, vh=video.videoHeight;
  const rw=Math.floor(vw*0.70), rh=Math.floor(vh*0.32);
  const rx=Math.floor((vw-rw)/2), ry=Math.floor((vh-rh)/2);
  return {rx,ry,rw,rh};
}
async function loop(){
  const off = document.createElement('canvas'); const ctx = off.getContext('2d',{willReadFrequently:true});
  const step = async ()=>{
    if(!S.scanning) return;
    S.frames++;
    const vw=video.videoWidth, vh=video.videoHeight;
    if(vw&&vh){
      const {rx,ry,rw,rh}=roi();
      off.width=rw; off.height=rh; ctx.drawImage(video,rx,ry,rw,rh,0,0,rw,rh);
      try{
        const res = await S.det.detect(off);
        if(res && res.length){
          const code = (res[0].rawValue||'').trim();
          onCode(code); // sadece göster + ses, listeye Ekle’ye basınca girilecek
        }
      }catch{}
    }
    S.raf = requestAnimationFrame(step);
  };
  step();
}
async function singleShotLoop(){
  const off = document.createElement('canvas'); const ctx = off.getContext('2d',{willReadFrequently:true});
  const started = performance.now();
  const step = async ()=>{
    if(!S.scanning) return;
    const vw=video.videoWidth, vh=video.videoHeight;
    if(vw&&vh){
      const {rx,ry,rw,rh}=roi();
      off.width=rw; off.height=rh; ctx.drawImage(video,rx,ry,rw,rh,0,0,rw,rh);
      try{
        const res = await S.det.detect(off);
        if(res && res.length){
          const code = (res[0].rawValue||'').trim();
          onCode(code);
          stop(); // tek okut modunda durdur
          return;
        }
      }catch{}
    }
    if(performance.now()-started<8000){ S.raf = requestAnimationFrame(step); }
    else stop();
  };
  step();
}
function onCode(code){
  if(!code) return;
  barcodeInp.value = code; // sadece alanı doldur
  showProduct(code);       // isim & fiyat göster
  try{ beep.currentTime=0; beep.play(); }catch{}
  vibrate(25);
}

/* ==== UI ==== */
document.getElementById('btnStart').onclick = async()=>{ await listCameras(); start(false); };
document.getElementById('btnStop').onclick  = ()=> stop();
document.getElementById('btnSingle').onclick= async()=>{ await listCameras(); start(true); };

document.getElementById('btnPlus').onclick  = ()=> qtyInp.value = Math.max(1,(+qtyInp.value||1)+1);
document.getElementById('btnMinus').onclick = ()=> qtyInp.value = Math.max(1,(+qtyInp.value||1)-1);
document.getElementById('btnAdd').onclick   = ()=>{
  const code = barcodeInp.value.trim();
  const qty  = qtyInp.value;
  if(!code) return;
  upsert(code, qty);
  // alanı boş bırak ama klavyeyi sadece kullanıcı adet alanına tıklarsa açsın
  barcodeInp.blur();
};
document.getElementById('btnUndo').onclick  = ()=> undo();
document.getElementById('btnExport').onclick= ()=> exportTXT();
document.getElementById('btnCSV').onclick   = ()=> exportCSV();
document.getElementById('btnClear').onclick = ()=>{ if(confirm('Listeyi temizlemek istiyor musun?')){ S.items={}; saveList(); render(); } };
document.getElementById('btnClearBarcode').onclick = ()=>{ barcodeInp.value=''; pName.textContent='—'; pPrice.textContent='—'; };

barcodeInp.addEventListener('input', ()=>{ const v=barcodeInp.value.trim(); if(v) showProduct(v); });

/* ==== Başlat ==== */
loadProductsFromStorage();
loadList();
listCameras();
