/* ====== GLOBAL DURUM ====== */
const state={items:{},scanning:false,currentDeviceId:null,singleShot:false};
let mediaStream=null,rafId=null,frames=0,duplicateGuard={code:null,until:0},lastOp=null,detector=null,off=null,octx=null;

/* ====== ELEMANLAR ====== */
const selCam = byId('cameraSelect'), video=byId('video'), statusEl=byId('scanStatus'), fpsEl=byId('fps');
const barcodeInp=byId('barcode'), qtyInp=byId('qty'), tbody=byId('tbody'), totalRows=byId('totalRows'), totalQty=byId('totalQty');
const filenameInp=byId('filename'), btnScanOnce=byId('btnScanOnce'), productFile=byId('productFile'), mapStat=byId('mapStat');
const productNameEl=byId('productName'), productPriceEl=byId('productPrice'), searchInp=byId('search'), resultsEl=byId('results');
const beep=document.getElementById('beep'), err=document.getElementById('err'), encSel=byId('encoding');

function byId(id){return document.getElementById(id);}

/* ====== PERSIST ====== */
const LS_ITEMS='barcodeItems_v3';
const LS_MAP='productMap_v3';

let productMap={}; // barcode -> {name,price}
loadItems();
loadMapStat();

/* ====== RENDER ====== */
function render(){
  tbody.innerHTML=''; let sum=0;
  Object.entries(state.items).forEach(([c,q])=>{
    sum+=Number(q)||0;
    const name=(productMap[c]?.name)||'—';
    const tr=document.createElement('tr');
    tr.innerHTML=`<td>${c}</td><td>${escapeHtml(name)}</td><td class="right">${q}</td><td><button class="warn" onclick="delItem('${c}')">Sil</button></td>`;
    tbody.appendChild(tr);
  });
  totalRows.textContent=Object.keys(state.items).length;
  totalQty.textContent=sum;
}
window.delItem=(c)=>{delete state.items[c];saveItems();render();};
function upsert(c,q){ if(!c) return; const n=Math.max(1,Number(q)||1); state.items[c]=(Number(state.items[c])||0)+n; lastOp={code:c,qty:n}; saveItems(); render(); }
function undo(){ if(!lastOp) return; const {code,qty}=lastOp; state.items[code]=(Number(state.items[code])||0)-qty; if(state.items[code]<=0) delete state.items[code]; lastOp=null; saveItems(); render(); }
function saveItems(){ localStorage.setItem(LS_ITEMS,JSON.stringify(state.items)); }
function loadItems(){ try{ const raw=localStorage.getItem(LS_ITEMS); if(raw) state.items=JSON.parse(raw)||{}; }catch{} render(); }
function saveMap(){ localStorage.setItem(LS_MAP,JSON.stringify(productMap)); loadMapStat(); }
function loadMapStat(){ try{ const pm=localStorage.getItem(LS_MAP); if(pm){ productMap=JSON.parse(pm)||{}; } }catch{} mapStat.textContent=Object.keys(productMap).length+' ürün yüklü'; }

/* ====== İNDİRME ====== */
function dl(name,content,type){ const a=document.createElement('a'); a.href=URL.createObjectURL(new Blob([content],{type})); a.download=name; a.click(); URL.revokeObjectURL(a.href); }
function exportTXT(){ const lines=Object.entries(state.items).map(([c,q])=>`${c};${q}`); dl((filenameInp.value||'sayim')+'.txt',lines.join('\n'),'text/plain'); }
function exportCSV(){ const lines=['barcode,qty',...Object.entries(state.items).map(([c,q])=>`${c},${q}`)]; dl((filenameInp.value||'sayim')+'.csv',lines.join('\n'),'text/csv'); }

/* ====== KAMERA ====== */
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
selCam.onchange=()=>{state.currentDeviceId=selCam.value;if(state.scanning)start();};

