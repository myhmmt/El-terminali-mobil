/* GENÇ GROSS – Mobil Terminal
   GTF (Genius 2 SQL) şeması:
   1;PLU;İSİM;...
   3;PLU;BARKOD;...
   4;PLU;...;FİYAT;...  → fiyat çoğunlukla 5. sütun; değilse satırın en sağındaki fiyat kullanılır.
*/
const state={items:{},scanning:false,currentDeviceId:null,singleShot:false};
let mediaStream=null,rafId=null,frames=0,duplicateGuard={code:null,until:0},lastOp=null,detector=null,off=null,octx=null;

let productMap={}; // { barkod/kod: {name, price (disp "12,34")} }
let nameIndex=[];

const $=id=>document.getElementById(id);
const selCam=$('cameraSelect'), video=$('video'), statusEl=$('scanStatus'), fpsEl=$('fps');
const barcodeInp=$('barcode'), qtyInp=$('qty'), tbody=$('tbody'), totalRows=$('totalRows'), totalQty=$('totalQty'), filenameInp=$('filename');
const okbeep=$('okbeep'), errbeep=$('errbeep'), btnScanOnce=$('btnScanOnce');
const productNameEl=$('productName'), productPriceEl=$('productPrice');
const productFile=$('productFile'), mapStat=$('mapStat'), encodingSel=$('encoding');
const results=$('results'), searchInp=$('search');

