/* GENÇ GROSS – uygulama mantığı */

const el = {
  selCam:  document.getElementById('cameraSelect'),
  video:   document.getElementById('video'),
  stat:    document.getElementById('scanStatus'),
  fps:     document.getElementById('fps'),
  barcode: document.getElementById('barcode'),
  qty:     document.getElementById('qty'),
  tbody:   document.getElementById('tbody'),
  totalRows: document.getElementById('totalRows'),
  totalQty:  document.getElementById('totalQty'),
  filename:  document.getElementById('filename'),
  beep: document.getElementById('beep'),
  err:  document.getElementById('err'),
  btnScanOnce: document.getElementById('btnScanOnce'),
  productName: document.getElementById('productName'),
  productPrice:document.getElementById('productPrice'),
  productFile: document.getElementById('productFile'),
  encSel:      document.getElementById('encSel'),
  mapStat:     document.getElementById('mapStat'),
  nameSearch:  document.getElementById('nameSearch'),
  searchArea:  document.getElementById('searchArea'),
};

const state = { items:{}, scanning:false, currentDeviceId:null, singleShot:false };
let mediaStream=null, rafId=null, frames=0, duplicateGuard={code:null,until:0}, lastOp=null, detector=null, off=null, octx=null;
let productMap = {}; // { barcodeOrCode: {name, price} }

function save(){ localStorage.setItem('gg_items', JSON.stringify(state.items)); }
function load(){ try{ state.items = JSON.parse(localStorage.getItem('gg_items')||'{}'); }catch{} render(); }
function setMap(map, src='dosya'){ productMap = map; localStorage.setItem('gg_map', JSON.stringify(productMap)); el.mapStat.textContent = Object.keys(map).length+' ürün yüklü'; alert(`${Object.keys(map).length} ürün yüklendi (${src}).`); }

