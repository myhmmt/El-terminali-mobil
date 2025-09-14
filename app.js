/* ===== GENÇ GROSS Mobil Terminal – app.js (v15) ===== */

const state = { items:{}, scanning:false, currentDeviceId:null, singleShot:false };
let mediaStream=null, rafId=null, frames=0, duplicateGuard={code:null,until:0}, lastOp=null, detector=null, off=null, octx=null;

let productMap = {};           // { barcode: {name, price} }
let searchIndex = [];          // [{code,name,price,nameLC}]
const encSel = document.getElementById('encSel');

const $ = id => document.getElementById(id);
const selCam = $('cameraSelect');
const video  = $('video');
const statusEl = $('scanStatus');
const fpsEl = $('fps');
const barcodeInp = $('barcode');
const qtyInp = $('qty');
const tbody   = $('tbody');
const totalRows = $('totalRows');
const totalQty  = $('totalQty');
const filenameInp = $('filename');
const beep = $('beep');
const btnScanOnce = $('btnScanOnce');
const productNameEl = $('productName');
const productPriceEl = $('productPrice');
const productFile = $('productFile');
const mapStat = $('mapStat');
const btnComplete = $('btnComplete');
const searchBox = $('nameSearch');
const searchList = $('searchResults');

/* ---------- yardımcılar ---------- */
const trLower = s => (s||'').toLocaleLowerCase('tr');

