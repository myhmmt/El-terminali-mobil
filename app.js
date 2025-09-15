/* =======================
   GENÇ GROSS · Mobil Terminal
   Android odaklı PWA, arka kamera, tek okut, 2 sn tarama, offline, TXT/PDF export
   ======================= */

const state = {
  stream: null,
  scanning: false,
  singleMode: false,
  scanTimer: null,
  items: [],        // {barcode, name, price, qty}
  products: {},     // barcode -> {name, price}
  filename: "",
};

// ======= Yardımcılar
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

const beep = $("#beep");
const errS = $("#error");
const video = $("#video");
const foundInfo = $("#foundInfo");
const offlineState = $("#offlineState");

const barcodeInput = $("#barcodeInput");
const qtyInput = $("#qtyInput");
const filenameInput = $("#filenameInput");
const itemsBody = $("#itemsBody");
const productCount = $("#productCount");
const searchInput = $("#searchInput");
const searchResult = $("#searchResult");

// Türkçe-insensitive normalize
function trFold(s) {
  if (!s) return "";
  const map = { 'I':'i','İ':'i','ı':'i','Ş':'s','ş':'s','Ğ':'g','ğ':'g','Ü':'u','ü':'u','Ö':'o','ö':'o','Ç':'c','ç':'c' };
  return s.split("").map(ch => map[ch] ?? ch).join("").toLowerCase();
}

// LocalStorage
const LS = {
  load() {
    try {
      state.items = JSON.parse(localStorage.getItem("gg_items")||"[]");
      state.filename = localStorage.getItem("gg_filename")||"";
      const p = localStorage.getItem("gg_products");
      state.products = p ? JSON.parse(p) : {};
    } catch { /* noop */ }
  },
  save() {
    localStorage.setItem("gg_items", JSON.stringify(state.items));
    localStorage.setItem("gg_filename", state.filename);
    localStorage.setItem("gg_products", JSON.stringify(state.products));
  },
  clearItems() {
    state.items = [];
    localStorage.setItem("gg_items","[]");
  },
  clearProducts() {
    state.products = {};
    localStorage.setItem("gg_products","{}");
  }
};