// ---------- yardımcılar ----------
const trUpper=s=>(s||'').toLocaleUpperCase('tr-TR');
function escapeHtml(s){return (s||'').replace(/[&<>"']/g,m=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m]));}
function toNumber(d){ if(!d) return 0; return Number(String(d).replace(/\./g,'').replace(',','.'))||0; }
function numDisp(n){ return (Number(n)||0).toFixed(2).replace('.',','); }

// "175.00" / "1.175,00" / "175,00" → "175,00"
function normalizePriceFlexible(p){
  if(p==null) return '';
  let s=String(p).trim().replace(/["'\s]/g,'').replace(/[^0-9.,]/g,'');
  if(!s) return '';
  const lastC=s.lastIndexOf(','), lastD=s.lastIndexOf('.');
  if(lastC>-1 && lastD>-1){
    if(lastC>lastD){ s=s.replace(/\./g,''); return disp(Number(s.replace(',','.'))); }
    else{ s=s.replace(/,/g,''); return disp(Number(s)); }
  }
  if(lastC>-1){ return disp(Number(s.replace(/\./g,'').replace(',','.'))); }
  if(lastD>-1){ return disp(Number(s.replace(/,/g,''))); }
  return '';
  function disp(n){ return (isFinite(n)&&n>0) ? n.toFixed(2).replace('.',',') : ''; }
}
// satırın en sağındaki fiyatı çek
function rightmostPrice(str){
  const re=/\d{1,3}(?:[.,]\d{3})*[.,]\d{2}|\d+[.,]\d{2}/g;
  let m,last=''; while((m=re.exec(str))) last=m[0];
  return normalizePriceFlexible(last);
}

// ---------- render & kalıcılık ----------
function render(){
  tbody.innerHTML=''; let sum=0;
  Object.entries(state.items).forEach(([c,q])=>{
    sum+=Number(q)||0;
    const name=(productMap[c]?.name)||'—';
    const tr=document.createElement('tr');
    tr.innerHTML=`<td>${c}</td><td>${escapeHtml(name)}</td><td class="right">${q}</td><td><button data-del="${c}">Sil</button></td>`;
    tbody.appendChild(tr);
  });
  totalRows.textContent=Object.keys(state.items).length;
  totalQty.textContent=sum;
}
tbody.addEventListener('click',e=>{
  const c=e.target.getAttribute('data-del'); if(!c) return;
  delete state.items[c]; save(); render();
});
function upsert(c,q){ if(!c) return; const n=Math.max(1,Number(q)||1); state.items[c]=(Number(state.items[c])||0)+n; lastOp={code:c,qty:n}; save(); render(); }
function undo(){ if(!lastOp) return; const {code,qty}=lastOp; state.items[code]=(Number(state.items[code])||0)-qty; if(state.items[code]<=0) delete state.items[code]; lastOp=null; save(); render(); }
function save(){ localStorage.setItem('barcodeItems',JSON.stringify(state.items)); }
function load(){ try{const raw=localStorage.getItem('barcodeItems'); if(raw) state.items=JSON.parse(raw);}catch{} render(); }

// ---------- export ----------
function dl(name,content,type){ const a=document.createElement('a'); a.href=URL.createObjectURL(new Blob([content],{type})); a.download=name; a.click(); URL.revokeObjectURL(a.href); }
function exportTXT(){ const lines=Object.entries(state.items).map(([c,q])=>`${c};${q}`); dl((filenameInp.value||'sayim')+'.txt',lines.join('\n'),'text/plain'); }
function exportPDF(){
  const rows=Object.entries(state.items).map(([code,qty])=>{
    const p=productMap[code]||{}; const unit=toNumber(p.price); const total=(unit*qty)||0;
    return {code,name:p.name||'',qty,unitDisp:p.price||'',totalDisp:numDisp(total)};
  });
  const grand = rows.reduce((a,r)=>a+toNumber(r.totalDisp),0);
  const css=`body{font-family:system-ui,Segoe UI,Arial;margin:24px}h2{text-align:center}
  table{border-collapse:collapse;width:100%}th,td{border-bottom:1px solid #ddd;padding:8px}
  th{text-align:left;background:#f2f2f2}.r{text-align:right}.tot{font-weight:700}`;
  const html=`<html><head><meta charset="utf-8"><title>GENÇ GROSS</title><style>${css}</style></head><body>
  <h2>GENÇ GROSS</h2>
  <table><thead><tr><th>Barkod</th><th>İsim</th><th class="r">Adet</th><th class="r">Birim</th><th class="r">Toplam</th></tr></thead><tbody>
  ${rows.map(r=>`<tr><td>${r.code}</td><td>${escapeHtml(r.name)}</td><td class="r">${r.qty}</td><td class="r">${r.unitDisp}</td><td class="r">${r.totalDisp}</td></tr>`).join('')}
  </tbody><tfoot><tr><td colspan="4" class="r tot">Genel Toplam</td><td class="r tot">${numDisp(grand)}</td></tr></tfoot></table></body></html>`;
  const w=window.open('','_blank'); w.document.write(html); w.document.close(); w.print();
}

// ---------- kamera ----------
async function listCameras(){
  try{
    const devices=await navigator.mediaDevices.enumerateDevices();
    const videos=devices.filter(d=>d.kind==='videoinput');
    selCam.innerHTML='';
    videos.forEach((d,i)=>{const o=document.createElement('option');o.value=d.deviceId;o.textContent=d.label||`Kamera ${i+1}`;selCam.appendChild(o);});
    const rear=videos.find(d=>/back|rear|arka/i.test(d.label||'')); state.currentDeviceId=rear?.deviceId||videos[0]?.deviceId||null;
    if(state.currentDeviceId) selCam.value=state.currentDeviceId;
  }catch{}
}
selCam.onchange=()=>{ state.currentDeviceId=selCam.value; if(state.scanning) start(); };

async function start(){
  stop(); statusEl.textContent='Kamera açılıyor...';
  try{
    const constraints={video:state.currentDeviceId?{deviceId:{exact:state.currentDeviceId},width:{ideal:1920},height:{ideal:1080}}:{facingMode:{ideal:'environment'},width:{ideal:1920},height:{ideal:1080}},audio:false};
    mediaStream=await navigator.mediaDevices.getUserMedia(constraints);
    video.srcObject=mediaStream; await video.play(); state.scanning=true; statusEl.textContent='Tarama aktif'; runLoop(); fpsCounter();
  }catch{ statusEl.textContent='Tarama başlatılamadı'; }
}
function stop(){ cancelAnimationFrame(rafId); rafId=null; frames=0; fpsEl.textContent='FPS: -'; const s=video.srcObject; if(s?.getTracks) s.getTracks().forEach(t=>t.stop()); video.srcObject=null; mediaStream=null; state.scanning=false; statusEl.textContent='Durduruldu'; }
async function runLoop(){
  if(!('BarcodeDetector' in window)){ statusEl.textContent='Tarayıcı desteklemiyor'; return;}
  if(!detector) detector=new BarcodeDetector({formats:['ean_13','ean_8','code_128','code_39','itf','upc_e','upc_a']});
  if(!off){ off=document.createElement('canvas'); octx=off.getContext('2d',{willReadFrequently:true}); }
  const loop=async()=>{
    if(!state.scanning) return; frames++;
    const vw=video.videoWidth,vh=video.videoHeight;
    if(vw&&vh){
      const rw=Math.floor(vw*0.68),rh=Math.floor(vh*0.32);
      const rx=Math.floor((vw-rw)/2),ry=Math.floor((vh-rh)/2);
      off.width=rw;off.height=rh;octx.drawImage(video,rx,ry,rw,rh,0,0,rw,rh);
      try{ const d=await detector.detect(off); if(d&&d.length){ onCode((d[0].rawValue||'').trim()); } }catch{}
    }
    if(state.scanning) rafId=requestAnimationFrame(loop);
  }; loop();
}
function fpsCounter(){ let last=performance.now(); const tick=()=>{ if(!state.scanning) return; const now=performance.now(); if(now-last>=1000){ fpsEl.textContent='FPS: '+frames; frames=0; last=now; } requestAnimationFrame(tick); }; tick(); }

function onCode(text){
  if(!text) return; const now=performance.now();
  if(text===duplicateGuard.code && now<duplicateGuard.until) return;
  duplicateGuard={code:text,until:now+1200};
  barcodeInp.value=text;
  const found=!!productMap[text];
  showProductInfo(text);
  if(found) playOk(); else playErr(); // ürün bulunmazsa error sesi
  if(navigator.vibrate) navigator.vibrate(found?25:[30,40,30]);
  if(state.singleShot){ stop(); btnScanOnce.disabled=true; btnScanOnce.textContent='Okundu ✓'; setTimeout(()=>{btnScanOnce.disabled=false;btnScanOnce.textContent='👉 Tek Okut';},900); state.singleShot=false; }
}
function playOk(){ try{ okbeep.currentTime=0; okbeep.play(); }catch{} }
function playErr(){ try{ errbeep.currentTime=0; errbeep.play(); }catch{} }

// ---------- ürün bilgisi & arama ----------
function showProductInfo(code){
  const p=productMap[code];
  if(p){ productNameEl.textContent=p.name||'—'; productPriceEl.textContent=p.price||'—'; }
  else { productNameEl.textContent='Bulunamadı'; productPriceEl.textContent='—'; }
}
function rebuildIndex(){ nameIndex=Object.entries(productMap).map(([bc,v])=>({bc,nameU:trUpper(v.name||''),price:v.price||''})); }
searchInp.addEventListener('input',()=>{
  const q=trUpper(searchInp.value.trim()); results.innerHTML=''; if(!q) return;
  const hits=nameIndex.filter(r=>r.nameU.includes(q)).slice(0,150);
  for(const r of hits){
    const p=productMap[r.bc]||{};
    const div=document.createElement('div');
    div.style.cssText='padding:10px;border:1px solid #e5e9ff;border-radius:10px;margin:6px 0;background:#fff';
    div.innerHTML=`<b>${escapeHtml(p.name||'')}</b><br><span class="muted">${r.bc}</span> · ${p.price||'—'}`;
    div.onclick=()=>{ barcodeInp.value=r.bc; showProductInfo(r.bc); window.scrollTo({top:0,behavior:'smooth'}); };
    results.appendChild(div);
  }
});

// ---------- dosya yükleme ----------
$('btnClearMap').onclick=()=>{ productMap={}; nameIndex=[]; localStorage.removeItem('productMap'); mapStat.textContent='0 ürün yüklü'; showProductInfo(''); results.innerHTML=''; };

productFile.onchange=async(e)=>{
  const file=e.target.files?.[0]; if(!file) return;
  try{
    const txt=await file.text(); // 1254 sorununda FileReader+TextDecoder ekleyebiliriz
    loadProductText(txt,file.name||'dosya');
  }catch{ alert('Dosya okunamadı.'); }
};

function loadProductText(txt,src='metin'){
  try{
    let map={};
    const first=(txt.split(/\r?\n/).find(l=>l.trim())||'').trim();
    if(/^([134]);/.test(first)) map=parseGTF(txt);
    else if(txt.trim().startsWith('{')){
      const obj=JSON.parse(txt);
      for(const [k,v] of Object.entries(obj)){ map[k]={name:(typeof v==='string'?v:(v.name||'')),price:v.price||''}; }
    }else map=parseCSV(txt);
    const count=Object.keys(map).length;
    if(count===0){ alert('0 ürün bulundu.'); return; }
    productMap=map; rebuildIndex();
    localStorage.setItem('productMap',JSON.stringify(productMap));
    mapStat.textContent=count+' ürün yüklü';
    showProductInfo(barcodeInp.value.trim());
    alert(`${count} ürün yüklendi (${src}).`);
  }catch(err){ console.error(err); alert('Veri çözümlenemedi. CSV/TXT (kod;isim;…;fiyat), JSON veya GTF verin.'); }
}

// CSV/TXT: kod;isim;…;fiyat  (son sütunu fiyat say)
function parseCSV(txt){
  const lines=txt.split(/\r?\n/).filter(x=>x.trim());
  const sep=lines[0]?.includes(';')?';':',';
  const map={};
  for(const L of lines){
    const cols=L.split(sep).map(s=>s.trim());
    if(cols.length>=2){
      const code=(cols[0]||'').replace(/\s+/g,''); const name=(cols[1]||'').trim();
      const priceDisp=normalizePriceFlexible(cols.at(-1)||'');
      if(code) map[code]={name,price:priceDisp};
    }
  }
  return map;
}

// GTF parser: 1;PLU;İSİM…, 3;PLU;BARKOD…, 4;PLU;...;FİYAT;...
function parseGTF(txt){
  const lines=txt.split(/\r?\n/);
  const names={}, prices={}, barcByPlu={};
  for(const raw of lines){
    if(!raw) continue;
    const parts=raw.split(';');
    const tag=(parts[0]||'').trim();
    if(tag==='1'){
      const plu=(parts[1]||'').trim();
      const name=(parts[2]||'').trim();
      if(plu) names[plu]=name;
    }else if(tag==='3'){
      const plu=(parts[1]||'').trim();
      const bc =(parts[2]||'').replace(/\D/g,'');
      if(plu && bc){ (barcByPlu[plu]??=[]).push(bc); }
    }else if(tag==='4'){
      const plu=(parts[1]||'').trim();
      // 1) 5. sütun öncelikli
      let priceDisp = normalizePriceFlexible(parts[4]||'');
      // 2) boş/uygunsuzsa satırın en sağındaki fiyat
      if(!priceDisp) priceDisp = rightmostPrice(raw);
      if(plu) prices[plu]=priceDisp;
    }
  }
  const map={};
  const all=new Set([...Object.keys(names),...Object.keys(prices),...Object.keys(barcByPlu)]);
  for(const plu of all){
    const name=names[plu]||''; const price=prices[plu]||'';
    (barcByPlu[plu]||[]).forEach(bc=>{ map[bc]={name,price}; });
    if(plu) map[plu]={name,price}; // PLU da geçerli kod
  }
  return map;
}

// ---------- olaylar ----------
$('btnStart').onclick=async()=>{ await listCameras(); start(); };
$('btnStop').onclick=()=>stop();
btnScanOnce.onclick=async()=>{ await listCameras(); state.singleShot=true; btnScanOnce.disabled=true; btnScanOnce.textContent='Okutuluyor...'; if(!state.scanning) await start(); else statusEl.textContent='Tek seferlik okuma aktif'; };

$('btnAdd').onclick=()=>{ upsert(barcodeInp.value.trim(),qtyInp.value); barcodeInp.value=''; qtyInp.value=1; showProductInfo(''); barcodeInp.focus(); };
$('btnMinus').onclick=()=>{ qtyInp.value=Math.max(1,Number(qtyInp.value)-1); };
$('btnPlus').onclick=()=>{ qtyInp.value=Number(qtyInp.value)+1; };
$('btnClearField').onclick=()=>{ barcodeInp.value=''; showProductInfo(''); barcodeInp.focus(); };
$('btnClear').onclick=()=>{ if(confirm('Listeyi temizlemek istiyor musun?')){ state.items={}; save(); render(); } };
$('btnUndo').onclick=()=>undo();
$('btnExport').onclick=()=>exportTXT();
$('btnPDF').onclick=()=>exportPDF();

$('btnGo').onclick=()=>{
  const code=barcodeInp.value.trim();
  if(!code){ playErr(); barcodeInp.focus(); return; }
  const found=!!productMap[code];
  showProductInfo(code);
  if(found) playOk(); else playErr();
  qtyInp.focus(); qtyInp.select();
};
barcodeInp.addEventListener('keydown',e=>{ if(e.key==='Enter'){ e.preventDefault(); $('btnGo').click(); } });
barcodeInp.addEventListener('input',()=>{ const code=barcodeInp.value.replace(/\D/g,''); if(code.length>=1) showProductInfo(code); });
qtyInp.addEventListener('keydown',e=>{ if(e.key==='Enter'){ e.preventDefault(); $('btnAdd').click(); } });
qtyInp.addEventListener('focus',()=>{ qtyInp.select(); });

// ---------- başlangıç ----------
try{
  const pm=localStorage.getItem('productMap');
  if(pm){ productMap=JSON.parse(pm); nameIndex=Object.entries(productMap).map(([bc,v])=>({bc,nameU:trUpper(v.name||''),price:v.price||''})); mapStat.textContent=Object.keys(productMap).length+' ürün yüklü'; }
}catch{}
load(); listCameras();
barcodeInp?.focus(); barcodeInp?.select();