function render(){
  tbody.innerHTML=''; let sum=0;
  Object.entries(state.items).forEach(([c,q])=>{
    sum += Number(q)||0;
    const name = (productMap[c]?.name)||'—';
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${c}</td><td>${name}</td><td class="right">${q}</td><td><button onclick="del('${c}')">Sil</button></td>`;
    tbody.appendChild(tr);
  });
  totalRows.textContent = Object.keys(state.items).length;
  totalQty.textContent  = sum;
}
window.del = (c)=>{ delete state.items[c]; save(); render(); };
function upsert(c,q){ if(!c) return; const n=Math.max(1,Number(q)||1); state.items[c]=(Number(state.items[c])||0)+n; lastOp={code:c,qty:n}; save(); render(); }
function undo(){ if(!lastOp) return; const {code,qty}=lastOp; state.items[code]=(Number(state.items[code])||0)-qty; if(state.items[code]<=0) delete state.items[code]; lastOp=null; save(); render(); }
function save(){ localStorage.setItem('barcodeItems', JSON.stringify(state.items)); }
function load(){ const raw=localStorage.getItem('barcodeItems'); if(raw){ try{ state.items=JSON.parse(raw); }catch{} } render(); }

function dl(name,content,type){ const a=document.createElement('a'); a.href=URL.createObjectURL(new Blob([content],{type})); a.download=name; a.click(); URL.revokeObjectURL(a.href); }
function exportTXT(){ const lines=Object.entries(state.items).map(([c,q])=>`${c};${q}`); dl((filenameInp.value||'sayim')+'.txt', lines.join('\n'),'text/plain'); }
function exportCSV(){ const lines=['barcode,qty',...Object.entries(state.items).map(([c,q])=>`${c},${q}`)]; dl((filenameInp.value||'sayim')+'.csv', lines.join('\n'),'text/csv'); }

/* ---------- kamera / okuma ---------- */
async function listCameras(){
  try{
    const devices = await navigator.mediaDevices.enumerateDevices();
    const videos = devices.filter(d=>d.kind==='videoinput');
    selCam.innerHTML='';
    videos.forEach((d,i)=>{ const o=document.createElement('option'); o.value=d.deviceId; o.textContent=d.label||`Kamera ${i+1}`; selCam.appendChild(o); });
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
        ? { deviceId:{exact:state.currentDeviceId}, width:{ideal:1920}, height:{ideal:1080} }
        : { facingMode:{ideal:'environment'}, width:{ideal:1920}, height:{ideal:1080} },
      audio:false
    };
    mediaStream = await navigator.mediaDevices.getUserMedia(constraints);
    video.srcObject = mediaStream; await video.play(); state.scanning = true; statusEl.textContent = 'Tarama aktif';
    runNativeLoop(); fpsCounter();
  }catch(e){ statusEl.textContent = 'Tarama başlatılamadı'; }
}
function stop(){
  cancelAnimationFrame(rafId); rafId=null; frames=0; fpsEl.textContent='FPS: -';
  const s=video.srcObject; if(s?.getTracks) s.getTracks().forEach(t=>t.stop());
  video.srcObject=null; mediaStream=null; state.scanning=false; statusEl.textContent='Durduruldu';
}
function showProductInfo(code){
  const p = productMap[code];
  if(p){ productNameEl.textContent = p.name||'—'; productPriceEl.textContent = p.price||'—'; }
  else { productNameEl.textContent = 'Bulunamadı'; productPriceEl.textContent = '—'; }
}
async function runNativeLoop(){
  if(!('BarcodeDetector' in window)){ statusEl.textContent='Desteklenmiyor'; return; }
  if(!detector){ detector = new BarcodeDetector({ formats:['ean_13','ean_8','code_128','code_39','itf','upc_e','upc_a'] }); }
  if(!off){ off=document.createElement('canvas'); octx=off.getContext('2d',{willReadFrequently:true}); }
  const loop = async ()=>{
    if(!state.scanning) return; frames++;
    const vw=video.videoWidth, vh=video.videoHeight;
    if(vw&&vh){
      const rw=Math.floor(vw*0.68), rh=Math.floor(vh*0.32);
      const rx=Math.floor((vw-rw)/2), ry=Math.floor((vh-rh)/2);
      off.width=rw; off.height=rh; octx.drawImage(video,rx,ry,rw,rh,0,0,rw,rh);
      try{ const d=await detector.detect(off); if(d && d.length){ onCode((d[0].rawValue||'').trim()); } }catch(_){}
    }
    if(state.scanning) rafId = requestAnimationFrame(loop);
  };
  loop();
}
function onCode(text){
  if(!text) return;
  const now=performance.now();
  if(text===duplicateGuard.code && now<duplicateGuard.until) return;
  duplicateGuard={code:text,until:now+1500};

  barcodeInp.value = text;
  showProductInfo(text);

  try{ beep.currentTime=0; beep.play(); }catch(_){}
  if(navigator.vibrate) navigator.vibrate(30);
  if(state.singleShot){ stop(); btnScanOnce.disabled=true; btnScanOnce.textContent='Okundu ✓'; setTimeout(()=>{btnScanOnce.disabled=false;btnScanOnce.textContent='👉 Tek Okut';},900); state.singleShot=false; }
}
function fpsCounter(){ let last=performance.now(); const tick=()=>{ if(!state.scanning) return; const now=performance.now(); if(now-last>=1000){ fpsEl.textContent='FPS: '+frames; frames=0; last=now; } requestAnimationFrame(tick); }; tick(); }

/* ---------- ürün verisi yükleme ---------- */
$('btnClearMap').onclick = ()=>{ productMap={}; searchIndex=[]; localStorage.removeItem('productMap'); mapStat.textContent='0 ürün yüklü'; showProductInfo(''); };

productFile.onchange = async (e)=>{
  const file = e.target.files?.[0]; if(!file) return;
  let txt = await decodeFile(file, encSel?.value || 'utf-8');
  loadProductText(txt, file.name||'dosya');
};

async function decodeFile(file, encoding){
  try{
    const buf = await file.arrayBuffer();
    const dec = new TextDecoder(encoding);
    return dec.decode(buf);
  }catch{
    return await file.text();
  }
}
function loadProductText(txt, src='metin'){
  try{
    const map = parseCSV(txt);
    const count = Object.keys(map).length;
    productMap = map;
    searchIndex = Object.entries(productMap).map(([code,p])=>({code,name:p.name||'',price:p.price||'',nameLC:trLower(p.name||'')}));
    localStorage.setItem('productMap', JSON.stringify(productMap));
    mapStat.textContent = count + ' ürün yüklü';
    showProductInfo(barcodeInp.value.trim());
    alert(`${count} ürün yüklendi (${src}).`);
  }catch(err){ console.error(err); alert('Veri çözümlenemedi. CSV/TXT (barkod;isim;fiyat) bekleniyor.'); }
}
function parseCSV(txt){
  const lines = txt.split(/\\r?\\n/).filter(x=>x.trim().length);
  const sep = (lines[0] && (lines[0].match(/;/g)||[]).length >= (lines[0].match(/,/g)||[]).length) ? ';' : ',';
  const map={};
  for(const L of lines){
    const cols=L.split(sep).map(s=>s.trim());
    if(cols.length>=3){
      const bc = cols[0].replace(/\\s+/g,'');
      const name = cols[1];
      let price = (cols[2]||'').replace(/\\s/g,'');
      if(/^[0-9]{5,14}$/.test(bc)) map[bc] = {name,price};
    }
  }
  return map;
}

/* ---------- arama (isimle) ---------- */
if(searchBox && searchList){
  searchBox.addEventListener('input', ()=>{
    const q = trLower(searchBox.value.trim());
    searchList.innerHTML='';
    if(!q) return;
    const results = searchIndex.filter(x=>x.nameLC.includes(q)).slice(0,50);
    for(const r of results){
      const li=document.createElement('div');
      li.className='result';
      li.innerHTML = `<div class=\"rs-left\"><div class=\"rs-name\">${r.name}</div><div class=\"rs-meta\">${r.price||''}</div></div><div class=\"rs-code\">${r.code}</div>`;
      li.onclick=()=>{ barcodeInp.value=r.code; showProductInfo(r.code); try{navigator.clipboard.writeText(r.code);}catch{}; };
      searchList.appendChild(li);
    }
  });
}

