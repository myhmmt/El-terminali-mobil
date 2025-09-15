/* ====== DURUM ====== */
const state={items:{},scanning:false,currentDeviceId:null,singleShot:false};
let mediaStream=null,rafId=null,frames=0,duplicateGuard={code:null,until:0},lastOp=null,detector=null,off=null,octx=null;

/* ====== ELEMANLAR ====== */
const $=id=>document.getElementById(id);
const selCam=$('cameraSelect'), video=$('video'), statusEl=$('scanStatus'), fpsEl=$('fps');
const barcodeInp=$('barcode'), qtyInp=$('qty'), tbody=$('tbody'), totalRows=$('totalRows'), totalQty=$('totalQty');
const filenameInp=$('filename'), btnScanOnce=$('btnScanOnce'), productFile=$('productFile'), mapStat=$('mapStat');
const productNameEl=$('productName'), productPriceEl=$('productPrice'), searchInp=$('search'), resultsEl=$('results');
const beep=$('beep'), err=$('err'), encSel=$('encoding');
const LS_ITEMS='barcodeItems_v3', LS_MAP='productMap_v3';
let productMap={};

/* ====== KALICI ====== */
function saveItems(){ localStorage.setItem(LS_ITEMS,JSON.stringify(state.items)); }
function loadItems(){ try{ const raw=localStorage.getItem(LS_ITEMS); if(raw) state.items=JSON.parse(raw)||{}; }catch{} render(); }
function saveMap(){ localStorage.setItem(LS_MAP,JSON.stringify(productMap)); mapStat.textContent=Object.keys(productMap).length+' ürün yüklü'; }
function loadMap(){ try{ const pm=localStorage.getItem(LS_MAP); if(pm) productMap=JSON.parse(pm)||{}; }catch{} mapStat.textContent=Object.keys(productMap).length+' ürün yüklü'; }

/* ====== LİSTE ====== */
function render(){
  tbody.innerHTML=''; let sum=0;
  for(const [bc,q] of Object.entries(state.items)){
    sum+=Number(q)||0;
    const name=(productMap[bc]?.name)||'—';
    const tr=document.createElement('tr');
    tr.innerHTML=`<td>${bc}</td><td>${escapeHtml(name)}</td><td class="right">${q}</td><td><button class="warn" onclick="delItem('${bc}')">Sil</button></td>`;
    tbody.appendChild(tr);
  }
  totalRows.textContent=Object.keys(state.items).length;
  totalQty.textContent=sum;
}
window.delItem=(c)=>{ delete state.items[c]; saveItems(); render(); };
function upsert(c,q){ if(!c) return; const n=Math.max(1,Number(q)||1); state.items[c]=(Number(state.items[c])||0)+n; lastOp={code:c,qty:n}; saveItems(); render(); }
function undo(){ if(!lastOp) return; const {code,qty}=lastOp; state.items[code]=(Number(state.items[code])||0)-qty; if(state.items[code]<=0) delete state.items[code]; lastOp=null; saveItems(); render(); }

/* ====== DIŞA AKTARIM ====== */
function dl(name,content,type){ const a=document.createElement('a'); a.href=URL.createObjectURL(new Blob([content],{type})); a.download=name; a.click(); URL.revokeObjectURL(a.href); }
function exportTXT(){ const lines=Object.entries(state.items).map(([c,q])=>`${c};${q}`); dl((filenameInp.value||'sayim')+'.txt',lines.join('\n'),'text/plain'); }