/* ---------- liste render ---------- */
function render(){
  el.tbody.innerHTML=''; let sum=0;
  Object.entries(state.items).forEach(([c,q])=>{
    sum += Number(q)||0;
    const name = (productMap[c]?.name) || '—';
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${c}</td><td>${name}</td><td class="right">${q}</td><td><button onclick="delItem('${c}')">Sil</button></td>`;
    el.tbody.appendChild(tr);
  });
  el.totalRows.textContent = Object.keys(state.items).length;
  el.totalQty.textContent  = sum;
}
window.delItem=(c)=>{ delete state.items[c]; save(); render(); };
function upsert(c,q){ if(!c) return; const n=Math.max(1,Number(q)||1); state.items[c]=(Number(state.items[c])||0)+n; lastOp={code:c,qty:n}; save(); render(); }
function undo(){ if(!lastOp) return; const {code,qty}=lastOp; state.items[code]=(Number(state.items[code])||0)-qty; if(state.items[code]<=0) delete state.items[code]; lastOp=null; save(); render(); }

/* ---------- export ---------- */
function dl(name,content,type){ const a=document.createElement('a'); a.href=URL.createObjectURL(new Blob([content],{type})); a.download=name; a.click(); URL.revokeObjectURL(a.href); }
function exportTXT(){ const lines=Object.entries(state.items).map(([c,q])=>`${c};${q}`); dl((el.filename.value||'sayim')+'.txt',lines.join('\n'),'text/plain'); }
function exportCSV(){ const lines=['barcode,qty',...Object.entries(state.items).map(([c,q])=>`${c},${q}`)]; dl((el.filename.value||'sayim')+'.csv',lines.join('\n'),'text/csv'); }

/* ---------- kamera ---------- */
async function listCameras(){
  try{
    const devices=await navigator.mediaDevices.enumerateDevices();
    const videos=devices.filter(d=>d.kind==='videoinput');
    el.selCam.innerHTML='';
    videos.forEach((d,i)=>{ const o=document.createElement('option'); o.value=d.deviceId; o.textContent=d.label||`camera ${i+1}`; el.selCam.appendChild(o); });
    const rear=videos.find(d=>/back|rear|arka/i.test(d.label||'')); state.currentDeviceId=rear?.deviceId||videos[0]?.deviceId||null;
    if(state.currentDeviceId) el.selCam.value=state.currentDeviceId;
  }catch(e){}
}
el.selCam.onchange=()=>{ state.currentDeviceId=el.selCam.value; if(state.scanning) start(); };

async function start(){
  stop(); el.stat.textContent='Kamera açılıyor...';
  try{
    const constraints = { video: state.currentDeviceId?{deviceId:{exact:state.currentDeviceId},width:{ideal:1920},height:{ideal:1080}}:{facingMode:{ideal:'environment'},width:{ideal:1920},height:{ideal:1080}}, audio:false };
    mediaStream = await navigator.mediaDevices.getUserMedia(constraints);
    el.video.srcObject = mediaStream; await el.video.play();
    state.scanning=true; el.stat.textContent='Tarama aktif'; runNativeLoop(); fpsCounter();
  }catch(e){ el.stat.textContent='Tarama başlatılamadı'; }
}
function stop(){
  cancelAnimationFrame(rafId); rafId=null; frames=0; el.fps.textContent='FPS: -';
  const s=el.video.srcObject; if(s?.getTracks) s.getTracks().forEach(t=>t.stop()); el.video.srcObject=null; mediaStream=null; state.scanning=false; el.stat.textContent='Durduruldu';
}
async function runNativeLoop(){
  if(!('BarcodeDetector'in window)){ el.stat.textContent='Tarayıcı desteklemiyor'; return; }
  if(!detector){ detector = new BarcodeDetector({formats:['ean_13','ean_8','code_128','code_39','itf','upc_e','upc_a']}); }
  if(!off){ off=document.createElement('canvas'); octx=off.getContext('2d',{willReadFrequently:true}); }
  const loop = async()=>{
    if(!state.scanning) return; frames++;
    const vw=el.video.videoWidth,vh=el.video.videoHeight;
    if(vw&&vh){
      const rw=Math.floor(vw*0.68), rh=Math.floor(vh*0.32);
      const rx=Math.floor((vw-rw)/2), ry=Math.floor((vh-rh)/2);
      off.width=rw; off.height=rh; octx.drawImage(el.video,rx,ry,rw,rh,0,0,rw,rh);
      try{ const d=await detector.detect(off); if(d&&d.length){ onCode((d[0].rawValue||'').trim()); } }catch(_){}
    }
    if(state.scanning) rafId=requestAnimationFrame(loop);
  }; loop();
}
function onCode(text){
  if(!text) return; const now=performance.now();
  if(text===duplicateGuard.code && now<duplicateGuard.until) return;
  duplicateGuard={code:text,until:now+1500};
  el.barcode.value=text; showProductInfo(text);
  play(el.beep);
  if(state.singleShot){ stop(); el.btnScanOnce.disabled=true; el.btnScanOnce.textContent='Okundu ✓'; setTimeout(()=>{el.btnScanOnce.disabled=false; el.btnScanOnce.textContent='👉 Tek Okut';},900); state.singleShot=false; }
}
function fpsCounter(){ let last=performance.now(); const tick=()=>{ if(!state.scanning) return; const now=performance.now(); if(now-last>=1000){ el.fps.textContent='FPS: '+frames; frames=0; last=now; } requestAnimationFrame(tick); }; tick(); }

/* ---------- ürün bilgisi göster ---------- */
function showProductInfo(code){
  const p = productMap[code];
  if(p){ el.productName.textContent=p.name||'—'; el.productPrice.textContent=p.price||'—'; }
  else { el.productName.textContent='Bulunamadı'; el.productPrice.textContent='—'; }
}

/* ---------- dosya okuma & ayrıştırma ---------- */
async function readFileAsText(file, preferEnc){
  // Seçilen kodlamayı dene; olmazsa fallback’ler
  const tryEnc = async(enc)=>new Promise((res,rej)=>{
    const fr=new FileReader(); fr.onload=()=>res(fr.result); fr.onerror=rej;
    enc && enc!=='utf-8' ? fr.readAsText(file, enc) : fr.readAsText(file);
  });
  const encs=[preferEnc||'utf-8','windows-1254','iso-8859-9','utf-8'];
  let lastErr;
  for(const e of encs){ try{ return await tryEnc(e);}catch(err){ lastErr=err; } }
  throw lastErr||new Error('Dosya okunamadı');
}

function parseFileSmart(txt){
  const t = txt.trimStart();
  if(t.startsWith('{') || t.startsWith('[')){
    const obj = JSON.parse(t); const map={};
    for(const [k,v] of Object.entries(obj)){ if(typeof v==='string') map[k]={name:v,price:''}; else map[k]={name:v.name||'',price:v.price||''}; }
    return map;
  }
  if(/^\(.*İSİM.*\)[\s\S]*\(.*BARKOD.*\)[\s\S]*\(.*FİYAT.*\)/i.test(txt)) return parseGNCPULUF(txt);
  return parseCSV(txt);
}

// CSV/TXT: kod;isim;...;fiyat  (ayraç , veya ;)
function parseCSV(txt){
  const lines = txt.split(/\r?\n/).filter(x=>x.trim().length);
  const sep = lines[0]?.includes(';')?';':',';
  const map={};
  for(const L of lines){
    const cols=L.split(sep).map(s=>s.trim());
    if(cols.length>=2){
      const code=cols[0].replace(/\s+/g,'');
      const name=cols[1];
      const priceDisp = toPriceDisp(cols.slice(2).find(c=>/\d,\d{2}/.test(c))||'');
      if(/^\d{5,14}$/.test(code)) map[code]={name,price:priceDisp};
      else map[code]={name,price:priceDisp}; // stok kodlarını da kabul et
    }
  }
  return map;
}

// GNCPULUF: (İSİM) satırı; altındaki satırda (BARKOD) — fiyatlar ayrı sütunda (FİYAT); aralarda boş satır olabilir
function parseGNCPULUF(txt){
  const lines = txt.split(/\r?\n/);
  const map={};
  const PRICE_RE = /\d{1,3}(?:\.\d{3})*,\d{2}/;

  for(let i=0;i<lines.length;i++){
    const nameLine = lines[i].trim();
    if(!nameLine) continue;

    // isim satırı (en az bir harf, çok sayıda boşluk/özel karakter olabilir)
    if(/[A-ZÇĞİÖŞÜa-zçğıöşü]/.test(nameLine) && !/^\d{5,}$/.test(nameLine)){
      // 1-3 satır aşağıda barkod ara
      let barcode='';
      for(let j=1;j<=3 && i+j<lines.length;j++){
        const b = (lines[i+j]||'').replace(/\s+/g,'').trim();
        if(/^\d{8,14}$/.test(b)){ barcode=b; break; }
      }
      if(!barcode) continue;

      // 1-8 satır aşağıda fiyat ara (ilk görüleni al)
      let priceDisp='';
      for(let k=1;k<=8 && i+k<lines.length;k++){
        const L = lines[i+k]||'';
        const m = L.match(PRICE_RE);
        if(m){ priceDisp = toPriceDisp(m[0]); break; }
      }
      map[barcode]={name:nameLine,price:priceDisp};
    }
  }
  return map;
}

/* yardımcılar */
function toPriceDisp(p){ if(!p) return ''; p = p.replace(/\s+/g,'').replace(/\./g,''); if(!/,/.test(p)) return ''; let n=Number(p.replace(',','.')); if(!isFinite(n)||n<=0) return ''; return n.toFixed(2).replace('.',','); }
function play(audio){ try{ audio.currentTime=0; audio.play(); }catch{} }

/* ---------- olaylar ---------- */
document.getElementById('btnStart').onclick=async()=>{ await listCameras(); start(); };
document.getElementById('btnStop').onclick=()=>stop();
document.getElementById('btnScanOnce').onclick=async()=>{ await listCameras(); state.singleShot=true; el.btnScanOnce.disabled=true; el.btnScanOnce.textContent='Okutuluyor...'; if(!state.scanning) await start(); else el.stat.textContent='Tek seferlik okuma aktif'; };

document.getElementById('btnMinus').onclick=()=>{ el.qty.value=Math.max(1,Number(el.qty.value)-1); };
document.getElementById('btnPlus').onclick =()=>{ el.qty.value=Number(el.qty.value)+1; };
document.getElementById('btnClearField').onclick=()=>{ el.barcode.value=''; showProductInfo(''); };
document.getElementById('btnAdd').onclick =()=>{ upsert(el.barcode.value.trim(), el.qty.value); el.barcode.value=''; el.qty.value=1; showProductInfo(''); };
document.getElementById('btnExport').onclick=()=>exportTXT();
document.getElementById('btnCSV').onclick  =()=>exportCSV();
document.getElementById('btnClear').onclick=()=>{ if(confirm('Listeyi temizlemek istiyor musun?')){ state.items={}; save(); render(); } };
document.getElementById('btnUndo').onclick =()=>undo();

document.getElementById('btnCommit').onclick=()=>{ // “Tamam” → miktara geç
  const code = el.barcode.value.replace(/\D/g,'');
  if(code){ showProductInfo(code); play(productMap[code]?el.beep:el.err); el.qty.focus(); el.qty.select(); }
};

// Barkod yazarken bilgi göster
el.barcode.addEventListener('input',()=>{
  const code=el.barcode.value.replace(/\D/g,'');
  if(code.length>=5) showProductInfo(code);
});

// miktarda Enter → ekle
el.qty.addEventListener('focus', ()=>{ el.qty.select(); });
el.qty.addEventListener('keydown', (e)=>{ if(e.key==='Enter'){ upsert(el.barcode.value.trim(), el.qty.value); el.barcode.value=''; el.qty.value=1; showProductInfo(''); } });

// dosya yükleme
document.getElementById('btnClearMap').onclick=()=>{ productMap={}; localStorage.removeItem('gg_map'); el.mapStat.textContent='0 ürün yüklü'; showProductInfo(''); };
el.productFile.onchange = async (e)=>{
  const f = e.target.files?.[0]; if(!f) return;
  let txt='';
  try{ txt = await readFileAsText(f, el.encSel.value); }catch{}
  try{
    const map = parseFileSmart(txt);
    setMap(map, f.name);
    requestAnimationFrame(()=> el.mapStat.textContent = `${Object.keys(productMap).length} ürün yüklü`);
  }catch(err){
    console.error(err);
    alert('Veri çözümlenemedi. CSV/TXT (kod;isim;…;fiyat), JSON veya GNCPULUF dosyası verin.');
  }
};

// isimle arama (büyük/küçük ve Türkçe harf duyarsız)
const trMap = {'i':'İ','ı':'I','ş':'Ş','ğ':'Ğ','ü':'Ü','ö':'Ö','ç':'Ç'};
const normalize = s => s.toLocaleUpperCase('tr-TR');
el.nameSearch.addEventListener('input', ()=>{
  const q = normalize(el.nameSearch.value.trim());
  el.searchArea.innerHTML='';
  if(!q) return;
  const list=[];
  for(const [code,p] of Object.entries(productMap)){
    const nm = normalize(p.name||'');
    if(nm.includes(q)) list.push({code,name:p.name,price:p.price||''});
    if(list.length>=50) break;
  }
  list.forEach(r=>{
    const d=document.createElement('div');
    d.className='result';
    d.innerHTML=`<div class="ttl">${r.name}</div><div>${r.code} · ${r.price||'—'}</div>`;
    d.onclick=()=>{ el.barcode.value=r.code; showProductInfo(r.code); play(el.beep); window.scrollTo({top:0,behavior:'smooth'}); };
    el.searchArea.appendChild(d);
  });
});

/* ---------- init ---------- */
try{ const pm = localStorage.getItem('gg_map'); if(pm){ productMap = JSON.parse(pm); el.mapStat.textContent = Object.keys(productMap).length+' ürün yüklü'; } }catch{}
load(); listCameras();