/* ---------- UI olayları ---------- */
$('btnStart').onclick = async()=>{ await listCameras(); start(); };
$('btnStop').onclick  = ()=> stop();
$('btnAdd').onclick   = ()=>{ upsert(barcodeInp.value.trim(), qtyInp.value); barcodeInp.value=''; qtyInp.value=1; showProductInfo(''); };
$('btnMinus').onclick = ()=>{ qtyInp.value = Math.max(1, Number(qtyInp.value)-1); };
$('btnPlus').onclick  = ()=>{ qtyInp.value = Number(qtyInp.value)+1; };
$('btnClearField').onclick=()=>{ barcodeInp.value=''; showProductInfo(''); };
btnComplete.onclick   = ()=>{ qtyInp.focus(); qtyInp.select(); };
$('btnExport').onclick= ()=> exportTXT();
$('btnCSV').onclick   = ()=> exportCSV();
$('btnClear').onclick = ()=>{ if(confirm('Listeyi temizlemek istiyor musun?')){ state.items={}; save(); render(); } };
$('btnUndo').onclick  = ()=> undo();

barcodeInp.addEventListener('keydown', e=>{
  if(e.key==='Enter'){ qtyInp.focus(); qtyInp.select(); }
});
qtyInp.addEventListener('focus', ()=>{ qtyInp.select(); });
qtyInp.addEventListener('keydown', e=>{
  if(e.key==='Enter'){ $('btnAdd').click(); }
});
btnScanOnce.onclick = async()=>{
  await listCameras();
  state.singleShot=true;
  btnScanOnce.disabled=true; btnScanOnce.textContent='Okutuluyor...';
  if(!state.scanning) await start(); else statusEl.textContent='Tek seferlik okuma aktif';
};

/* ---------- persist ---------- */
try{
  const pm = localStorage.getItem('productMap');
  if(pm){ productMap = JSON.parse(pm); mapStat.textContent = Object.keys(productMap).length+' ürün yüklü';
    searchIndex = Object.entries(productMap).map(([code,p])=>({code,name:p.name||'',price:p.price||'',nameLC:trLower(p.name||'')}));
  }
}catch{}
load(); listCameras();