/* --- PDF (fatura görünümü) --- */
function exportPDF(){
  const rows = []; let grand = 0;
  for(const [bc,q] of Object.entries(state.items)){
    const p = productMap[bc] || {};
    const name = p.name || '';
    const unitDisp = p.price || '';
    const unit = priceToNumber(unitDisp);
    const qty = Number(q)||0;
    const total = unit * qty;
    grand += total;
    rows.push({ bc, name, qty, unitDisp: numberToDisp(unit), totalDisp: numberToDisp(total) });
  }
  const title='GENÇ GROSS', fname=(filenameInp.value||'sayim'), dateStr=new Date().toLocaleString('tr-TR');
  const html = `<!doctype html><html lang="tr"><head><meta charset="utf-8"><title>${title} - ${fname}</title>
<style>*{box-sizing:border-box}body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial;margin:24px;color:#111}
h1{margin:0 0 4px 0;text-align:center;font-size:22px}.sub{text-align:center;color:#555;margin-bottom:16px;font-size:12px}
table{width:100%;border-collapse:collapse;margin-top:8px}th,td{padding:8px 10px;border-bottom:1px solid #ddd;font-size:13px;vertical-align:top}
th{background:#f3f5ff;text-align:left}td.right,th.right{text-align:right}.tot{margin-top:18px;display:flex;justify-content:flex-end}
.tot .box{min-width:280px;border:1px solid #ccc;padding:10px 12px;border-radius:8px}.row{display:flex;justify-content:space-between;margin:4px 0;font-weight:700}
.muted{color:#666;font-weight:400}@media print{.noprint{display:none}}</style></head><body>
<h1>${title}</h1><div class="sub">${fname}.pdf · ${dateStr}</div>
<table><thead><tr><th style="width:22%">Barkod</th><th>İsim</th><th class="right" style="width:10%">Adet</th><th class="right" style="width:14%">Birim</th><th class="right" style="width:14%">Tutar</th></tr></thead>
<tbody>${rows.map(r=>`<tr><td>${escapeHtml(r.bc)}</td><td>${escapeHtml(r.name)}</td><td class="right">${r.qty}</td><td class="right">${r.unitDisp||'—'}</td><td class="right">${r.totalDisp||'—'}</td></tr>`).join('')}
${rows.length===0?`<tr><td colspan="5" class="muted">Liste boş</td></tr>`:''}</tbody></table>
<div class="tot"><div class="box"><div class="row"><span>Genel Toplam</span><span>${numberToDisp(grand)}</span></div><div class="row muted"><span>Satır Sayısı</span><span>${rows.length}</span></div></div></div>
<div class="noprint" style="margin-top:16px;text-align:center"><button onclick="window.print()">PDF olarak kaydet</button></div>
<script>window.onload=()=>window.print();</script></body></html>`;
  const w=window.open('','_blank'); w.document.open(); w.document.write(html); w.document.close();
}

/* ====== KAMERA ====== */
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
selCam.onchange=()=>{state.currentDeviceId=selCam.value;if(state.scanning)start();};

