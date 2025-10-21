// ====== AYAR ======
const REMOTE_PRODUCT_URLS = [
  "./Bilgi.txt", // aynı origin (öncelik)
  "https://raw.githubusercontent.com/myhmmt/El-terminali-mobil/main/Bilgi.txt",
  "https://cdn.jsdelivr.net/gh/myhmmt/El-terminali-mobil@main/Bilgi.txt"
];

// ====== STATE ======
const state = {
  items: {},
  order: [],
  scanning: false,
  currentDeviceId: null,
  singleShot: false
};

// ====== RUNTIME ======
let mediaStream=null, rafId=null, frames=0, frameIx=0;
let duplicateGuard={code:null,until:0};
let detector=null, off=null, octx=null;
let productMap={};

// ====== ELEMENTLER ======
const $        = sel => document.querySelector(sel);
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
const btnRemote  = $('#btnRemote');
const remoteStat = $('#remoteStatus');
const lastSyncLbl= $('#lastSync');
const sndAccepted = new Audio('accepted.ogg'); sndAccepted.preload = 'auto';
const sndUnknown  = new Audio('unkown.ogg');  sndUnknown.preload  = 'auto';

// ====== LİSTE ======
function ensureOrderIntegrity(){ for(const c of Object.keys(state.items)){ if(!state.order.includes(c)) state.order.push(c); } }
function render(){
  ensureOrderIntegrity();
  tbody.innerHTML='';
  const codes = state.order.filter(c => state.items[c] != null);
  let sum=0;
  for(const c of codes){
    const q = Number(state.items[c])||0; sum+=q;
    const name=(productMap[c]?.name)||'—';
    const tr=document.createElement('tr');
    tr.innerHTML =
      `<td class="col-act"><button class="btn-del" onclick="delItem('${c}')">Sil</button></td>
       <td class="col-product">
         <div class="prod">
           <span class="prod-name">${name}</span>
           <span class="prod-code">${c}</span>
         </div>
       </td>
       <td class="right col-qty">
         <input type="number" class="qtyInput" min="0" value="${q}" data-code="${c}" style="width:72px;text-align:right">
       </td>`;
    tbody.appendChild(tr);
  }
  totalRows.textContent=codes.length; totalQty.textContent=sum;
}
window.delItem=(c)=>{ delete state.items[c]; const i=state.order.indexOf(c); if(i>-1) state.order.splice(i,1); save(); render(); };
function upsert(c,q){
  if(!c) return;
  const n=Math.max(1,Number(q)||1);
  const existed = Object.prototype.hasOwnProperty.call(state.items,c);
  state.items[c]=(Number(state.items[c])||0)+n;
  if(!existed) state.order.push(c);
  save(); render();
}
function save(){ localStorage.setItem('barcodeItems',JSON.stringify(state.items)); localStorage.setItem('barcodeOrder',JSON.stringify(state.order)); }
function load(){
  const raw=localStorage.getItem('barcodeItems'); if(raw){ try{state.items=JSON.parse(raw)||{};}catch{} }
  const ord=localStorage.getItem('barcodeOrder'); if(ord){ try{state.order=JSON.parse(ord)||[];}catch{} }
  render();
}

