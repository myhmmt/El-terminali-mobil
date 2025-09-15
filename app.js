// --- durum ---
const state={items:{},scanning:false,currentDeviceId:null,singleShot:false};
let mediaStream=null,rafId=null,frames=0,duplicateGuard={code:null,until:0},lastOp=null,detector=null,off=null,octx=null;

// --- UI ---
const $ = id => document.getElementById(id);
const selCam=$('cameraSelect'), video=$('video'), statusEl=$('scanStatus'), fpsEl=$('fps');
const barcodeInp=$('barcode'), qtyInp=$('qty'), tbody=$('tbody'), totalRows=$('totalRows'), totalQty=$('totalQty'), filenameInp=$('filename');
const okbeep=$('okbeep'), errbeep=$('errbeep'), btnScanOnce=$('btnScanOnce');
const productNameEl=$('productName'), productPriceEl=$('productPrice');
const productFile=$('productFile'), mapStat=$('mapStat'), encodingSel=$('encoding');
const results=$('results'), search=$('search');

let productMap={};                // barcode -> {name, price}
let nameIndex=[];                 // [{name, barcode}]
const trLower = s => (s||'').toLocaleLowerCase('tr-TR');

// --- render / kalıcılık ---
function render(){
  tbody.innerHTML=''; let sum=0;
  Object.entries(state.items).forEach(([c,q])=>{
    sum+=Number(q)||0;
    const name=(productMap[c]?.name)||'—';
    const tr=document.createElement('tr');
    tr.innerHTML=`<td>${c}</td><td>${name}</td><td class="right">${q}</td><td><button onclick="delRow('${c}')">Sil</button></td>`;
    tbody.appendChild(tr);
  });
  totalRows.textContent=Object.keys(state.items).length;
  totalQty.textContent=sum;
}
window.delRow=(c)=>{delete state.items[c];save();render();};
function upsert(c,q){ if(!c) return; const n=Math.max(1,Number(q)||1); state.items[c]=(Number(state.items[c])||0)+n; lastOp={code:c,qty:n}; save(); render();}
function undo(){ if(!lastOp) return; const {code,qty}=lastOp; state.items[code]=(Number(state.items[code])||0)-qty; if(state.items[code]<=0) delete state.items[code]; lastOp=null; save(); render();}
function save(){ localStorage.setItem('barcodeItems',JSON.stringify(state.items)); }
function load(){ const raw=localStorage.getItem('barcodeItems'); if(raw){ try{state.items=JSON.parse(raw);}catch{} } render(); }

// --- export ---
function dl(name,content,type){ const a=document.createElement('a'); a.href=URL.createObjectURL(new Blob([content],{type})); a.download=name; a.click(); URL.revokeObjectURL(a.href); }
function exportTXT(){ const lines=Object.entries(state.items).map(([c,q])=>`${c};${q}`); dl((filenameInp.value||'sayim')+'.txt',lines.join('\n'),'text/plain'); }
// PDF (basit fatura görünümü)
function exportPDF(){
  const rows=Object.entries(state.items).map(([code,qty])=>{
    const p=productMap[code]||{}; const name=p.name||''; const unit=parsePriceNum(p.price); const total=(unit*qty)||0;
    return {code,name,qty,unit,total};
  });
  let html=`<html><head><meta charset="utf-8"><title>GENÇ GROSS</title>
  <style>body{font-family:Arial,Helvetica,sans-serif;margin:24px}h1{text-align:center}
  table{width:100%;border-collapse:collapse;margin-top:10px}
  th,td{border-bottom:1px solid #ddd;padding:6px}th{text-align:left;background:#f2f2f2}
  .r{text-align:right}.tot{font-weight:bold}</style></head><body>
  <h1>GENÇ GROSS</h1>
  <table><thead><tr><th>Barkod</th><th>İsim</th><th class="r">Adet</th><th class="r">Birim</th><th class="r">Toplam</th></tr></thead><tbody>`;
  let grand=0;
  rows.forEach(r=>{grand+=r.total; html+=`<tr><td>${r.code}</td><td>${r.name}</td><td class="r">${r.qty}</td><td class="r">${fmtTRY(r.unit)}</td><td class="r">${fmtTRY(r.total)}</td></tr>`;});
  html+=`</tbody></table><div class="r tot" style="margin-top:14px">Genel Toplam: ${fmtTRY(grand)}</div></body></html>`;
  const win=window.open('','_blank'); win.document.write(html); win.document.close(); win.print();
}
function fmtTRY(n){ if(!n) n=0; return n.toFixed(2).replace('.',','); }
function parsePriceNum(disp){ if(!disp) return 0; return Number(String(disp).replace(/\./g,'').replace(',','.')) || Number(disp) || 0; }

