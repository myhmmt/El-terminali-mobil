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

// Ek sesler
const sndAccepted = new Audio('accepted.ogg'); sndAccepted.preload = 'auto';
const sndUnknown  = new Audio('unkown.ogg');  sndUnknown.preload  = 'auto';

// ====== HELPERS ======
function render(){
  tbody.innerHTML=''; let sum=0;
  Object.entries(state.items).forEach(([c,q])=>{
    sum+=Number(q)||0;
    const name=(productMap[c]?.name)||'—';
    const tr=document.createElement('tr');
    tr.innerHTML=
      `<td class="col-act"><button class="btn-del" onclick="del('${c}')">Sil</button></td>
       <td class="col-product">
         <div class="prod">
           <div class="prod-name">${name}</div>
           <div class="prod-code">${c}</div>
         </div>
       </td>
       <td class="right col-qty">
         <input type="number" class="qtyInput" min="0" value="${q}" data-code="${c}" style="width:72px;text-align:right">
       </td>`;
    tbody.appendChild(tr);
  });
  totalRows.textContent=Object.keys(state.items).length;
  totalQty.textContent=sum;
}
window.del=(c)=>{delete state.items[c];save();render();}
function upsert(c,q){ if(!c) return; const n=Math.max(1,Number(q)||1); state.items[c]=(Number(state.items[c])||0)+n; save(); render(); }
function save(){ localStorage.setItem('barcodeItems', JSON.stringify(state.items)); }
function load(){ const raw=localStorage.getItem('barcodeItems'); if(raw){ try{state.items=JSON.parse(raw);}catch{} } render(); }

function dl(name,content,type){ const a=document.createElement('a'); a.href=URL.createObjectURL(new Blob([content],{type})); a.download=name; a.click(); URL.revokeObjectURL(a.href); }
function exportTXT(){ const lines=Object.entries(state.items).map(([c,q])=>`${c};${q}`); dl((($('#filename').value)||'sayim')+'.txt', lines.join('\n'), 'text/plain'); }

// PDF (Fatura görünümü)
function parseMoney(str){ if(!str) return 0; const s=String(str).replace(/\./g,'').replace(',','.'); const v=parseFloat(s); return isFinite(v)?v:0; }
function fmtMoney(n){ return n.toFixed(2).replace('.',','); }
function exportPDF(){
  const rows = Object.entries(state.items).map(([code,qty])=>{
    const name = productMap[code]?.name || '';
    const priceStr = productMap[code]?.price || '0,00';
    const price = parseMoney(priceStr);
    const total = price * (Number(qty)||0);
    return {code,name,qty:Number(qty)||0,priceStr:fmtMoney(price),totalStr:fmtMoney(total),total};
  });
  const grand = rows.reduce((s,r)=>s+r.total,0);

  const title = 'GENÇ GROSS';
  const date = new Date().toLocaleString('tr-TR');
  const html = `<!doctype html><html><head><meta charset="utf-8">
<style>
body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial;margin:24px}
h1{margin:0 0 4px 0;font-size:22px}
.muted{color:#666;font-size:12px;margin-bottom:12px}
table{width:100%;border-collapse:collapse;margin-top:8px}
th,td{padding:8px;border-bottom:1px solid #ddd;font-size:14px}
th{text-align:left;background:#f5f5f5}
td.num{text-align:right}
.total{margin-top:12px;display:flex;justify-content:flex-end}
.total .box{min-width:260px;border:1px solid #ddd;padding:10px 12px}
.right{text-align:right}
</style></head><body>
<h1>${title}</h1>
<div class="muted">Tarih: ${date}</div>
<table>
  <thead><tr><th>Barkod</th><th>İsim</th><th class="right">Adet</th><th class="right">Fiyat</th><th class="right">Toplam</th></tr></thead>
  <tbody>
    ${rows.map(r=>`<tr>
      <td>${r.code}</td>
      <td>${r.name}</td>
      <td class="num">${r.qty}</td>
      <td class="num">${r.priceStr}</td>
      <td class="num">${r.totalStr}</td>
    </tr>`).join('')}
  </tbody>
</table>
<div class="total"><div class="box"><strong>Genel Toplam:</strong> <span style="float:right">${fmtMoney(grand)}</span></div></div>
<script>window.onload=()=>window.print()</script>
</body></html>`;
  const w = window.open('', '_blank');
  w.document.open(); w.document.write(html); w.document.close();
}

