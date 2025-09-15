// ====== STATE ======
const state={items:{},scanning:false,currentDeviceId:null,singleShot:false};
let mediaStream=null,rafId=null,frames=0,duplicateGuard={code:null,until:0},lastOp=null,detector=null,off=null,octx=null;
let productMap={};           // { barcode or stockCode : {name, price, barcode?, stock?} }
let searchArr=[];

// ====== EL ======
const $=s=>document.querySelector(s);
const selCam=$('#cameraSelect'),video=$('#video'),statusEl=$('#scanStatus'),fpsEl=$('#fps');
const inpCode=$('#barcode'),inpQty=$('#qty'),tbody=$('#tbody'),totalRows=$('#totalRows'),totalQty=$('#totalQty');
const nameEl=$('#productName'),priceEl=$('#productPrice'),mapStat=$('#mapStat');
const inpFile=$('#productFile'),searchBox=$('#searchName'),searchList=$('#searchList');
const beep=$('#beep'),errBeep=$('#err'),btnOnce=$('#btnScanOnce');

// ====== HELPERS ======
function render(){
  tbody.innerHTML=''; let sum=0;
  for(const [c,q] of Object.entries(state.items)){
    sum+=Number(q)||0;
    const nm=(productMap[c]?.name)||'—';
    const tr=document.createElement('tr');
    tr.innerHTML=`<td>${c}</td><td>${nm}</td><td class="right">${q}</td><td><button onclick="del('${c}')">Sil</button></td>`;
    tbody.appendChild(tr);
  }
  totalRows.textContent=Object.keys(state.items).length;
  totalQty.textContent=sum;
}
window.del=(c)=>{delete state.items[c];save();render();}
function upsert(c,q){if(!c)return;const n=Math.max(1,Number(q)||1);state.items[c]=(Number(state.items[c])||0)+n;lastOp={code:c,qty:n};save();render();}
function undo(){if(!lastOp)return;const {code,qty}=lastOp;state.items[code]=(Number(state.items[code])||0)-qty; if(state.items[code]<=0) delete state.items[code]; lastOp=null; save(); render();}
function save(){localStorage.setItem('barcodeItems',JSON.stringify(state.items));}
function load(){const raw=localStorage.getItem('barcodeItems');if(raw){try{state.items=JSON.parse(raw);}catch{}}render();}
function dl(name,content,type){const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([content],{type}));a.download=name;a.click();URL.revokeObjectURL(a.href);}
function exportTXT(){const lines=Object.entries(state.items).map(([c,q])=>`${c};${q}`);dl((($('#filename').value)||'sayim')+'.txt',lines.join('\n'),'text/plain');}
function exportCSV(){const lines=['barcode,qty',...Object.entries(state.items).map(([c,q])=>`${c},${q}`)];dl((($('#filename').value)||'sayim')+'.csv',lines.join('\n'),'text/csv');}
function trLower(s){return (s||'').toLocaleLowerCase('tr-TR');}
function play(a){try{a.currentTime=0;a.play();}catch{}}

// ====== CAMERA ======
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
selCam.onchange=()=>{state.currentDeviceId=selCam.value;if(state.scanning)start();};