// --- kamera ---
async function listCameras(){
  try{
    const devices=await navigator.mediaDevices.enumerateDevices();
    const videos=devices.filter(d=>d.kind==='videoinput');
    selCam.innerHTML=''; videos.forEach((d,i)=>{const o=document.createElement('option');o.value=d.deviceId;o.textContent=d.label||`Kamera ${i+1}`;selCam.appendChild(o);});
    const rear=videos.find(d=>/back|rear|arka/i.test(d.label||'')); state.currentDeviceId=rear?.deviceId||videos[0]?.deviceId||null;
    if(state.currentDeviceId) selCam.value=state.currentDeviceId;
  }catch{}
}
selCam.onchange=()=>{state.currentDeviceId=selCam.value;if(state.scanning)start();};

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
      try{
        const d=await detector.detect(off);
        if(d&&d.length){ onCode((d[0].rawValue||'').trim()); }
      }catch{}
    }
    if(state.scanning) rafId=requestAnimationFrame(loop);
  }; loop();
}
function onCode(text){
  if(!text) return; const now=performance.now();
  if(text===duplicateGuard.code && now<duplicateGuard.until) return;
  duplicateGuard={code:text,until:now+1200};
  barcodeInp.value=text;
  const found = !!productMap[text];
  showProductInfo(text);
  if(found) playOk(); else playErr();           // ✅ bulunamadıysa error sesi
  if(state.singleShot){ stop(); btnScanOnce.disabled=true; btnScanOnce.textContent='Okundu ✓'; setTimeout(()=>{btnScanOnce.disabled=false;btnScanOnce.textContent='👉 Tek Okut';},900); state.singleShot=false; }
}
function fpsCounter(){ let last=performance.now(); const tick=()=>{ if(!state.scanning) return; const now=performance.now(); if(now-last>=1000){ fpsEl.textContent='FPS: '+frames; frames=0; last=now; } requestAnimationFrame(tick); }; tick(); }
function playOk(){ try{okbeep.currentTime=0; okbeep.play();}catch{} if(navigator.vibrate) navigator.vibrate(25); }
function playErr(){ try{errbeep.currentTime=0; errbeep.play();}catch{} if(navigator.vibrate) navigator.vibrate([30,40,30]); }

// --- ürün bilgisi gösterimi ---
function showProductInfo(code){
  const p=productMap[code];
  if(p){ productNameEl.textContent=p.name||'—'; productPriceEl.textContent=p.price||'—'; }
  else { productNameEl.textContent='Bulunamadı'; productPriceEl.textContent='—'; }
}

// --- dosya yükleme ---
$('btnClearMap').onclick=()=>{ productMap={}; nameIndex=[]; localStorage.removeItem('productMap'); localStorage.removeItem('nameIndex'); mapStat.textContent='0 ürün yüklü'; showProductInfo(''); };

productFile.onchange=async(e)=>{
  const file=e.target.files?.[0]; if(!file) return;
  try{
    const txt=await readAsTextWithEncoding(file, encodingSel.value);
    loadProductText(txt, file.name||'dosya');
  }catch{ alert('Dosya okunamadı.'); }
};

function readAsTextWithEncoding(file, enc){
  return new Promise((resolve,reject)=>{
    const fr=new FileReader();
    if(enc==='windows-1254') fr.readAsText(file,'windows-1254'); else fr.readAsText(file);
    fr.onerror=()=>reject(fr.error); fr.onload=()=>resolve(fr.result);
  });
}

