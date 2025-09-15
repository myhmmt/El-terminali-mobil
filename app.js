/* -----------------------------------------
   GENÇ GROSS • Mobil Terminal – app.js (full)
   - Barkod tarama + manuel giriş
   - Listeyi localStorage'da tutar (yenileyince kaybolmaz)
   - Ürün verisi: CSV/TXT (kod;isim;…;fiyat), JSON, GNCPULUF (1; / 3; / 4;)
   - GNCPULUF: 1->İsim, 3->Barkod, 4->Fiyat(5. sütun)
------------------------------------------*/

// ============= GLOBAL STATE =============
const state = {
  items: {},                // {barcode: qty}
  scanning: false,
  currentDeviceId: null,
  singleShot: false
};

let mediaStream = null, rafId = null, frames = 0;
let detector = null, off = null, octx = null;
let duplicateGuard = { code: null, until: 0 };
let lastOp = null;

// Ürün haritası: { barcode: {name, price} }
let productMap = {};

// ============= ELEMENTLER =============
const selCam         = document.getElementById('cameraSelect');
const video          = document.getElementById('video');
const statusEl       = document.getElementById('scanStatus');
const fpsEl          = document.getElementById('fps');

const barcodeInp     = document.getElementById('barcode');
const qtyInp         = document.getElementById('qty');
const btnAdd         = document.getElementById('btnAdd');
const btnMinus       = document.getElementById('btnMinus');
const btnPlus        = document.getElementById('btnPlus');
const btnClearField  = document.getElementById('btnClearField');
const btnUndo        = document.getElementById('btnUndo');

const tbody          = document.getElementById('tbody');
const totalRows      = document.getElementById('totalRows');
const totalQty       = document.getElementById('totalQty');
const filenameInp    = document.getElementById('filename');

const btnStart       = document.getElementById('btnStart');
const btnStop        = document.getElementById('btnStop');
const btnScanOnce    = document.getElementById('btnScanOnce');

const btnExport      = document.getElementById('btnExport');
const btnCSV         = document.getElementById('btnCSV'); // varsa
const btnClear       = document.getElementById('btnClear');

const productNameEl  = document.getElementById('productName');
const productPriceEl = document.getElementById('productPrice');
const productFile    = document.getElementById('productFile');
const encodingSel    = document.getElementById('encoding'); // varsa
const mapStat        = document.getElementById('mapStat');

const searchInp      = document.getElementById('searchName'); // isimle arama varsa
const searchList     = document.getElementById('searchList'); // arama sonucu konteyneri

// Sesler
const okBeep    = document.getElementById('beep');       // başarı sesi
const errBeep   = document.getElementById('errBeep');    // ürün bulunamadı sesi

// ============= KÜÇÜK ARAÇLAR =============
function dl(name, content, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([content], { type }));
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}
function save() {
  localStorage.setItem('barcodeItems', JSON.stringify(state.items));
}
function load() {
  try {
    const raw = localStorage.getItem('barcodeItems');
    if (raw) state.items = JSON.parse(raw);
  } catch {}
  render();
}

// Ürün bilgisi göster
function showProductInfo(code) {
  const p = productMap[code];
  if (p) {
    productNameEl.textContent = p.name || '—';
    productPriceEl.textContent = p.price || '—';
  } else {
    productNameEl.textContent = 'Bulunamadı';
    productPriceEl.textContent = '—';
  }
}