// ====== DIŞA AKTAR ======
function dl(name,content,type){ const a=document.createElement('a'); a.href=URL.createObjectURL(new Blob([content],{type})); a.download=name; a.click(); URL.revokeObjectURL(a.href); }
function exportTXT(){ ensureOrderIntegrity(); const codes=state.order.filter(c=>state.items[c]!=null); const lines=codes.map(c=>`${c};${state.items[c]}`); dl((($('#filename').value)||'sayim')+'.txt', lines.join('\n'),'text/plain'); }
function parseMoney(str){ if(!str) return 0; const s=String(str).replace(/\./g,'').replace(',','.'); const v=parseFloat(s); return isFinite(v)?v:0; }
function fmtMoney(n){ return n.toFixed(2).replace('.',','); }
function exportPDF(){
  ensureOrderIntegrity();
  const codes=state.order.filter(c=>state.items[c]!=null);
  const rows=codes.map(code=>{
    const qty=Number(state.items[code])||0;
    const name=productMap[code]?.name||'';
    const priceStr=productMap[code]?.price||'0,00';
    const price=parseMoney(priceStr);
    const total=price*qty;
    return {code,name,qty,priceStr:fmtMoney(price),totalStr:fmtMoney(total),total};
  });
  const grand=rows.reduce((s,r)=>s+r.total,0);
  const html=`<!doctype html><html><head><meta charset="utf-8"><style>
  body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial;margin:24px}
  h1{margin:0 0 4px 0;font-size:22px}.muted{color:#666;font-size:12px;margin-bottom:12px}
  table{width:100%;border-collapse:collapse;margin-top:8px}th,td{padding:8px;border-bottom:1px solid #ddd;font-size:14px}
  th{text-align:left;background:#f5f5f5}td.num{text-align:right}.total{margin-top:12px;display:flex;justify-content:flex-end}
  .total .box{min-width:260px;border:1px solid #ddd;padding:10px 12px}
  </style></head><body>
  <h1>GENÇ GROSS <span style="font-size:12px;color:#666;">v2.1</span></h1>
  <div class="muted">Tarih: ${new Date().toLocaleString('tr-TR')}</div>
  <table><thead><tr><th>Barkod</th><th>İsim</th><th class="right">Adet</th><th class="right">Fiyat</th><th class="right">Toplam</th></tr></thead>
  <tbody>${rows.map(r=>`<tr><td>${r.code}</td><td>${r.name}</td><td class="num">${r.qty}</td><td class="num">${r.priceStr}</td><td class="num">${r.totalStr}</td></tr>`).join('')}</tbody></table>
  <div class="total"><div class="box"><strong>Genel Toplam:</strong> <span style="float:right">${fmtMoney(grand)}</span></div></div>
  <script>window.onload=()=>window.print()</script></body></html>`;
  const w=window.open('','_blank'); w.document.open(); w.document.write(html); w.document.close();
}

// ====== ARAMA ======
function trFold(s){ if(!s) return ''; const m={'ı':'i','İ':'i','I':'i','Ş':'s','ş':'s','Ç':'c','ç':'c','Ğ':'g','ğ':'g','Ö':'o','ö':'o','Ü':'u','ü':'u'}; return s.split('').map(ch=>m[ch]??ch).join('').toLocaleLowerCase('tr-TR'); }
let searchArr=[];
function buildSearchIndex(){ searchArr=Object.entries(productMap).map(([code,obj])=>({code,name:obj.name,price:obj.price,fold:trFold(obj.name||'')})); }
$('#searchName').addEventListener('input', ()=>{
  const q=trFold(($('#searchName').value||'').trim()); const list=$('#searchList'); list.innerHTML=''; if(!q) return;
  const matches=searchArr.filter(x=>x.fold.includes(q)).slice(0,50);
  for(const m of matches){
    const row=document.createElement('div'); row.className='result';
    row.innerHTML=`<div><strong>${m.name}</strong><br><small>${m.code}</small></div><div><strong>${m.price||'—'}</strong></div>`;
    row.onclick=()=>{ navigator.clipboard?.writeText(m.code).catch(()=>{}); inpCode.value=m.code; showProductInfo(m.code); inpQty.focus(); };
    list.appendChild(row);
  }
});

// ====== SES ======
function play(a){ try{ a.currentTime=0; a.play(); }catch{} }
function playBeep(a){ play(a); }

