// ====== STATE ======
const state={items:{},scanning:false,currentDeviceId:null,singleShot:false};
let mediaStream=null,rafId=null,frames=0,duplicateGuard={code:null,until:0},lastOp=null,detector=null,off=null,octx=null;
let productMap={};

// ====== EL ======
const $ = sel => document.querySelector(sel);
const selCam   = $('#cameraSelect');
const video    = $('#video');
const statusEl = $('#scanStatus');
const fpsEl    = $('#fps');
const inpCode  = $('#barcode');
const inpQty   = $('#qty');
const tbody    = $('#tbody');
const totalRows= $('#totalRows');
const totalQty = $('#totalQty');
const inpFile  = $('#productFile');
const mapStat  = $('#mapStat');
const nameEl   = $('#productName');
const priceEl  = $('#productPrice');
const beep     = $('#beep');
const errBeep  = $('#err');
const btnOnce  = $('#btnScanOnce');

// ====== HELPERS ======
function render(){
  tbody.innerHTML=''; let sum=0;
  Object.entries(state.items).forEach(([c,q])=>{
    sum+=Number(q)||0;
    const name=(productMap[c]?.name)||'—';
    const tr=document.createElement('tr');
    tr.innerHTML=`<td>${c}</td><td>${name}</td><td class="right">${q}</td><td><button onclick="del('${c}')">Sil</button></td>`;
    tbody.appendChild(tr);
  });
  totalRows.textContent=Object.keys(state.items).length;
  totalQty.textContent=sum;
}
window.del=(c)=>{delete state.items[c];save();render();}
function upsert(c,q){ if(!c) return; const n=Math.max(1,Number(q)||1); state.items[c]=(Number(state.items[c])||0)+n; lastOp={code:c,qty:n}; save(); render(); }
function undo(){ if(!lastOp) return; const {code,qty}=lastOp; state.items[code]=(Number(state.items[code])||0)-qty; if(state.items[code]<=0) delete state.items[code]; lastOp=null; save(); render(); }
function save(){ localStorage.setItem('barcodeItems', JSON.stringify(state.items)); }
function load(){ const raw=localStorage.getItem('barcodeItems'); if(raw){ try{state.items=JSON.parse(raw);}catch{} } render(); }

function dl(name,content,type){ const a=document.createElement('a'); a.href=URL.createObjectURL(new Blob([content],{type})); a.download=name; a.click(); URL.revokeObjectURL(a.href); }
function exportTXT(){ const lines=Object.entries(state.items).map(([c,q])=>`${c};${q}`); dl((($('#filename').value)||'sayim')+'.txt', lines.join('\n'), 'text/plain'); }
function exportCSV(){ const lines=['barcode,qty',...Object.entries(state.items).map(([c,q])=>`${c},${q}`)]; dl((($('#filename').value)||'sayim')+'.csv', lines.join('\n'), 'text/csv'); }

function trLower(s){ return (s||'').toLocaleLowerCase('tr-TR'); }
function playBeep(a){ try{a.currentTime=0; a.play();}catch{} }

// ====== KAMERA / BarcodeDetector ======
async function listCameras(){
  try{
    const devices=await navigator.mediaDevices.enumerateDevices();
    const videos=devices.filter(d=>d.kind==='videoinput');
    selCam.innerHTML='';
    videos.forEach((d,i)=>{const o=document.createElement('option');o.value=d.deviceId;o.textContent=d.label||`Kamera ${i+1}`;selCam.appendChild(o);});
    const rear=videos.find(d=>/back|rear|arka/i.test(d.label||'')); state.currentDeviceId=rear?.deviceId||videos[0]?.deviceId||null;
    if(state.currentDeviceId) selCam.value=state.currentDeviceId;
  }catch(e){}
}
selCam.onchange=()=>{ state.currentDeviceId=selCam.value; if(state.scanning) start(); };

async function start(){
  stop(); statusEl.textContent='Kamera açılıyor...';
  try{
    const constraints={video: state.currentDeviceId?{deviceId:{exact:state.currentDeviceId},width:{ideal:1920},height:{ideal:1080}}:{facingMode:{ideal:'environment'},width:{ideal:1920},height:{ideal:1080}}, audio:false};
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
      try{ const d=await detector.detect(off); if(d && d.length){ onScanned((d[0].rawValue||'').trim()); } }catch(_){}
    }
    if(state.scanning) rafId=requestAnimationFrame(loop);
  }; loop();
}
function onScanned(code){
  if(!code) return;
  const now=performance.now();
  if(code===duplicateGuard.code && now<duplicateGuard.until) return;
  duplicateGuard={code,until:now+1500};

  inpCode.value = code;
  showProductInfo(code);
  if(productMap[code]) playBeep(beep); else playBeep(errBeep);
  if(navigator.vibrate) navigator.vibrate(30);

  if(state.singleShot){ stop(); btnOnce.disabled=true; btnOnce.textContent='Okundu ✓'; setTimeout(()=>{btnOnce.disabled=false;btnOnce.textContent='👉 Tek Okut';},900); state.singleShot=false; }
}
function fpsCounter(){ let last=performance.now(); const tick=()=>{ if(!state.scanning) return; const now=performance.now(); if(now-last>=1000){ fpsEl.textContent='FPS: '+frames; frames=0; last=now; } requestAnimationFrame(tick); }; tick(); }

// ====== ÜRÜN BİLGİ ======
function showProductInfo(code){
  const p=productMap[code];
  if(p){ nameEl.textContent=p.name||'—'; priceEl.textContent=p.price||'—'; }
  else { nameEl.textContent='Bulunamadı'; priceEl.textContent='—'; }
}

