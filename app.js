/* Genç Gross Mobil Terminal - Uygulama Mantığı */
const state = { items:{}, scanning:false, currentDeviceId:null, singleShot:false };
let mediaStream=null, rafId=null, frames=0, duplicateGuard={code:null,until:0}, lastOp=null;
let detector=null, off=null, octx=null;
let productMap={};

// ---- DOM ----
const selCam=document.getElementById('cameraSelect');
const video=document.getElementById('video');
const statusEl=document.getElementById('scanStatus');
const fpsEl=document.getElementById('fps');
const barcodeInp=document.getElementById('barcode');
const qtyInp=document.getElementById('qty');
const btnComplete=document.getElementById('btnComplete');

const tbody=document.getElementById('tbody');
const totalRows=document.getElementById('totalRows');
const totalQty=document.getElementById('totalQty');
const filenameInp=document.getElementById('filename');
const beep=document.getElementById('beep');
const err=document.getElementById('err');
const btnScanOnce=document.getElementById('btnScanOnce');
const productNameEl=document.getElementById('productName');
const productPriceEl=document.getElementById('productPrice');
const productFile=document.getElementById('productFile');
const mapStat=document.getElementById('mapStat');

// ---- Liste render ----
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
window.del=(c)=>{ delete state.items[c]; save(); render(); };
function upsert(c,q){ if(!c)return; const n=Math.max(1,Number(q)||1); state.items[c]=(Number(state.items[c])||0)+n; lastOp={code:c,qty:n}; save(); render(); }
function undo(){ if(!lastOp)return; const {code,qty}=lastOp; state.items[code]=(Number(state.items[code])||0)-qty; if(state.items[code]<=0) delete state.items[code]; lastOp=null; save(); render(); }
function save(){ localStorage.setItem('barcodeItems',JSON.stringify(state.items)); }
function load(){ const raw=localStorage.getItem('barcodeItems'); if(raw){ try{state.items=JSON.parse(raw);}catch{} } render(); }

// ---- Dışa aktar ----
function dl(name,content,type){ const a=document.createElement('a'); a.href=URL.createObjectURL(new Blob([content],{type})); a.download=name; a.click(); URL.revokeObjectURL(a.href); }
function exportTXT(){ const lines=Object.entries(state.items).map(([c,q])=>`${c};${q}`); dl((filenameInp.value||'sayim')+'.txt',lines.join('\n'),'text/plain'); }
function exportCSV(){ const lines=['barcode,qty',...Object.entries(state.items).map(([c,q])=>`${c},${q}`)]; dl((filenameInp.value||'sayim')+'.csv',lines.join('\n'),'text/csv'); }

// ---- Kamera ----
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
    const constraints={ video: state.currentDeviceId ? {deviceId:{exact:state.currentDeviceId}, width:{ideal:1920}, height:{ideal:1080}} : {facingMode:{ideal:'environment'}, width:{ideal:1920}, height:{ideal:1080}}, audio:false };
    mediaStream=await navigator.mediaDevices.getUserMedia(constraints);
    video.srcObject=mediaStream; await video.play();
    state.scanning=true; statusEl.textContent='Tarama aktif'; runNativeLoop(); fpsCounter();
  }catch(e){ statusEl.textContent='Tarama başlatılamadı'; }
}
function stop(){
  cancelAnimationFrame(rafId); rafId=null; frames=0; fpsEl.textContent='FPS: -';
  const s=video.srcObject; if(s?.getTracks) s.getTracks().forEach(t=>t.stop());
  video.srcObject=null; mediaStream=null; state.scanning=false; statusEl.textContent='Durduruldu';
}

function showProductInfo(code){
  const p=productMap[code];
  if(p){ productNameEl.textContent=p.name||'—'; productPriceEl.textContent=p.price||'—'; }
  else { productNameEl.textContent='Bulunamadı'; productPriceEl.textContent='—'; }
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
      try{ const d=await detector.detect(off); if(d && d.length){ onCode((d[0].rawValue||'').trim()); } }catch(_){}
    }
    if(state.scanning) rafId=requestAnimationFrame(loop);
  };
  loop();
}

