/* Genç GROSS – Mobil Terminal (offline + kalıcı veri) */

const SKEY_DB = 'gg_productDB_v2';
const SKEY_LIST = 'gg_items_v2';

const els = {
  video: document.getElementById('video'),
  selCam: document.getElementById('cameraSelect'),
  btnStart: document.getElementById('btnStart'),
  btnStop: document.getElementById('btnStop'),
  btnOneShot: document.getElementById('btnOneShot'),
  status: document.getElementById('scanStatus'),
  tech: document.getElementById('tech'),
  fps: document.getElementById('fps'),

  barcode: document.getElementById('barcode'),
  btnManualOk: document.getElementById('btnManualOk'),
  btnClearCode: document.getElementById('btnClearCode'),
  qty: document.getElementById('qty'),
  btnPlus: document.getElementById('btnPlus'),
  btnMinus: document.getElementById('btnMinus'),
  btnAdd: document.getElementById('btnAdd'),
  btnUndo: document.getElementById('btnUndo'),

  pName: document.getElementById('pName'),
  pPrice: document.getElementById('pPrice'),
  filename: document.getElementById('filename'),

  btnExport: document.getElementById('btnExport'),
  btnCSV: document.getElementById('btnCSV'),
  btnClearList: document.getElementById('btnClearList'),

  fileInput: document.getElementById('fileInput'),
  dbCount: document.getElementById('dbCount'),
  btnClearDB: document.getElementById('btnClearDB'),

  tbody: document.getElementById('tbody'),
  totalRows: document.getElementById('totalRows'),
  totalQty: document.getElementById('totalQty'),

  ok: document.getElementById('beepOk'),
  err: document.getElementById('beepErr'),
};

let productDB = loadJSON(SKEY_DB, {});              // { barcode: {name, price} }
let items = loadJSON(SKEY_LIST, {});                // { barcode: qty }
let lastOp = null;                                  // undo
renderList();
updateDBCount();

let scanning = false, mediaStream = null, detector = null, rafId = null;

/* ---------- Yardımcılar ---------- */
function loadJSON(key, fallback){
  try{ const j = localStorage.getItem(key); return j? JSON.parse(j): fallback; }
  catch{ return fallback; }
}
function saveJSON(key, obj){ localStorage.setItem(key, JSON.stringify(obj)); }

function play(el){ try{ el.currentTime = 0; el.play(); }catch{} }

function formatPrice(p){
  // "11,90" | "11.90" | " 11 , 90 " -> "11,90"
  if(p==null) return "";
  const s = String(p).replace(/\s+/g,'').replace(',', '.');
  const n = Number(s);
  if(isNaN(n)) return "";
  return n.toFixed(2).replace('.', ',');
}

function parseProductFile(text){
  // Tek satır -> barkod;isim;fiyat | CSV; gereksiz boş satırları at, tekrarı ele.
  const seen = new Set();
  const out = {};
  const lines = text.replace(/\r/g,'\n').split('\n');
  for(let raw of lines){
    if(!raw) continue;
    const line = raw.trim();
    if(!line) continue;
    // CSV virgül/; karışık olabilir, önce ; ile deneyelim
    let parts = line.split(';');
    if(parts.length < 2){ parts = line.split(','); } // bazı çıktılar virgül ayraçlı
    if(parts.length < 2) continue;

    let [code,name,price] = parts;
    if(!code) continue;
    code = code.replace(/[^0-9]/g,'');     // barkod sadece rakamlar
    if(!code) continue;

    if(seen.has(code)) continue;
    seen.add(code);

    name = (name||'').toString().trim();
    // fiyat sayıya dönüşecek şekilde normalize
    let pr = null;
    if(parts.length >= 3){
      const s = String(price).replace(/\s+/g,'').replace(',', '.');
      const n = Number(s);
      if(!isNaN(n)) pr = n;               // sayı ise kaydet
    }
    out[code] = { name, price: pr };      // pr null olabilir
  }
  return out;
}

function lookup(code){
  const p = productDB[code];
  if(p){
    els.pName.textContent = p.name || '—';
    els.pPrice.textContent = (p.price!=null)? formatPrice(p.price) : '—';
  }else{
    els.pName.textContent = 'Ürün bulunamadı';
    els.pPrice.textContent = '—';
  }
}

