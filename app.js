/* GENÇ GROSS Mobil Terminal */
const APP_VERSION = 'v7';

const state = { items:{}, scanning:false, currentDeviceId:null, singleShot:false };
let mediaStream=null, rafId=null, frames=0, lastOp=null;
let duplicateGuard={code:null,until:0};
let detector=null, off=null, octx=null;

let productMap = {};       // { barcodeOrCode: { name, price } }
let nameIndex   = [];      // [{t:'ONURLU KOLONYA', code:'868…', price:'…'}]

/* ==== DOM ==== */
const selCam  = document.getElementById('cameraSelect');
const video   = document.getElementById('video');
const statusEl= document.getElementById('scanStatus');
const fpsEl   = document.getElementById('fps');
const btnScanOnce = document.getElementById('btnScanOnce');

const barcodeInp = document.getElementById('barcode');
const qtyInp     = document.getElementById('qty');
const tbody      = document.getElementById('tbody');
const totalRows  = document.getElementById('totalRows');
const totalQty   = document.getElementById('totalQty');
const filenameInp= document.getElementById('filename');

const productFile= document.getElementById('productFile');
const encodingSel= document.getElementById('encoding');
const mapStat    = document.getElementById('mapStat');

const productNameEl = document.getElementById('productName');
const productPriceEl= document.getElementById('productPrice');

const beep  = document.getElementById('beep');
const errSnd= document.getElementById('error');

