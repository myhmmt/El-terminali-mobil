/* Genç Gross Mobil Terminal - Daha hassas okuma + fiyat iyileştirme */
const state = { items:{}, scanning:false, currentDeviceId:null, singleShot:false };
let mediaStream=null, rafId=null, frames=0, duplicateGuard={code:null,until:0}, lastOp=null;
let detector=null, off=null, octx=null;
let productMap={};

// ---- DOM ----
const selCam=$('#cameraSelect'), video=$('#video'), statusEl=$('#scanStatus'), fpsEl=$('#fps');
const barcodeInp=$('#barcode'), qtyInp=$('#qty'), btnComplete=$('#btnComplete');
const tbody=$('#tbody'), totalRows=$('#totalRows'), totalQty=$('#totalQty'), filenameInp=$('#filename');
const beep=$('#beep'), err=$('#err'), btnScanOnce=$('#btnScanOnce');
const productNameEl=$('#productName'), productPriceEl=$('#productPrice');
const productFile=$('#productFile'), mapStat=$('#mapStat');
const onlyEANBox=$('#onlyEAN'), gdfColInp=$('#gdfCol');

// ---- utils ----
function $(s,c=document){return c.querySelector(s)}
function dl(name,content,type){const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([content],{type}));a.download=name;a.click();URL.revokeObjectURL(a.href);}
function vibrate(n=30){navigator.vibrate&&navigator.vibrate(n)}
function safePlay(a){try{a.currentTime=0;a.play()}catch(_){}}

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
function exportCSV(){const lines=['barcode,name,qty',...Object.entries(state.items).map(([c,q])=>`${c},"${(productMap[c]?.name||'').replace(/"/g,'""')}",${q}`)]; dl((filenameInp.value||'sayim')+'.csv',lines.join('\n'),'text/csv')}

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
onlyEANBox.onchange=()=>{localStorage.setItem('onlyEAN', onlyEANBox.checked?'1':'0'); detector=null;}; // yeniden başlatınca formats değişir
gdfColInp.onchange=()=>{localStorage.setItem('gdfPriceCol', gdfColInp.value.trim());};

// ---- Barcode Detector formats ----
function getFormats(){
  let fmts=['ean_13','ean_8'];
  if(!onlyEANBox.checked) fmts=fmts.concat(['code_128','code_39','itf','upc_e','upc_a']);
  return fmts;
}

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
const CONFIRM_WINDOW_MS=800;   // bu süre içinde
const CONFIRM_HITS=2;          // aynı kod 2 kez gelirse onayla
let confirmMap=new Map();      // code -> {count, ts}

function normalizeAndValidate(text){
  const raw=(text||'').trim();
  const digits=raw.replace(/\D/g,'');
  if(digits.length===13 && isValidEAN13(digits)) return digits;
  if(digits.length===8  && isValidEAN8(digits))  return digits;
  // EAN dışı istenirse (onlyEAN kapalıyken) basit filtre:
  if(!onlyEANBox.checked && /^\d{9,20}$/.test(digits)) return digits; // örn. Code128 numerik
  return null;
}
function isValidEAN13(code){
  if(!/^\d{13}$/.test(code)) return false;
  let sum=0;
  for(let i=0;i<12;i++){ const n=+code[i]; sum += (i%2? 3*n : n); }
  const check=(10 - (sum%10))%10;
  return check === +code[12];
}
function isValidEAN8(code){
  if(!/^\d{8}$/.test(code)) return false;
  const n=code.split('').map(Number);
  const sum = 3*(n[1]+n[3]+n[5]) + (n[0]+n[2]+n[4]);
  const check=(10 - (sum%10))%10;
  return check === n[6]; // dikkat: EAN-8 check 7. index
}

// ---- Tarama döngüsü ----
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
          // En uzun rawValue'yu al (gürültüden kaçın)
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
  if(now - e.ts > CONFIRM_WINDOW_MS){ e.count=0; e.ts=now; }
  e.count++; e.ts=now;
  confirmMap.set(code,e);
  if(e.count>=CONFIRM_HITS){ confirmMap.clear(); onCodeAccepted(code); }
}