function renderList(){
  els.tbody.innerHTML = '';
  let sum = 0;
  Object.entries(items).forEach(([c,q])=>{
    sum += Number(q)||0;
    const tr = document.createElement('tr');
    const name = productDB[c]?.name || '';
    tr.innerHTML = `
      <td>${c}</td>
      <td>${name}</td>
      <td class="right">${q}</td>
      <td class="right"><button data-del="${c}">Sil</button></td>`;
    els.tbody.appendChild(tr);
  });
  els.totalRows.textContent = Object.keys(items).length;
  els.totalQty.textContent = sum;
}
els.tbody.addEventListener('click', (e)=>{
  const c = e.target.getAttribute('data-del');
  if(!c) return;
  delete items[c];
  saveJSON(SKEY_LIST, items);
  renderList();
});

function addItem(code, qty){
  if(!code) return;
  const n = Math.max(1, Number(qty)||1);
  items[code] = (Number(items[code])||0) + n;
  lastOp = {code, qty:n};
  saveJSON(SKEY_LIST, items);
  renderList();
}

function undo(){
  if(!lastOp) return;
  const {code, qty} = lastOp;
  items[code] = (Number(items[code])||0) - qty;
  if(items[code] <= 0) delete items[code];
  lastOp = null;
  saveJSON(SKEY_LIST, items);
  renderList();
}

function updateDBCount(){
  els.dbCount.textContent = `${Object.keys(productDB).length} ürün yüklü`;
}

/* ---------- Dışa aktarma ---------- */
function download(name, content, type){
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([content], {type}));
  a.download = name;
  a.click(); URL.revokeObjectURL(a.href);
}
function exportTXT(){
  const name = (els.filename.value || 'sayim') + '.txt';
  const lines = Object.entries(items).map(([c,q])=>`${c};${q}`);
  download(name, lines.join('\n'), 'text/plain');
}
function exportCSV(){
  const name = (els.filename.value || 'sayim') + '.csv';
  const lines = ['barkod,isim,adet', ...Object.entries(items).map(([c,q])=>{
    const nm = productDB[c]?.name || '';
    return `${c},${nm},${q}`;
  })];
  download(name, lines.join('\n'), 'text/csv');
}

/* ---------- Kamera / BarcodeDetector ---------- */
async function listCameras(){
  try{
    const devices = await navigator.mediaDevices.enumerateDevices();
    const cams = devices.filter(d=>d.kind==='videoinput');
    els.selCam.innerHTML = '';
    cams.forEach((d,i)=>{
      const o = document.createElement('option');
      o.value = d.deviceId;
      o.textContent = d.label || `camera ${i+1}`;
      els.selCam.appendChild(o);
    });
    // arka kamera öncelik
    const rear = cams.find(d=>/back|rear|arka/i.test(d.label||''));
    els.selCam.value = rear?.deviceId || cams[0]?.deviceId || '';
  }catch{}
}
function stopCam(){
  scanning = false;
  cancelAnimationFrame(rafId); rafId=null;
  const s = els.video.srcObject; if(s?.getTracks) s.getTracks().forEach(t=>t.stop());
  els.video.srcObject = null;
  els.status.textContent = 'Durduruldu';
  els.fps.textContent = 'FPS: -';
}
async function startCam(){
  stopCam();
  els.status.textContent = 'Kamera açılıyor...';
  try{
    const devId = els.selCam.value;
    const stream = await navigator.mediaDevices.getUserMedia({
      video: devId? {deviceId:{exact:devId}, width:{ideal:1920}, height:{ideal:1080}, focusMode:'continuous'}
                   : {facingMode:'environment', width:{ideal:1920}, height:{ideal:1080}, focusMode:'continuous'},
      audio:false
    });
    els.video.srcObject = stream; await els.video.play();
    scanning = true;
    els.status.textContent = 'Tarama aktif';
    els.tech.textContent = 'Motor: BarcodeDetector';
    if(!detector) detector = new BarcodeDetector({formats:['ean_13','ean_8','code_128','code_39','itf','upc_e','upc_a']});
    runLoop();
    fpsCounter();
  }catch(e){
    els.status.textContent = 'Tarama başlatılamadı';
  }
}
function fpsCounter(){
  let frames=0, last=performance.now();
  const tick=()=>{ if(!scanning) return;
    frames++;
    const now=performance.now();
    if(now-last>=1000){ els.fps.textContent='FPS: '+frames; frames=0; last=now; }
    requestAnimationFrame(tick);
  };
  tick();
}
function codeCame(text, isManual=false){
  const code = String(text||'').replace(/[^0-9]/g,'');
  if(!code) return;
  els.barcode.value = code;
  lookup(code);
  // ses: bulundu mu?
  if(productDB[code]) play(els.ok); else play(els.err);
  if(isManual){ els.qty.focus(); els.qty.select(); }
}
function runLoop(){
  const off = document.createElement('canvas');
  const ctx = off.getContext('2d', {willReadFrequently:true});
  const loop = async ()=>{
    if(!scanning) return;
    const vw = els.video.videoWidth, vh = els.video.videoHeight;
    if(vw&&vh){
      const rw = Math.floor(vw*0.70), rh = Math.floor(vh*0.32);
      const rx = Math.floor((vw-rw)/2), ry = Math.floor((vh-rh)/2);
      off.width=rw; off.height=rh;
      ctx.drawImage(els.video, rx,ry,rw,rh, 0,0,rw,rh);
      try{
        const det = await detector.detect(off);
        if(det && det.length){
          codeCame(det[0].rawValue);
          // Tek-Okut modunda otomatik durdur
          if(oneShot){ stopCam(); oneShot=false; }
        }
      }catch{}
    }
    rafId = requestAnimationFrame(loop);
  };
  loop();
}