// Türkçe arama normalizasyonu
function trFold(s){
  if(!s) return '';
  const m = {'ı':'i','İ':'i','I':'i','Ş':'s','ş':'s','Ç':'c','ç':'c','Ğ':'g','ğ':'g','Ö':'o','ö':'o','Ü':'u','ü':'u'};
  return s.split('').map(ch=>m[ch]??ch).join('').toLocaleLowerCase('tr-TR');
}

function play(a){ try{ a.currentTime=0; a.play(); }catch{} }
function playBeep(a){ play(a); }

// ====== KAMERA ======
async function start(){
  stop();
  statusEl.textContent='Kamera açılıyor...';
  const tryGet = async (cons) => { try{ return await navigator.mediaDevices.getUserMedia(cons); } catch(e){ throw e; } };
  try{
    let stream=null;
    try{ stream = await tryGet({video:{facingMode:{exact:'environment'}, width:{ideal:1920}, height:{ideal:1080}}, audio:false}); }
    catch(_){ try{ stream = await tryGet({video:{facingMode:{ideal:'environment'}, width:{ideal:1920}, height:{ideal:1080}}, audio:false}); }catch(__){} }
    if(!stream){ stream = await tryGet({video:true, audio:false}); }

    mediaStream = stream;
    video.srcObject = mediaStream;
    await video.play();
    state.scanning=true;
    statusEl.textContent='Tarama aktif';
    runNativeLoop();
    fpsCounter();
  }catch(e){
    console.error('Camera error:', e);
    let msg='Tarama başlatılamadı.';
    if(e && e.name==='NotAllowedError') msg='Kamera izni verilmedi. Lütfen site için Kamera iznini aç.';
    if(e && (e.name==='NotFoundError' || e.name==='OverconstrainedError')) msg='Uygun arka kamera bulunamadı.';
    statusEl.textContent=msg;
  }
}
async function listCameras(){ try{ await navigator.mediaDevices.enumerateDevices(); }catch(e){} }
selCam && (selCam.onchange=()=>{});

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
      const rw=Math.floor(vw*0.72), rh=Math.floor(vh*0.36);
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
  const box = document.getElementById('productInfoBox');
  if(p){ nameEl.textContent=p.name||'—'; priceEl.textContent=p.price||'—'; }
  else { nameEl.textContent='Bulunamadı'; priceEl.textContent='—'; }
  if(box) box.style.display='block';
}

// ====== PARSE ======
function normPriceStr(p){
  if(!p) return '';
  p = String(p).trim();
  if(!p) return '';
  const onlyNums = p.replace(/[^\d.,]/g, ''); if(!onlyNums) return '';
  let decIdx = -1;
  for(let i=onlyNums.length-1;i>=0;i--){ const ch = onlyNums[i]; if((ch==='.'||ch===',') && i < onlyNums.length-1){ const tail = onlyNums.slice(i+1); if(/^\d{1,2}$/.test(tail)){ decIdx = i; break; } } }
  let intPart, fracPart=''; if(decIdx>=0){ intPart = onlyNums.slice(0,decIdx); fracPart = onlyNums.slice(decIdx+1); } else { intPart = onlyNums; }
  intPart = intPart.replace(/[.,]/g, ''); let norm = intPart; if(fracPart){ fracPart = (fracPart+'00').slice(0,2); norm += '.'+fracPart; }
  const v = Number(norm); if(!isFinite(v)) return ''; return v.toFixed(2).replace('.',',');
}

