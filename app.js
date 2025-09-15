/* ==== Sesler ==== */
const Sounds = {
  beep: new Audio('beep.ogg'),
  accepted: new Audio('accepted.ogg'),
  error: new Audio('error.ogg'),
  // Depodaki dosya ismi 'unkown.ogg' olduğu için ona göre kullanıyoruz:
  unknown: new Audio('unkown.ogg'),
};
let audioReady = false;
function prepareAudioOnce() {
  if (audioReady) return;
  Object.values(Sounds).forEach(a => { a.preload = 'auto'; a.load?.(); });
  audioReady = true;
}
document.addEventListener('pointerdown', prepareAudioOnce, { once: true });

/* ==== Elemanlar ==== */
const barcodeInput = document.getElementById('barcodeInput');
const qtyInput     = document.getElementById('qtyInput');
const lastInfo     = document.getElementById('lastInfo');
const lastInfoName = lastInfo.querySelector('.li-name');
const lastInfoPrice= lastInfo.querySelector('.li-price');

const searchInput  = document.getElementById('searchInput');
const searchList   = document.getElementById('searchList');
const searchCount  = document.getElementById('searchCount');

const alertsEl     = document.getElementById('alerts');

const unknownModal = document.getElementById('unknownModal');
const unknownOk    = document.getElementById('unknownOk');
const unknownCancel= document.getElementById('unknownCancel');
const unknownMeta  = document.getElementById('unknownMeta');

const torchBtn     = document.getElementById('torchBtn');
const videoEl      = document.getElementById('video');

let cameraStream = null;
let torchOn = false;
let mode = 'manual';

/* ==== VERİ ==== */
let PRODUCTS = []; // [{barcode:'869...', name:'...', price:'...'}]

/* ==== Yardımcılar ==== */
const onlyDigits = s => /^[0-9]+$/.test(s);
function showAlert(msg) { alertsEl.textContent = msg || ''; }
function clearAlert()   { alertsEl.textContent = ''; }
function updateLastInfo({ name, price }) {
  lastInfoName.textContent  = name || '(TANIMSIZ ÜRÜN)';
  lastInfoPrice.textContent = (price ?? '') === '' ? '' : String(price);
}
function findProduct(barcode) {
  return PRODUCTS.find(p => p.barcode === barcode) || null;
}

/* ==== Kamera ==== */
async function startCamera(){
  prepareAudioOnce();
  mode = 'camera';
  try{
    cameraStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' }, width:{ideal:1280}, height:{ideal:720}, frameRate:{ideal:30,max:30} },
      audio: false
    });
    videoEl.srcObject = cameraStream;
    await videoEl.play();
    barcodeInput.blur(); qtyInput.blur(); // klavye kapalı
    clearAlert();
  }catch(e){ showAlert('Kamera açılamadı: '+e.message); }
}
function stopCamera(){
  mode = 'manual';
  if (cameraStream){ cameraStream.getTracks().forEach(t=>t.stop()); cameraStream=null; }
}

/* ==== Torch ==== */
async function toggleTorch(){
  try{
    if (!cameraStream) return showAlert('Kamera kapalı.');
    const track = cameraStream.getVideoTracks()[0];
    const caps = track.getCapabilities?.();
    if (caps && caps.torch){
      torchOn = !torchOn;
      await track.applyConstraints({ advanced: [{ torch: torchOn }]});
      clearAlert();
    } else { showAlert('Bu cihazda flaş desteklenmiyor.'); }
  }catch(e){ showAlert('Flaş hata: '+e.message); }
}
torchBtn?.addEventListener('click', toggleTorch);

/* ==== Listeye ekleme ==== */
function addToList({ barcode, qty }){
  const prod = findProduct(barcode);
  // TODO: kendi ekleme fonksiyonunu çağır:
  // upsertCartRow(barcode, prod?.name ?? '(TANIMSIZ ÜRÜN)', prod?.price ?? '', qty);

  Sounds.accepted.currentTime = 0; Sounds.accepted.play().catch(()=>{});
  updateLastInfo({ name: (prod?.name ?? '(TANIMSIZ ÜRÜN)'), price: (prod?.price ?? '') });
}

/* ==== Tanımsız Onay ==== */
function askUnknownConfirm({ barcode, qty, onConfirm }){
  Sounds.unknown.currentTime = 0; Sounds.unknown.play().catch(()=>{});
  unknownMeta.textContent = `Barkod: ${barcode} • Adet: ${qty}`;
  unknownModal.classList.remove('hidden');

  const close = () => unknownModal.classList.add('hidden');
  function ok(){ close(); onConfirm?.(); }
  function cancel(){ close(); barcodeInput.focus(); barcodeInput.select?.(); }
  unknownOk.onclick = ok; unknownCancel.onclick = cancel;
  unknownModal.onkeydown = (ev)=>{ if (ev.key === 'Escape') cancel(); };
}

/* ==== Enter / Git Akışı ==== */
// Barkod Enter → numerikse Adet
barcodeInput.addEventListener('keydown', (ev)=>{
  if (ev.key !== 'Enter') return;
  const val = barcodeInput.value.trim();
  if (!onlyDigits(val)){
    Sounds.error.currentTime=0; Sounds.error.play().catch(()=>{});
    showAlert('Sadece sayısal barkod girin.');
    return;
  }
  clearAlert(); ev.preventDefault();
  qtyInput.focus(); qtyInput.select?.();
});