let oneShot = false;

/* ---------- Etkileşimler ---------- */
els.btnStart.onclick = async()=>{ await listCameras(); startCam(); };
els.btnStop.onclick = ()=> stopCam();
els.btnOneShot.onclick = async()=>{ oneShot=true; await listCameras(); startCam(); };

els.btnPlus.onclick = ()=> els.qty.value = Math.max(1,(Number(els.qty.value)||1)+1);
els.btnMinus.onclick = ()=> els.qty.value = Math.max(1,(Number(els.qty.value)||1)-1);

els.btnManualOk.onclick = ()=> codeCame(els.barcode.value, true);
els.btnClearCode.onclick = ()=>{ els.barcode.value=''; els.pName.textContent='—'; els.pPrice.textContent='—'; els.barcode.focus(); };
els.barcode.addEventListener('keydown', e=>{ if(e.key==='Enter'){ e.preventDefault(); els.btnManualOk.click(); }});
els.qty.addEventListener('keydown', e=>{ if(e.key==='Enter'){ e.preventDefault(); els.btnAdd.click(); }});

els.btnAdd.onclick = ()=>{
  const code = els.barcode.value.trim();
  const qty = els.qty.value;
  if(!code) return;
  addItem(code, qty);
  els.barcode.value='';
  els.qty.value=1;
  els.pName.textContent='—'; els.pPrice.textContent='—';
  els.barcode.focus();
};
els.btnUndo.onclick = ()=> undo();

els.btnExport.onclick = ()=> exportTXT();
els.btnCSV.onclick = ()=> exportCSV();
els.btnClearList.onclick = ()=>{ if(confirm('Listeyi temizlemek istiyor musun?')){ items={}; saveJSON(SKEY_LIST,items); renderList(); } };

/* ---------- Ürün verisi yükleme ---------- */
els.fileInput.onchange = async(e)=>{
  const f = e.target.files?.[0];
  if(!f) return;
  const text = await f.text();
  const parsed = parseProductFile(text);
  productDB = parsed;                // dosyadaki temiz set
  saveJSON(SKEY_DB, productDB);
  updateDBCount();
  // mevcut barkod alanı doluysa anında göster
  if(els.barcode.value) lookup(els.barcode.value);
};
els.btnClearDB.onclick = ()=>{ if(confirm('Ürün verisini sil?')){ productDB={}; saveJSON(SKEY_DB, productDB); updateDBCount(); } };

/* İlk yüklemede sayı klavyesi gelsin */
els.barcode.setAttribute('inputmode','numeric');
els.barcode.setAttribute('pattern','[0-9]*');
