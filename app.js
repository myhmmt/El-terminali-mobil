/* ============= Global durum ============= */
const state = { items:{}, lastOp:null, scanning:false, singleShot:false };
let productMap = {};           // { codeOrBarcode: {name, priceDisp, priceNum} }
let nameIndex  = [];           // [{key, code}] küçük-büyük/aksan normalize edilmiş isim araması için
let mediaStream=null, detector=null, rafId=null, frames=0;

/* ============= Kısayollar ============= */
const $ = (id)=>document.getElementById(id);
const video=$('video'), selCam=$('cameraSelect'), statusEl=$('scanStatus'), fpsEl=$('fps');
const barcodeInp=$('barcode'), qtyInp=$('qty'), tbody=$('tbody'), totalRows=$('totalRows'), totalQty=$('totalQty');
const filenameInp=$('filename'), okBeep=$('okBeep'), errBeep=$('errBeep');
const productNameEl=$('productName'), productPriceEl=$('productPrice');
const productFile=$('productFile'), mapStat=$('mapStat'), encSel=$('encSel');
const nameSearch=$('nameSearch'), searchResults=$('searchResults');

/* ============= Yardımcılar ============= */
const turkNorm = (s='') => s.toLowerCase()
  .replaceAll('ı','i').replaceAll('İ','i').replaceAll('ş','s').replaceAll('ğ','g')
  .replaceAll('ü','u').replaceAll('ö','o').replaceAll('ç','c');

const priceDisp = (n)=> (isFinite(n) && n>0) ? n.toFixed(2).replace('.',',') : '';

function render(){
  tbody.innerHTML=''; let adetTop=0;
  Object.entries(state.items).forEach(([code,qty])=>{
    adetTop += Number(qty)||0;
    const name = productMap[code]?.name || '—';
    const tr=document.createElement('tr');
    tr.innerHTML = `<td>${code}</td><td>${name}</td><td style="text-align:right">${qty}</td>`;
    tbody.appendChild(tr);
  });
  totalRows.textContent = Object.keys(state.items).length;
  totalQty.textContent  = adetTop;
}
function save(){ localStorage.setItem('barcodeItems', JSON.stringify(state.items)); }
function load(){ try{ const raw=localStorage.getItem('barcodeItems'); if(raw) state.items=JSON.parse(raw)||{}; }catch{} render(); }

function showProductInfo(code){
  const p = productMap[code];
  if(p){ productNameEl.textContent=p.name; productPriceEl.textContent=p.priceDisp||'—'; }
  else { productNameEl.textContent='Bulunamadı'; productPriceEl.textContent='—'; }
}

function onScanned(text){
  const code=(text||'').trim();
  if(!code) return;
  barcodeInp.value=code;
  if(productMap[code]) { try{ okBeep.currentTime=0; okBeep.play(); }catch{} }
  else { try{ errBeep.currentTime=0; errBeep.play(); }catch{} }
  showProductInfo(code);
  if(state.singleShot){ stop(); $('btnScanOnce').disabled=false; $('btnScanOnce').textContent='👉 Tek Okut'; state.singleShot=false; }
}

function upsert(code, qty){
  if(!code) return;
  const n = Math.max(1, Number(qty)||1);
  state.items[code] = (Number(state.items[code])||0) + n;
  state.lastOp = {code, qty:n};
  save(); render();
}
function undo(){
  if(!state.lastOp) return;
  const {code, qty} = state.lastOp;
  state.items[code] = (Number(state.items[code])||0) - qty;
  if(state.items[code]<=0) delete state.items[code];
  state.lastOp=null; save(); render();
}

/* ============= Dışa aktar ============= */
function dl(name, content, type){
  const a=document.createElement('a');
  a.href=URL.createObjectURL(new Blob([content],{type}));
  a.download=name; a.click(); URL.revokeObjectURL(a.href);
}
function exportTXT(){
  const lines = Object.entries(state.items).map(([c,q])=>`${c};${q}`);
  dl((filenameInp.value||'sayim')+'.txt', lines.join('\n'), 'text/plain');
}