// Adet Enter → ekle; tanımsızsa onay
qtyInput.addEventListener('keydown', (ev)=>{
  if (ev.key !== 'Enter') return;
  ev.preventDefault();

  const barcode = barcodeInput.value.trim();
  let qty = (qtyInput.value || '1').trim();

  if (!onlyDigits(barcode)){
    Sounds.error.currentTime=0; Sounds.error.play().catch(()=>{});
    showAlert('Geçersiz barkod (sadece rakam).');
    barcodeInput.focus(); barcodeInput.select?.();
    return;
  }
  if (!onlyDigits(qty) || qty === '0'){ qty = '1'; }

  const prod = findProduct(barcode);
  if (prod){
    addToList({ barcode, qty: Number(qty) });
    barcodeInput.value=''; qtyInput.value='1';
    barcodeInput.focus(); barcodeInput.select?.();
    clearAlert();
  } else {
    askUnknownConfirm({
      barcode, qty: Number(qty),
      onConfirm: ()=>{
        addToList({ barcode, qty: Number(qty) });
        barcodeInput.value=''; qtyInput.value='1';
        barcodeInput.focus(); barcodeInput.select?.();
        clearAlert();
      }
    });
  }
});

/* ==== Liste içi adet düzenleme: Enter ==== */
document.addEventListener('keydown', (ev)=>{
  if (ev.key !== 'Enter') return;
  const el = ev.target;
  if (!(el instanceof HTMLInputElement)) return;
  if (!el.classList.contains('row-qty')) return;

  ev.preventDefault();
  const newVal = el.value.trim();
  if (!onlyDigits(newVal) || newVal === '0'){
    Sounds.error.currentTime=0; Sounds.error.play().catch(()=>{});
  } else {
    // TODO: updateRowQuantity(rowId, Number(newVal));
    Sounds.accepted.currentTime=0; Sounds.accepted.play().catch(()=>{});
  }
  barcodeInput.focus(); barcodeInput.select?.();
});

/* ==== Kamera decode sonucu (kendi decoder’ından çağır) ==== */
async function onDecode(barcode){
  prepareAudioOnce();
  if (!onlyDigits(barcode)) { Sounds.error.currentTime=0; Sounds.error.play().catch(()=>{}); return; }
  const prod = findProduct(barcode);
  if (prod){ addToList({ barcode, qty:1 }); }
  else {
    askUnknownConfirm({ barcode, qty:1, onConfirm: ()=> addToList({ barcode, qty:1 }) });
  }
  // kamera modunda hiçbir inputa focus verme
}

/* ==== Arama: 50 → +50 ==== */
let searchResults = [];
function renderSearchChunk(start, count=50){
  const end = Math.min(start+count, searchResults.length);
  const frag = document.createDocumentFragment();
  for (let i=start;i<end;i++){
    const p = searchResults[i];
    const row = document.createElement('div'); row.className = 'result-row';

    const name = document.createElement('div'); name.className='r-name'; name.textContent = p.name || '(TANIMSIZ ÜRÜN)';
    const price= document.createElement('div'); price.className='r-price'; if (p.price) price.textContent = p.price;
    const bar  = document.createElement('div'); bar.className='r-bar';   bar.textContent = p.barcode;

    const left = document.createElement('div'); left.appendChild(name); left.appendChild(bar);
    row.appendChild(left); row.appendChild(price);
    frag.appendChild(row);
  }
  searchList.appendChild(frag);
  searchList.dataset.page = String((+searchList.dataset.page) + 1);
}
function doSearch(q){
  const t = (q||'').toLocaleLowerCase('tr-TR').trim();
  searchList.innerHTML=''; searchList.dataset.page='0';
  if (!t){ searchResults = []; searchCount.textContent=''; return; }
  searchResults = PRODUCTS.filter(p => (p.name||'').toLocaleLowerCase('tr-TR').includes(t));
  searchCount.textContent = `${searchResults.length} sonuç`;
  renderSearchChunk(0, 50);
}
searchInput.addEventListener('input', debounce(()=> doSearch(searchInput.value), 300));
searchList.addEventListener('scroll', ()=>{
  const atBottom = (searchList.scrollTop + searchList.clientHeight) / (searchList.scrollHeight || 1) > 0.8;
  if (!atBottom) return;
  const page = +searchList.dataset.page || 0;
  const nextStart = page * 50;
  if (nextStart < searchResults.length){ renderSearchChunk(nextStart, 50); }
});
function debounce(fn, ms){ let t; return (...a)=>{ clearTimeout(t); t=setTimeout(()=>fn(...a), ms); }; }

/* ==== Ses tuşları iptal ==== */
window.removeEventListener?.('keydown', window.__volumeKeyHandler__);
window.__volumeKeyHandler__ = undefined;

/* ==== Dışarıdan erişim ==== */
window.GG = { startCamera, stopCamera, onDecode, setProducts:(arr)=>{ PRODUCTS = arr||[]; } };