// === DÜZELTİLEN KISIM: Kamera okumasında doğru sesi çal ===
function onCode(text){
  if(!text) return;
  const now=performance.now();
  if(text===duplicateGuard.code && now<duplicateGuard.until) return;
  duplicateGuard={code:text,until:now+1500};

  barcodeInp.value=text;
  showProductInfo(text);

  const found = !!productMap[text];
  try{
    (found ? beep : err).currentTime = 0;
    (found ? beep : err).play();
  }catch(_){}
  if(navigator.vibrate) navigator.vibrate(found ? 30 : 80);

  // Tek seferlik mod kapat
  if(state.singleShot){
    stop();
    btnScanOnce.disabled=true; btnScanOnce.textContent='Okundu ✓';
    setTimeout(()=>{ btnScanOnce.disabled=false; btnScanOnce.textContent='👉 Tek Okut'; },900);
    state.singleShot=false;
  }

  // Manuel akış: adet’e geç
  qtyInp.focus(); setTimeout(()=>qtyInp.select(),0);
}

function fpsCounter(){
  let last=performance.now();
  const tick=()=>{ if(!state.scanning) return; const now=performance.now(); if(now-last>=1000){ fpsEl.textContent='FPS: '+frames; frames=0; last=now; } requestAnimationFrame(tick); };
  tick();
}

// ---- ÜRÜN VERİSİ ----
document.getElementById('btnClearMap').onclick=()=>{ productMap={}; localStorage.removeItem('productMap'); mapStat.textContent='0 ürün yüklü'; showProductInfo(''); };
productFile.onchange=async(e)=>{
  const file=e.target.files?.[0]; if(!file) return;
  let txt=''; try{ txt=await file.text(); }catch{ alert('Dosya okunamadı.'); return; }
  loadProductText(txt,file.name||'dosya');
};

function loadProductText(txt,src='metin'){
  try{
    let map={};
    if(txt.startsWith('<SIGNATURE=GNDPLU.GDF>')) map=parseGDF(txt);
    else if(txt.trim().startsWith('{')){
      const obj=JSON.parse(txt);
      for(const [k,v] of Object.entries(obj)){
        if(typeof v==='string') map[k]={name:v,price:''};
        else map[k]={name:v.name||'',price:v.price||''};
      }
    }else map=parseCSV(txt);

    const count=Object.keys(map).length;
    if(count===0){ const first=(txt.split(/\r?\n/)[0]||'').slice(0,120); alert(`0 ürün bulundu (${src}). İlk satır: "${first}"`); return; }
    productMap=map; localStorage.setItem('productMap',JSON.stringify(productMap)); mapStat.textContent=count+' ürün yüklü';
    showProductInfo(barcodeInp.value.trim());
    alert(`${count} ürün yüklendi (${src}).`);
  }catch(err){ console.error(err); alert('Veri çözümlenemedi. CSV/TXT (barkod;isim;fiyat), JSON veya imzalı GDF kullanın.'); }
}

// CSV/TXT: barkod;isim;fiyat
function parseCSV(txt){
  const lines=txt.split(/\r?\n/).filter(x=>x.trim().length);
  const sep=lines[0]?.includes(';')?';':',';
  const map={};
  for(const L of lines){
    const cols=L.split(sep).map(s=>s.trim());
    if(cols.length>=2){
      const bc=cols[0].replace(/\s+/g,'');
      const name=cols[1];
      let price=(cols[2]||'').replace(/\s/g,'');
      price=normPriceStr(price).disp;
      if(/^[0-9]{8,14}$/.test(bc)) map[bc]={name,price};
    }
  }
  return map;
}

// Fiyat normalizasyonu
function normPriceStr(p){
  if(!p) return {num:0,disp:''};
  p = p.replace(/\s+/g,'');      // boşluk
  p = p.replace(/\./g,'');       // binlik
  p = p.replace(/^0+(?=\d)/,''); // baştaki sıfırlar
  if(!/,/.test(p)) return {num:0,disp:''};
  let n = Number(p.replace(',','.'));
  if(!isFinite(n)) n=0;
  return {num:n,disp: n? n.toFixed(2).replace('.',',') : ''};
}