async function start(){
  stop(); statusEl.textContent='Kamera açılıyor...';
  try{
    const constraints={video: state.currentDeviceId?{deviceId:{exact:state.currentDeviceId},width:{ideal:1920},height:{ideal:1080}}:{facingMode:{ideal:'environment'},width:{ideal:1920},height:{ideal:1080}}, audio:false};
    mediaStream=await navigator.mediaDevices.getUserMedia(constraints);
    video.srcObject=mediaStream; await video.play(); state.scanning=true; statusEl.textContent='Tarama aktif'; runNativeLoop(); fpsCounter();
  }catch(e){ statusEl.textContent='Tarama başlatılamadı'; }
}
function stop(){ cancelAnimationFrame(rafId); rafId=null; frames=0; fpsEl.textContent='FPS: -'; const s=video.srcObject; if(s?.getTracks) s.getTracks().forEach(t=>t.stop()); video.srcObject=null; mediaStream=null; state.scanning=false; statusEl.textContent='Durduruldu'; }
function fpsCounter(){ let last=performance.now(); const tick=()=>{ if(!state.scanning) return; const now=performance.now(); if(now-last>=1000){ fpsEl.textContent='FPS: '+frames; frames=0; last=now; } requestAnimationFrame(tick); }; tick(); }
async function runNativeLoop(){
  if(!('BarcodeDetector' in window)){ statusEl.textContent='Desteklenmiyor'; return; }
  if(!detector){ detector=new BarcodeDetector({formats:['ean_13','ean_8','code_128','code_39','itf','upc_e','upc_a']}); }
  if(!off){ off=document.createElement('canvas'); octx=off.getContext('2d',{willReadFrequently:true}); }
  const loop=async()=>{
    if(!state.scanning) return; frames++;
    const vw=video.videoWidth, vh=video.videoHeight;
    if(vw&&vh){
      const rw=Math.floor(vw*0.68), rh=Math.floor(vh*0.32), rx=Math.floor((vw-rw)/2), ry=Math.floor((vh-rh)/2);
      off.width=rw; off.height=rh; octx.drawImage(video,rx,ry,rw,rh,0,0,rw,rh);
      try{ const d=await detector.detect(off); if(d&&d.length){ onCode((d[0].rawValue||'').trim()); }}catch(_){}
    }
    if(state.scanning) rafId=requestAnimationFrame(loop);
  }; loop();
}
function onCode(text){
  if(!text) return; const now=performance.now();
  if(text===duplicateGuard.code&&now<duplicateGuard.until) return; duplicateGuard={code:text,until:now+1200};
  barcodeInp.value=text; const found=!!productMap[text]; showProductInfo(text);
  if(found) play(beep); else play(err);
  if(navigator.vibrate) navigator.vibrate(found?30:80);
  if(state.singleShot){ stop(); btnScanOnce.disabled=true; btnScanOnce.textContent='Okundu ✓'; setTimeout(()=>{btnScanOnce.disabled=false;btnScanOnce.textContent='👉 Tek Okut';},900); state.singleShot=false; }
}

/* ====== ÜRÜN BİLGİ ====== */
function showProductInfo(code){
  const p = productMap[code];
  if(p){ productNameEl.textContent=p.name||'—'; productPriceEl.textContent=p.price||'—'; }
  else { productNameEl.textContent='Bulunamadı'; productPriceEl.textContent='—'; }
}

/* ====== DOSYA YÜKLEME / PARSE ====== */
$('btnClearMap').onclick=()=>{ productMap={}; saveMap(); showProductInfo(''); };
productFile.onchange=async(e)=>{
  const file=e.target.files?.[0]; if(!file) return;
  let txt=''; try{
    if(encSel && encSel.value==='windows-1254'){
      txt = await new Promise((resolve,reject)=>{
        const fr=new FileReader();
        fr.onload=()=>resolve(fr.result); fr.onerror=reject;
        fr.readAsText(file,'windows-1254');
      });
    }else{
      txt = await file.text(); // UTF-8
    }
  }catch{ alert('Dosya okunamadı.'); return; }
  try{
    const map = autoParse(txt);
    const count = Object.keys(map).length;
    if(!count){ alert('Veri çözümlenemedi. CSV/TXT (kod;isim;...;fiyat), JSON ya da GNCPULUF verin.'); return; }
    productMap = map; saveMap(); showProductInfo(barcodeInp.value.trim());
    alert(`${count} ürün yüklendi (${file.name}).`);
  }catch(err){ console.error(err); alert('Veri çözümlenemedi. CSV/TXT (kod;isim;...;fiyat), JSON ya da GNCPULUF verin.'); }
};

function autoParse(txt){
  const t = txt.trim();
  if(t.startsWith('{') || t.startsWith('[')) return parseJSON(t);
  if(/^\s*[1345];/m.test(t)) return parseGNCPULUF(t);
  return parseCSV(t);
}

/* --- CSV/TXT: kod;isim;...;fiyat --- */
function parseCSV(txt){
  const lines=txt.split(/\r?\n/).filter(x=>x.trim().length);
  const sep = lines[0]?.includes(';')?';':',';
  const map={};
  for(const L of lines){
    const cols=L.split(sep).map(s=>s.trim());
    if(cols.length<2) continue;
    const code=cols[0].replace(/\s+/g,'');
    const name=safeTxt(cols[1]||'');
    const price=normalizePrice(cols.slice(2).reverse().find(x=>/\d+[,.]\d{2}/.test(x))||'');
    if(/^[0-9]{3,14}$/.test(code)) map[code]={name,price};
  }
  return map;
}