// Liste render
function render() {
  tbody.innerHTML = '';
  let sum = 0;
  Object.entries(state.items).forEach(([c, q]) => {
    sum += Number(q) || 0;
    const name = (productMap[c]?.name) || '—';
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${c}</td>
      <td>${name}</td>
      <td class="right">${q}</td>
      <td><button onclick="delRow('${c}')">Sil</button></td>
    `;
    tbody.appendChild(tr);
  });
  totalRows.textContent = Object.keys(state.items).length;
  totalQty.textContent = sum;
}
window.delRow = (c)=>{ delete state.items[c]; save(); render(); };

function upsert(code, qty) {
  if (!code) return;
  const n = Math.max(1, Number(qty)||1);
  state.items[code] = (Number(state.items[code])||0) + n;
  lastOp = { code, qty:n };
  save();
  render();
}
function undo() {
  if (!lastOp) return;
  const { code, qty } = lastOp;
  state.items[code] = (Number(state.items[code])||0) - qty;
  if (state.items[code] <= 0) delete state.items[code];
  lastOp = null;
  save();
  render();
}

// TXT/CSV dışa aktar
function exportTXT() {
  const lines = Object.entries(state.items).map(([c, q])=>`${c};${q}`);
  dl((filenameInp.value||'sayim')+'.txt', lines.join('\n'), 'text/plain');
}
function exportCSV() {
  const lines = ['barcode,qty', ...Object.entries(state.items).map(([c,q])=>`${c},${q}`)];
  dl((filenameInp.value||'sayim')+'.csv', lines.join('\n'), 'text/csv');
}

// ============= KAMERA / BARCODE =============
async function listCameras() {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const videos  = devices.filter(d=>d.kind==='videoinput');
    selCam.innerHTML = '';
    videos.forEach((d,i)=>{
      const o=document.createElement('option');
      o.value=d.deviceId; o.textContent=d.label||`camera ${i+1}`;
      selCam.appendChild(o);
    });
    const rear = videos.find(d=>/back|rear|arka/i.test(d.label||''));
    state.currentDeviceId = rear?.deviceId || videos[0]?.deviceId || null;
    if (state.currentDeviceId) selCam.value = state.currentDeviceId;
  } catch {}
}
selCam?.addEventListener('change', ()=>{
  state.currentDeviceId = selCam.value;
  if (state.scanning) start();
});

async function start() {
  stop();
  statusEl.textContent = 'Kamera açılıyor...';
  try {
    const constraints = state.currentDeviceId
      ? { video: {deviceId:{exact:state.currentDeviceId}, width:{ideal:1920}, height:{ideal:1080}}, audio:false }
      : { video: {facingMode:{ideal:'environment'}, width:{ideal:1920}, height:{ideal:1080}}, audio:false };
    mediaStream = await navigator.mediaDevices.getUserMedia(constraints);
    video.srcObject = mediaStream;
    await video.play();
    state.scanning = true;
    statusEl.textContent='Tarama aktif';
    runNativeLoop(); fpsCounter();
  } catch (e) {
    statusEl.textContent = 'Tarama başlatılamadı';
  }
}
function stop() {
  cancelAnimationFrame(rafId); rafId=null; frames=0; fpsEl.textContent='FPS: -';
  const s = video.srcObject;
  if (s?.getTracks) s.getTracks().forEach(t=>t.stop());
  video.srcObject=null; mediaStream=null;
  state.scanning=false; statusEl.textContent='Durduruldu';
}

async function runNativeLoop() {
  if (!('BarcodeDetector' in window)) { statusEl.textContent='Tarayıcı desteklemiyor'; return; }
  if (!detector) detector = new BarcodeDetector({ formats:['ean_13','ean_8','code_128','code_39','itf','upc_e','upc_a'] });
  if (!off) { off=document.createElement('canvas'); octx=off.getContext('2d',{willReadFrequently:true}); }

  const loop = async ()=>{
    if (!state.scanning) return;
    frames++;

    const vw=video.videoWidth, vh=video.videoHeight;
    if (vw && vh) {
      const rw=Math.floor(vw*0.68), rh=Math.floor(vh*0.32);
      const rx=Math.floor((vw-rw)/2), ry=Math.floor((vh-rh)/2);
      off.width=rw; off.height=rh;
      octx.drawImage(video, rx,ry,rw,rh, 0,0,rw,rh);
      try{
        const d = await detector.detect(off);
        if (d && d.length) onCode((d[0].rawValue||'').trim());
      }catch{}
    }
    if (state.scanning) rafId=requestAnimationFrame(loop);
  };
  loop();
}
function fpsCounter(){
  let last=performance.now();
  const tick=()=>{
    if(!state.scanning) return;
    const now=performance.now();
    if(now-last>=1000){ fpsEl.textContent='FPS: '+frames; frames=0; last=now; }
    requestAnimationFrame(tick);
  };
  tick();
}

function onCode(text){
  if(!text) return;
  const now=performance.now();
  if (text===duplicateGuard.code && now<duplicateGuard.until) return;
  duplicateGuard={code:text, until: now+1200};

  barcodeInp.value = text;
  const found = !!productMap[text];
  showProductInfo(text);

  try {
    if (found) { okBeep && (okBeep.currentTime=0, okBeep.play()); }
    else       { errBeep && (errBeep.currentTime=0, errBeep.play()); }
  } catch {}

  if (navigator.vibrate) navigator.vibrate(found?30:80);

  if (state.singleShot){
    stop();
    btnScanOnce.disabled=true; btnScanOnce.textContent='Okundu ✓';
    setTimeout(()=>{ btnScanOnce.disabled=false; btnScanOnce.textContent='👉 Tek Okut'; },900);
    state.singleShot=false;
  }
}

// ============= ÜRÜN VERİSİ PARSING =============

// CSV/TXT: "kod;isim;...;fiyat"
function parseCSVorTXT(txt){
  const lines = txt.split(/\r?\n/).filter(x=>x.trim().length);
  if (!lines.length) return {};

  // ayraç tespiti
  const sep = lines[0].includes(';') ? ';' : ',';
  const map = {};

  for (const L of lines){
    const cols = L.split(sep).map(s=>s.trim());
    if (cols.length < 2) continue;

    const code = cols[0].replace(/\s+/g,'');  // barkod veya stok kodu
    const name = cols[1] || '';

    // fiyatı en sağdaki anlamlı sayısal alan gibi bul
    let price = '';
    for (let i=cols.length-1; i>=2; i--){
      const p = cols[i].replace(/\s+/g,'');
      if (!p) continue;
      const norm = normalizePrice(p);
      if (norm){ price = norm; break; }
    }

    if (code) map[code] = { name, price };
  }
  return map;
}

// GNCPULUF: 
// 1;PLU;İSİM;...
// 3;PLU;BARKOD;...
// 4;PLU;...;...;FİYAT;...
function parseGNCPULUF(txt){
  const lines = txt.split(/\r?\n/).filter(Boolean);
  const byPLU = new Map();  // PLU -> {name, price, codes:Set}

  const getRec = (plu)=>{
    let r = byPLU.get(plu);
    if (!r) { r = { name:'', price:'', codes:new Set() }; byPLU.set(plu, r); }
    return r;
  };

  for (const raw of lines){
    const parts = raw.split(';');
    const typ = (parts[0]||'').trim();
    if (!typ) continue;

    if (typ === '1'){ // İsim
      const plu  = (parts[1]||'').trim();
      const name = (parts[2]||'').trim();
      if (!plu) continue;
      const rec = getRec(plu);
      if (name) rec.name = name;

    } else if (typ === '3'){ // Barkod
      const plu = (parts[1]||'').trim();
      if (!plu) continue;
      const rec = getRec(plu);

      // 3;PLU;BARKOD;... -> 3. sütun
      const bcRaw = (parts[2]||'').trim();
      // satırda birden çok kod olma ihtimaline karşı tüm rakam bloklarını yakala
      const candidates = bcRaw.match(/\d{4,14}/g) || [];
      for (const c of candidates){
        const code = c.replace(/^0+(?=\d)/,''); // baştaki 0'ları kırp
        if (code.length>=4) rec.codes.add(code);
      }

    } else if (typ === '4'){ 
      // *** FİYAT 5. SÜTUN ***
      const plu = (parts[1]||'').trim();
      if (!plu) continue;

      const priceRaw = (parts[4]||'').trim();  // 5. sütun
      const price = normalizePrice(priceRaw);

      const rec = getRec(plu);
      if (price) rec.price = price;
    }
    // 5; ... diğer tipler ilgisiz
  }

  // PLU -> barcode map'ini düzleştir
  const out = {};
  for (const [,rec] of byPLU){
    const {name, price, codes} = rec;
    for (const bc of codes){
      out[bc] = {name, price};
    }
  }
  return out;
}

// Fiyat normalizasyonu: "1.234,50" / "1234,50" / "1234.50" → "1234,50"
function normalizePrice(p){
  if (!p) return '';
  p = (''+p).replace(/\s+/g,'').replace(/"/g,'');
  // Binlik noktalarını sil (sadece binlik olanları)
  p = p.replace(/\.(?=\d{3}(?:[.,]|$))/g, '');
  // 1234.50 -> 1234,50
  p = p.replace(/(\d)\.(\d{2})$/, '$1,$2');
  // Son durumda sayıya çevir
  const n = Number(p.replace(',', '.'));
  return (isFinite(n) && n>0) ? n.toFixed(2).replace('.', ',') : '';
}

// ============= ÜRÜN YÜKLEME =============
document.getElementById('btnClearMap')?.addEventListener('click', ()=>{
  productMap={}; localStorage.removeItem('productMap');
  mapStat.textContent='0 ürün yüklü'; showProductInfo('');
});

productFile?.addEventListener('change', async (e)=>{
  const file = e.target.files?.[0];
  if (!file) return;
  let txt = '';
  try { txt = await file.text(); }
  catch { alert('Dosya okunamadı.'); return; }

  try {
    let map = {};
    const nameLower = (file.name||'').toLowerCase();

    if (txt.startsWith('1;') || nameLower.includes('gncpuluf')) {
      map = parseGNCPULUF(txt);
    } else if (txt.trim().startsWith('{')) {
      // JSON { barkod: {name, price} } veya { barkod: "isim" }
      const obj = JSON.parse(txt);
      for (const [k,v] of Object.entries(obj)){
        if (typeof v === 'string') map[k] = { name:v, price:'' };
        else map[k] = { name:v.name||'', price:v.price||'' };
      }
    } else {
      map = parseCSVorTXT(txt);
    }

    const count = Object.keys(map).length;
    if (count === 0) {
      alert('Veri çözümlenemedi. CSV/TXT (kod;isim;…;fiyat), JSON veya GNCPULUF verin.');
      return;
    }
    productMap = map;
    localStorage.setItem('productMap', JSON.stringify(productMap));
    mapStat.textContent = count + ' ürün yüklü';
    showProductInfo(barcodeInp.value.trim());
    alert(`${count} ürün yüklendi (${file.name}).`);
  } catch (err) {
    console.error(err);
    alert('Veri çözümlenemedi. CSV/TXT (kod;isim;…;fiyat), JSON veya GNCPULUF verin.');
  }
});

// ============= OLAYLAR =============
btnStart?.addEventListener('click', async()=>{ await listCameras(); start(); });
btnStop?.addEventListener('click', ()=> stop());
btnScanOnce?.addEventListener('click', async()=>{
  await listCameras();
  state.singleShot = true;
  btnScanOnce.disabled = true; btnScanOnce.textContent='Okutuluyor...';
  if (!state.scanning) await start();
  else statusEl.textContent='Tek seferlik okuma aktif';
});

btnAdd?.addEventListener('click', ()=>{
  upsert(barcodeInp.value.trim(), qtyInp.value);
  barcodeInp.value=''; qtyInp.value=1; showProductInfo('');
  barcodeInp.focus();
});

btnMinus?.addEventListener('click', ()=>{ qtyInp.value=Math.max(1, Number(qtyInp.value)-1); qtyInp.select(); });
btnPlus?.addEventListener('click', ()=>{ qtyInp.value=Number(qtyInp.value)+1; qtyInp.select(); });
btnClearField?.addEventListener('click', ()=>{ barcodeInp.value=''; showProductInfo(''); barcodeInp.focus(); });
btnUndo?.addEventListener('click', ()=> undo());

btnExport?.addEventListener('click', ()=> exportTXT());
btnCSV?.addEventListener('click', ()=> exportCSV());
btnClear?.addEventListener('click', ()=>{
  if (confirm('Listeyi temizlemek istiyor musun?')) { state.items={}; save(); render(); }
});

// Manuel giriş davranışları
barcodeInp.addEventListener('keydown', (e)=>{
  if (e.key === 'Enter') { // "Tamam"
    const code = barcodeInp.value.trim();
    if (code) {
      const found = !!productMap[code];
      showProductInfo(code);
      try {
        if (found) { okBeep && (okBeep.currentTime=0, okBeep.play()); }
        else       { errBeep && (errBeep.currentTime=0, errBeep.play()); }
      } catch {}
      qtyInp.focus(); qtyInp.select();
    }
  }
});
qtyInp.addEventListener('focus', ()=> qtyInp.select());
qtyInp.addEventListener('keydown', (e)=>{
  if (e.key === 'Enter') { btnAdd.click(); }
});

// İsimle arama (opsiyonel UI varsa)
function renderSearchResults(q){
  if (!searchList) return;
  searchList.innerHTML='';
  if (!q) return;
  const qq = q.toLocaleUpperCase('tr-TR');

  let shown = 0;
  for (const [bc, p] of Object.entries(productMap)){
    const nameU = (p.name||'').toLocaleUpperCase('tr-TR');
    if (nameU.includes(qq)){
      const li = document.createElement('div');
      li.className='card';
      li.style.padding='8px 10px';
      li.style.cursor='pointer';
      li.innerHTML = `<div style="font-weight:800">${p.name||'—'}</div>
                      <div style="opacity:.8">${bc} · ${p.price||'—'}</div>`;
      li.onclick = ()=>{
        navigator.clipboard?.writeText(bc).catch(()=>{});
        barcodeInp.value = bc; showProductInfo(bc);
        window.scrollTo({top:0,behavior:'smooth'});
        barcodeInp.focus(); qtyInp.select();
      };
      searchList.appendChild(li);
      if (++shown >= 100) break; // çok uzun olmasın
    }
  }
}
searchInp?.addEventListener('input', ()=> renderSearchResults(searchInp.value));

// ============= BOOTSTRAP =============
try {
  const pm = localStorage.getItem('productMap');
  if (pm) {
    productMap = JSON.parse(pm);
    mapStat && (mapStat.textContent = Object.keys(productMap).length+' ürün yüklü');
  }
} catch {}
load(); listCameras();