// GDF (sağdan fiyat çıkarımı)
function priceFromTextRightmost(txt){
  const re=/\d{1,3}(?:\.\d{3})*,\d{2}|\d+,\d{2}/g;
  const matches=[]; let m;
  while((m=re.exec(txt))){ const n=normPriceStr(m[0]); if(n.num>0 && n.num<1000) matches.push({pos:m.index,disp:n.disp}); }
  if(!matches.length) return '';
  return matches[matches.length-1].disp;
}
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
      let priceDisp = priceFromTextRightmost(raw);
      if(!priceDisp && lines[i+1]) priceDisp = priceFromTextRightmost(lines[i+1]);
      if(!priceDisp && lines[i-1]) priceDisp = priceFromTextRightmost(lines[i-1]);

      const nums=(raw.match(/\b\d{8,14}\b/g)||[]);
      const candidates=nums.filter(n=>n!==lastPLU);
      let bc=candidates.filter(n=>n.length===13||n.length===12).pop()
            || candidates.filter(n=>n.length===8).pop()
            || '';

      const name=names[lastPLU]||'';
      if(bc&&name) map[bc]={name,price:priceDisp};
    }
  }
  return map;
}

// ---- UI olayları ----
document.getElementById('btnStart').onclick=async()=>{ await listCameras(); start(); };
document.getElementById('btnStop').onclick=()=>stop();
document.getElementById('btnAdd').onclick=()=>{ upsert(barcodeInp.value.trim(),qtyInp.value); barcodeInp.value=''; qtyInp.value=1; showProductInfo(''); };
document.getElementById('btnMinus').onclick=()=>{ qtyInp.value=Math.max(1,Number(qtyInp.value)-1); };
document.getElementById('btnPlus').onclick=()=>{ qtyInp.value=Number(qtyInp.value)+1; };
document.getElementById('btnClearField').onclick=()=>{ barcodeInp.value=''; showProductInfo(''); };
document.getElementById('btnExport').onclick=()=>exportTXT();
document.getElementById('btnCSV').onclick=()=>exportCSV();
document.getElementById('btnClear').onclick=()=>{ if(confirm('Listeyi temizlemek istiyor musun?')){ state.items={}; save(); render(); } };
document.getElementById('btnUndo').onclick=()=>undo();

// Barkodu yazarken bilgi göster
barcodeInp.addEventListener('input',()=>{
  const code=barcodeInp.value.replace(/\D/g,'');
  if(code.length>=8) showProductInfo(code);
});
barcodeInp.addEventListener('blur',()=>{
  const code=barcodeInp.value.replace(/\D/g,'');
  if(code) showProductInfo(code);
});

// Elle giriş: Enter/Git veya "Tamam"
function confirmManualBarcode(){
  const code=(barcodeInp.value||'').replace(/\D/g,'');
  if(!code){ barcodeInp.focus(); return; }
  const p=productMap[code];
  if(p){ productNameEl.textContent=p.name||'—'; productPriceEl.textContent=p.price||'—'; try{beep.currentTime=0;beep.play();}catch(_){} }
  else { productNameEl.textContent='Bulunamadı'; productPriceEl.textContent='—'; try{err.currentTime=0;err.play();}catch(_){} }
  if(navigator.vibrate) navigator.vibrate(30);
  qtyInp.focus(); setTimeout(()=>qtyInp.select(),0);
}
barcodeInp.addEventListener('keydown',e=>{ if(e.key==='Enter'){ e.preventDefault(); confirmManualBarcode(); } });
if(btnComplete) btnComplete.onclick=confirmManualBarcode;

// Adet alanına tıklayınca mevcut değeri seç (120 yazınca 1120 olmasın)
qtyInp.addEventListener('focus',()=>{ setTimeout(()=>qtyInp.select(),0); });
qtyInp.addEventListener('pointerdown',()=>{ setTimeout(()=>qtyInp.select(),0); });

// Tek okut modu
btnScanOnce.onclick=async()=>{
  await listCameras();
  state.singleShot=true;
  btnScanOnce.disabled=true; btnScanOnce.textContent='Okutuluyor...';
  if(!state.scanning) await start(); else statusEl.textContent='Tek seferlik okuma aktif';
};

// Önceden yüklenmiş ürün haritasını ve listeyi geri getir
try{ const pm=localStorage.getItem('productMap'); if(pm){ productMap=JSON.parse(pm); mapStat.textContent=Object.keys(productMap).length+' ürün yüklü'; } }catch{}
load(); listCameras();
