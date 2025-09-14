// ====== Durum & Elemanlar ======
const state = { items:{}, scanning:false, currentDeviceId:null, singleShot:false };
let mediaStream=null, rafId=null, frames=0, duplicateGuard={code:null,until:0}, lastOp=null;
let detector=null, off=null, octx=null;

// Ürün sözlükleri
let productMap = {};     // barcode -> {name, price, barcode, code}
let productByCode = {};  // stockCode -> aynı obje

// UI
const selCam = document.getElementById('cameraSelect');
const video  = document.getElementById('video');
const statusEl = document.getElementById('scanStatus');
const fpsEl  = document.getElementById('fps');
const barcodeInp = document.getElementById('barcode');
const qtyInp  = document.getElementById('qty');
const tbody   = document.getElementById('tbody');
const totalRows = document.getElementById('totalRows');
const totalQty  = document.getElementById('totalQty');
const filenameInp = document.getElementById('filename');
const beep = document.getElementById('beep');
const errorS = document.getElementById('errorS');
const btnScanOnce = document.getElementById('btnScanOnce');
const productNameEl = document.getElementById('productName');
const productPriceEl = document.getElementById('productPrice');
const productFile = document.getElementById('productFile');
const mapStat = document.getElementById('mapStat');
const encodingSel = document.getElementById('encoding');
const searchName = document.getElementById('searchName');
const searchList = document.getElementById('searchList');
const btnOk = document.getElementById('btnOk');

// ====== Yardımcılar ======
function getProduct(key){
  return productMap[key] || productByCode[key] || null;
}
function addRec({ barcode, code, name, price }){
  const rec = { name: name||'', price: price||'', barcode: barcode||'', code: code||'' };
  if (barcode) productMap[barcode] = rec;
  if (code)    productByCode[code] = rec;
}
function render(){
  tbody.innerHTML=''; let sum=0;
  Object.entries(state.items).forEach(([enteredKey,q])=>{
    sum += Number(q)||0;
    const p = getProduct(enteredKey);
    const shownBarcode = p?.barcode || enteredKey; // stok kodu girilmişse bile listede barkodu göster
    const shownName    = p?.name || '—';
    const tr=document.createElement('tr');
    tr.innerHTML = `<td>${shownBarcode}</td><td>${shownName}</td>
                    <td class="right">${q}</td>
                    <td><button onclick="del('${enteredKey}')">Sil</button></td>`;
    tbody.appendChild(tr);
  });
  totalRows.textContent = Object.keys(state.items).length;
  totalQty.textContent  = sum;
}
window.del=(c)=>{ delete state.items[c]; save(); render(); };
function upsert(c,q){ if(!c) return; const n=Math.max(1,Number(q)||1); state.items[c]=(Number(state.items[c])||0)+n; lastOp={code:c, qty:n}; save(); render(); }
function undo(){ if(!lastOp) return; const {code,qty}=lastOp; state.items[code]=(Number(state.items[code])||0)-qty; if(state.items[code]<=0) delete state.items[code]; lastOp=null; save(); render(); }
function save(){ localStorage.setItem('barcodeItems', JSON.stringify(state.items)); }
function load(){ const raw=localStorage.getItem('barcodeItems'); if(raw){ try{state.items=JSON.parse(raw);}catch{} } render(); }

function dl(name,content,type){ const a=document.createElement('a'); a.href=URL.createObjectURL(new Blob([content],{type})); a.download=name; a.click(); URL.revokeObjectURL(a.href); }
function exportTXT(){ const lines=Object.entries(state.items).map(([c,q])=>`${(getProduct(c)?.barcode||c)};${q}`); dl((filenameInp.value||'sayim')+'.txt', lines.join('\n'), 'text/plain'); }
function exportCSV(){ const lines=['barcode,qty',...Object.entries(state.items).map(([c,q])=>`${(getProduct(c)?.barcode||c)},${q}`)]; dl((filenameInp.value||'sayim')+'.csv', lines.join('\n'), 'text/csv'); }