function onCodeAccepted(code){
  const now=performance.now();
  if(code===duplicateGuard.code && now<duplicateGuard.until) return;
  duplicateGuard={code,until:now+1500};

  barcodeInp.value=code;
  showProductInfo(code);

  const found=!!productMap[code];
  safePlay(found?beep:err); vibrate(found?30:80);

  if(state.singleShot){
    stop();
    btnScanOnce.disabled=true; btnScanOnce.textContent='Okundu ✓';
    setTimeout(()=>{btnScanOnce.disabled=false;btnScanOnce.textContent='👉 Tek Okut';},900);
    state.singleShot=false;
  }
  qtyInp.focus(); setTimeout(()=>qtyInp.select(),0);
}

// ---- Ürün göster ----
function showProductInfo(code){
  const p=productMap[code];
  if(p){ productNameEl.textContent=p.name||'—'; productPriceEl.textContent=p.price||'—'; }
  else { productNameEl.textContent='Bulunamadı'; productPriceEl.textContent='—'; }
}

// ---- Ürün Verisi ----
$('#btnClearMap').onclick=()=>{productMap={};localStorage.removeItem('productMap');mapStat.textContent='0 ürün yüklü';showProductInfo('');};
productFile.onchange=async(e)=>{
  const file=e.target.files?.[0]; if(!file) return;
  let txt=''; try{txt=await file.text();}catch{alert('Dosya okunamadı.');return;}
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
    if(count===0){const first=(txt.split(/\r?\n/)[0]||'').slice(0,120);alert(`0 ürün bulundu (${src}). İlk satır: "${first}"`);return;}
    productMap=map; localStorage.setItem('productMap',JSON.stringify(productMap));
    mapStat.textContent=count+' ürün yüklü'; showProductInfo(barcodeInp.value.trim());
    alert(`${count} ürün yüklendi (${src}).`);
  }catch(err){console.error(err);alert('Veri çözümlenemedi. CSV/TXT (barkod;isim;fiyat), JSON veya imzalı GDF kullanın.');}
}

// CSV/TXT: başlıklı veya başlıksız
function parseCSV(txt){
  const lines=txt.split(/\r?\n/).filter(x=>x.trim().length);
  if(!lines.length) return {};
  const sep=lines[0].includes(';')?';':',';
  let start=0, colBC=0, colName=1, colPrice=2;

  // başlık algıla
  const header=lines[0].split(sep).map(x=>x.trim().toLowerCase());
  const looksHeader = header.some(h=>/barkod|barcode/.test(h)) || header.some(h=>/isim|ad|name/.test(h));
  if(looksHeader){
    start=1;
    colBC   = header.findIndex(h=>/barkod|barcode/.test(h)); if(colBC<0) colBC=0;
    colName = header.findIndex(h=>/isim|ad|name/.test(h));   if(colName<0) colName=1;
    colPrice= header.findIndex(h=>/fiyat|price|tutar/.test(h)); if(colPrice<0) colPrice=2;
  }

  const map={};
  for(let i=start;i<lines.length;i++){
    const cols=lines[i].split(sep).map(s=>s.trim());
    const bc=(cols[colBC]||'').replace(/\s+/g,'');
    const name=cols[colName]||'';
    const priceRaw=cols[colPrice]||'';
    const price=normPriceFlexible(priceRaw).disp;
    if(/^\d{8,14}$/.test(bc)) map[bc]={name,price};
  }
  return map;
}

// Fiyat normalizasyonu (virgül VEYA nokta ondalık destekli)
function normPriceFlexible(p){
  if(!p) return {num:0,disp:''};
  let s = String(p).replace(/[₺\s]/g,'');
  // Binlik noktaları kaldır (virgüllü formatta)
  if(s.includes(',')) s = s.replace(/\./g,'');
  // Eğer sadece nokta varsa ve virgül yoksa: onu ondalık say
  if(!s.includes(',') && /\d+\.\d{2}$/.test(s)){
    const num = Number(s);
    return isFinite(num) ? {num,disp: num.toFixed(2).replace('.',',')} : {num:0,disp:''};
  }
  // standart TR: 1.234,56
  s = s.replace(/^0+(?=\d)/,'');
  if(!/,/.test(s)) return {num:0,disp:''};
  let n = Number(s.replace(/\./g,'').replace(',','.'));
  if(!isFinite(n)) n=0;
  return {num:n,disp: n? n.toFixed(2).replace('.',',') : ''};
}

