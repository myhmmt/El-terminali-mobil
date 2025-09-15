/* GENÇ GROSS – Mobil Terminal (GTF + CSV + JSON)
   - GTF (Genius 2 SQL) şeması:
     1;PLU;İSİM;...
     3;PLU;BARKOD;...
     4;PLU;...;FİYAT;...   (fiyat 5. sütun, ör: 175.00)
*/

const state={items:{},scanning:false,currentDeviceId:null,singleShot:false};
let mediaStream=null,rafId=null,frames=0,duplicateGuard={code:null,until:0},lastOp=null,detector=null,off=null,octx=null;
let productMap={};           // { barkod: {name, price} }
let searchIndex=[];          // [{k, n, p}] k=barkod/kod, n=isim UPPER-TR, p=fiyat

// kısayollar
const $=sel=>document.querySelector(sel);
const selCam=$("#cameraSelect");
const video=$("#video");
const statusEl=$("#scanStatus");
const fpsEl=$("#fps");
const barcodeInp=$("#barcode");
const qtyInp=$("#qty");
const tbody=$("#tbody");
const totalRows=$("#totalRows");
const totalQty=$("#totalQty");
const filenameInp=$("#filename");
const okbeep=$("#okbeep");
const errbeep=$("#errbeep");
const btnScanOnce=$("#btnScanOnce");
const productNameEl=$("#productName");
const productPriceEl=$("#productPrice");
const productFile=$("#productFile");
const mapStat=$("#mapStat");
const encodingSel=$("#encoding");
const results=$("#results");
const searchInp=$("#search");

// ---------- liste ----------
function render(){
  tbody.innerHTML=''; let sum=0;
  Object.entries(state.items).forEach(([c,q])=>{
    sum+=Number(q)||0;
    const name=(productMap[c]?.name)||'—';
    const tr=document.createElement('tr');
    tr.innerHTML=`<td>${c}</td><td>${name}</td><td class="right">${q}</td><td><button data-del="${c}">Sil</button></td>`;
    tbody.appendChild(tr);
  });
  totalRows.textContent=Object.keys(state.items).length;
  totalQty.textContent=sum;
}
tbody.addEventListener('click',e=>{
  const c=e.target.getAttribute('data-del'); if(!c) return;
  delete state.items[c]; save(); render();
});
function upsert(c,q){ if(!c) return; const n=Math.max(1,Number(q)||1);
  state.items[c]=(Number(state.items[c])||0)+n; lastOp={code:c,qty:n}; save(); render();
}
function undo(){ if(!lastOp) return; const {code,qty}=lastOp;
  state.items[code]=(Number(state.items[code])||0)-qty;
  if(state.items[code]<=0) delete state.items[code];
  lastOp=null; save(); render();
}
function save(){ localStorage.setItem('barcodeItems',JSON.stringify(state.items)); }
function load(){ try{const raw=localStorage.getItem('barcodeItems'); if(raw) state.items=JSON.parse(raw);}catch{} render(); }