// ====== KAMERA ======
async function start(){
  stop();
  statusEl.textContent='Kamera açılıyor...';
  const tryGet = async (cons)=>{ try{return await navigator.mediaDevices.getUserMedia(cons);}catch(e){throw e;} };
  try{
    let stream=null;
    try{stream=await tryGet({video:{facingMode:{exact:'environment'},width:{ideal:1280},height:{ideal:720},frameRate:{ideal:60,max:90}},audio:false});}
    catch(_){try{stream=await tryGet({video:{facingMode:{ideal:'environment'},width:{ideal:1280},height:{ideal:720},frameRate:{ideal:60,max:90}},audio:false});}
    catch(__){try{stream=await tryGet({video:{facingMode:{ideal:'environment'},width:{ideal:1920},height:{ideal:1080},frameRate:{ideal:30,max:60}},audio:false});}
    catch(___){stream=await tryGet({video:true,audio:false});}}}
    mediaStream=stream; video.srcObject=mediaStream; await video.play();
    try{const track=mediaStream.getVideoTracks?.()[0];
      if(track?.getCapabilities && track.applyConstraints){
        const caps=track.getCapabilities(); const adv=[];
        if(caps.focusMode&&caps.focusMode.includes('continuous')) adv.push({focusMode:'continuous'});
        if(caps.exposureMode&&caps.exposureMode.includes('continuous')) adv.push({exposureMode:'continuous'});
        if(adv.length) await track.applyConstraints({advanced:adv});
      }}catch{}
    state.scanning=true; statusEl.textContent='Tarama aktif'; runNativeLoop(); fpsCounter();
  }catch(e){
    console.error('Camera error:',e);
    let msg='Tarama başlatılamadı.'; if(e?.name==='NotAllowedError') msg='Kamera izni verilmedi.';
    if(e?.name==='NotFoundError'||e?.name==='OverconstrainedError') msg='Uygun arka kamera bulunamadı.'; statusEl.textContent=msg;
  }
}
function stop(){ cancelAnimationFrame(rafId); rafId=null; frames=0; fpsEl.textContent='FPS: -'; const s=video.srcObject; if(s?.getTracks) s.getTracks().forEach(t=>t.stop()); video.srcObject=null; mediaStream=null; state.scanning=false; statusEl.textContent='Durduruldu'; }
async function listCameras(){ try{ await navigator.mediaDevices.enumerateDevices(); }catch(e){} }

async function runNativeLoop(){
  if(!('BarcodeDetector' in window)){ statusEl.textContent='Desteklenmiyor'; return; }
  if(!detector){ detector=new BarcodeDetector({formats:['ean_13','ean_8','code_128','code_39','itf']}); }
  if(!off){ off=document.createElement('canvas'); octx=off.getContext('2d',{willReadFrequently:true}); octx.imageSmoothingEnabled=false; }
  const tryDetect=async(src)=>{
    try{
      const d=await detector.detect(src);
      if(d&&d.length){
        const pick=d.sort((a,b)=>{const fa=a.format||'',fb=b.format||'';if(fa===fb)return(b.rawValue?.length||0)-(a.rawValue?.length||0);if(fa==='ean_13')return-1;if(fb==='ean_13')return 1;return 0;})[0];
        const raw=(pick.rawValue||'').trim(); if(raw){onScanned(raw);return true;}
      }
    }catch(_){}
    return false;
  };
  const loop=async()=>{
    if(!state.scanning)return; frames++; frameIx=(frameIx+1)%6;
    const vw=video.videoWidth,vh=video.videoHeight;
    if(vw&&vh){
      const rw=Math.floor(vw*0.80),rh=Math.floor(vh*0.42);
      const rx=Math.floor((vw-rw)/2),ry=Math.floor((vh-rh)/2);
      off.width=rw;off.height=rh;octx.drawImage(video,rx,ry,rw,rh,0,0,rw,rh);
      let ok=await tryDetect(off); if(!ok&&frameIx===0){ok=await tryDetect(video);}
    }
    if(state.scanning)rafId=requestAnimationFrame(loop);
  };
  loop();
}
function onScanned(code){
  if(!code)return;
  const now=performance.now();
  if(code===duplicateGuard.code&&now<duplicateGuard.until)return;
  duplicateGuard={code,until:now+1500};
  inpCode.value=code; showProductInfo(code);
  setTimeout(()=>{inpQty.focus();inpQty.select();},0);
  playBeep(productMap[code]?beep:errBeep);
  if(state.singleShot){stop();btnOnce.textContent='👉 Tek Okut';state.singleShot=false;}
}
function fpsCounter(){let last=performance.now();const tick=()=>{if(!state.scanning)return;const now=performance.now();if(now-last>=1000){fpsEl.textContent='FPS: '+frames;frames=0;last=now;}requestAnimationFrame(tick);};tick();}