// UI güncelle
function refreshUI() {
  // filename
  filenameInput.value = state.filename;

  // items list
  itemsBody.innerHTML = "";
  state.items.forEach((it, idx) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${it.barcode}</td>
      <td>${it.name ?? "—"}</td>
      <td class="right">
        <input type="number" min="1" value="${it.qty}" data-idx="${idx}" class="row-qty" style="width:80px;padding:6px 8px;border:1px solid #e2e6ff;border-radius:8px">
      </td>
      <td class="right actions">
        <button class="btn btn-ghost editBtn" data-idx="${idx}">Düzenle</button>
        <button class="btn btn-warn delBtn" data-idx="${idx}">Sil</button>
      </td>
    `;
    itemsBody.appendChild(tr);
  });

  // products count
  productCount.textContent = `${Object.keys(state.products).length} ürün yüklü`;
}

// Ürün bul
function findProduct(barcode) {
  return state.products[barcode] || null;
}

// Bilgi göster + ses
function showFound(product, barcode) {
  if (product) {
    // Bulursa adet alanına focus
    beep.currentTime = 0; beep.play().catch(()=>{});
    foundInfo.textContent = `${product.name} • ${product.price != null ? (product.price + " ₺") : "Fiyat Yok"}`;
    qtyInput.focus();
  } else {
    errS.currentTime = 0; errS.play().catch(()=>{});
    foundInfo.textContent = `Ürün bulunamadı (${barcode})`;
    // barkod alanında kal
    barcodeInput.focus();
  }
}

// ============ Kamera ============
// BarcodeDetector (Chrome Android)
const supportsDetector = "BarcodeDetector" in window;

async function startCamera() {
  // arka kamera zorlaması
  const constraints = {
    audio: false,
    video: {
      facingMode: { ideal: "environment" },
      width: { ideal: 1280 }, height: { ideal: 720 }
    }
  };
  try {
    state.stream = await navigator.mediaDevices.getUserMedia(constraints);
    video.srcObject = state.stream;
    await video.play();
    state.scanning = true;
    scheduleScanLoop();
  } catch (e) {
    console.error("Kamera açılamadı:", e);
    alert("Kamera açılamadı. Lütfen arka kameraya izin verdiğinden emin ol.");
  }
}

function stopCamera() {
  state.scanning = false;
  if (state.scanTimer) {
    clearTimeout(state.scanTimer);
    state.scanTimer = null;
  }
  if (state.stream) {
    state.stream.getTracks().forEach(t=>t.stop());
    state.stream = null;
  }
}

// 2 sn'de bir tarama
function scheduleScanLoop() {
  if (!state.scanning) return;
  state.scanTimer = setTimeout(scanOnce, 2000);
}

// Tek okut
async function singleScan() {
  if (state.scanning) return; // zaten açıkken ikinci kez tetikleme
  state.singleMode = true;
  await startCamera();
}

// Tarama
async function scanOnce() {
  if (!state.scanning || !video.videoWidth) { scheduleScanLoop(); return; }

  try {
    if (!supportsDetector) {
      // Basit fallback: video kare al, sonra bırak (gerçek tarama için ZXing gerekir; Android Chrome hedef olduğu için BarcodeDetector yeterli sayıldı)
      console.warn("BarcodeDetector yok; Android Chrome önerilir.");
      scheduleScanLoop();
      return;
    }
    const detector = new BarcodeDetector({ formats: ["ean_13","ean_8","upc_a","upc_e","code_128","code_39","itf","qr_code"] });
    const codes = await detector.detect(video);

    if (codes && codes.length) {
      const raw = (codes[0].rawValue || "").replace(/\D+/g,""); // sadece numerik
      if (raw) {
        // kural: sadece sayısal barkodlar
        barcodeInput.value = raw;
        const p = findProduct(raw);
        showFound(p, raw);

        // otomatik tek okut kapatma
        if (state.singleMode) {
          stopCamera();
          state.singleMode = false;
        }
        // sürekli moddaysa tekrar 2 sn sonra dene (okudu okudu, kullanıcı eklemeyi yapar)
        else {
          scheduleScanLoop();
        }
        return;
      }
    }
  } catch (e) {
    console.error("Taramada hata:", e);
  }
  // Okunmadıysa tekrar sırala
  scheduleScanLoop();
}

// Donanım tuşları: Ses + / − => Tek Okut
window.addEventListener("keydown", (e) => {
  // Not: Bazı cihazlarda tarayıcı bu event'i iletmez. Android Chrome PWA'da çoğunlukla çalışır.
  if (e.code === "VolumeUp" || e.code === "VolumeDown") {
    e.preventDefault();
    singleScan();
  }
});

// ============ Form Davranışları ============
function onBarcodeChanged() {
  const val = (barcodeInput.value || "").replace(/\D+/g,"");
  barcodeInput.value = val; // sadece numerik
  if (!val) { foundInfo.textContent = "—"; return; }

  const p = findProduct(val);
  showFound(p, val);
  if (p) {
    // ürün bulunursa adet alanına geç
    qtyInput.select();
    qtyInput.focus();
  }
  // bulunmazsa barkod alanında kalır
}

function addToList() {
  const barcode = (barcodeInput.value || "").trim();
  if (!barcode) { errS.play().catch(()=>{}); return; }
  const qty = Math.max(1, parseInt(qtyInput.value || "1", 10));
  const prod = findProduct(barcode);
  const name = prod?.name ?? null;
  const price = prod?.price ?? null;

  // mevcut satır varsa qty topla
  const idx = state.items.findIndex(x => x.barcode === barcode);
  if (idx >= 0) {
    state.items[idx].qty += qty;
  } else {
    state.items.push({ barcode, name, price, qty });
  }
  LS.save();
  refreshUI();

  // alanları sıfırla: adet her zaman 1'e dönsün
  qtyInput.value = "1";
  // barkod alanında kalma kuralı: kullanıcı "Git/Enter" ile geçsin
  barcodeInput.select();
  beep.currentTime = 0; beep.play().catch(()=>{});
}

function exportTXT() {
  const fname = (filenameInput.value || "sayim_listesi") + ".txt";
  const lines = state.items.map(it => `${it.barcode};${it.qty}`);
  const blob = new Blob([lines.join("\n")], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  downloadURL(url, fname);
}

function exportPDF() {
  // Kütüphane kullanmadan print-to-PDF yaklaşımı: yeni bir pencere/sekme ile stilize tablo açıp print diyalogunu tetikler.
  // Android'de "Yazdır" -> "PDF olarak kaydet" ile kaydedilir. (Offline uyumlu)
  const fname = (filenameInput.value || "sayim_listesi");
  const title = "GENÇ GROSS";
  const rows = state.items.map(it => {
    const unit = (it.price != null) ? it.price : 0;
    const total = (it.price != null) ? (it.price * it.qty) : 0;
    return { ...it, unit, total };
  });
  const grand = rows.reduce((a,b)=>a+b.total,0);

  const html = `
<!doctype html><html><head><meta charset="utf-8">
<title>${fname}.pdf</title>
<style>
  body{font-family:system-ui,Segoe UI,Roboto,Arial;margin:40px;color:#111}
  h1{text-align:center;margin:0 0 16px 0}
  table{width:100%;border-collapse:collapse}
  th,td{border-bottom:1px solid #ddd;padding:8px 6px;font-size:13.5px}
  th{background:#f6f8ff;text-transform:uppercase;letter-spacing:.04em;font-size:12px;text-align:left}
  tfoot td{border-top:2px solid #000;font-weight:700}
  .right{text-align:right}
  @media print { @page { size: A4 portrait; margin: 16mm } }
</style>
</head><body>
  <h1>${title}</h1>
  <table>
    <thead>
      <tr><th>Barkod</th><th>İsim</th><th class="right">Adet</th><th class="right">Birim Fiyat</th><th class="right">Toplam Fiyat</th></tr>
    </thead>
    <tbody>
      ${rows.map(r=>`
        <tr>
          <td>${r.barcode}</td>
          <td>${r.name ?? ""}</td>
          <td class="right">${r.qty}</td>
          <td class="right">${r.unit ? r.unit.toFixed(2) : ""}</td>
          <td class="right">${r.total ? r.total.toFixed(2) : ""}</td>
        </tr>`).join("")}
    </tbody>
    <tfoot>
      <tr><td colspan="4" class="right">Genel Toplam</td><td class="right">${grand.toFixed(2)}</td></tr>
    </tfoot>
  </table>
  <script>window.onload=()=>window.print()</script>
</body></html>`;
  const w = window.open("", "_blank");
  w.document.write(html);
  w.document.close();
}

function downloadURL(url, filename) {
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(()=>URL.revokeObjectURL(url), 1000);
}

// ============ Ürün Verisi ============
// Beklenen TXT: "barkod;isim;fiyat" satırları
$("#productFileInput").addEventListener("change", (e)=>{
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (ev)=>{
    const text = ev.target.result;
    parseProducts(text);
  };
  // Türkçe karakter desteği
  reader.readAsText(file, "windows-1254");
});

function parseProducts(text) {
  const lines = text.split(/\r?\n/);
  const map = {};
  for (const raw of lines) {
    if (!raw.trim()) continue;
    const parts = raw.split(";");
    if (parts.length < 3) continue;
    const barcode = (parts[0]||"").trim().replace(/\D+/g,"");
    const name = (parts[1]||"").trim();
    const price = parseFloat((parts[2]||"").replace(",", "."));
    if (!barcode) continue;
    map[barcode] = { name, price: Number.isFinite(price) ? price : null };
  }
  state.products = map;
  LS.save();
  refreshUI();
  alert("Ürün listesi yüklendi: " + Object.keys(map).length + " ürün.");
}

// Ürün arama (isimle)
searchInput.addEventListener("input", ()=>{
  const q = trFold(searchInput.value);
  if (!q) { searchResult.textContent = "—"; return; }
  // basit tarama: ilk 10 sonucu göster
  const results = [];
  for (const [bc, obj] of Object.entries(state.products)) {
    if (trFold(obj.name||"").includes(q)) {
      results.push({ bc, ...obj });
      if (results.length >= 10) break;
    }
  }
  if (!results.length) { searchResult.textContent = "Sonuç yok"; return; }
  searchResult.innerHTML = results.map(r=>`${r.name} — <b>${r.bc}</b> — ${r.price ?? ""}`).join("<br>");
});

// Ürün verisini temizle (onaylı)
$("#clearProductsBtn").addEventListener("click", ()=>{
  $("#confirmClearProducts").showModal();
});
$("#confirmClearProducts [data-close]").addEventListener("click", ()=>$("#confirmClearProducts").close());
$("#confirmClearProductsYes").addEventListener("click", ()=>{
  LS.clearProducts();
  refreshUI();
  $("#confirmClearProducts").close();
});

// ============ Liste işlemleri ============
function openConfirmClearList() { $("#confirmClearList").showModal(); }
$("#clearListBtn").addEventListener("click", openConfirmClearList);
$("#confirmClearList [data-close]").addEventListener("click", ()=>$("#confirmClearList").close());
$("#confirmClearListYes").addEventListener("click", ()=>{
  LS.clearItems();
  refreshUI();
  $("#confirmClearList").close();
});

// satır sil/düzenle
itemsBody.addEventListener("click", (e)=>{
  const delBtn = e.target.closest(".delBtn");
  const editBtn = e.target.closest(".editBtn");
  if (delBtn) {
    const idx = +delBtn.dataset.idx;
    state.items.splice(idx,1);
    LS.save(); refreshUI();
  } else if (editBtn) {
    const idx = +editBtn.dataset.idx;
    const row = state.items[idx];
    const nb = prompt("Barkodu düzenle:", row.barcode);
    if (nb && /^\d+$/.test(nb)) {
      row.barcode = nb;
      const p = findProduct(nb);
      row.name = p?.name ?? null;
      row.price = p?.price ?? null;
      LS.save(); refreshUI();
    }
  }
});

// satır qty değişimi
itemsBody.addEventListener("change", (e)=>{
  const q = e.target.closest(".row-qty");
  if (!q) return;
  const idx = +q.dataset.idx;
  const val = Math.max(1, parseInt(q.value||"1",10));
  state.items[idx].qty = val;
  LS.save();
});

// ============ Etkileşimler ============
$("#startBtn").addEventListener("click", async ()=>{
  state.singleMode = false;
  await startCamera();
});
$("#stopBtn").addEventListener("click", ()=>{ stopCamera(); });

$("#singleScanBtn").addEventListener("click", ()=> singleScan());

// Barkod alanı: değişince arama/odak
barcodeInput.addEventListener("input", onBarcodeChanged);

// Barkod alanı: Enter/Go => adet alanına geçmesin (senin kuralına göre)
barcodeInput.addEventListener("keydown", (e)=>{
  if (e.key === "Enter") {
    e.preventDefault(); // alt satıra otomatik geçmesin
  }
});

// Adet alanı: Enter/Go => ekle
qtyInput.addEventListener("keydown", (e)=>{
  if (e.key === "Enter") {
    e.preventDefault();
    addToList();
  }
});

// Adet alanına odaklanınca ilk dokunuşta mevcut 1 silinsin (bir sayıya basınca değiştirsin)
qtyInput.addEventListener("focus", ()=>{ qtyInput.select(); });

// Temizleme tuşu (barkod alanı)
$("#clearBarcodeBtn").addEventListener("click", ()=>{
  barcodeInput.value = "";
  foundInfo.textContent = "—";
  barcodeInput.focus();
});

// Ekle butonu
$("#addBtn").addEventListener("click", addToList);

// Export
$("#exportTxtBtn").addEventListener("click", exportTXT);
$("#exportPdfBtn").addEventListener("click", exportPDF);

// Dosya adı alanı
filenameInput.addEventListener("input", ()=>{
  state.filename = filenameInput.value;
  LS.save();
});

// Offline/PWA durumu
function updateOfflineBadge() {
  offlineState.textContent = navigator.onLine ? "Hazır" : "Çevrimdışı";
}
window.addEventListener("online", updateOfflineBadge);
window.addEventListener("offline", updateOfflineBadge);

// Init
(function init(){
  LS.load();
  refreshUI();
  updateOfflineBadge();
  // PWA SW
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch(console.error);
  }
})();