/* ============= Kamera/okuyucu ============= */
async function listCameras(){
  const devs = await navigator.mediaDevices.enumerateDevices().catch(()=>[]);
  const cams = devs.filter(d=>d.kind==='videoinput');
  selCam.innerHTML='';
  cams.forEach((d,i)=>{
    const o=document.createElement('option');
    o.value=d.deviceId; o.textContent=d.label||`camera ${i+1}`; selCam.appendChild(o);
  });
  if(cams[0]) selCam.value=cams[0].deviceId;
}
async function start(){
  stop(); statusEl.textContent='Açılıyor...';
  try{
    const constraints={ video: selCam.value?{deviceId:{exact:selCam.value},width:{ideal:1920},height:{ideal:1080}}:{facingMode:'environment'}, audio:false };
    mediaStream=await navigator.mediaDevices.getUserMedia(constraints);
    video.srcObject=mediaStream; await video.play(); state.scanning=true; statusEl.textContent='Tarama aktif';
    if(!('BarcodeDetector' in window)){ statusEl.textContent='BarcodeDetector yok'; return; }
    if(!detector) detector=new BarcodeDetector({formats:['ean_13','ean_8','code_128','code_39','itf','upc_e','upc_a']});
    const loop=async()=>{
      if(!state.scanning) return;
      try{ const ds=await detector.detect(video); if(ds?.[0]) onScanned(ds[0].rawValue||''); }catch{}
      rafId=requestAnimationFrame(loop);
    }; loop();
  }catch(e){ statusEl.textContent='Başlatılamadı'; }
}
function stop(){
  cancelAnimationFrame(rafId); rafId=null; frames=0; fpsEl.textContent='FPS: -';
  const s=video.srcObject; if(s?.getTracks) s.getTracks().forEach(t=>t.stop());
  video.srcObject=null; state.scanning=false; statusEl.textContent='Durduruldu';
}

/* ============= GNCPULUF (Genius 2 SQL) Ayrıştırıcı ============= */
/*
  1;PLU;İSİM;...
  3;PLU;BARKOD;...
  4;PLU;...;FİYAT;...   -> FİYAT: satırın sondan bir önceki kolonu (175.00 gibi)  (noktalı)
*/
function parseGNCPULUF(txt){
  const names={}, barcodes={}, prices={};
  const lines=txt.split(/\r?\n/);
  for(const raw of lines){
    if(!raw) continue;
    const p = raw.split(';');
    const tag = p[0];
    if(tag==='1'){           // isim
      const plu=p[1]; const name=(p[2]||'').trim();
      if(plu) names[plu]=name;
    }else if(tag==='3'){     // barkod
      const plu=p[1]; const bc=(p[2]||'').replace(/\D/g,'');
      if(plu && bc){ if(!barcodes[plu]) barcodes[plu]=[]; barcodes[plu].push(bc); }
    }else if(tag==='4'){     // fiyat (sondan bir önceki)
      const plu=p[1];
      const priceStr = p[p.length-2]; // <<<<< kritik
      const num = parseFloat(priceStr);           // 175.00 gibi noktalı
      const disp = priceDisp(num);
      if(plu) prices[plu] = {num,disp};
    }
  }

  // Harita oluştur
  const map = {};
  const plus = new Set([...Object.keys(names), ...Object.keys(barcodes), ...Object.keys(prices)]);
  for(const plu of plus){
    const name = names[plu] || '';
    const pr   = prices[plu] || {num:0,disp:''};

    // PLU ile koddan erişim (1, 2, 50526 gibi kısa kodlar)
    map[plu] = {name, priceNum:pr.num, priceDisp:pr.disp};

    // Barkod(lar)
    (barcodes[plu]||[]).forEach(bc=>{
      map[bc] = {name, priceNum:pr.num, priceDisp:pr.disp};
    });
  }
  return map;
}

/* CSV/TXT (kod;isim;...;fiyat) & JSON da destek */
function parseCSVorTXT(txt){
  const lines=txt.split(/\r?\n/).filter(x=>x.trim().length);
  const sep = lines[0]?.includes(';')?';':',';
  const map={};
  for(const L of lines){
    const c=L.split(sep).map(s=>s.trim());
    if(c.length<2) continue;
    const code=c[0];
    const name=c[1]||'';
    const priceNum=parseFloat((c.at(-1)||'').replace(',','.'));
    map[code]={name,priceNum,priceDisp:priceDisp(priceNum)};
  }
  return map;
}

/* ============= Ürün yükleme/arama ============= */
$('btnClearMap').onclick=()=>{ productMap={}; nameIndex=[]; localStorage.removeItem('productMap'); mapStat.textContent='0 ürün yüklü'; showProductInfo(''); };