async function start(){
  stop(); statusEl.textContent='Kamera açılıyor...';
  try{
    const constraints={video: state.currentDeviceId?{deviceId:{exact:state.currentDeviceId},width:{ideal:1920},height:{ideal:1080}}:{facingMode:{ideal:'environment'},width:{ideal:1920},height:{ideal:1080}}, audio:false};
    mediaStream=await navigator.mediaDevices.getUserMedia(constraints);
    video.srcObject=mediaStream; await video.play(); state.scanning=true; statusEl.textContent='Tarama aktif'; runNativeLoop(); fpsCounter();
  }catch(e){ statusEl.textContent='Tarama başlatılamadı'; }
}
function stop(){ cancelAnimationFrame(rafId); rafId=null; frames=0; fpsEl.textContent='FPS: -'; const s=video.srcObject; if(s?.getTracks) s.getTracks().forEach(t=>t.stop()); video.srcObject=null; mediaStream=null; state.scanning=false; statusEl.textContent='Durduruldu'; }
function fpsCounter(){ let last=performance.now(); const tick=()=>{ if(!state.scanning) return; const now=performance.now(); if(now-last>=1000){ fpsEl.textContent='FPS: '+frames; frames=0; last=now; } requestAnimationFrame(tick); }; tick(); }

async function runNativeLoop(){
  if(!('BarcodeDetector' in window)){ statusEl.textContent='Desteklenmiyor'; return; }
  if(!detector){ detector=new BarcodeDetector({formats:['ean_13','ean_8','code_128','code_39','itf','upc_e','upc_a']}); }
  if(!off){ off=document.createElement('canvas'); octx=off.getContext('2d',{willReadFrequently:true}); }
  const loop=async()=>{
    if(!state.scanning) return; frames++;
    const vw=video.videoWidth, vh=video.videoHeight;
    if(vw&&vh){
      const rw=Math.floor(vw*0.68), rh=Math.floor(vh*0.32), rx=Math.floor((vw-rw)/2), ry=Math.floor((vh-rh)/2);
      off.width=rw; off.height=rh; octx.drawImage(video,rx,ry,rw,rh,0,0,rw,rh);
      try{ const d=await detector.detect(off); if(d&&d.length){ onCode((d[0].rawValue||'').trim()); }}catch(_){}
    }
    if(state.scanning) rafId=requestAnimationFrame(loop);
  }; loop();
}
function onCode(text){
  if(!text) return; const now=performance.now();
  if(text===duplicateGuard.code&&now<duplicateGuard.until) return; duplicateGuard={code:text,until:now+1200};
  barcodeInp.value=text; showProductInfo(text);
  play(beep);
  if(navigator.vibrate) navigator.vibrate(30);
  if(state.singleShot){ stop(); btnScanOnce.disabled=true; btnScanOnce.textContent='Okundu ✓'; setTimeout(()=>{btnScanOnce.disabled=false;btnScanOnce.textContent='👉 Tek Okut';},900); state.singleShot=false; }
}

/* ====== ÜRÜN BİLGİ ====== */
function showProductInfo(code){
  const p = productMap[code];
  if(p){ productNameEl.textContent=p.name||'—'; productPriceEl.textContent=p.price||'—'; }
  else { productNameEl.textContent='Bulunamadı'; productPriceEl.textContent='—'; }
}

/* ====== YÜKLEME / PARSE ====== */
byId('btnClearMap').onclick=()=>{ productMap={}; saveMap(); showProductInfo(''); };
productFile.onchange=async(e)=>{
  const file=e.target.files?.[0]; if(!file) return;
  let txt=''; try{
    // Seçilen kodlama ile oku
    txt = await file.text(encSel.value);
  }catch{ alert('Dosya okunamadı.'); return; }
  try{
    const map = autoParse(txt);
    const count = Object.keys(map).length;
    if(!count){ alert('Veri çözümlenemedi. CSV/TXT (kod;isim;...;fiyat), JSON ya da GNCPULUF verin.'); return; }
    productMap = map; saveMap(); showProductInfo(barcodeInp.value.trim());
    alert(`${count} ürün yüklendi (${file.name}).`);
  }catch(err){ console.error(err); alert('Veri çözümlenemedi. CSV/TXT (kod;isim;...;fiyat), JSON ya da GNCPULUF verin.'); }
};