function loadProductText(txt, src='metin'){
  try{
    let map={};
    if(/^\s*1;/.test(txt)) map=parseGNC2SQL(txt);           // Genius 2 SQL
    else if(txt.trim().startsWith('{')){                     // JSON
      const obj=JSON.parse(txt);
      for(const [k,v] of Object.entries(obj)){ map[k]={name: (typeof v==='string'?v:(v.name||'')), price: v.price||''}; }
    }else { map=parseCSV(txt); }                             // CSV/TXT: kod;isim;...;fiyat

    const count=Object.keys(map).length;
    if(count===0){ alert('0 ürün bulundu.'); return; }

    productMap=map;
    nameIndex=Object.entries(productMap).map(([bc,v])=>({name:trLower(v.name), barcode:bc}));
    localStorage.setItem('productMap',JSON.stringify(productMap));
    localStorage.setItem('nameIndex',JSON.stringify(nameIndex));
    mapStat.textContent=count+' ürün yüklü';
    showProductInfo(barcodeInp.value.trim());
    alert(`${count} ürün yüklendi (${src}).`);
  }catch(err){ console.error(err); alert('Veri çözümlenemedi. CSV/TXT (kod;isim;…;fiyat), JSON veya GNCPULUF verin.'); }
}

// CSV/TXT: kod;isim;...;fiyat
function parseCSV(txt){
  const lines=txt.split(/\r?\n/).filter(x=>x.trim().length);
  const sep=lines[0]?.includes(';')?';':',';
  const map={};
  for(const L of lines){
    const cols=L.split(sep).map(s=>s.trim());
    if(cols.length>=2){
      const code=cols[0].replace(/\s+/g,''); const name=cols[1];
      // sondaki sütunu fiyat varsayımı
      const priceDisp = normalizePrice(cols.at(-1)||'');
      if(code) map[code]={name,price:priceDisp};
    }
  }
  return map;
}

// ✅ Genius 2 SQL (GNCPULUF.GTF) – kesin format:
// 1;PLU;İSİM;...
// 3;PLU;BARKOD;...
// 4;PLU;…;…;FİYAT;…  → FİYAT = **5. sütun** = cols[4] (noktalı: 175.00 da olabilir)
function parseGNC2SQL(txt){
  const lines=txt.split(/\r?\n/);
  const names={}, prices={}, barcByPlu={};   // PLU ->[]

  for(const raw of lines){
    if(!raw) continue;
    const cols=raw.split(';');
    const t=(cols[0]||'').trim();

    if(t==='1'){ // 1;PLU;NAME;...
      const plu=(cols[1]||'').trim();
      const name=(cols[2]||'').trim();
      if(plu) names[plu]=name;
    }
    else if(t==='3'){ // 3;PLU;BARCODE;...
      const plu=(cols[1]||'').trim();
      let bc=(cols[2]||'').replace(/\D+/g,''); // rakamları çek
      if(plu && bc && bc.length>=4){ (barcByPlu[plu]??=[]).push(bc); }
    }
    else if(t==='4'){ // 4;PLU;…;…;FİYAT;…
      const plu=(cols[1]||'').trim();
      // 🔴 FİYAT kesinlikle 5. sütun: index 4
      let rawPrice = (cols[4]||'').trim();
      const priceDisp = normalizePrice(rawPrice);  // 175.00 → 175,00 ; 1.175,00 → 1.175,00
      if(plu) prices[plu]=priceDisp;
    }
    // 5;... yok say
  }

  const map={};
  for(const [plu,barcs] of Object.entries(barcByPlu)){
    const name=names[plu]||''; const price=prices[plu]||'';
    for(const bc of barcs){ map[bc]={name,price}; }
  }
  return map;
}