function showProductInfo(key){
  const p = getProduct(key);
  if(p){ productNameEl.textContent=p.name||'—'; productPriceEl.textContent=p.price||'—'; }
  else { productNameEl.textContent='Bulunamadı'; productPriceEl.textContent='—'; }
}
function playBeep(){ try{beep.currentTime=0;beep.play();}catch{} if(navigator.vibrate) navigator.vibrate(30); }
function playError(){ try{errorS.currentTime=0;errorS.play();}catch{} if(navigator.vibrate) navigator.vibrate([30,40,30]); }

// ====== Kamera / Okuma ======
async function listCameras(){
  try{
    const devices=await navigator.mediaDevices.enumerateDevices();
    const videos=devices.filter(d=>d.kind==='videoinput');
    selCam.innerHTML='';
    videos.forEach((d,i)=>{const o=document.createElement('option');o.value=d.deviceId;o.textContent=d.label||`Kamera ${i+1}`;selCam.appendChild(o);});
    const rear=videos.find(d=>/back|rear|arka/i.test(d.label||''));state.currentDeviceId=rear?.deviceId||videos[0]?.deviceId||null;
    if(state.currentDeviceId)selCam.value=state.currentDeviceId;
  }catch(e){}
}
selCam.onchange=()=>{ state.currentDeviceId = selCam.value; if(state.scanning) start(); };

async function start(){
  stop(); statusEl.textContent='Kamera açılıyor...';
  try{
    const constraints={video:state.currentDeviceId?{deviceId:{exact:state.currentDeviceId},width:{ideal:1920},height:{ideal:1080}}:{facingMode:{ideal:'environment'},width:{ideal:1920},height:{ideal:1080}},audio:false};
    mediaStream=await navigator.mediaDevices.getUserMedia(constraints);
    video.srcObject=mediaStream; await video.play(); state.scanning=true; statusEl.textContent='Tarama aktif'; runNativeLoop(); fpsCounter();
  }catch(e){ statusEl.textContent='Tarama başlatılamadı'; }
}
function stop(){
  cancelAnimationFrame(rafId); rafId=null; frames=0; fpsEl.textContent='FPS: -';
  const s=video.srcObject; if(s?.getTracks) s.getTracks().forEach(t=>t.stop()); video.srcObject=null; mediaStream=null; state.scanning=false; statusEl.textContent='Durduruldu';
}
async function runNativeLoop(){
  if(!('BarcodeDetector' in window)){ statusEl.textContent='Desteklenmiyor'; return; }
  if(!detector){ detector=new BarcodeDetector({formats:['ean_13','ean_8','code_128','code_39','itf','upc_e','upc_a']}); }
  if(!off){ off=document.createElement('canvas'); octx=off.getContext('2d',{willReadFrequently:true}); }
  const loop=async()=>{
    if(!state.scanning) return; frames++;
    const vw=video.videoWidth, vh=video.videoHeight;
    if(vw&&vh){
      const rw=Math.floor(vw*0.68), rh=Math.floor(vh*0.32);
      const rx=Math.floor((vw-rw)/2), ry=Math.floor((vh-rh)/2);
      off.width=rw; off.height=rh; octx.drawImage(video,rx,ry,rw,rh,0,0,rw,rh);
      try{
        const d=await detector.detect(off);
        if(d&&d.length){ onCode((d[0].rawValue||'').trim()); }
      }catch(_){}
    }
    if(state.scanning) rafId=requestAnimationFrame(loop);
  }; loop();
}
function onCode(text){
  if(!text) return;
  const now=performance.now();
  if(text===duplicateGuard.code && now<duplicateGuard.until) return;
  duplicateGuard={code:text,until:now+1500};
  barcodeInp.value=text; showProductInfo(text);
  const p = getProduct(text);
  if(p) playBeep(); else playError();
  if(state.singleShot){ stop(); btnScanOnce.disabled=true; btnScanOnce.textContent='Okundu ✓'; setTimeout(()=>{btnScanOnce.disabled=false;btnScanOnce.textContent='👉 Tek Okut';},900); state.singleShot=false; }
}
function fpsCounter(){ let last=performance.now(); const tick=()=>{ if(!state.scanning) return; const now=performance.now(); if(now-last>=1000){ fpsEl.textContent='FPS: '+frames; frames=0; last=now; } requestAnimationFrame(tick); }; tick(); }