productFile.onchange = async (e)=>{
  const f=e.target.files?.[0]; if(!f) return;
  let txt='';
  try{
    const buf = await f.arrayBuffer();
    const dec = new TextDecoder(encSel.value||'windows-1254');
    txt = dec.decode(buf);
  }catch{ alert('Dosya okunamadı'); return; }

  try{
    let map={};
    // Format tespiti: Satır başları 1; / 3; / 4; ise GNCPULUF diyelim
    if(/^\s*[134];/m.test(txt)) map = parseGNCPULUF(txt);
    else if(txt.trim().startsWith('{')) map = JSON.parse(txt);
    else map = parseCSVorTXT(txt);

    productMap = map;
    localStorage.setItem('productMap', JSON.stringify(productMap));

    // isim arama index’i
    nameIndex = Object.entries(productMap)
      // sadece benzersiz isimler için (barkod tekrarlarını azaltmak adına kodu PLU’ya yakın seçmek zor)
      .map(([code, p])=> ({ key: turkNorm(p.name||''), code, name:p.name||'', priceDisp:p.priceDisp||'' }))
      .filter(x=>x.key.length>1);

    const count = Object.keys(productMap).length;
    mapStat.textContent = `${count} ürün yüklü`;
    showProductInfo(barcodeInp.value.trim());
    alert(`${count} ürün yüklendi (${f.name}).`);
  }catch(err){
    console.error(err);
    alert('Veri çözümlenemedi. CSV/TXT (kod;isim;...;fiyat), JSON veya GNCPULUF dosyası verin.');
  }
};

nameSearch.addEventListener('input', ()=>{
  const q = turkNorm(nameSearch.value.trim());
  searchResults.innerHTML='';
  if(q.length<2) return;
  const hits = nameIndex.filter(x=>x.key.includes(q)).slice(0,50);
  for(const h of hits){
    const div=document.createElement('div');
    div.style.cssText='padding:10px;border:1px solid #e3e7ff;border-radius:10px;margin:6px 0;background:#fff';
    div.innerHTML = `<b>${h.name}</b><br><span class="muted">${h.code} · ${h.priceDisp||'—'}</span>`;
    div.onclick=()=>{ barcodeInp.value=h.code; showProductInfo(h.code); window.scrollTo({top:0,behavior:'smooth'}); };
    searchResults.appendChild(div);
  }
});

/* ============= Olaylar ============= */
$('btnStart').onclick=async()=>{ await listCameras(); start(); };
$('btnStop').onclick=()=>stop();
$('btnScanOnce').onclick=async()=>{ await listCameras(); state.singleShot=true; this.disabled=true; this.textContent='Okutuluyor...'; if(!state.scanning) start(); };

$('btnMinus').onclick=()=>{ qtyInp.value=Math.max(1, Number(qtyInp.value||1)-1); };
$('btnPlus').onclick =()=>{ qtyInp.value=Number(qtyInp.value||1)+1; };
$('btnAdd').onclick  =()=>{ upsert(barcodeInp.value.trim(), qtyInp.value); barcodeInp.select(); };

$('btnDone').onclick =()=>{ qtyInp.focus(); qtyInp.select(); };
$('btnClear').onclick=()=>{ if(confirm('Listeyi temizlemek istiyor musun?')){ state.items={}; save(); render(); } };
$('btnUndo').onclick =()=>undo();
$('btnExport').onclick=()=>exportTXT();

barcodeInp.addEventListener('input', ()=>{
  const code = barcodeInp.value.replace(/\s+/g,'');
  if(code.length>=1) showProductInfo(code);
});
barcodeInp.addEventListener('keydown', (e)=>{
  if(e.key==='Enter'){ e.preventDefault(); qtyInp.focus(); qtyInp.select(); }
});
qtyInp.addEventListener('focus', ()=>{ qtyInp.select(); });
qtyInp.addEventListener('keydown', (e)=>{
  if(e.key==='Enter'){ e.preventDefault(); $('btnAdd').click(); }
});

/* ============= Başlangıç: localStorage’dan yükle ============= */
try{
  const pm=localStorage.getItem('productMap');
  if(pm){ productMap=JSON.parse(pm)||{}; mapStat.textContent=Object.keys(productMap).length+' ürün yüklü';
    nameIndex = Object.entries(productMap).map(([code,p])=>({key:turkNorm(p.name||''),code,name:p.name||'',priceDisp:p.priceDisp||''}));
  }
}catch{}
load(); listCameras();
