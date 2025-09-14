/* Genç Gross Mobil Terminal — arama: sadece barkod göster, kısa kodları destekle, miktarda Enter=Ekle */
const state = { items:{}, scanning:false, currentDeviceId:null, singleShot:false };
let mediaStream=null, rafId=null, frames=0, duplicateGuard={code:null,until:0}, lastOp=null;
let detector=null, off=null, octx=null;
let productMap={};

// ---- DOM ----
const $=(s,c=document)=>c.querySelector(s);
const selCam=$('#cameraSelect'), video=$('#video'), statusEl=$('#scanStatus'), fpsEl=$('#fps');
const barcodeInp=$('#barcode'), qtyInp=$('#qty'), btnComplete=$('#btnComplete');
const tbody=$('#tbody'), totalRows=$('#totalRows'), totalQty=$('#totalQty'), filenameInp=$('#filename');
const beep=$('#beep'), err=$('#err'), btnScanOnce=$('#btnScanOnce');
const productNameEl=$('#productName'), productPriceEl=$('#productPrice');
const productFile=$('#productFile'), mapStat=$('#mapStat');
const onlyEANBox=$('#onlyEAN');
const searchInput=$('#searchName'), searchResults=$('#searchResults');

// ---- utils ----
function dl(name,content,type){const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([content],{type}));a.download=name;a.click();URL.revokeObjectURL(a.href);}
function vibrate(n=30){navigator.vibrate&&navigator.vibrate(n)}
function safePlay(a){try{a.currentTime=0;a.play()}catch(_){}}
function trFold(s=''){return s.toLowerCase()
  .replace(/ı/g,'i').replace(/İ/g,'i').replace(/ş/g,'s').replace(/Ş/g,'s')
  .replace(/ğ/g,'g').replace(/Ğ/g,'g').replace(/ç/g,'c').replace(/Ç/g,'c')
  .replace(/ö/g,'o').replace(/Ö/g,'o').replace(/ü/g,'u').replace(/Ü/g,'u');}
const stripDigits = s => String(s||'').replace(/\D/g,'');
const isEAN = k => /^\d{8,14}$/.test(k);

// ---- Liste ----
function render(){ tbody.innerHTML=''; let sum=0;
  Object.entries(state.items).forEach(([c,q])=>{
    sum+=Number(q)||0; const name=(productMap[c]?.name)||'—';
    const tr=document.createElement('tr');
    tr.innerHTML=`<td>${c}</td><td>${name}</td><td class="right">${q}</td><td><button onclick="del('${c}')">Sil</button></td>`;
    tbody.appendChild(tr);
  });
  totalRows.textContent=Object.keys(state.items).length; totalQty.textContent=sum;
}
window.del=(c)=>{delete state.items[c];save();render();}
function upsert(c,q){if(!c)return; const n=Math.max(1,Number(q)||1); state.items[c]=(Number(state.items[c])||0)+n; lastOp={code:c,qty:n}; save(); render();}
function undo(){if(!lastOp)return; const {code,qty}=lastOp; state.items[code]=(Number(state.items[code])||0)-qty; if(state.items[code]<=0) delete state.items[code]; lastOp=null; save(); render();}
function save(){localStorage.setItem('barcodeItems',JSON.stringify(state.items))}
function load(){const raw=localStorage.getItem('barcodeItems'); if(raw){try{state.items=JSON.parse(raw)}catch{}} render();}

// ---- Export ----
function exportTXT(){const lines=Object.entries(state.items).map(([c,q])=>`${c};${q}`); dl((filenameInp.value||'sayim')+'.txt',lines.join('\n'),'text/plain')}
function exportCSV(){const lines=['code,name,qty',...Object.entries(state.items).map(([c,q])=>`${c},"${(productMap[c]?.name||'').replace(/"/g,'""')}",${q}`)]; dl((filenameInp.value||'sayim')+'.csv',lines.join('\n'),'text/csv')}

// ---- Kamera ----
async function listCameras(){
  try{
    const devices=(await navigator.mediaDevices.enumerateDevices()).filter(d=>d.kind==='videoinput');
    selCam.innerHTML=''; devices.forEach((d,i)=>{const o=document.createElement('option');o.value=d.deviceId;o.textContent=d.label||`Kamera ${i+1}`;selCam.appendChild(o);});
    const rear=devices.find(d=>/back|rear|arka/i.test(d.label||'')); state.currentDeviceId=rear?.deviceId||devices[0]?.deviceId||null;
    if(state.currentDeviceId) selCam.value=state.currentDeviceId;
  }catch(_){}
}
selCam.onchange=()=>{state.currentDeviceId=selCam.value; if(state.scanning) start();};
onlyEANBox.onchange=()=>{localStorage.setItem('onlyEAN', onlyEANBox.checked?'1':'0'); detector=null;};