function autoParse(txt){
  const t = txt.trim();
  if(t.startsWith('{') || t.startsWith('[')) return parseJSON(t);
  if(/^\s*[1345];/m.test(t)) return parseGNCPULUF(t); // satır başında 1; / 3; / 4; / 5; var mı
  return parseCSV(t);
}

/* --- CSV/TXT: kod;isim;...;fiyat --- */
function parseCSV(txt){
  const lines=txt.split(/\r?\n/).filter(x=>x.trim().length);
  const sep = lines[0]?.includes(';')?';':',';
  const map={};
  for(const L of lines){
    const cols=L.split(sep).map(s=>s.trim());
    if(cols.length<2) continue;
    const code=cols[0].replace(/\s+/g,'');
    const name=fixTurkish(cols[1]||'');
    const price=normalizePrice(cols.slice(2).reverse().find(x=>/\d+[,.]\d{2}/.test(x))||'');
    if(/^[0-9]{5,14}$/.test(code)) map[code]={name,price};
  }
  return map;
}

/* --- JSON: {"869...":{"name":"X","price":"11,90"}} veya {"869...":"X"} --- */
function parseJSON(txt){
  const obj=JSON.parse(txt); const map={};
  for(const [k,v] of Object.entries(obj)){
    if(typeof v==='string') map[k]={name:fixTurkish(v),price:''};
    else map[k]={name:fixTurkish(v.name||''),price:normalizePrice(v.price||'')};
  }
  return map;
}

/* --- GNCPULUF (Genius 2 SQL) — senin verdiğin kesin format ---
   1;PLU;İSİM;...
   3;PLU;BARKOD;...
   4;PLU;…;FİYAT;…
   5;PLU;…  (önemsiz)                                     */
function parseGNCPULUF(txt){
  const byPLU=new Map(); // PLU -> {name, price, barcodes:Set}
  const lines=txt.split(/\r?\n/);
  for(let raw of lines){
    raw=raw.trim(); if(!raw) continue;
    const parts=raw.split(';');
    const typ=parts[0];
    if(typ==='1'){
      const plu = (parts[1]||'').trim();
      const name = fixTurkish((parts[2]||'').trim());
      if(!plu) continue;
      const rec = byPLU.get(plu) || {name:'',price:'',codes:new Set()};
      if(name) rec.name = name;
      byPLU.set(plu, rec);
    }else if(typ==='3'){
      const plu=(parts[1]||'').trim();
      const bc =(parts[2]||'').trim().replace(/\s+/g,'');
      if(!plu||!bc) continue;
      if(!/^[0-9]{5,14}$/.test(bc)) continue;
      const rec = byPLU.get(plu) || {name:'',price:'',codes:new Set()};
      rec.codes.add(bc);
      byPLU.set(plu, rec);
    }else if(typ==='4'){
      const plu=(parts[1]||'').trim(); if(!plu) continue;
      // satırdaki en sağ geçerli fiyatı bul
      const priceToken = parts.slice().reverse().find(p=>/\d+[,.]\d{2}$/.test(p.trim())) || '';
      const price = normalizePrice(priceToken);
      if(price){
        const rec = byPLU.get(plu) || {name:'',price:'',codes:new Set()};
        rec.price = price;
        byPLU.set(plu, rec);
      }
    }
    // 5; ... -> yok say
  }

  // PLU -> barkod map
  const out={};
  for(const [plu,rec] of byPLU.entries()){
    const name = rec.name || '';
    const price = rec.price || '';
    if(rec.codes.size===0 && /^[0-9]{5,14}$/.test(plu)){
      // bazı kasalarda PLU=barkod gibi kullanılabiliyor
      out[plu]={name,price};
    }else{
      for(const bc of rec.codes){ out[bc] = {name,price}; }
    }
  }
  return out;
}