function parseTextToMap(txt){
  const lines = txt.split(/\r?\n/).filter(l=>l.trim().length);
  const map = {};
  for(const raw0 of lines){
    const raw = raw0.trim();
    const first = raw.indexOf(';'); if(first === -1) continue;
    const second = raw.indexOf(';', first+1); if(second === -1) continue;
    const code = raw.slice(0, first).replace(/\s+/g,'');
    const name = raw.slice(first+1, second).trim();
    const tail = raw.slice(second+1).trim();
    if(!code || !name) continue;
    let price = normPriceStr(tail);
    if(!price && tail){
      const numish = tail.replace(/[^\d.,]/g,'');
      if(numish){ const guess = (numish.includes('.') && !numish.includes(',')) ? numish.replace('.',',') : numish; price = guess; }
      else{ price = tail; }
    }
    if(!price){
      const parts = raw.split(';').map(s=>s.trim());
      for(let i=parts.length-1;i>=2;i--){ const p = normPriceStr(parts[i]); if(p){ price = p; break; } }
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
  if(txt && txt.charCodeAt(0) === 0xFEFF){ txt = txt.slice(1); } // BOM temizle
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
    productMap = map;
    localStorage.setItem('productMap',JSON.stringify(productMap));
    mapStat.textContent = Object.keys(productMap).length + ' ürün yüklü';
    showProductInfo(inpCode.value.trim());
    buildSearchIndex();
  }catch(err){ console.error(err); alert('Veri çözümlenemedi. "kod;isim;…;fiyat" biçimini kullanın.'); }
};

// ====== ARAMA ======
let searchArr=[];
function buildSearchIndex(){
  searchArr = Object.entries(productMap).map(([code,obj])=>({
    code,
    name:obj.name,
    price:obj.price,
    key:(obj.name||''),
    fold:trFold(obj.name||'')
  }));
}
$('#searchName').addEventListener('input', ()=>{
  const qRaw = ($('#searchName').value||'').trim();
  const q = trFold(qRaw);
  const list = $('#searchList'); list.innerHTML='';
  if(!q){ return; }
  const matches = searchArr.filter(x=>x.fold.includes(q)).slice(0,50);
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
btnOnce.onclick        = async()=>{ state.singleShot=true; btnOnce.disabled=true; btnOnce.textContent='Okutuluyor...'; if(!state.scanning) await start(); else statusEl.textContent='Tek seferlik okuma aktif'; };

$('#btnAdd').onclick  = ()=>{
  const code = inpCode.value.trim();
  const qty  = inpQty.value;
  if(!code) return;

  const known = !!productMap[code];
  if(!known){
    play(sndUnknown);
    const ok = confirm('Bu barkod ürün verisinde tanımlı değil. Listeye eklemek istediğinizden emin misiniz?');
    if(!ok) return;
  }

  upsert(code, qty);
  if(known) play(sndAccepted);
  inpCode.value=''; inpQty.value=1; nameEl.textContent='—'; priceEl.textContent='—'; inpCode.focus();
};

$('#btnClearField').onclick = ()=>{ inpCode.value=''; showProductInfo(''); inpCode.focus(); };
$('#btnExport').onclick= ()=> exportTXT();
$('#btnPDF').onclick   = ()=> exportPDF();
$('#btnClear').onclick = ()=>{ if(confirm('Listeyi temizlemek istiyor musun?')){ state.items={}; save(); render(); } };

// Enter akışı: barkod → adet → ekle
$('#btnSubmitCode').onclick = ()=>{
  const code = inpCode.value.trim();
  if(!code) return;
  showProductInfo(code);
  playBeep(productMap[code] ? beep : errBeep);
  inpQty.focus(); inpQty.select();
};
inpCode.addEventListener('keydown', e=>{
  if(e.key==='Enter'){ e.preventDefault(); $('#btnSubmitCode').click(); }
});
inpQty.addEventListener('keydown', e=>{
  if(e.key==='Enter'){ e.preventDefault(); $('#btnAdd').click(); }
});
inpQty.addEventListener('focus', ()=>{ inpQty.select(); });

// Liste adet düzenleme
tbody.addEventListener('change', (e)=>{
  const t = e.target;
  if(t && t.classList.contains('qtyInput')){
    const code = t.getAttribute('data-code');
    let v = Number(t.value)||0;
    if(v<=0){ delete state.items[code]; } else { state.items[code]=v; }
    save(); render();
  }
});
tbody.addEventListener('keydown', (e)=>{
  const t = e.target;
  if(t && t.classList.contains('qtyInput') && e.key==='Enter'){
    t.blur();
  }
});

// ====== BOOT ======
try{
  const pm = localStorage.getItem('productMap');
  if(pm){ productMap = JSON.parse(pm); mapStat.textContent = Object.keys(productMap).length + ' ürün yüklü'; buildSearchIndex(); }
}catch{}
load(); listCameras();