function getFormats(){ let fmts=['ean_13','ean_8']; if(!onlyEANBox.checked) fmts=fmts.concat(['code_128','code_39','itf','upc_e','upc_a']); return fmts; }

async function start(){
  stop(); statusEl.textContent='Kamera açılıyor...';
  try{
    const constraints={video: state.currentDeviceId?{deviceId:{exact:state.currentDeviceId},width:{ideal:1920},height:{ideal:1080}}:{facingMode:{ideal:'environment'},width:{ideal:1920},height:{ideal:1080}},audio:false};
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
function fpsCounter(){let last=performance.now(); const tick=()=>{if(!state.scanning)return; const now=performance.now(); if(now-last>=1000){fpsEl.textContent='FPS: '+frames; frames=0; last=now;} requestAnimationFrame(tick);}; tick();}

// ---- Çok-kare onayı + checksum ----
const CONFIRM_WINDOW_MS=800, CONFIRM_HITS=2;
let confirmMap=new Map();
function isValidEAN13(code){ if(!/^\d{13}$/.test(code)) return false; let sum=0; for(let i=0;i<12;i++){ const n=+code[i]; sum += (i%2? 3*n : n); } return ((10-(sum%10))%10)===+code[12]; }
function isValidEAN8(code){ if(!/^\d{8}$/.test(code)) return false; const n=code.split('').map(Number); const sum=3*(n[1]+n[3]+n[5])+(n[0]+n[2]+n[4]); return ((10-(sum%10))%10)===n[6]; }
function normalizeAndValidate(text){
  const digits=(text||'').trim().replace(/\D/g,'');
  if(digits.length===13 && isValidEAN13(digits)) return digits;
  if(digits.length===8  && isValidEAN8(digits))  return digits;
  if(!onlyEANBox.checked && /^\d{1,24}$/.test(digits)) return digits; // kısa mağaza kodları dahil
  return null;
}
async function runNativeLoop(){
  if(!('BarcodeDetector' in window)){statusEl.textContent='Desteklenmiyor';return;}
  if(!detector){ detector=new BarcodeDetector({formats:getFormats()}); }
  if(!off){ off=document.createElement('canvas'); octx=off.getContext('2d',{willReadFrequently:true}); }
  const loop=async()=>{
    if(!state.scanning) return; frames++;
    const vw=video.videoWidth, vh=video.videoHeight;
    if(vw&&vh){
      const rw=Math.floor(vw*0.68), rh=Math.floor(vh*0.28);
      const rx=Math.floor((vw-rw)/2), ry=Math.floor((vh-rh)/2);
      off.width=rw; off.height=rh; octx.drawImage(video,rx,ry,rw,rh,0,0,rw,rh);
      try{
        const dets=await detector.detect(off);
        if(dets && dets.length){
          const best=dets.reduce((a,b)=> (String(a.rawValue||'').length>=String(b.rawValue||'').length)?a:b);
          const code=normalizeAndValidate(best.rawValue);
          if(code) confirmCandidate(code);
        }
      }catch(_){}
    }
    if(state.scanning) rafId=requestAnimationFrame(loop);
  }; loop();
}
function confirmCandidate(code){
  const now=performance.now();
  const e=confirmMap.get(code)||{count:0,ts:now};
  if(now-e.ts>CONFIRM_WINDOW_MS){e.count=0;e.ts=now;}
  e.count++; e.ts=now; confirmMap.set(code,e);
  if(e.count>=CONFIRM_HITS){ confirmMap.clear(); onCodeAccepted(code); }
}
function onCodeAccepted(code){
  const now=performance.now();
  if(code===duplicateGuard.code && now<duplicateGuard.until) return;
  duplicateGuard={code,until:now+1500};

  barcodeInp.value=code; showProductInfo(code);
  const found=!!smartLookup(code);
  safePlay(found?beep:err); vibrate(found?30:80);

  if(state.singleShot){
    stop();
    btnScanOnce.disabled=true; btnScanOnce.textContent='Okundu ✓';
    setTimeout(()=>{btnScanOnce.disabled=false;btnScanOnce.textContent='👉 Tek Okut';},900);
    state.singleShot=false;
  }
  qtyInp.focus(); setTimeout(()=>qtyInp.select(),0);
}

// ---- Akıllı ürün eşleştirme ----
function smartLookup(key){
  if(!key) return null;
  if(productMap[key]) return productMap[key];
  const d=stripDigits(key); if(d && productMap[d]) return productMap[d];
  const dz=d.replace(/^0+(?=\d)/,''); if(dz && productMap[dz]) return productMap[dz];
  return null;
}
function showProductInfo(code){
  const p=smartLookup(code);
  if(p){ productNameEl.textContent=p.name||'—'; productPriceEl.textContent=p.price||'—'; }
  else { productNameEl.textContent='Bulunamadı'; productPriceEl.textContent='—'; }
}

// ---- Ürün verisi yükleme (STOKK/CSV/JSON/GDF) ----
$('#btnClearMap').onclick=()=>{productMap={};localStorage.removeItem('productMap');mapStat.textContent='0 ürün yüklü';showProductInfo('');};
productFile.onchange=async(e)=>{
  const file=e.target.files?.[0]; if(!file) return;
  let txt=''; try{txt=await file.text();}catch{alert('Dosya okunamadı.');return;}
  loadProductText(txt,file.name||'dosya');
};

function loadProductText(txt,src='metin'){
  try{
    let map={};
    const firstLine=(txt.split(/\r?\n/)[0]||'').toLowerCase();
    const looksStokk = firstLine.includes('stok kodu') && firstLine.includes('stok ismi');
    if(looksStokk)      map=parseSTOKK(txt);
    else if(txt.startsWith('<SIGNATURE=GNDPLU.GDF>')) map=parseGDF(txt);
    else if(txt.trim().startsWith('{'))               map=parseJSON(txt);
    else                                              map=parseCSVGeneric(txt);

    const count=Object.keys(map).length;
    if(!count){const first=(txt.split(/\r?\n/)[0]||'').slice(0,120);alert(`0 ürün bulundu (${src}). İlk satır: "${first}"`);return;}
    productMap=map; localStorage.setItem('productMap',JSON.stringify(productMap));
    mapStat.textContent=count+' ürün yüklü'; showProductInfo(barcodeInp.value.trim());
    alert(`${count} ürün yüklendi (${src}).`);
  }catch(err){console.error(err);alert('Veri çözümlenemedi. Uygun başlıklı TXT/CSV, JSON veya GDF yükleyin.');}
}

function parseJSON(txt){
  const obj=JSON.parse(txt), map={};
  for(const [k,v] of Object.entries(obj)){
    if(typeof v==='string') map[k]={name:v,price:''};
    else map[k]={name:v.name||'',price:v.price||''};
  }
  return map;
}

// STOKK: "Stok kodu;Stok ismi; ... ; Fiyat 1" (+ varsa barkod sütunu)
function parseSTOKK(txt){
  const lines=txt.split(/\r?\n/).filter(x=>x.trim().length);
  if(lines.length<2) return {};
  const sep=';';
  const head=lines[0].split(sep).map(s=>s.trim().toLowerCase());
  let ixCode=head.findIndex(h=>/stok\s*kodu|kod/.test(h));     if(ixCode<0) ixCode=0;
  let ixName=head.findIndex(h=>/stok\s*ismi|stok\s*adi|ad|isim|name/.test(h)); if(ixName<0) ixName=1;
  let ixPrice=head.findIndex(h=>/fiyat/.test(h));              if(ixPrice<0) ixPrice=2;
  let ixBarcode=head.findIndex(h=>/bar\s*kodu|barkod|barcode/.test(h));
  if(ixBarcode<0 && lines.length>1){
    const head2=lines[1].split(sep).map(s=>s.trim().toLowerCase());
    ixBarcode=head2.findIndex(h=>/bar\s*kodu|barkod|barcode/.test(h));
  }

  const map={};
  for(let i=1;i<lines.length;i++){
    const cols=lines[i].split(sep);
    if(cols.length<Math.max(ixCode,ixName,ixPrice)+1) continue;
    const rawCode=(cols[ixCode]||'').trim();
    const rawName=(cols[ixName]||'').trim();
    const rawPrice=(cols[ixPrice]||'').trim();
    const rawBarcode = (ixBarcode>=0 ? (cols[ixBarcode]||'').trim() : '');

    if(!rawName && !rawCode && !rawBarcode) continue;

    const name=cleanupName(rawName);
    const price=normPriceFlexible(rawPrice).disp;

    // mağaza kodu (artık 1 karakter de olabilir)
    const keyCode=rawCode.replace(/\s+/g,'');
    if(validKey(keyCode)) map[keyCode] = {name,price};

    // barkod (yalnızca 8–14 hane)
    const digits=stripDigits(rawBarcode);
    if(isEAN(digits)) map[digits] = {name,price};
  }
  return map;
}
function validKey(k){ return !!k && k.length>=1 && k.length<=24; }
function cleanupName(s){ return String(s||'').replace(/\s{2,}/g,' ').trim(); }

function parseCSVGeneric(txt){
  const lines=txt.split(/\r?\n/).filter(x=>x.trim().length);
  if(!lines.length) return {};
  const sep=lines[0].includes(';')?';':',';
  let start=0, colCode=0, colName=1, colPrice=2;

  const header=lines[0].split(sep).map(x=>x.trim().toLowerCase());
  const looksHeader = header.some(h=>/barkod|barcode|kod|plu|sku/.test(h)) || header.some(h=>/isim|ad|name/.test(h)) || header.some(h=>/fiyat|price|tutar/.test(h));
  if(looksHeader){
    start=1;
    colCode = header.findIndex(h=>/barkod|barcode|kod|plu|sku/.test(h)); if(colCode<0) colCode=0;
    colName = header.findIndex(h=>/isim|ad|name/.test(h));               if(colName<0) colName=1;
    colPrice= header.findIndex(h=>/fiyat|price|tutar/.test(h));          if(colPrice<0) colPrice=2;
  }

  const map={};
  for(let i=start;i<lines.length;i++){
    const cols=lines[i].split(sep).map(s=>s.trim());
    let code=(cols[colCode]||'').trim();
    const name=cleanupName(cols[colName]||'');
    const price=normPriceFlexible(cols[colPrice]||'').disp;

    if(code && /^[A-Za-z0-9\-_.]+$/.test(code)) map[code]={name,price};
    else{
      code=(cols[colCode]||'').replace(/\s+/g,'');
      if(isEAN(code)) map[code]={name,price};
    }
  }
  return map;
}

// Fiyat normalizasyonu
function normPriceFlexible(p){
  if(p===undefined || p===null) return {num:0,disp:''};
  let s=String(p).trim();
  if(s==='********') return {num:0,disp:''};

  if(/^\d{3,9}$/.test(s)){ const num=Number(s)/100; return isFinite(num)?{num,disp:num.toFixed(2).replace('.',',')}:{num:0,disp:''}; }
  s=s.replace(/[₺\s]/g,'');
  if(s.includes(',')){ s=s.replace(/\./g,''); s=s.replace(/^0+(?=\d)/,''); let n=Number(s.replace(',','.')); if(!isFinite(n)) n=0; return {num:n,disp:n? n.toFixed(2).replace('.',',') : ''}; }
  if(/^\d+\.\d{2}$/.test(s)){ const n=Number(s); return isFinite(n)?{num:n,disp:n.toFixed(2).replace('.',',')}:{num:0,disp:''}; }
  return {num:0,disp:''};
}

// GDF (opsiyonel)
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
      const priceDisp = priceFromTextRightmost(raw) ||
                        (lines[i+1] && priceFromTextRightmost(lines[i+1])) ||
                        (lines[i-1] && priceFromTextRightmost(lines[i-1])) || '';
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
function priceFromTextRightmost(txt){
  const reComma=/\d{1,3}(?:\.\d{3})*,\d{2}|\d+,\d{2}/g;
  const reDot=/\d+\.\d{2}/g;
  let matches=[], m;
  while((m=reComma.exec(txt))){ const n=normPriceFlexible(m[0]); if(n.num>0 && n.num<10000) matches.push({pos:m.index,disp:n.disp,prio:2}); }
  while((m=reDot.exec(txt))){ const n=normPriceFlexible(m[0]); if(n.num>0 && n.num<10000) matches.push({pos:m.index,disp:n.disp,prio:1}); }
  if(!matches.length) return '';
  matches.sort((a,b)=> (a.prio!==b.prio? b.prio-a.prio : a.pos-b.pos));
  const prio = matches[matches.length-1].prio;
  const last = matches.filter(x=>x.prio===prio).pop();
  return last.disp;
}

// ---- UI ----
$('#btnStart').onclick=async()=>{await listCameras();start();};
$('#btnStop').onclick = ()=> stop();
$('#btnExport').onclick=()=>exportTXT();
$('#btnCSV').onclick   =()=>exportCSV();
$('#btnClear').onclick =()=>{if(confirm('Listeyi temizlemek istiyor musun?')){state.items={};save();render();}};
$('#btnUndo').onclick  =()=>undo();
$('#btnMinus').onclick =()=>{qtyInp.value=Math.max(1,Number(qtyInp.value)-1);};
$('#btnPlus').onclick  =()=>{qtyInp.value=Number(qtyInp.value)+1;};
$('#btnClearField').onclick=()=>{barcodeInp.value='';showProductInfo('');};

btnScanOnce.onclick=async()=>{await listCameras();state.singleShot=true;btnScanOnce.disabled=true;btnScanOnce.textContent='Okutuluyor...';if(!state.scanning)await start();else statusEl.textContent='Tek seferlik okuma aktif';};

// Elle giriş (Enter veya “Tamam”)
function confirmManualBarcode(){
  const code=(barcodeInp.value||'').trim();
  if(!code){barcodeInp.focus();return;}
  showProductInfo(code);
  const found=!!smartLookup(code);
  safePlay(found?beep:err); vibrate(found?30:80);
  qtyInp.focus(); setTimeout(()=>qtyInp.select(),0);
}
barcodeInp.addEventListener('keydown',e=>{ if(e.key==='Enter'){ e.preventDefault(); confirmManualBarcode(); } });
if(btnComplete) btnComplete.onclick=confirmManualBarcode;

// Adet alanında Enter → EKLE
qtyInp.addEventListener('keydown',e=>{
  if(e.key==='Enter'){
    e.preventDefault();
    $('#btnAdd').click();
  }
});
qtyInp.addEventListener('focus',()=>{ setTimeout(()=>qtyInp.select(),0); });
qtyInp.addEventListener('pointerdown',()=>{ setTimeout(()=>qtyInp.select(),0); });

// Ekle
$('#btnAdd').onclick=()=>{ upsert(barcodeInp.value.trim(),qtyInp.value); barcodeInp.value=''; qtyInp.value=1; showProductInfo(''); barcodeInp.focus(); };

// ---- İsimle arama — sadece barkodlu sonuçlar (tekilleştirilmiş) ----
let searchTimer=null;
searchInput.addEventListener('input', ()=>{ clearTimeout(searchTimer); searchTimer=setTimeout(runSearch,150); });
function highlightName(name,q){ const nf=trFold(name), i=nf.indexOf(q); if(i<0) return name; return name.substring(0,i)+'<b>'+name.substring(i,i+q.length)+'</b>'+name.substring(i+q.length); }
function runSearch(){
  const q = trFold(searchInput.value.trim());
  searchResults.innerHTML='';
  if(!q){ return; }
  const seen=new Set();
  const rows=[];
  for(const [code,info] of Object.entries(productMap)){
    if(!isEAN(code)) continue; // stok kodlarını at
    const name=info.name||''; const nf=trFold(name); if(!nf) continue;
    if(nf.includes(q)){ if(!seen.has(code)){ seen.add(code); rows.push({barcode:code,name,price:info.price||''}); } }
    if(rows.length>=200) break;
  }
  if(!rows.length){ searchResults.innerHTML='<div class="muted" style="margin-top:8px">Barkodlu sonuç bulunamadı.</div>'; return; }
  rows.slice(0,50).forEach(row=>{
    const div=document.createElement('div'); div.className='result';
    div.innerHTML=`<div class="rs-left"><div class="rs-name">${highlightName(row.name,q)}</div><div class="muted">${row.price||'—'}</div></div><div class="rs-meta">${row.barcode}</div>`;
    div.onclick=()=>{ try{navigator.clipboard&&navigator.clipboard.writeText(row.barcode);}catch(_){}
      barcodeInp.value=row.barcode; showProductInfo(row.barcode); safePlay(beep); barcodeInp.scrollIntoView({behavior:'smooth',block:'center'}); };
    searchResults.appendChild(div);
  });
}

// Kalıcı ayarlar
try{
  const pm=localStorage.getItem('productMap'); if(pm){productMap=JSON.parse(pm); mapStat.textContent=Object.keys(productMap).length+' ürün yüklü';}
  const only=localStorage.getItem('onlyEAN'); if(only!==null) onlyEANBox.checked = (only==='1');
}catch{}
load(); listCameras();