function render(){
  tbody.innerHTML=''; let sum=0;
  Object.entries(state.items).forEach(([c,q])=>{
    sum += Number(q)||0;
    const name = productMap[c]?.name || '—';
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${c}</td><td>${name}</td><td class="right">${q}</td>
                    <td><button onclick="delRow('${c}')">Sil</button></td>`;
    tbody.appendChild(tr);
  });
  totalRows.textContent = Object.keys(state.items).length;
  totalQty.textContent  = sum;
}
window.delRow = (c)=>{ delete state.items[c]; saveList(); render(); };

function upsert(code, qty){
  if(!code) return;
  const n = Math.max(1, Number(qty)||1);
  state.items[code] = (Number(state.items[code])||0) + n;
  lastOp = { code, qty:n };
  saveList(); render();
}
function undo(){
  if(!lastOp) return;
  const {code,qty} = lastOp;
  state.items[code] = (Number(state.items[code])||0) - qty;
  if(state.items[code] <= 0) delete state.items[code];
  lastOp = null; saveList(); render();
}
function saveList(){ localStorage.setItem('gg_list', JSON.stringify(state.items)); }
function loadList(){
  try{ const raw=localStorage.getItem('gg_list'); if(raw) state.items = JSON.parse(raw)||{}; }catch{}
  render();
}

/* ====== Export ====== */
function dl(name, content, type){
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([content],{type}));
  a.download = name; a.click(); URL.revokeObjectURL(a.href);
}
function exportTXT(){
  const lines = Object.entries(state.items).map(([c,q])=>`${c};${q}`);
  dl((filenameInp.value||'sayim')+'.txt', lines.join('\n'), 'text/plain');
}
function exportCSV(){
  const lines = ['code,qty', ...Object.entries(state.items).map(([c,q])=>`${c},${q}`)];
  dl((filenameInp.value||'sayim')+'.csv', lines.join('\n'), 'text/csv');
}

/* ====== Kamera / BarcodeDetector ====== */
async function listCameras(){
  try{
    const devices = await navigator.mediaDevices.enumerateDevices();
    const videos = devices.filter(d=>d.kind==='videoinput');
    selCam.innerHTML='';
    videos.forEach((d,i)=>{
      const o=document.createElement('option'); o.value=d.deviceId; o.textContent=d.label||`Kamera ${i+1}`;
      selCam.appendChild(o);
    });
    const rear = videos.find(d=>/back|rear|arka/i.test(d.label||''));
    state.currentDeviceId = rear?.deviceId || videos[0]?.deviceId || null;
    if(state.currentDeviceId) selCam.value = state.currentDeviceId;
  }catch(e){}
}
selCam.onchange = ()=>{ state.currentDeviceId = selCam.value; if(state.scanning) start(); };

async function start(){
  stop(); statusEl.textContent='Kamera açılıyor...';
  try{
    const constraints = {
      video: state.currentDeviceId
        ? {deviceId:{exact:state.currentDeviceId}, width:{ideal:1920}, height:{ideal:1080}}
        : {facingMode:{ideal:'environment'}, width:{ideal:1920}, height:{ideal:1080}},
      audio:false
    };
    mediaStream = await navigator.mediaDevices.getUserMedia(constraints);
    video.srcObject = mediaStream; await video.play();
    state.scanning = true; statusEl.textContent = 'Tarama aktif';
    runNativeLoop(); fpsCounter();
  }catch(e){ statusEl.textContent='Tarama başlatılamadı'; }
}
function stop(){
  cancelAnimationFrame(rafId); rafId=null; frames=0; fpsEl.textContent='FPS: -';
  const s=video.srcObject; if(s?.getTracks) s.getTracks().forEach(t=>t.stop());
  video.srcObject=null; mediaStream=null; state.scanning=false; statusEl.textContent='Durduruldu';
}

async function runNativeLoop(){
  if(!('BarcodeDetector' in window)){ statusEl.textContent='Desteklenmiyor'; return; }
  if(!detector) detector = new BarcodeDetector({formats:['ean_13','ean_8','code_128','code_39','itf','upc_e','upc_a']});
  if(!off){ off=document.createElement('canvas'); octx=off.getContext('2d',{willReadFrequently:true}); }
  const loop = async ()=>{
    if(!state.scanning) return; frames++;
    const vw=video.videoWidth, vh=video.videoHeight;
    if(vw && vh){
      const rw=Math.floor(vw*0.68), rh=Math.floor(vh*0.32);
      const rx=Math.floor((vw-rw)/2), ry=Math.floor((vh-rh)/2);
      off.width=rw; off.height=rh; octx.drawImage(video,rx,ry,rw,rh,0,0,rw,rh);
      try{
        const d = await detector.detect(off);
        if(d && d.length){ onCode((d[0].rawValue||'').trim()); }
      }catch(_){}
    }
    if(state.scanning) rafId = requestAnimationFrame(loop);
  };
  loop();
}
function onCode(text){
  if(!text) return;
  const now = performance.now();
  if(text===duplicateGuard.code && now<duplicateGuard.until) return;
  duplicateGuard = {code:text, until:now+1500};

  barcodeInp.value = text;
  showProductInfo(text);

  // Sesler
  const known = !!productMap[text];
  try{ (known?beep:errSnd).currentTime = 0; (known?beep:errSnd).play(); }catch(_){}
  if(navigator.vibrate) navigator.vibrate(known?30:60);

  if(state.singleShot){
    stop(); btnScanOnce.disabled=true; btnScanOnce.textContent='Okundu ✓';
    setTimeout(()=>{ btnScanOnce.disabled=false; btnScanOnce.textContent='👉 Tek Okut'; },900);
    state.singleShot=false;
  }
}
function fpsCounter(){
  let last=performance.now();
  const tick=()=>{ if(!state.scanning) return;
    const now=performance.now(); if(now-last>=1000){ fpsEl.textContent='FPS: '+frames; frames=0; last=now; }
    requestAnimationFrame(tick);
  }; tick();
}

/* ====== ÜRÜN VERİSİ ====== */
document.getElementById('btnClearMap').onclick = ()=>{
  productMap={}; nameIndex=[]; localStorage.removeItem('gg_products'); mapStat.textContent='0 ürün yüklü';
  showProductInfo('');
};

productFile.onchange = async (e)=>{
  const file = e.target.files?.[0]; if(!file) return;
  let txt='';
  try{
    const buf = await file.arrayBuffer();
    const dec = new TextDecoder(encodingSel.value);
    txt = dec.decode(buf);
  }catch{
    alert('Dosya okunamadı.'); return;
  }
  loadProductText(txt, file.name||'dosya');
};

function loadProductText(txt, src='metin'){
  try{
    let map={};
    if(txt.startsWith('<SIGNATURE=GNDPLU.GDF>')) map = parseGDF(txt);
    else if(txt.trim().startsWith('{')) {
      const obj = JSON.parse(txt);
      for(const [k,v] of Object.entries(obj)){
        if(typeof v==='string') map[k]={name:v,price:''};
        else map[k]={name:v.name||'',price:v.price||''};
      }
    } else {
      map = parseCSV(txt);
    }
    const count = Object.keys(map).length;
    if(!count){ alert('0 ürün bulundu. CSV biçimi: Stok kodu;Stok ismi;...;Fiyat 1'); return; }

    productMap = map;
    buildNameIndex();
    localStorage.setItem('gg_products', JSON.stringify(productMap));
    mapStat.textContent = count+' ürün yüklü';
    showProductInfo(barcodeInp.value.trim());
  }catch(err){
    console.error(err);
    alert('Veri çözümlenemedi. CSV/TXT (Stok kodu;Stok ismi;…;Fiyat 1), JSON veya GDF kullanın.');
  }
}

// CSV: "Stok kodu;Stok ismi;...;Fiyat 1"
function parseCSV(txt){
  const lines = txt.split(/\r?\n/).filter(x=>x.trim().length);
  const sep   = lines[0]?.includes(';') ? ';' : ',';
  const map={};
  for(const L of lines){
    const c = L.split(sep).map(s=>s.trim());
    if(c.length<2) continue;
    const code  = (c[0]||'').replace(/\s+/g,'');
    const name  = c[1]||'';
    let price   = extractRightmostPrice(L); // satırın en sağındaki fiyatı al
    if(!price && c.length>=3) price = extractRightmostPrice(c.slice(2).join(' '));
    if(code) map[code] = {name, price};
  }
  return map;
}
function extractRightmostPrice(text){
  // 0011,90 | 1.234,50 | 11,90 vb.
  const re=/\d{1,3}(?:\.\d{3})*,\d{2}|\d+,\d{2}/g;
  let last=''; let m;
  while((m=re.exec(text))){ last = normalizePrice(m[0]); }
  return last;
}
function normalizePrice(p){
  if(!p) return '';
  p = p.replace(/\s+/g,'').replace(/\./g,'');
  const n = Number(p.replace(',','.'));
  if(!isFinite(n) || n<=0 || n>10000) return '';
  return n.toFixed(2).replace('.',',');
}

// GDF (opsiyonel)
function parseGDF(txt){
  const lines=txt.split(/\r?\n/);
  const names={}; let lastPLU=null; const map={};
  for(let i=0;i<lines.length;i++){
    const raw=lines[i]; if(!raw) continue;
    if(raw.startsWith('01')){
      const parts=raw.trim().split(/\s{2,}/);
      if(parts.length>=4){ lastPLU=parts[1]; names[lastPLU]=parts[3]; }
      continue;
    }
    if(raw.startsWith('02')){
      let price = extractRightmostPrice(raw) || extractRightmostPrice(lines[i+1]||'') || extractRightmostPrice(lines[i-1]||'');
      const nums=(raw.match(/\b\d{5,14}\b/g)||[]);
      const candidates=nums.filter(n=>n!==lastPLU);
      const code = candidates.pop() || '';
      const name = names[lastPLU]||'';
      if(code && name) map[code]={name,price};
    }
  }
  return map;
}

function buildNameIndex(){
  nameIndex = Object.entries(productMap).map(([code,v])=>({
    t: normalizeText(v.name),
    code, price:v.price||''
  }));
}

function showProductInfo(code){
  const p = productMap[code];
  if(p){ productNameEl.textContent=p.name||'—'; productPriceEl.textContent=p.price||'—'; }
  else { productNameEl.textContent='Bulunamadı'; productPriceEl.textContent='—'; }
}

/* ====== Arama ====== */
const searchInp = document.getElementById('search');
const searchResults = document.getElementById('searchResults');

function normalizeText(s){ return (s||'').toLocaleUpperCase('tr-TR'); }

searchInp.addEventListener('input', ()=>{
  const q = normalizeText(searchInp.value.trim());
  searchResults.innerHTML='';
  if(!q || !nameIndex.length) return;
  const hits = nameIndex.filter(x=>x.t.includes(q)).slice(0,30);
  for(const h of hits){
    const div=document.createElement('div');
    const name = productMap[h.code]?.name || '';
    const price= productMap[h.code]?.price || '';
    // Stok kodunu göstermiyoruz: Sadece İsim + Barkod + Fiyat
    div.className='result';
    div.innerHTML=`<div style="font-weight:700">${name}</div>
                   <small>${h.code}</small> · <small>${price||'—'}</small>`;
    div.onclick=()=>{ barcodeInp.value=h.code; showProductInfo(h.code); qtyInp.focus(); };
    searchResults.appendChild(div);
  }
});

/* ====== UI Events ====== */
document.getElementById('btnStart').onclick = async()=>{ await listCameras(); start(); };
document.getElementById('btnStop').onclick  = ()=> stop();
btnScanOnce.onclick = async()=>{ await listCameras(); state.singleShot=true; btnScanOnce.disabled=true; btnScanOnce.textContent='Okutuluyor...'; if(!state.scanning) await start(); else statusEl.textContent='Tek seferlik okuma aktif'; };

document.getElementById('btnAdd').onclick   = ()=>{ upsert(barcodeInp.value.trim(), qtyInp.value); barcodeInp.value=''; qtyInp.value=1; showProductInfo(''); barcodeInp.focus(); };
document.getElementById('btnMinus').onclick = ()=>{ qtyInp.value=Math.max(1, Number(qtyInp.value)-1); };
document.getElementById('btnPlus').onclick  = ()=>{ qtyInp.value=Number(qtyInp.value)+1; };
document.getElementById('btnClearField').onclick = ()=>{ barcodeInp.value=''; showProductInfo(''); barcodeInp.focus(); };
document.getElementById('btnExport').onclick= ()=> exportTXT();
document.getElementById('btnCSV').onclick   = ()=> exportCSV();
document.getElementById('btnClear').onclick = ()=>{ if(confirm('Listeyi temizlemek istiyor musun?')){ state.items={}; saveList(); render(); } };
document.getElementById('btnUndo').onclick  = ()=> undo();

// "Tamam": barkodu onayla, miktara geç
document.getElementById('btnDone').onclick = ()=>{
  // Elle girerken de ses çalsın
  const code = barcodeInp.value.trim();
  const known = !!productMap[code];
  try{ (known?beep:errSnd).currentTime=0; (known?beep:errSnd).play(); }catch(_){}
  if(navigator.vibrate) navigator.vibrate(known?30:60);
  showProductInfo(code);
  qtyInp.select(); qtyInp.focus();
};

// Qty Enter => ekle
qtyInp.addEventListener('focus', ()=>{ qtyInp.select(); });
qtyInp.addEventListener('keydown', (e)=>{ if(e.key==='Enter'){ document.getElementById('btnAdd').click(); } });

barcodeInp.addEventListener('input', ()=>{
  // sadece rakam tut
  barcodeInp.value = barcodeInp.value.replace(/\D+/g,'');
  const code = barcodeInp.value;
  if(code.length>=1) showProductInfo(code);
});
barcodeInp.addEventListener('blur', ()=>{
  const code = barcodeInp.value.trim(); if(code) showProductInfo(code);
});

/* ====== Init ====== */
// Ürün haritasını geri yükle
try{
  const raw=localStorage.getItem('gg_products');
  if(raw){
    productMap = JSON.parse(raw)||{};
    buildNameIndex();
    mapStat.textContent = Object.keys(productMap).length + ' ürün yüklü';
  }
}catch{}
loadList(); listCameras();
