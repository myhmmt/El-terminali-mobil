/* GENÇ GROSS Mobil Terminal — uygulama mantığı (GNCPULUF destekli) */

const SKEY_ITEMS   = 'gg_items_v3';
const SKEY_PMAP    = 'gg_pmap_v3';        // ürün haritası (kalıcı)
const SKEY_PMAPSRC = 'gg_pmap_src_v3';    // son yüklenen dosya tipi
const SKEY_SETTINGS= 'gg_settings_v1';

const st = { items:{}, lastOp:null, scanning:false, single:false, devId:null };
let detector=null, mediaStream=null, rafId=null, frames=0;
let off=null, octx=null;

const $ = s => document.querySelector(s);
const $$ = s => document.querySelectorAll(s);

const el = {
  cameraSelect: $('#cameraSelect'),
  video: $('#video'),
  scanStatus: $('#scanStatus'),
  fps: $('#fps'),
  barcode: $('#barcode'),
  qty: $('#qty'),
  btnOk: $('#btnOk'),
  btnAdd: $('#btnAdd'),
  btnMinus: $('#btnMinus'),
  btnPlus: $('#btnPlus'),
  btnUndo: $('#btnUndo'),
  btnFieldClear: $('#btnFieldClear'),
  filename: $('#filename'),
  tbody: $('#tbody'),
  totalRows: $('#totalRows'),
  totalQty: $('#totalQty'),
  pname: $('#pname'),
  pprice: $('#pprice'),
  productFile: $('#productFile'),
  encSel: $('#encSel'),
  mapStat: $('#mapStat'),
  okSound: $('#okSound'),
  errSound: $('#errSound'),
  search: $('#search'),
  searchList: $('#searchList'),
  btnScanOnce: $('#btnScanOnce'),
};

let productMap = {};      // { code: {name, price} }
let normNameMap = {};     // arama için sadeleştirilmiş isim

// ---------- yardımcılar ----------
const sleep = ms => new Promise(r=>setTimeout(r,ms));
const toTR = s => (s||'').toLocaleUpperCase('tr-TR');
const strip = s => (s||'').trim();

function trFold(s){
  return (s||'')
    .replaceAll('I','ı').toLocaleLowerCase('tr-TR')
    .normalize('NFD').replace(/[\u0300-\u036f]/g,'');
}
function onlyDigits(s){ return (s||'').replace(/\D+/g,''); }
function prettyPrice(p){ 
  if(!p && p!==0) return '';
  const n = (typeof p==='number') ? p : Number(String(p).replace(/\./g,'').replace(',','.'));
  if(!isFinite(n) || n<=0) return '';
  return n.toFixed(2).replace('.',',');
}