// ====== Ürün VERİSİ ======
document.getElementById('btnClearMap').onclick=()=>{ productMap={}; productByCode={}; localStorage.removeItem('productMap'); localStorage.removeItem('productByCode'); mapStat.textContent='0 ürün yüklü'; showProductInfo(''); searchList.innerHTML=''; };
productFile.onchange=async(e)=>{
  const file=e.target.files?.[0]; if(!file) return;
  let txt='';
  try{
    const enc=encodingSel.value||'windows-1254';
    if(file.text && enc==='utf-8'){ txt = await file.text(); }
    else{ const buf = await file.arrayBuffer(); txt = new TextDecoder(enc).decode(buf); }
  }catch{ alert('Dosya okunamadı.'); return; }
  loadProductText(txt,file.name||'dosya');
};
function loadProductText(txt,src='metin'){
  try{
    productMap={}; productByCode={};
    let count=0;
    if(txt.startsWith('<SIGNATURE=GNDPLU.GDF>')) count=parseGDF(txt);
    else if(txt.trim().startsWith('{')){
      const obj=JSON.parse(txt);
      for(const [k,v] of Object.entries(obj)){
        if(typeof v==='string') addRec({barcode:k, name:v});
        else addRec({barcode:k, name:v.name||'', price:v.price||'', code:v.code||''});
        count++;
      }
    }else{
      count=parseCSV(txt);
    }
    localStorage.setItem('productMap', JSON.stringify(productMap));
    localStorage.setItem('productByCode', JSON.stringify(productByCode));
    mapStat.textContent=count+' ürün yüklü';
    showProductInfo(barcodeInp.value.trim());
    alert(`${count} ürün yüklendi (${src}).`);
  }catch(err){ console.error(err); alert('Veri çözümlenemedi. CSV/TXT (stokKodu;isim;…;fiyat), JSON veya imzalı GDF kullanın.'); }
}

// CSV/TXT: stokKodu;stokAdı;…;fiyat1  (+ satırın sağından fiyatı yakalama)
function parseCSV(txt){
  const lines=txt.split(/\r?\n/).filter(x=>x.trim().length);
  const sep=lines[0]?.includes(';')?';':',';
  let n=0;
  for(const L of lines){
    const cols=L.split(sep).map(s=>s.trim());
    if(cols.length<2) continue;
    const code = cols[0];           // stok kodu (barkodsuz olabilir)
    const name = cols[1];
    // olası barkod sütunları
    const maybeNums = cols.slice(1,4).map(x=>x.replace(/\D/g,''));
    const barcode = maybeNums.find(nm => /^\d{8,14}$/.test(nm)) || '';
    // fiyat: en sağ 2-3 sütundan
    const rightPart = cols.slice(-3).join(' ');
    const price = priceFromTextRightmost(rightPart);
    addRec({ barcode, code, name, price });
    n++;
  }
  return n;
}

// --- Fiyat normalizasyonu & çıkarımı ---
function normPriceStr(p){ if(!p) return {num:0,disp:''}; p=p.replace(/\s+/g,''); p=p.replace(/\./g,''); p=p.replace(/^0+(?=\d)/,''); if(!/,/.test(p)) return {num:0,disp:''}; let n=Number(p.replace(',','.')); if(!isFinite(n)) n=0; return {num:n,disp: n? n.toFixed(2).replace('.',',') : ''}; }
function priceFromTextRightmost(txt){
  const re=/\d{1,3}(?:\.\d{3})*,\d{2}|\d+,\d{2}/g;
  const matches=[]; let m;
  while((m=re.exec(txt))){ const n=normPriceStr(m[0]); if(n.num>0 && n.num<1000) matches.push({pos:m.index,disp:n.disp}); }
  if(!matches.length) return '';
  return matches[matches.length-1].disp;
}