async function start(){
  stop(); statusEl.textContent='Kamera açılıyor...';
  try{
    const constraints={video:state.currentDeviceId?{deviceId:{exact:state.currentDeviceId},width:{ideal:1920},height:{ideal:1080}}:{facingMode:{ideal:'environment'},width:{ideal:1920},height:{ideal:1080}},audio:false};
    mediaStream=await navigator.mediaDevices.getUserMedia(constraints);
    video.srcObject=mediaStream; await video.play(); state.scanning=true; statusEl.textContent='Tarama aktif'; runLoop(); fpsCounter();
  }catch{statusEl.textContent='Tarama başlatılamadı';}
}
function stop(){
  cancelAnimationFrame(rafId);rafId=null;frames=0;fpsEl.textContent='FPS: -';
  const s=video.srcObject; if(s?.getTracks) s.getTracks().forEach(t=>t.stop()); video.srcObject=null; mediaStream=null; state.scanning=false; statusEl.textContent='Durduruldu';
}
async function runLoop(){
  if(!('BarcodeDetector'in window)){statusEl.textContent='Desteklenmiyor';return;}
  if(!detector) detector=new BarcodeDetector({formats:['ean_13','ean_8','code_128','code_39','itf','upc_a','upc_e']});
  if(!off){off=document.createElement('canvas');octx=off.getContext('2d',{willReadFrequently:true});}
  const loop=async()=>{
    if(!state.scanning) return; frames++;
    const vw=video.videoWidth,vh=video.videoHeight;
    if(vw&&vh){
      const rw=Math.floor(vw*0.68),rh=Math.floor(vh*0.32);
      const rx=Math.floor((vw-rw)/2),ry=Math.floor((vh-rh)/2);
      off.width=rw;off.height=rh;octx.drawImage(video,rx,ry,rw,rh,0,0,rw,rh);
      try{const d=await detector.detect(off); if(d&&d.length) onScanned((d[0].rawValue||'').trim());}catch{}
    }
    if(state.scanning) rafId=requestAnimationFrame(loop);
  }; loop();
}
function onScanned(code){
  if(!code) return;
  const now=performance.now();
  if(code===duplicateGuard.code && now<duplicateGuard.until) return;
  duplicateGuard={code,until:now+1500};
  inpCode.value=code; showProductInfo(code);
  play(productMap[code]?beep:errBeep);
  if(navigator.vibrate) navigator.vibrate(30);
  if(state.singleShot){stop();btnOnce.disabled=true;btnOnce.textContent='Okundu ✓';setTimeout(()=>{btnOnce.disabled=false;btnOnce.textContent='👉 Tek Okut';},900);state.singleShot=false;}
}
function fpsCounter(){let last=performance.now();const tick=()=>{if(!state.scanning)return;const now=performance.now();if(now-last>=1000){fpsEl.textContent='FPS: '+frames;frames=0;last=now;}requestAnimationFrame(tick);};tick();}

// ====== PRODUCT INFO ======
function showProductInfo(code){
  const p=productMap[code];
  if(p){nameEl.textContent=p.name||'—';priceEl.textContent=p.price||'—';}
  else{nameEl.textContent='Bulunamadı';priceEl.textContent='—';}
}

// ====== PARSE & DECODE ======
function normPriceStr(txt){
  if(!txt) return '';
  const m=String(txt).match(/\d{1,3}(?:\.\d{3})*,\d{2}|\d+,\d{2}/); // 1.234,56 veya 12,34
  if(!m) return '';
  const n=Number(m[0].replace(/\./g,'').replace(',','.'));
  return isFinite(n)&&n>0 ? n.toFixed(2).replace('.',',') : '';
}
function looksBarcode(s){return /^\d{8,14}$/.test(s||'');}
function parseLinesToMap(lines){
  const map={};
  for(const raw of lines){
    const line=raw.trim(); if(!line) continue;
    const sep = line.includes(';')?';':'\t';
    const cols=line.split(sep).map(s=>s.trim()).filter(x=>x!=='');

    if(cols.length<2) continue;

    // isim: en uzun harfli alanı seç
    let name = cols.slice(0,3).sort((a,b)=>b.length-a.length).find(x=>/[A-Za-zĞÜŞİÖÇğüşiöç]/.test(x)) || cols[1];

    // fiyat: sondan ilk parasal
    let price='';
    for(let i=cols.length-1;i>=0;i--){ const p=normPriceStr(cols[i]); if(p){price=p;break;} }

    // barkod adaylarını topla
    const nums = cols.flatMap(c => (c.match(/\b\d{8,14}\b/g) || []));
    let barcode = nums.find(looksBarcode) || '';

    // stok kodu (ilk sütun genelde)
    const stock = cols[0].replace(/\s+/g,'');

    if(barcode){ map[barcode]={name,price,barcode,stock}; }
    // stok koduyla da erişilebilir olsun
    if(stock && !map[stock]){ map[stock]={name,price,barcode:barcode||'',stock}; }
  }
  return map;
}

// otomatik encoding: önce Windows-1254, olmazsa UTF-8
async function decodeFileSmart(file){
  const buf = await file.arrayBuffer();
  try{
    const t1254 = new TextDecoder('windows-1254',{fatal:false}).decode(buf);
    const bad1254 = (t1254.match(/\uFFFD/g)||[]).length;
    if(bad1254<=2) return t1254; // iyi
    const utf8 = new TextDecoder('utf-8',{fatal:false}).decode(buf);
    const bad8 = (utf8.match(/\uFFFD/g)||[]).length;
    return bad8<=bad1254 ? utf8 : t1254;
  }catch{
    try{ return new TextDecoder('utf-8').decode(buf); }catch{ return await file.text(); }
  }
}

// ====== FILE LOAD ======
$('#btnClearMap').onclick=()=>{productMap={};localStorage.removeItem('productMap');mapStat.textContent='0 ürün yüklü';showProductInfo('');searchList.innerHTML='';searchArr=[];};

