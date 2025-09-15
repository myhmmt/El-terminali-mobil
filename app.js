/* ========== SESLER ========== */
const Sounds = {
  beep: new Audio('beep.ogg'),          // kullanmıyoruz ama dursun
  accepted: new Audio('accepted.ogg'),  // ekleme/onay
  error: new Audio('error.ogg')         // tanımsız uyarısı + hatalar
};
let audioReady = false;
function prepareAudioOnce() {
  if (audioReady) return;
  Object.values(Sounds).forEach(a => { a.preload = 'auto'; a.load?.(); });
  audioReady = true;
}
document.addEventListener('pointerdown', prepareAudioOnce, { once: true });

/* ========== ELEMANLAR ========== */
const barcodeInput = document.getElementById('barcodeInput');
const qtyInput     = document.getElementById('qtyInput');
const lastInfo     = document.getElementById('lastInfo');
const lastInfoName = lastInfo.querySelector('.li-name');
const lastInfoPrice= lastInfo.querySelector('.li-price');

const fileInput    = document.getElementById('fileInput');
const datasetBadge = document.getElementById('datasetBadge');

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
const startBtn     = document.getElementById('startBtn');
const stopBtn      = document.getElementById('stopBtn');
const singleBtn    = document.getElementById('singleBtn');

let cameraStream = null;
let torchOn = false;
let singleShot = false;
let mode = 'manual'; // 'manual' | 'camera'

/* ========== VERİ ========== */
let PRODUCTS = JSON.parse(localStorage.getItem('GG_PRODUCTS')||'[]'); // [{barcode,name,price}]
let CART     = JSON.parse(localStorage.getItem('GG_CART')||'[]');     // [{barcode,name,price,qty}]

/* ========== YARDIMCILAR ========== */
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

/* ========== KAMERA ========== */
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
    // Kamera modunda klavye açılmasın:
    barcodeInput.blur(); qtyInput.blur();
    clearAlert();
  }catch(e){ showAlert('Kamera açılamadı: '+e.message); }
}
function stopCamera(){
  mode = 'manual';
  if (cameraStream){ cameraStream.getTracks().forEach(t=>t.stop()); cameraStream=null; }
}

/* Flaş */
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

/* ========== DOSYA YÜKLEME ========== */
fileInput?.addEventListener('change', async (e)=>{
  const f = e.target.files?.[0]; if (!f) return;
  const text = await f.text();
  const lines = text.split(/\r?\n/).filter(Boolean);
  const data = [];
  for (const ln of lines){
    let bc='', name='', price='';
    if (ln.includes(';')) {
      const parts = ln.split(';');
      [bc, name, price] = [parts[0], parts[1]||'', parts[2]||''];
    } else if (ln.includes('—') || ln.includes('-')) {
      const parts = ln.split(/—|-/).map(s=>s.trim());
      if (parts.length>=2){ name = parts[0]; bc = parts[1]; price = parts[2]||''; }
    } else {
      const m = ln.match(/(\d{8}|\d{13})/);
      if (m){ bc = m[0]; name = ln.replace(bc,'').trim(); }
    }
    bc = (bc||'').replace(/\D/g,''); // yalnız rakam
    if (!bc) continue;
    data.push({ barcode: bc, name, price });
  }
  PRODUCTS = data;
  localStorage.setItem('GG_PRODUCTS', JSON.stringify(PRODUCTS));
  datasetBadge.textContent = `${f.name} • ${data.length} ürün yüklendi`;
  updateLastInfo({ name: '(veri yüklendi)', price: '' });
  try { Sounds.accepted.currentTime=0; Sounds.accepted.play(); } catch {}
});

/* ========== LİSTE (CART) ========== */
const cartList = document.getElementById('cartList');

function saveCart(){ localStorage.setItem('GG_CART', JSON.stringify(CART)); }

function renderCart(){
  cartList.innerHTML = '';
  const frag = document.createDocumentFragment();
  for (const it of CART){
    const row = document.createElement('div'); row.className='row';

    const cbar = document.createElement('div'); cbar.className='c-bar'; cbar.textContent = it.barcode;
    const cname= document.createElement('div'); cname.className='c-name'; cname.textContent = it.name || '(TANIMSIZ ÜRÜN)';
    const cprice=document.createElement('div'); cprice.className='c-price'; if (it.price) cprice.textContent = it.price;

    const cqty = document.createElement('input'); cqty.type='text'; cqty.value=String(it.qty); cqty.className='in numeric row-qty';
    cqty.style.width='72px';
    cqty.addEventListener('change', ()=>{
      const v = cqty.value.trim();
      if (!onlyDigits(v) || v==='0'){ cqty.value = String(it.qty); try{Sounds.error.currentTime=0;Sounds.error.play();}catch{}; return; }
      it.qty = Number(v); saveCart();
    });
    cqty.addEventListener('keydown', (ev)=>{
      if (ev.key!=='Enter') return;
      ev.preventDefault();
      const v = cqty.value.trim();
      if (!onlyDigits(v) || v==='0'){ try{Sounds.error.currentTime=0;Sounds.error.play();}catch{}; return; }
      it.qty = Number(v); saveCart();
      try{Sounds.accepted.currentTime=0;Sounds.accepted.play();}catch{}
      barcodeInput.focus(); barcodeInput.select?.();
    });

    const actions = document.createElement('div'); actions.className='c-actions';
    const del = document.createElement('button'); del.className='btn ghost'; del.textContent='Sil';
    del.addEventListener('click', ()=>{
      const i = CART.findIndex(x=>x.barcode===it.barcode);
      if (i>-1){ CART.splice(i,1); saveCart(); renderCart(); }
    });
    actions.appendChild(del);

    row.appendChild(cbar);
    row.appendChild(cname);
    row.appendChild(cqty);
    row.appendChild(actions);
    frag.appendChild(row);
  }
  cartList.appendChild(frag);
}
renderCart();