// ====== ÜRÜN ======
function showProductInfo(code){
  const p=productMap[code];
  const box=document.getElementById('productInfoBox');
  if(p){nameEl.textContent=p.name||'—';priceEl.textContent=p.price||'—';}
  else{nameEl.textContent='Bulunamadı';priceEl.textContent='—';}
  if(box)box.style.display='block';
}
function normPriceStr(p){
  if(!p)return'';p=String(p).trim();const only=p.replace(/[^\d.,]/g,'');if(!only)return'';let di=-1;
  for(let i=only.length-1;i>=0;i--){const ch=only[i];if((ch==='.'||ch===',')&&i<only.length-1){const tail=only.slice(i+1);if(/^\d{1,2}$/.test(tail)){di=i;break;}}}
  let intPart,frac='';if(di>=0){intPart=only.slice(0,di);frac=only.slice(di+1);}else intPart=only;
  intPart=intPart.replace(/[.,]/g,'');let norm=intPart;if(frac){frac=(frac+'00').slice(0,2);norm+='.'+frac;}
  const v=Number(norm);return isFinite(v)?v.toFixed(2).replace('.',','):'';
}
function parseTextToMap(txt){
  const lines=txt.split(/\r?\n/).filter(l=>l.trim());const map={};
  for(const raw0 of lines){
    const raw=raw0.trim();const first=raw.indexOf(';');if(first===-1)continue;
    const second=raw.indexOf(';',first+1);if(second===-1)continue;
    const code=raw.slice(0,first).replace(/\s+/g,'');const name=raw.slice(first+1,second).trim();const tail=raw.slice(second+1).trim();
    if(!code||!name)continue;
    let price=normPriceStr(tail);
    if(!price&&tail){const numish=tail.replace(/[^\d.,]/g,'');price=numish?(numish.includes('.')&&!numish.includes(',')?numish.replace('.',','):numish):tail;}
    if(!price){const parts=raw.split(';').map(s=>s.trim());for(let i=parts.length-1;i>=2;i--){const p=normPriceStr(parts[i]);if(p){price=p;break;}}}
    map[code]={name,price};
  }
  return map;
}

// ====== UZAKTAN VERİ ======
function setRemoteStatus(okOrTxt,txt){if(typeof okOrTxt==='string'){remoteStat.textContent='Uzaktan veri: '+okOrTxt;return;}remoteStat.textContent=okOrTxt?('Uzaktan veri: ✓ '+(txt||'alındı')):('Uzaktan veri: ✗ '+(txt||'alınamadı'));}
function setLastSync(ts){lastSyncLbl.textContent=ts?new Date(ts).toLocaleString('tr-TR'):'—';}
async function fetchWithFallback(url){const full=url+(url.includes('?')?'&':'?')+'v='+Date.now();const res=await fetch(full,{cache:'no-store',mode:'cors',headers:{'cache-control':'no-cache'}});if(!res.ok)throw new Error('HTTP '+res.status);return res.text();}
async function fetchRemoteProducts(){
  try{
    setRemoteStatus('yükleniyor…');let txt=null,lastErr=null,used=null;
    for(const u of REMOTE_PRODUCT_URLS){try{used=u;txt=await fetchWithFallback(u);break;}catch(e){lastErr=e;}}
    if(txt==null){setRemoteStatus(false,lastErr?.message||'alınamadı');return false;}
    if(txt&&txt.charCodeAt(0)===0xFEFF)txt=txt.slice(1);
    let newMap={};
    if(txt.trim().startsWith('{')){const obj=JSON.parse(txt);for(const[k,v]of Object.entries(obj)){if(typeof v==='string')newMap[k]={name:v,price:''};else newMap[k]={name:v.name||'',price:v.price||''};}}
    else{newMap=parseTextToMap(txt);}