// --- fiyat normalizasyonu ---
// hem "175.00" hem "1.175,00" gibi yazımları "175,00" formatına getirir
function normalizePrice(p){
  if(!p) return '';
  p=String(p).replace(/\s+/g,'').replace(/"/g,'');
  // sadece ondalık nokta: 175.00
  if(/^\d+\.\d{2}$/.test(p)) return p.replace('.',',');
  // sadece ondalık virgül: 175,00
  if(/^\d+,\d{2}$/.test(p)) return p;
  // karışık/diğer
  let n = Number(p.replace(/\./g,'').replace(',','.'));
  if(!isFinite(n) || n<=0) return '';
  return n.toFixed(2).replace('.',',');
}

// --- arama ---
search.addEventListener('input', ()=>{
  const q=trLower(search.value.trim());
  results.innerHTML=''; if(!q || nameIndex.length===0) return;
  let shown=0;
  for(const r of nameIndex){
    if(r.name.includes(q)){
      const p=productMap[r.barcode]||{};
      const div=document.createElement('div');
      div.style.cssText='padding:10px;border:1px solid #e5e9ff;border-radius:10px;margin:6px 0;';
      div.innerHTML=`<b>${p.name||''}</b><br><span class="muted">${r.barcode}</span> · ${p.price||'—'}`;
      div.onclick=()=>{ barcodeInp.value=r.barcode; showProductInfo(r.barcode); window.scrollTo({top:0,behavior:'smooth'}); };
      results.appendChild(div);
      if(++shown>=50) break;
    }
  }
});

// --- olaylar ---
$('btnStart').onclick=async()=>{await listCameras();start();};
$('btnStop').onclick=()=>stop();
$('btnAdd').onclick=()=>{ upsert(barcodeInp.value.trim(),qtyInp.value); barcodeInp.value=''; qtyInp.value=1; showProductInfo(''); };
$('btnMinus').onclick=()=>{ qtyInp.value=Math.max(1,Number(qtyInp.value)-1); };
$('btnPlus').onclick=()=>{ qtyInp.value=Number(qtyInp.value)+1; };
$('btnClearField').onclick=()=>{ barcodeInp.value=''; showProductInfo(''); };
$('btnExport').onclick=()=>exportTXT();
$('btnPDF').onclick=()=>exportPDF();
$('btnClear').onclick=()=>{ if(confirm('Listeyi temizle?')){ state.items={}; save(); render(); } };
$('btnUndo').onclick=()=>undo();

// "Tamam" → miktara odaklan + doğru ses
$('btnGo').onclick=()=>{
  const code=barcodeInp.value.trim();
  if(!code){ playErr(); return; }
  const found=!!productMap[code];
  showProductInfo(code);
  if(found) playOk(); else playErr();
  qtyInp.focus(); qtyInp.select();
};

barcodeInp.addEventListener('focus', ()=>{ qtyInp.select(); });
barcodeInp.addEventListener('input', ()=>{ const code=barcodeInp.value.replace(/\D/g,''); if(code.length>=4) showProductInfo(code); });
barcodeInp.addEventListener('keydown', (e)=>{ if(e.key==='Enter'){ $('btnGo').click(); } });

qtyInp.addEventListener('keydown', (e)=>{ if(e.key==='Enter'){ $('btnAdd').click(); } });

btnScanOnce.onclick=async()=>{ await listCameras(); state.singleShot=true; btnScanOnce.disabled=true; btnScanOnce.textContent='Okutuluyor...'; if(!state.scanning) await start(); else statusEl.textContent='Tek seferlik okuma aktif'; };

// başlat
try{
  const pm=localStorage.getItem('productMap'); if(pm){ productMap=JSON.parse(pm); mapStat.textContent=Object.keys(productMap).length+' ürün yüklü'; }
  const ni=localStorage.getItem('nameIndex'); if(ni){ nameIndex=JSON.parse(ni); }
}catch{}
load(); listCameras();

// ürün bulunamadığında manuel kontrol için:
function ensureBeepByLookup(code){
  if(!productMap[code]) playErr(); else playOk();
}
barcodeInp.addEventListener('blur', ()=>{ const c=barcodeInp.value.trim(); if(c) ensureBeepByLookup(c); });