inpFile.onchange=async(e)=>{
  const f=e.target.files?.[0]; if(!f) return;
  let txt=''; try{ txt = await decodeFileSmart(f); }catch{ alert('Dosya okunamadı'); return; }
  try{
    let map={};
    if(txt.trim().startsWith('{')){
      const obj=JSON.parse(txt);
      for(const [k,v] of Object.entries(obj)){
        if(typeof v==='string') map[k]={name:v,price:''};
        else map[k]={name:v.name||'',price:v.price||''};
      }
    }else{
      const lines = txt.split(/\r?\n/).filter(x=>x.trim().length);
      map = parseLinesToMap(lines);
    }
    productMap = map; // ÜZERİNE YAZ
    localStorage.setItem('productMap',JSON.stringify(productMap));
    mapStat.textContent = Object.keys(productMap).length + ' ürün yüklü';
    showProductInfo(inpCode.value.trim());
    buildSearchIndex();
  }catch(err){ console.error(err); alert('Veri çözümlenemedi. Satırlar "kod;isim;…;fiyat" biçiminde olmalı.'); }
};

// ====== SEARCH (isimle) ======
function buildSearchIndex(){
  searchArr = Object.entries(productMap).filter(([k,v])=>!!v.name).map(([k,v])=>{
    return {code:k,name:v.name,price:v.price,barcode:v.barcode||'', key:trLower(v.name)};
  });
}
searchBox.addEventListener('input', ()=>{
  const q=trLower(searchBox.value).trim();
  searchList.innerHTML='';
  if(!q) return;
  const list = [];
  const seen = new Set(); // aynı ürünü tekrar gösterme
  for(const item of searchArr){
    if(item.key.includes(q)){
      const id = (item.barcode||item.code||item.name)+item.price;
      if(seen.has(id)) continue; seen.add(id);
      list.push(item);
      if(list.length>=50) break;
    }
  }
  for(const m of list){
    const row=document.createElement('div'); row.className='result';
    // sadece İSİM + FİYAT göster (stok kodu yazma)
    row.innerHTML = `<div><strong>${m.name}</strong></div><div><strong>${m.price||'—'}</strong></div>`;
    row.onclick=()=>{
      const target = m.barcode || m.code || m.name;
      if(target){ inpCode.value=target; showProductInfo(target); inpQty.focus(); }
    };
    searchList.appendChild(row);
  }
});

// ====== UI EVENTS ======
$('#btnStart').onclick=async()=>{await listCameras();start();};
$('#btnStop').onclick = ()=>stop();
btnOnce.onclick=async()=>{await listCameras();state.singleShot=true;btnOnce.disabled=true;btnOnce.textContent='Okutuluyor...';if(!state.scanning)await start();else statusEl.textContent='Tek seferlik okuma aktif';};

$('#btnAdd').onclick = ()=>{upsert(inpCode.value.trim(),inpQty.value);inpCode.value='';inpQty.value=1;nameEl.textContent='—';priceEl.textContent='—';inpCode.focus();};
$('#btnMinus').onclick=()=>{inpQty.value=Math.max(1,Number(inpQty.value)-1);};
$('#btnPlus').onclick =()=>{inpQty.value=Number(inpQty.value)+1;};
$('#btnClearField').onclick=()=>{inpCode.value='';showProductInfo('');inpCode.focus();};
$('#btnExport').onclick=()=>exportTXT();
$('#btnCSV').onclick=()=>exportCSV();
$('#btnClear').onclick=()=>{if(confirm('Listeyi temizlemek istiyor musun?')){state.items={};save();render();}};
$('#btnUndo').onclick=()=>undo();

$('#btnSubmitCode').onclick=()=>{
  const code=inpCode.value.trim(); if(!code) return;
  showProductInfo(code);
  play(productMap[code]?beep:errBeep);
  inpQty.focus(); inpQty.select();
};
inpCode.addEventListener('keydown',e=>{ if(e.key==='Enter'){ e.preventDefault(); $('#btnSubmitCode').click(); }});
inpCode.addEventListener('input',()=>{ const c=inpCode.value.trim(); if(c) showProductInfo(c); });
inpQty.addEventListener('focus',()=>inpQty.select());
inpQty.addEventListener('keydown',e=>{ if(e.key==='Enter'){ e.preventDefault(); $('#btnAdd').click(); }});

// ====== BOOT ======
try{
  const pm=localStorage.getItem('productMap');
  if(pm){ productMap=JSON.parse(pm); mapStat.textContent=Object.keys(productMap).length+' ürün yüklü'; buildSearchIndex(); }
}catch{}
load(); listCameras();