function addToList({ barcode, qty }){
  const prod = findProduct(barcode);
  const name = prod?.name ?? '(TANIMSIZ ÜRÜN)';
  const price = prod?.price ?? '';
  const ex = CART.find(x=>x.barcode===barcode);
  if (ex){ ex.qty += qty; }
  else   { CART.push({ barcode, name, price, qty }); }
  saveCart(); renderCart();
  updateLastInfo({ name, price });
  try{ Sounds.accepted.currentTime=0; Sounds.accepted.play(); }catch{}
}

/* ========== TANIMSIZ ONAY (error.ogg çalar) ========== */
function askUnknownConfirm({ barcode, qty, onConfirm }){
  try{ Sounds.error.currentTime=0; Sounds.error.play(); }catch{}  // isteğin: ürünü bulamayınca error çalsın
  unknownMeta.textContent = `Barkod: ${barcode} • Adet: ${qty}`;
  unknownModal.classList.remove('hidden');

  const close = () => unknownModal.classList.add('hidden');
  function ok(){ close(); onConfirm?.(); }
  function cancel(){ close(); barcodeInput.focus(); barcodeInput.select?.(); }

  unknownOk.onclick = ok;
  unknownCancel.onclick = cancel;
  unknownModal.onkeydown = (ev)=>{ if (ev.key==='Escape') cancel(); };
}

/* ========== ENTER / GİT AKIŞI ========== */
// Barkod Enter → numerikse Adet
barcodeInput.addEventListener('keydown', (ev)=>{
  if (ev.key !== 'Enter') return;
  const val = barcodeInput.value.trim();
  if (!onlyDigits(val)){
    try{ Sounds.error.currentTime=0; Sounds.error.play(); }catch{};
    showAlert('Sadece sayısal barkod girin.');
    return;
  }
  clearAlert(); ev.preventDefault();
  qtyInput.focus(); qtyInput.select?.();
});

// Adet Enter → ekle; tanımsızsa onay (error.ogg çalar)
qtyInput.addEventListener('keydown', (ev)=>{
  if (ev.key !== 'Enter') return;
  ev.preventDefault();

  const barcode = barcodeInput.value.trim();
  let qty = (qtyInput.value || '1').trim();

  if (!onlyDigits(barcode)){
    try{ Sounds.error.currentTime=0; Sounds.error.play(); }catch{};
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

/* ========== KAMERA DECODE (kendi kütüphanenden başarıda bunu çağır) ========== */
async function onDecode(barcode){
  prepareAudioOnce();
  if (!onlyDigits(barcode)) { try{Sounds.error.currentTime=0;Sounds.error.play();}catch{}; return; }
  const prod = findProduct(barcode);
  if (prod){
    addToList({ barcode, qty: 1 });
  } else {
    askUnknownConfirm({ barcode, qty:1, onConfirm: ()=> addToList({ barcode, qty:1 }) });
  }
  if (singleShot){ singleShot=false; stopCamera(); }
  // Kamera modunda inputa focus verme (klavye açılmasın)
}

/* ========== ARAMA: 50 → +50; TR uyumlu; fiyat kırmızı, yoksa boş ========== */
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
function debounce(fn, ms){ let t; return (...a)=>{ clearTimeout(t); t=setTimeout(()=>fn(...a), ms); }; }
searchInput.addEventListener('input', debounce(()=> doSearch(searchInput.value), 300));
searchList.addEventListener('scroll', ()=>{
  const atBottom = (searchList.scrollTop + searchList.clientHeight) / (searchList.scrollHeight || 1) > 0.8;
  if (!atBottom) return;
  const page = +searchList.dataset.page || 0;
  const nextStart = page * 50;
  if (nextStart < searchResults.length){ renderSearchChunk(nextStart, 50); }
});

/* ========== KAMERA BUTONLARI ========== */
startBtn?.addEventListener('click', async ()=>{ prepareAudioOnce(); await startCamera(); });
stopBtn ?.addEventListener('click', ()=>{ stopCamera(); });
singleBtn?.addEventListener('click', async ()=>{ prepareAudioOnce(); singleShot=true; await startCamera(); });

/* ========== Ses tuşları iptal (varsa eski dinleyicileri kapat) ========== */
window.removeEventListener?.('keydown', window.__volumeKeyHandler__); window.__volumeKeyHandler__=undefined;

/* ========== DIŞA AÇ ========== */
window.GG = {
  startCamera, stopCamera, onDecode,
  setProducts:(arr)=>{ PRODUCTS = arr||[]; localStorage.setItem('GG_PRODUCTS', JSON.stringify(PRODUCTS)); }
};