// GDF: isim 01, barkod+fiyat 02 — sabit sütun opsiyonu
function parseGDF(txt){
  const lines=txt.split(/\r?\n/);
  const names={}; let lastPLU=null; const map={};
  const fixedCol = Number(localStorage.getItem('gdfPriceCol')||gdfColInp.value||'0')||0; // 1-based, 0=otomatik

  for(let i=0;i<lines.length;i++){
    const raw=lines[i]; if(!raw) continue;

    if(raw.startsWith('01')){
      const parts=raw.trim().split(/\s{2,}/);
      if(parts.length>=4){ lastPLU=parts[1]; names[lastPLU]=parts[3]; }
      continue;
    }
    if(raw.startsWith('02')){
      let priceDisp='';
      if(fixedCol>0){
        const cols=raw.trim().split(/\s{2,}/);
        const pick=cols[fixedCol-1]||'';
        priceDisp = normPriceFlexible(pick).disp || priceFromTextRightmost(raw);
      }else{
        priceDisp = priceFromTextRightmost(raw);
        if(!priceDisp && lines[i+1]) priceDisp = priceFromTextRightmost(lines[i+1]);
        if(!priceDisp && lines[i-1]) priceDisp = priceFromTextRightmost(lines[i-1]);
      }
      // barkod
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

// Sağdan fiyat (virgül öncelikli, yoksa nokta-ondalık)
function priceFromTextRightmost(txt){
  const reComma=/\d{1,3}(?:\.\d{3})*,\d{2}|\d+,\d{2}/g;
  const reDot=/\d+\.\d{2}/g;
  let matches=[], m;
  while((m=reComma.exec(txt))){ const n=normPriceFlexible(m[0]); if(n.num>0 && n.num<1000) matches.push({pos:m.index,disp:n.disp,prio:2}); }
  while((m=reDot.exec(txt))){ const n=normPriceFlexible(m[0]); if(n.num>0 && n.num<1000) matches.push({pos:m.index,disp:n.disp,prio:1}); }
  if(!matches.length) return '';
  // virgüllüye öncelik; eşitse en sağdaki
  matches.sort((a,b)=> (a.prio!==b.prio? b.prio-a.prio : a.pos-b.pos));
  // aynı prio'lu en sağdakini al
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

// Elle giriş onayı
function confirmManualBarcode(){
  const code=(barcodeInp.value||'').replace(/\D/g,'');
  if(!code){barcodeInp.focus();return;}
  showProductInfo(code);
  const found=!!productMap[code];
  safePlay(found?beep:err); vibrate(found?30:80);
  qtyInp.focus(); setTimeout(()=>qtyInp.select(),0);
}
barcodeInp.addEventListener('keydown',e=>{ if(e.key==='Enter'){ e.preventDefault(); confirmManualBarcode(); } });
if(btnComplete) btnComplete.onclick=confirmManualBarcode;

// Adet alanı tıklanınca seç
qtyInp.addEventListener('focus',()=>{ setTimeout(()=>qtyInp.select(),0); });
qtyInp.addEventListener('pointerdown',()=>{ setTimeout(()=>qtyInp.select(),0); });

// Ekle
$('#btnAdd').onclick=()=>{ upsert(barcodeInp.value.trim(),qtyInp.value); barcodeInp.value=''; qtyInp.value=1; showProductInfo(''); barcodeInp.focus(); };

// Kalıcı ayarlar
try{
  const pm=localStorage.getItem('productMap'); if(pm){productMap=JSON.parse(pm); mapStat.textContent=Object.keys(productMap).length+' ürün yüklü';}
  const only=localStorage.getItem('onlyEAN'); if(only!==null) onlyEANBox.checked = (only==='1');
  const gc=localStorage.getItem('gdfPriceCol'); if(gc){gdfColInp.value=gc;}
}catch{}
load(); listCameras();