// ---------- export ----------
function dl(name,content,type){ const a=document.createElement('a');
  a.href=URL.createObjectURL(new Blob([content],{type})); a.download=name; a.click(); URL.revokeObjectURL(a.href);
}
function exportTXT(){
  const lines=Object.entries(state.items).map(([c,q])=>`${c};${q}`);
  dl((filenameInp.value||'sayim')+'.txt',lines.join('\n'),'text/plain');
}
function exportPDF(){
  // basit fatura PDF’i (pdfmake vb. yok; txt-benzeri PDF yapmıyoruz)
  // burada HTML -> yeni pencere -> print pdf
  const rows=Object.entries(state.items).map(([code,qty])=>{
    const p=productMap[code]||{};
    const priceNum = toNumber(p.price);     // 12,34 -> 12.34
    const lineTotal = qty * (priceNum||0);
    return {code, name:p.name||'', qty, unit: p.price||'', total: numDisp(lineTotal)};
  });
  const total = rows.reduce((a,b)=>a+toNumber(b.total),0);

  const w=window.open('','_blank');
  const css=`body{font-family:system-ui,Segoe UI,Arial;margin:24px}
    h2{margin:0 0 12px 0} table{border-collapse:collapse;width:100%}
    th,td{border-bottom:1px solid #ddd;padding:8px} th{text-align:left;background:#f2f2f2}
    tfoot td{font-weight:700}`;
  const html = `
  <html><head><meta charset="utf-8"><title>GG PDF</title><style>${css}</style></head>
  <body>
    <h2>GENÇ GROSS</h2>
    <table>
      <thead><tr><th>Barkod</th><th>İsim</th><th style="text-align:right">Adet</th><th style="text-align:right">Birim Fiyat</th><th style="text-align:right">Toplam</th></tr></thead>
      <tbody>
        ${rows.map(r=>`<tr><td>${r.code}</td><td>${escapeHtml(r.name)}</td><td style="text-align:right">${r.qty}</td><td style="text-align:right">${r.unit||''}</td><td style="text-align:right">${r.total}</td></tr>`).join('')}
      </tbody>
      <tfoot><tr><td colspan="4" style="text-align:right">Genel Toplam</td><td style="text-align:right">${numDisp(total)}</td></tr></tfoot>
    </table>
  </body></html>`;
  w.document.write(html); w.document.close();
  // kullanıcı isterse Print->PDF kaydeder
}
function escapeHtml(s){return (s||'').replace(/[&<>"']/g,m=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m]));}
function toNumber(str){ if(!str) return 0; return Number(String(str).replace(/\./g,'').replace(',','.'))||0; }
function numDisp(n){ return (Number(n)||0).toFixed(2).replace('.',','); }

// ---------- kamera ----------
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
selCam.onchange=()=>{ state.currentDeviceId=selCam.value; if(state.scanning) start(); };

async function start(){
  stop(); statusEl.textContent='Kamera açılıyor...';
  try{
    const constraints={video:state.currentDeviceId?{deviceId:{exact:state.currentDeviceId},width:{ideal:1920},height:{ideal:1080}}:{facingMode:{ideal:'environment'},width:{ideal:1920},height:{ideal:1080}},audio:false};
    mediaStream=await navigator.mediaDevices.getUserMedia(constraints);
    video.srcObject=mediaStream; await video.play(); state.scanning=true; statusEl.textContent='Tarama aktif'; runNativeLoop(); fpsCounter();
  }catch(e){ statusEl.textContent='Tarama başlatılamadı'; }
}
function stop(){
  cancelAnimationFrame(rafId); rafId=null; frames=0; fpsEl.textContent='FPS: -';
  const s=video.srcObject; if(s?.getTracks) s.getTracks().forEach(t=>t.stop());
  video.srcObject=null; mediaStream=null; state.scanning=false; statusEl.textContent='Durduruldu';
}
async function runNativeLoop(){
  if(!('BarcodeDetector' in window)){ statusEl.textContent='Cihaz desteklemiyor'; return; }
  if(!detector){ detector=new BarcodeDetector({formats:['ean_13','ean_8','code_128','code_39','itf','upc_e','upc_a']}); }
  if(!off){ off=document.createElement('canvas'); octx=off.getContext('2d',{willReadFrequently:true}); }
  const loop=async()=>{
    if(!state.scanning) return; frames++;
    const vw=video.videoWidth,vh=video.videoHeight;
    if(vw&&vh){
      const rw=Math.floor(vw*0.68),rh=Math.floor(vh*0.32);
      const rx=Math.floor((vw-rw)/2),ry=Math.floor((vh-rh)/2);
      off.width=rw;off.height=rh;octx.drawImage(video,rx,ry,rw,rh,0,0,rw,rh);
      try{const d=await detector.detect(off); if(d&&d.length){ onCode((d[0].rawValue||'').trim()); }}catch(_){}
    }
    if(state.scanning) rafId=requestAnimationFrame(loop);
  }; loop();
}
function onCode(text){
  if(!text) return; const now=performance.now();
  if(text===duplicateGuard.code && now<duplicateGuard.until) return;
  duplicateGuard={code:text,until:now+1500};
  barcodeInp.value=text; showProductInfo(text, true);
  playOk();
  if(navigator.vibrate) navigator.vibrate(30);
  if(state.singleShot){ stop(); btnScanOnce.disabled=true; btnScanOnce.textContent='Okundu ✓'; setTimeout(()=>{btnScanOnce.disabled=false;btnScanOnce.textContent='👉 Tek Okut';},900); state.singleShot=false; }
}
function fpsCounter(){ let last=performance.now(); const tick=()=>{ if(!state.scanning) return; const now=performance.now(); if(now-last>=1000){ fpsEl.textContent='FPS: '+frames; frames=0; last=now; } requestAnimationFrame(tick); }; tick(); }

// ---------- ürün bilgisi / arama ----------
function trUpper(s){ return (s||'').toLocaleUpperCase('tr-TR'); }
function rebuildSearch(){
  searchIndex = Object.entries(productMap).map(([k,v])=>({k, n:trUpper(v.name||''), p:v.price||''}));
}
function showProductInfo(code,fromScanner=false){
  const p=productMap[code];
  if(p){ productNameEl.textContent=p.name||'—'; productPriceEl.textContent=p.price||'—'; }
  else { productNameEl.textContent='Bulunamadı'; productPriceEl.textContent='—'; if(!fromScanner) playError(); }
}
searchInp?.addEventListener('input', ()=>{
  const q=trUpper(searchInp.value.trim()); results.innerHTML=''; if(!q) return;
  const rows = searchIndex.filter(r=>r.n.includes(q)).slice(0,150);
  for(const r of rows){
    const div=document.createElement('div');
    div.style.cssText='padding:10px;border:1px solid #eaeaff;border-radius:10px;margin:6px 0;background:#fff';
    div.innerHTML=`<div style="font-weight:800">${escapeHtml(productMap[r.k].name||'')}</div>
                   <div class="muted">${r.k} · ${productMap[r.k].price||'—'}</div>`;
    div.onclick=()=>{ barcodeInp.value=r.k; showProductInfo(r.k); barcodeInp.focus(); barcodeInp.select(); };
    results.appendChild(div);
  }
});

// ---------- dosya yükleme ----------
$("#btnClearMap").onclick=()=>{ productMap={}; searchIndex=[]; localStorage.removeItem('productMap'); mapStat.textContent='0 ürün yüklü'; showProductInfo(''); results.innerHTML=''; };

productFile.onchange=async(e)=>{
  const file=e.target.files?.[0]; if(!file) return;
  let txt='';
  try{
    if(encodingSel.value==='windows-1254'){
      txt = await file.text(); // çoğu tarayıcı 1254'ü de çözüyor; sorun olursa FileReader+TextDecoder gerekir
    }else{
      txt = await file.text();
    }
  }catch{ alert('Dosya okunamadı.'); return; }
  loadProductText(txt,file.name||'dosya');
};

function loadProductText(txt,src='metin'){
  try{
    let map={};
    const firstLine=(txt.split(/\r?\n/).find(l=>l.trim())||'').trim();
    if(/^1;/.test(firstLine) || /^3;/.test(firstLine) || /^4;/.test(firstLine)){
      map = parseGTF(txt);  // ✅ GENIUS 2 SQL
    }else if(txt.trim().startsWith('{')){
      const obj=JSON.parse(txt);
      for(const [k,v] of Object.entries(obj)){
        if(typeof v==='string') map[k]={name:v,price:''};
        else map[k]={name:v.name||'',price:v.price||''};
      }
    }else{
      map = parseCSV(txt);  // CSV/TXT: kod;isim;…;fiyat
    }

    const count=Object.keys(map).length;
    if(count===0){ const first=(txt.split(/\r?\n/)[0]||'').slice(0,120); alert(`0 ürün bulundu (${src}). İlk satır: "${first}"`); return; }
    productMap=map; rebuildSearch();
    localStorage.setItem('productMap',JSON.stringify(productMap));
    mapStat.textContent=count+' ürün yüklü';
    showProductInfo(barcodeInp.value.trim());
    alert(`${count} ürün yüklendi (${src}).`);
  }catch(err){ console.error(err); alert('Veri çözümlenemedi. CSV/TXT (kod;isim;…;fiyat), JSON veya GTF verin.'); }
}

// CSV/TXT: kod;isim;...;fiyat (fiyat virgüllü ya da noktalı olabilir)
function parseCSV(txt){
  const lines=txt.split(/\r?\n/).filter(x=>x.trim().length);
  const sep=lines[0]?.includes(';')?';':',';
  const map={};
  for(const L of lines){
    const cols=L.split(sep).map(s=>s.trim());
    if(cols.length>=2){
      const code=cols[0].replace(/\s+/g,'');
      const name=cols[1];
      let rawp = cols[cols.length-1] || '';
      let num = Number(String(rawp).replace(/\./g,'').replace(',','.'));
      const disp = num ? num.toFixed(2).replace('.',',') : '';
      if(/^[0-9]{1,14}$/.test(code)) map[code]={name,price:disp};
    }
  }
  return map;
}

// GTF: 1;PLU;İSİM…, 3;PLU;BARKOD…, 4;PLU;...;FİYAT;...
function parseGTF(txt){
  const lines=txt.split(/\r?\n/);
  const names={}, prices={}, barc={}; // barc[plu]=[barkod...]
  for(const raw of lines){
    if(!raw) continue;
    const parts = raw.split(';');
    const tag = parts[0];
    if(tag==='1'){
      const plu=(parts[1]||'').trim();
      const name=(parts[2]||'').trim();
      if(plu) names[plu]=name;
    }else if(tag==='3'){
      const plu=(parts[1]||'').trim();
      const bc =(parts[2]||'').replace(/\D/g,'');
      if(plu && bc){ (barc[plu] ||= []).push(bc); }
    }else if(tag==='4'){
      const plu=(parts[1]||'').trim();
      let rawp = (parts[4]||parts[3]||'').trim();  // 5. sütun, yoksa 4.
      let num = Number(rawp.replace(',','.'));
      if(!isFinite(num)) num = 0;
      prices[plu]= num;
    }
  }
  const map={};
  for(const plu of new Set([...Object.keys(barc), ...Object.keys(names), ...Object.keys(prices)])){
    const name = names[plu]||'';
    const priceDisp = prices[plu] ? prices[plu].toFixed(2).replace('.',',') : '';
    // barkodların tümüne ata
    (barc[plu]||[]).forEach(bc=>{ map[bc]={name,price:priceDisp}; });
    // PLU kodunun kendisi de girilebilsin
    if(plu) map[plu]={name,price:priceDisp};
  }
  return map;
}

// ---------- olaylar ----------
$("#btnStart").onclick=async()=>{ await listCameras(); start(); };
$("#btnStop").onclick=()=>stop();
$("#btnScanOnce").onclick=async()=>{ await listCameras(); state.singleShot=true; btnScanOnce.disabled=true; btnScanOnce.textContent='Okutuluyor...'; if(!state.scanning) await start(); else statusEl.textContent='Tek seferlik okuma aktif'; };

$("#btnAdd").onclick=()=>{ upsert(barcodeInp.value.trim(),qtyInp.value); barcodeInp.value=''; qtyInp.value=1; showProductInfo(''); barcodeInp.focus(); };
$("#btnMinus").onclick=()=>{ qtyInp.value=Math.max(1,Number(qtyInp.value)-1); };
$("#btnPlus").onclick=()=>{ qtyInp.value=Number(qtyInp.value)+1; };
$("#btnClearField").onclick=()=>{ barcodeInp.value=''; showProductInfo(''); barcodeInp.focus(); };
$("#btnClear").onclick=()=>{ if(confirm('Listeyi temizlemek istiyor musun?')){ state.items={}; save(); render(); } };
$("#btnUndo").onclick=()=>undo();
$("#btnExport").onclick=()=>exportTXT();
$("#btnPDF").onclick=()=>exportPDF();

// “Tamam” + Enter/Git davranışı
$("#btnGo").onclick=()=>{ const code=barcodeInp.value.trim(); if(!code){ barcodeInp.focus(); return; }
  showProductInfo(code); // bulunursa fiyat/isim göster
  const p=productMap[code];
  if(p) playOk(); else playError();
  qtyInp.focus(); qtyInp.select();
};
barcodeInp.addEventListener('keydown',e=>{
  if(e.key==='Enter'){ e.preventDefault(); $("#btnGo").click(); }
});
qtyInp.addEventListener('focus',()=>{ qtyInp.select(); });

// canlı yazarken ürün bilgisini göster
barcodeInp.addEventListener('input',()=>{
  const code=barcodeInp.value.replace(/\D/g,''); if(code.length>=1) showProductInfo(code);
});

// sesler
function playOk(){ try{ okbeep.currentTime=0; okbeep.play(); }catch{} }
function playError(){ try{ errbeep.currentTime=0; errbeep.play(); }catch{} }

// ---------- başlangıç ----------
try{ const pm=localStorage.getItem('productMap'); if(pm){ productMap=JSON.parse(pm); rebuildSearch(); mapStat.textContent=Object.keys(productMap).length+' ürün yüklü'; }}catch{}
load(); listCameras();
barcodeInp.focus(); barcodeInp.select();