/* --- JSON: {"869...":{"name":"X","price":"11,90"}} veya {"869...":"X"} --- */
function parseJSON(txt){
  const obj=JSON.parse(txt); const map={};
  for(const [k,v] of Object.entries(obj)){
    if(typeof v==='string') map[k]={name:safeTxt(v),price:''};
    else map[k]={name:safeTxt(v.name||''),price:normalizePrice(v.price||'')};
  }
  return map;
}

/* --- GNCPULUF (Genius 2 SQL) ---
   1;PLU;İSİM;...
   3;PLU;BARKOD;...
   4;PLU;…;FİYAT;…   (fiyat sütunu dosyaya göre değişebiliyor → TÜM sütunlarda ara, en sağ geçerli fiyatı al)
   5;PLU;… (yok say)                                                        */
function parseGNCPULUF(txt){
  const byPLU=new Map(); // PLU -> {name, price, codes:Set}
  const lines=txt.split(/\r?\n/);

  for(let raw of lines){
    raw=raw.trim(); if(!raw) continue;
    const parts=raw.split(';');
    const typ=parts[0];

    if(typ==='1'){
      const plu=(parts[1]||'').trim(); if(!plu) continue;
      const name=safeTxt((parts[2]||'').trim());
      const rec=byPLU.get(plu)||{name:'',price:'',codes:new Set()};
      if(name) rec.name=name;
      byPLU.set(plu,rec);
    }

    else if(typ==='3'){
      const plu=(parts[1]||'').trim(); if(!plu) continue;
      const rec=byPLU.get(plu)||{name:'',price:'',codes:new Set()};
      const bcField=(parts[2]||'').trim();
      const cands = bcField.match(/\d{3,14}/g) || [];
      for(const c of cands){ rec.codes.add(c.replace(/^0+(?=\d)/,'')); }
      byPLU.set(plu,rec);
    }

    else if(typ==='4'){
      const plu=(parts[1]||'').trim(); if(!plu) continue;
      // TÜM sütunlarda TR fiyatı tara; en sağdaki geçerli olanı al (örn: ...;175,00;175,00;)
      let price = '';
      for(let i=parts.length-1;i>=2;i--){
        const p = normalizePrice((parts[i]||'').trim());
        if(p){ price=p; break; }
      }
      // yine de boşsa satırın sağından regex fallback
      if(!price){
        const m = rightmostPrice(raw);
        if(m) price = m;
      }
      const rec=byPLU.get(plu)||{name:'',price:'',codes:new Set()};
      if(price) rec.price=price;
      byPLU.set(plu,rec);
    }
    // 5; ... yok say
  }

  const out={};
  for(const [,rec] of byPLU){
    const name=rec.name||'', price=rec.price||'';
    for(const bc of rec.codes){ out[bc]={name,price}; }
  }
  return out;
}