// GDF: 01 (PLU+İsim), 02 (Barkod+Fiyat)
function parseGDF(txt){
  const lines=txt.split(/\r?\n/);
  const names={}; let lastPLU=null; let n=0;
  for(let i=0;i<lines.length;i++){
    const raw=lines[i]; if(!raw) continue;
    if(raw.startsWith('01')){
      const parts=raw.trim().split(/\s{2,}/);
      if(parts.length>=4){ lastPLU=parts[1]; names[lastPLU]=parts[3]; }
      continue;
    }
    if(raw.startsWith('02')){
      let priceDisp = priceFromTextRightmost(raw);
      if(!priceDisp && lines[i+1]) priceDisp = priceFromTextRightmost(lines[i+1]);
      if(!priceDisp && lines[i-1]) priceDisp = priceFromTextRightmost(lines[i-1]);
      const nums=(raw.match(/\b\d{8,14}\b/g)||[]);
      const candidates=nums.filter(n=>n!==lastPLU);
      let bc=candidates.filter(n=>n.length===13||n.length===12).pop()
            || candidates.filter(n=>n.length===8).pop() || '';
      const name=names[lastPLU]||'';
      if(bc||lastPLU){ addRec({ barcode:bc, code:lastPLU, name, price:priceDisp }); n++; }
    }
  }
  return n;
}

// ====== ARAMA (isimle) ======
searchName.addEventListener('input', ()=>{
  const q=searchName.value.trim().toLocaleLowerCase('tr');
  searchList.innerHTML='';
  if(!q) return;
  // productMap + productByCode birleşik gez: barcode tabanlısı yeterli
  const list = Object.values(productMap);
  let shown=0;
  for(const p of list){
    if(!p?.name) continue;
    const nm = p.name.toLocaleLowerCase('tr');
    if(nm.includes(q)){
      const div=document.createElement('div');
      div.className='result';
      div.innerHTML = `<b>${p.name}</b><div>${p.barcode||'-'} · ${p.price||'—'}</div>`;
      div.onclick=()=>{ barcodeInp.value = p.barcode || p.code || ''; showProductInfo(barcodeInp.value); qtyInp.focus(); };
      searchList.appendChild(div);
      if(++shown>=40) break;
    }
  }
});

// ====== UI Olayları ======
document.getElementById('btnStart').onclick=async()=>{ await listCameras(); start(); };
document.getElementById('btnStop').onclick = ()=> stop();
document.getElementById('btnAdd').onclick  = ()=>{ upsert(barcodeInp.value.trim(), qtyInp.value); barcodeInp.value=''; qtyInp.value=1; showProductInfo(''); barcodeInp.focus(); };
document.getElementById('btnMinus').onclick= ()=>{ qtyInp.value=Math.max(1,Number(qtyInp.value)-1); };
document.getElementById('btnPlus').onclick = ()=>{ qtyInp.value=Number(qtyInp.value)+1; };
document.getElementById('btnClearField').onclick= ()=>{ barcodeInp.value=''; showProductInfo(''); barcodeInp.focus(); };
document.getElementById('btnExport').onclick= ()=> exportTXT();
document.getElementById('btnCSV').onclick   = ()=> exportCSV();
document.getElementById('btnClear').onclick = ()=>{ if(confirm('Listeyi temizlemek istiyor musun?')){ state.items={}; save(); render(); } };
document.getElementById('btnUndo').onclick  = ()=> undo();

btnOk.onclick = ()=>{
  const code = barcodeInp.value.replace(/\D/g,'');
  if(!code) return;
  showProductInfo(code);
  const p = getProduct(code);
  if(p) playBeep(); else playError();
  qtyInp.select(); qtyInp.focus();
};
barcodeInp.addEventListener('keydown', e=>{ if(e.key==='Enter'){ btnOk.click(); } });
qtyInp.addEventListener('focus', ()=>{ qtyInp.select(); });
qtyInp.addEventListener('keydown', e=>{ if(e.key==='Enter'){ document.getElementById('btnAdd').click(); } });

btnScanOnce.onclick=async()=>{ await listCameras(); state.singleShot=true; btnScanOnce.disabled=true; btnScanOnce.textContent='Okutuluyor...'; if(!state.scanning) await start(); else statusEl.textContent='Tek seferlik okuma aktif'; };

// localStorage'dan ürün verisini çek
try{
  const pm=localStorage.getItem('productMap');
  const pc=localStorage.getItem('productByCode');
  if(pm){ productMap=JSON.parse(pm); }
  if(pc){ productByCode=JSON.parse(pc); }
  const cnt=new Set([...Object.keys(productMap),...Object.keys(productByCode)]).size;
  if(cnt) mapStat.textContent=cnt+' ürün yüklü';
}catch{}
load(); listCameras();