// ---------- liste render ----------
function render(){
  el.tbody.innerHTML='';
  let sum=0;
  Object.entries(st.items).forEach(([code,qty])=>{
    sum += Number(qty)||0;
    const name = productMap[code]?.name || '—';
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${code}</td><td>${name}</td><td class="right">${qty}</td>
                    <td><button class="warn" onclick="delItem('${code}')">Sil</button></td>`;
    el.tbody.appendChild(tr);
  });
  el.totalRows.textContent = Object.keys(st.items).length;
  el.totalQty.textContent  = sum;
}
window.delItem = (c)=>{ delete st.items[c]; saveItems(); render(); };

function upsert(code, qty){
  if(!code) return;
  const n = Math.max(1, Number(qty)||1);
  st.items[code] = (Number(st.items[code])||0) + n;
  st.lastOp = { code, qty:n };
  saveItems(); render();
}
function undo(){
  const o=st.lastOp; if(!o) return;
  st.items[o.code] = (Number(st.items[o.code])||0) - o.qty;
  if(st.items[o.code]<=0) delete st.items[o.code];
  st.lastOp=null; saveItems(); render();
}
function saveItems(){ localStorage.setItem(SKEY_ITEMS, JSON.stringify(st.items)); }
function loadItems(){ try{ st.items = JSON.parse(localStorage.getItem(SKEY_ITEMS)||'{}'); }catch{} render(); }

// ---------- ürün bilgisi göster ----------
function showProductInfo(code){
  const p = productMap[code];
  if(p){
    el.pname.textContent = p.name || '—';
    el.pprice.textContent = p.price ? prettyPrice(p.price) : '—';
  }else{
    el.pname.textContent = 'Bulunamadı';
    el.pprice.textContent = '—';
  }
}

// ---------- ses ----------
function playOK(){ try{ el.okSound.currentTime=0; el.okSound.play(); }catch{} if(navigator.vibrate) navigator.vibrate(20); }
function playERR(){ try{ el.errSound.currentTime=0; el.errSound.play(); }catch{} if(navigator.vibrate) navigator.vibrate([20,30,20]); }

// ---------- kamera / tarama ----------
async function listCams(){
  try{
    const devs = await navigator.mediaDevices.enumerateDevices();
    const vids = devs.filter(d=>d.kind==='videoinput');
    el.cameraSelect.innerHTML='';
    vids.forEach((d,i)=>{
      const o=document.createElement('option');
      o.value=d.deviceId; o.textContent=d.label || `camera ${i+1}`;
      el.cameraSelect.appendChild(o);
    });
    const rear = vids.find(d=>/back|rear|arka/i.test(d.label||''));
    st.devId = rear?.deviceId || vids[0]?.deviceId || null;
    if(st.devId) el.cameraSelect.value = st.devId;
  }catch{}
}
el.cameraSelect.onchange = ()=>{ st.devId=el.cameraSelect.value; if(st.scanning) start(); };

async function start(){
  stop(); el.scanStatus.textContent='Açılıyor...';
  try{
    mediaStream = await navigator.mediaDevices.getUserMedia({
      video: st.devId ? {deviceId:{exact:st.devId}, width:{ideal:1920}, height:{ideal:1080}} :
                        {facingMode:{ideal:'environment'}, width:{ideal:1920}, height:{ideal:1080}},
      audio:false
    });
    el.video.srcObject = mediaStream; await el.video.play();
    st.scanning = true; el.scanStatus.textContent='Tarama aktif';
    runLoop(); fpsLoop();
  }catch(e){ el.scanStatus.textContent='Tarama başlatılamadı'; }
}
function stop(){
  cancelAnimationFrame(rafId); rafId=null; frames=0; el.fps.textContent='FPS: -';
  const s=el.video.srcObject; if(s?.getTracks) s.getTracks().forEach(t=>t.stop());
  el.video.srcObject=null; st.scanning=false; el.scanStatus.textContent='Durduruldu';
}

async function runLoop(){
  if(!('BarcodeDetector' in window)){ el.scanStatus.textContent='Desteklenmiyor'; return; }
  if(!detector) detector = new BarcodeDetector({formats:['ean_13','ean_8','code_128','code_39','itf','upc_a','upc_e']});
  if(!off){ off=document.createElement('canvas'); octx=off.getContext('2d',{willReadFrequently:true}); }

  const dup={code:null,until:0};
  const loop=async()=>{
    if(!st.scanning) return;
    frames++;
    const vw=el.video.videoWidth, vh=el.video.videoHeight;
    if(vw&&vh){
      const rw=Math.floor(vw*0.68), rh=Math.floor(vh*0.32);
      const rx=Math.floor((vw-rw)/2), ry=Math.floor((vh-rh)/2);
      off.width=rw; off.height=rh; octx.drawImage(el.video,rx,ry,rw,rh,0,0,rw,rh);
      try{
        const res = await detector.detect(off);
        if(res?.length){
          const text = (res[0].rawValue||'').trim();
          const now = performance.now();
          if(text && !(text===dup.code && now<dup.until)){
            dup.code=text; dup.until=now+1500;
            onCode(text);
          }
        }
      }catch{}
    }
    if(st.scanning) rafId = requestAnimationFrame(loop);
  };
  loop();
}
function fpsLoop(){
  let last=performance.now();
  const tick=()=>{ if(!st.scanning) return; const now=performance.now();
    if(now-last>=1000){ el.fps.textContent='FPS: '+frames; frames=0; last=now; }
    requestAnimationFrame(tick);
  }; tick();
}
function onCode(code){
  el.barcode.value = code;
  showProductInfo(code);
  if(productMap[code]) playOK(); else playERR();
  if(st.single){ stop(); el.btnScanOnce.disabled=true; el.btnScanOnce.textContent='Okundu ✓';
    setTimeout(()=>{ el.btnScanOnce.disabled=false; el.btnScanOnce.textContent='👉 Tek Okut'; },800);
    st.single=false;
  }
}

// ---------- GNCPULUF / CSV / JSON ayrıştırıcı ----------
function parseFileSmart(txt){
  const head = txt.slice(0,200).toUpperCase('tr-TR');

  // GNCPULUF mi? Başlıklara bak
  if( head.includes('(İSİM') || head.includes('(ISIM') || head.includes('(BARKOD') || head.includes('(FIYAT') || head.includes('(FİYAT')){
    return parseGNCPULUF(txt);
  }

  // JSON obje/array
  if( txt.trim().startsWith('{') || txt.trim().startsWith('[') ){
    const obj = JSON.parse(txt);
    const map={};
    if(Array.isArray(obj)){
      for(const r of obj){
        const code = String(r.barkod || r.kod || r.code || '').replace(/\s+/g,'');
        if(!code) continue;
        map[code] = {name: strip(r.isim || r.ad || r.name || ''), price: prettyPrice(r.fiyat || r.price || '')};
      }
    }else{
      for(const [k,v] of Object.entries(obj)){
        if(typeof v==='string') map[k] = {name: v, price:''};
        else map[k] = {name: v.isim||v.name||'', price: prettyPrice(v.fiyat||v.price||'')};
      }
    }
    return map;
  }

  // CSV/TXT: kod;isim;...;fiyat  — ; veya , ayırıcı
  return parseCSV(txt);
}

function parseCSV(txt){
  const lines = txt.split(/\r?\n/).filter(x=>x.trim().length);
  const sep = lines[0]?.includes(';') ? ';' : ',';
  const header = lines[0].toLowerCase('tr-TR');
  let iStart = 0;
  const map = {};

  // header’ı atla
  if( /kod|barkod|isim|ad|fiyat/.test(header) ) iStart=1;

  for(let i=iStart;i<lines.length;i++){
    const cols = lines[i].split(sep).map(s=>s.trim());
    const code = onlyDigits(cols[0]||'');
    if(!code) continue;
    const name = cols[1] || '';
    const price = prettyPrice((cols[2]||'').replace(/\s/g,''));
    map[code] = {name, price};
  }
  return map;
}

function parseGNCPULUF(txt){
  const lines = txt.split(/\r?\n/);

  // başlık satırını bul — sütun başlangıç indeksleri
  let nameCol=0, codeCol=0, priceCol=0;
  for(const L of lines.slice(0,30)){
    const u = toTR(L);
    if(u.includes('(İSİM')||u.includes('(ISIM')){
      nameCol = L.indexOf('(') >=0 ? L.indexOf('(') : 0;
    }
    if(u.includes('(BARKOD')){
      codeCol = L.indexOf('(') >=0 ? L.indexOf('(') : Math.max(codeCol,0);
    }
    if(u.includes('(FİYAT')||u.includes('(FIYAT')){
      priceCol = L.indexOf('(') >=0 ? L.indexOf('(') : Math.max(priceCol,0);
    }
  }
  // falls back if not found
  codeCol = Math.max(codeCol, nameCol + 20);
  priceCol = Math.max(priceCol, codeCol + 20);

  const map = {};
  let pendingName='', pendingPrice='';

  function seg(line, start, next){
    if(next<=start) return line.slice(start).trimEnd();
    return line.slice(start, next).trimEnd();
  }
  function pickPrice(s){
    // 1.234,56 | 27,00 gibi sağdan ilkini al
    const m = s.match(/\d{1,3}(?:\.\d{3})*,\d{2}|\d+,\d{2}/g);
    if(!m) return '';
    const v = m[m.length-1];
    return prettyPrice(v);
  }

  for(let i=0;i<lines.length;i++){
    const raw = lines[i]; if(!raw) continue;

    const namePart  = seg(raw, nameCol,  codeCol).trim();
    const codePart  = seg(raw, codeCol,  priceCol).trim();
    const pricePart = seg(raw, priceCol, raw.length).trim();

    if(namePart && !/^\(?(İ|I)S?İ?M\)?$/i.test(namePart) && !/^\-+$/.test(namePart)){
      pendingName = namePart;
    }

    // fiyat aynı satırda ya da bir-iki satır aşağıda olabilir
    let pr = pickPrice(pricePart);
    if(!pr && lines[i+1]) pr = pickPrice(seg(lines[i+1], priceCol, (lines[i+1]||'').length));
    if(pr) pendingPrice = pr;

    // barkod veya stok kodu (bazen 5 haneli de var)
    let digits = onlyDigits(codePart);
    if(!digits){
      // isim satırının hemen altındaki satırda olabilir
      const nxt = lines[i+1]||'';
      const maybe = seg(nxt, codeCol, priceCol);
      digits = onlyDigits(maybe);
    }

    if(digits){
      const isBarcode = /^\d{8,14}$/.test(digits);
      const isStock   = /^\d{3,7}$/.test(digits);
      if( (isBarcode || isStock) && pendingName ){
        map[digits] = { name: pendingName, price: pendingPrice };
        // aynı isim birkaç barkoda gelmesin diye adı sıfırlama
        pendingName='';
      }
    }
  }
  return map;
}

// ---------- ürün verisini yükle ----------
async function readFileAsText(file, encoding){
  // FileReader + encoding
  return await new Promise((res,rej)=>{
    const fr = new FileReader();
    fr.onload = ()=>res(fr.result);
    fr.onerror = rej;
    if(encoding && encoding!=='utf-8') fr.readAsText(file, encoding);
    else fr.readAsText(file);
  });
}
function rebuildSearchIndex(){
  normNameMap = {};
  for(const [k,v] of Object.entries(productMap)){
    normNameMap[k] = trFold(v.name||'');
  }
}
function setMap(map, srcName='dosya'){
  productMap = map || {};
  localStorage.setItem(SKEY_PMAP, JSON.stringify(productMap));
  localStorage.setItem(SKEY_PMAPSRC, srcName);
  el.mapStat.textContent = `${Object.keys(productMap).length} ürün yüklü`;
  rebuildSearchIndex();
  // yeni yüklenen veriyle varsa mevcut barkod kutusunu güncelle
  showProductInfo(el.barcode.value.trim());
}

$('#btnClearMap').onclick = ()=>{
  productMap={}; normNameMap={};
  localStorage.removeItem(SKEY_PMAP);
  localStorage.removeItem(SKEY_PMAPSRC);
  el.mapStat.textContent='0 ürün yüklü';
  showProductInfo('');
};

el.productFile.onchange = async (e)=>{
  const f = e.target.files?.[0]; if(!f) return;
  let txt='';
  try{
    txt = await readFileAsText(f, el.encSel.value);
  }catch{
    alert('Dosya okunamadı. Farklı kodlama ile deneyin.');
    return;
  }
  try{
    const map = parseFileSmart(txt);
    setMap(map, f.name);
    alert(`${Object.keys(map).length} ürün yüklendi (${f.name}).`);
  }catch(err){
    console.error(err);
    alert('Veri çözümlenemedi. CSV/TXT (kod;isim;…;fiyat), JSON veya GNCPULUF dosyası verin.');
  }
};

// ---------- arama ----------
el.search.addEventListener('input', ()=>{
  const q = trFold(el.search.value);
  el.searchList.innerHTML='';
  if(q.length<2) return;
  let shown=0;
  for(const [code,norm] of Object.entries(normNameMap)){
    if(norm.includes(q)){
      const p = productMap[code] || {};
      const div = document.createElement('div');
      div.className='searchItem click';
      div.innerHTML = `<strong>${p.name||'—'}</strong><div class="muted">${code} · ${p.price?prettyPrice(p.price):'—'}</div>`;
      div.onclick = ()=>{
        el.barcode.value = code;
        showProductInfo(code);
        playOK();
        el.qty.focus();
      };
      el.searchList.appendChild(div);
      if(++shown>=30) break;
    }
  }
});

// ---------- UI olaylar ----------
$('#btnStart').onclick = async()=>{ await listCams(); start(); };
$('#btnStop').onclick  = ()=> stop();
el.btnScanOnce.onclick = async()=>{ await listCams(); st.single=true; el.btnScanOnce.disabled=true; el.btnScanOnce.textContent='Okutuluyor...'; if(!st.scanning) await start(); else el.scanStatus.textContent='Tek seferlik okuma aktif'; };

el.btnMinus.onclick = ()=> el.qty.value = Math.max(1, Number(el.qty.value||1)-1);
el.btnPlus.onclick  = ()=> el.qty.value = Number(el.qty.value||1)+1;
el.btnUndo.onclick  = ()=> undo();

el.btnFieldClear.onclick = ()=>{ el.barcode.value=''; showProductInfo(''); el.barcode.focus(); };

el.btnOk.onclick = ()=>{
  // Tamam: barkod/koddan sonra miktara geç
  if(el.barcode.value.trim()){
    showProductInfo(el.barcode.value.trim());
    if(productMap[el.barcode.value.trim()]) playOK(); else playERR();
    el.qty.focus(); el.qty.select();
  }else{
    el.barcode.focus();
  }
};

// miktar kutusuna tıklayınca 1'i seç — direkt yazsın
el.qty.addEventListener('focus', e=>{ e.target.select(); });

// Enter davranışları
el.barcode.addEventListener('keydown', e=>{
  if(e.key==='Enter'){ e.preventDefault(); el.btnOk.click(); }
});
el.qty.addEventListener('keydown', e=>{
  if(e.key==='Enter'){ e.preventDefault(); el.btnAdd.click(); }
});

// Elle yazarken de anlık bilgi göster
el.barcode.addEventListener('input', ()=>{
  const code = onlyDigits(el.barcode.value);
  if(code.length>=3) showProductInfo(code);
});

// Ekle
el.btnAdd.onclick = ()=>{
  const code = onlyDigits(el.barcode.value);
  if(!code){ playERR(); return; }
  upsert(code, el.qty.value);
  el.barcode.value=''; el.qty.value=1; showProductInfo('');
  el.barcode.focus(); playOK();
};

// dışa aktar
$('#btnExport').onclick = ()=>{
  const lines = Object.entries(st.items).map(([c,q])=>`${c};${q}`);
  const name = (el.filename.value||'sayim')+'.txt';
  const blob = new Blob([lines.join('\n')], {type:'text/plain'});
  const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=name; a.click(); URL.revokeObjectURL(a.href);
};
$('#btnCSV').onclick = ()=>{
  const lines = ['barkod,adet', ...Object.entries(st.items).map(([c,q])=>`${c},${q}`)];
  const name = (el.filename.value||'sayim')+'.csv';
  const blob = new Blob([lines.join('\n')], {type:'text/csv'});
  const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=name; a.click(); URL.revokeObjectURL(a.href);
};
$('#btnClear').onclick = ()=>{
  if(confirm('Listeyi temizlemek istiyor musun?')){
    st.items={}; saveItems(); render();
  }
};

// ---------- başlangıç ----------
(function init(){
  try{
    const m = JSON.parse(localStorage.getItem(SKEY_PMAP)||'{}');
    if(m && Object.keys(m).length){ productMap=m; el.mapStat.textContent=`${Object.keys(productMap).length} ürün yüklü`; rebuildSearchIndex(); }
  }catch{}
  loadItems();
  listCams();
})();