/* ====== YARDIMCILAR ====== */
function normalizePrice(p){
  if(!p) return '';
  let s=(''+p).trim().replace(/\s+/g,'');
  // binlik noktaları sil, ondalığı noktaya çevir → sonra tekrar , ile göster
  s = s.replace(/\./g,'').replace(',', '.');
  const n = Number(s);
  if(!isFinite(n) || n<=0) return '';
  return n.toFixed(2).replace('.', ',');
}
function fixTurkish(s){
  // Windows-1254 karışıklıklarında güvenli kalsın
  return s.normalize('NFC');
}
function escapeHtml(s){return (s||'').replace(/[&<>"']/g,m=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m]));}
function play(aud){ if(!aud) return; try{ aud.currentTime=0; aud.play(); }catch{} }

/* ====== OLAYLAR ====== */
byId('btnStart').onclick=async()=>{await listCameras();start();};
byId('btnStop').onclick=()=>stop();
byId('btnMinus').onclick=()=>{qtyInp.value=Math.max(1,Number(qtyInp.value)-1); qtyInp.select();};
byId('btnPlus').onclick=()=>{qtyInp.value=Number(qtyInp.value)+1; qtyInp.select();};
byId('btnClearField').onclick=()=>{barcodeInp.value=''; showProductInfo('');};
byId('btnExport').onclick=()=>exportTXT();
byId('btnCSV').onclick=()=>exportCSV();
byId('btnClear').onclick=()=>{ if(confirm('Listeyi temizlemek istiyor musun?')){ state.items={}; saveItems(); render(); } };
byId('btnUndo').onclick=()=>undo();

btnScanOnce.onclick=async()=>{await listCameras(); state.singleShot=true; btnScanOnce.disabled=true; btnScanOnce.textContent='Okutuluyor...'; if(!state.scanning) await start(); else statusEl.textContent='Tek seferlik okuma aktif';};

byId('btnGo').onclick=()=>{ // Tamam → miktara odaklan + ses + info
  const code=barcodeInp.value.trim().replace(/\s+/g,'');
  if(!code) return;
  showProductInfo(code);
  if(productMap[code]) play(beep); else play(err);
  qtyInp.focus(); qtyInp.select();
};
barcodeInp.addEventListener('keydown',e=>{
  if(e.key==='Enter'){ byId('btnGo').click(); e.preventDefault(); }
});
qtyInp.addEventListener('focus',()=>{ qtyInp.select(); });
qtyInp.addEventListener('keydown',e=>{
  if(e.key==='Enter'){ byId('btnAdd').click(); e.preventDefault(); }
});
byId('btnAdd').onclick=()=>{
  const code=barcodeInp.value.trim().replace(/\s+/g,''); if(!code) return;
  upsert(code, qtyInp.value);
  barcodeInp.value=''; qtyInp.value=1; showProductInfo('');
  barcodeInp.focus();
};

barcodeInp.addEventListener('input',()=>{
  const code=barcodeInp.value.replace(/\D/g,'');
  if(code.length>=5) showProductInfo(code);
});
barcodeInp.addEventListener('blur',()=>{
  const code=barcodeInp.value.replace(/\D/g,'');
  if(code) showProductInfo(code);
});

/* ====== ARAMA ====== */
searchInp.addEventListener('input',()=>{
  const q = searchInp.value.trim().toLocaleLowerCase('tr-TR');
  resultsEl.innerHTML='';
  if(!q) return;
  const out=[];
  for(const [bc,info] of Object.entries(productMap)){
    const name=(info.name||'').toLocaleLowerCase('tr-TR');
    if(name.includes(q)){ out.push([bc,info]); if(out.length>=50) break; }
  }
  for(const [bc,info] of out){
    const div=document.createElement('div');
    div.className='result';
    div.innerHTML=`<b>${escapeHtml(info.name||'')}</b>${bc} · <b>${info.price||'—'}</b>`;
    div.onclick=()=>{ barcodeInp.value=bc; showProductInfo(bc); window.scrollTo({top:0,behavior:'smooth'}); barcodeInp.focus(); };
    resultsEl.appendChild(div);
  }
});

/* ====== BAŞLAT ====== */
listCameras();
showProductInfo('');