/* ====== YARDIMCILAR ====== */
function rightmostPrice(str){
  const re=/\d{1,3}(?:\.\d{3})*,\d{2}|\d+,\d{2}/g; let m,last='';
  while((m=re.exec(str))){ last=m[0]; }
  return normalizePrice(last);
}
function normalizePrice(p){
  if(!p) return '';
  let s=(''+p).replace(/\s+/g,'').replace(/"/g,'');
  s = s.replace(/\.(?=\d{3}(?:[.,]|$))/g,''); // binlik nokta
  s = s.replace(/(\d)\.(\d{2})$/, '$1,$2');   // 1234.50 -> 1234,50
  const n = Number(s.replace(',', '.'));
  return (isFinite(n)&&n>0) ? n.toFixed(2).replace('.',',') : '';
}
function priceToNumber(d){ if(!d) return 0; const n=Number(String(d).replace(/\./g,'').replace(',','.')); return isFinite(n)?n:0; }
function numberToDisp(n){ return Number(n||0).toFixed(2).replace('.',','); }
function play(aud){ if(!aud) return; try{ aud.currentTime=0; aud.play(); }catch{} }
function escapeHtml(s){return (s||'').replace(/[&<>"']/g,m=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m]));}
function safeTxt(s){ return (s||'').normalize('NFC'); }

/* ====== OLAYLAR ====== */
$('btnStart').onclick=async()=>{await listCameras();start();};
$('btnStop').onclick=()=>stop();
$('btnMinus').onclick=()=>{qtyInp.value=Math.max(1,Number(qtyInp.value)-1); qtyInp.select();};
$('btnPlus').onclick =()=>{qtyInp.value=Number(qtyInp.value)+1; qtyInp.select();};
$('btnClearField').onclick=()=>{barcodeInp.value=''; showProductInfo('');};
$('btnExport').onclick=()=>exportTXT();
$('btnPDF').onclick  =()=>exportPDF();
$('btnClear').onclick=()=>{ if(confirm('Listeyi temizlemek istiyor musun?')){ state.items={}; saveItems(); render(); } };
$('btnUndo').onclick =()=>undo();

btnScanOnce.onclick=async()=>{await listCameras(); state.singleShot=true; btnScanOnce.disabled=true; btnScanOnce.textContent='Okutuluyor...'; if(!state.scanning) await start(); else statusEl.textContent='Tek seferlik okuma aktif';};

$('btnGo').onclick=()=>{ 
  const code=barcodeInp.value.trim().replace(/\s+/g,'');
  if(!code) return;
  const found=!!productMap[code];
  showProductInfo(code);
  if(found) play(beep); else play(err);
  qtyInp.focus(); qtyInp.select();
};
barcodeInp.addEventListener('keydown',e=>{ if(e.key==='Enter'){ $('btnGo').click(); e.preventDefault(); }});
qtyInp.addEventListener('focus',()=>{ qtyInp.select(); });
qtyInp.addEventListener('keydown',e=>{ if(e.key==='Enter'){ $('btnAdd').click(); e.preventDefault(); }});
$('btnAdd').onclick=()=>{
  const code=barcodeInp.value.trim().replace(/\s+/g,''); if(!code) return;
  upsert(code, qtyInp.value);
  barcodeInp.value=''; qtyInp.value=1; showProductInfo('');
  barcodeInp.focus();
};
barcodeInp.addEventListener('input',()=>{ const code=barcodeInp.value.replace(/\D/g,''); if(code.length>=3) showProductInfo(code); });
barcodeInp.addEventListener('blur',()=>{ const code=barcodeInp.value.replace(/\D/g,''); if(code) showProductInfo(code); });

/* ====== ARAMA (Türkçe duyarlı) ====== */
searchInp.addEventListener('input',()=>{
  const q = searchInp.value.trim();
  resultsEl.innerHTML='';
  if(!q) return;
  const QQ = q.toLocaleUpperCase('tr-TR');
  const out=[];
  for(const [bc,info] of Object.entries(productMap)){
    const nameU=(info.name||'').toLocaleUpperCase('tr-TR');
    if(nameU.includes(QQ)){ out.push([bc,info]); if(out.length>=100) break; }
  }
  for(const [bc,info] of out){
    const div=document.createElement('div');
    div.className='result';
    div.innerHTML=`<b>${escapeHtml(info.name||'')}</b>${bc} · <b>${info.price||'—'}</b>`;
    div.onclick=()=>{ barcodeInp.value=bc; showProductInfo(bc); window.scrollTo({top:0,behavior:'smooth'}); barcodeInp.focus(); };
    resultsEl.appendChild(div);
  }
});

/* ====== BAŞLAT ====== */
loadMap();
loadItems();
showProductInfo('');
listCameras();