// ====== PARSE ======
function normPriceStr(p){
  if(!p) return '';
  p = String(p).replace(/\s+/g,'');
  const m = p.match(/\d{1,3}(?:\.\d{3})*,\d{2}|\d+,\d{2}/);
  if(!m) return '';
  let n = m[0].replace(/\./g,'').replace(',','.');
  let v = Number(n);
  if(!isFinite(v)) return '';
  return v.toFixed(2).replace('.',',');
}
function parseTextToMap(txt){
  const lines = txt.split(/\r?\n/).filter(l=>l.trim().length);
  const map = {};
  for(const raw of lines){
    const sep = raw.includes(';') ? ';' : '\t';
    const cols = raw.split(sep).map(s=>s.trim());
    if(cols.length < 2) continue;
    const code = (cols[0]||'').replace(/\s+/g,'');
    const name = cols[1]||'';
    if(!code || !name) continue;

    // fiyat: sağdan sola ilk parasal
    let price = '';
    for(let i=cols.length-1;i>=2;i--){
      const p = normPriceStr(cols[i]);
      if(p){ price = p; break; }
    }
    map[code] = {name, price};
  }
  return map;
}

// ====== DOSYA YÜKLE ======
$('#btnClearMap').onclick = ()=>{ productMap={}; localStorage.removeItem('productMap'); mapStat.textContent='0 ürün yüklü'; showProductInfo(''); $('#searchList').innerHTML=''; };
inpFile.onchange = async(e)=>{
  const f = e.target.files?.[0]; if(!f) return;
  let txt=''; try{ txt = await f.text(); }catch{ alert('Dosya okunamadı.'); return; }
  try{
    let map={};
    if(txt.trim().startsWith('{')){
      const obj=JSON.parse(txt);
      for(const [k,v] of Object.entries(obj)){
        if(typeof v==='string') map[k]={name:v,price:''};
        else map[k]={name:v.name||'',price:v.price||''};
      }
    }else{
      map = parseTextToMap(txt);
    }
    productMap = map;  // ÜZERİNE YAZ
    localStorage.setItem('productMap',JSON.stringify(productMap));
    mapStat.textContent = Object.keys(productMap).length + ' ürün yüklü';
    showProductInfo(inpCode.value.trim());
    buildSearchIndex();
  }catch(err){ console.error(err); alert('Veri çözümlenemedi. "kod;isim;…;fiyat" biçimini kullanın.'); }
};

// ====== ARAMA ======
let searchArr=[];
function buildSearchIndex(){
  searchArr = Object.entries(productMap).map(([code,obj])=>({code,name:obj.name,price:obj.price, key:(obj.name||'').toLocaleLowerCase('tr-TR')}));
}
$('#searchName').addEventListener('input', ()=>{
  const q = ($('#searchName').value||'').toLocaleLowerCase('tr-TR').trim();
  const list = $('#searchList'); list.innerHTML='';
  if(!q){ return; }
  const matches = searchArr.filter(x=>x.key.includes(q)).slice(0,50);
  for(const m of matches){
    const row = document.createElement('div'); row.className='result';
    row.innerHTML = `<div><strong>${m.name}</strong><br><small>${m.code}</small></div><div><strong>${m.price||'—'}</strong></div>`;
    row.onclick = ()=>{ navigator.clipboard?.writeText(m.code).catch(()=>{}); inpCode.value=m.code; showProductInfo(m.code); inpQty.focus(); };
    list.appendChild(row);
  }
});

// ====== UI OLAYLARI ======
$('#btnStart').onclick = async()=>{ await listCameras(); start(); };
$('#btnStop').onclick  = ()=> stop();
btnOnce.onclick        = async()=>{ await listCameras(); state.singleShot=true; btnOnce.disabled=true; btnOnce.textContent='Okutuluyor...'; if(!state.scanning) await start(); else statusEl.textContent='Tek seferlik okuma aktif'; };

$('#btnAdd').onclick   = ()=>{ upsert(inpCode.value.trim(), inpQty.value); inpCode.value=''; inpQty.value=1; nameEl.textContent='—'; priceEl.textContent='—'; inpCode.focus(); };
$('#btnMinus').onclick = ()=>{ inpQty.value=Math.max(1,Number(inpQty.value)-1); };
$('#btnPlus').onclick  = ()=>{ inpQty.value=Number(inpQty.value)+1; };
$('#btnClearField').onclick = ()=>{ inpCode.value=''; showProductInfo(''); inpCode.focus(); };
$('#btnExport').onclick= ()=> exportTXT();
$('#btnCSV').onclick   = ()=> exportCSV();
$('#btnClear').onclick = ()=>{ if(confirm('Listeyi temizlemek istiyor musun?')){ state.items={}; save(); render(); } };
$('#btnUndo').onclick  = ()=> undo();

$('#btnSubmitCode').onclick = ()=>{
  const code = inpCode.value.trim();
  if(!code) return;
  showProductInfo(code);
  playBeep(productMap[code] ? beep : errBeep);
  inpQty.focus(); inpQty.select();
};
inpCode.addEventListener('input', ()=>{ const c=inpCode.value.trim(); if(c) showProductInfo(c); });
inpCode.addEventListener('keydown', e=>{
  if(e.key==='Enter'){ e.preventDefault(); $('#btnSubmitCode').click(); }
});
inpQty.addEventListener('focus', ()=>{ inpQty.select(); });
inpQty.addEventListener('keydown', e=>{
  if(e.key==='Enter'){ e.preventDefault(); $('#btnAdd').click(); }
});

// ====== BOOT ======
try{
  const pm = localStorage.getItem('productMap');
  if(pm){ productMap = JSON.parse(pm); mapStat.textContent = Object.keys(productMap).length + ' ürün yüklü'; buildSearchIndex(); }
}catch{}
load(); listCameras();
