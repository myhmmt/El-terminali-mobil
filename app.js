/* app.js – GNCPULUF fiyatı: 4. satır, sondan 1 önceki sütun
   - Ürün metni cihazda saklanır (localStorage: "productMapV2")
   - Bulunan üründe beep, bulunamayanda error çalar
   - Aynı PLU altında birden fazla barkod -> her barkod ayrı kayda dönüşür
   - Manuel kod/barkod yazınca da isim/fiyat gösterilir
*/

(function () {
  // ---------- Durum ----------
  let productMap = {};     // { code -> {name, priceDisp, priceNum} }
  let items = {};          // sayaç listesi { code -> qty }
  let lastOp = null;

  // ---------- Elemanlar ----------
  const el = (id) => document.getElementById(id);
  const q = (sel) => document.querySelector(sel);

  const barcodeInp     = el('barcode') || q('#barcodeInput') || q('[name="barcode"]');
  const qtyInp         = el('qty') || el('quantity') || q('#qty');
  const nameOut        = el('productName') || q('#productName');
  const priceOut       = el('productPrice') || q('#productPrice');
  const mapStat        = el('mapStat') || q('#mapStat');
  const fileInput      = el('productFile') || q('#productFile') || q('input[type="file"]');
  const encSelect      = el('encSel') || el('encoding') || q('#encoding') || q('#encSel');
  const btnAdd         = el('btnAdd') || q('#btnAdd');
  const btnUndo        = el('btnUndo') || q('#btnUndo');
  const btnClearMap    = el('btnClearMap') || q('#btnClearMap') || q('[data-clear-product]');
  const tbody          = el('tbody') || q('#tbody');
  const totalRows      = el('totalRows') || q('#totalRows');
  const totalQty       = el('totalQty') || q('#totalQty');
  const beepOk         = el('beepOk') || el('beep') || q('#beepOk') || q('#beep');
  const beepErr        = el('beepErr') || q('#beepErr');

  // ---------- Yardımcılar ----------
  const dig = (s) => (s || '').replace(/\D+/g, '');
  const isBarcode = (s) => /^\d{4,14}$/.test(s); // 4…14: iç kodlar + EAN’ler
  function setText(node, val) { if (node) node.textContent = val; }
  function priceDispFromRaw(raw) {
    // "175.00" -> 175,00   |   "1.175,00" -> 1.175,00   |  "175,00" -> 175,00
    if (!raw) return { num: 0, disp: '' };
    let t = String(raw).trim();
    // önce noktalı ondalıklı olasılık
    if (/^\d+(?:\.\d+)?$/.test(t)) {
      const n = parseFloat(t);
      return { num: n || 0, disp: n ? n.toFixed(2).replace('.', ',') : '' };
    }
    // binlik nokta + virgül ondalık
    t = t.replace(/\./g, '').replace(',', '.');
    const n = parseFloat(t);
    return { num: isFinite(n) ? n : 0, disp: n ? n.toFixed(2).replace('.', ',') : '' };
  }
  function saveMap() {
    try { localStorage.setItem('productMapV2', JSON.stringify(productMap)); } catch { }
    if (mapStat) mapStat.textContent = Object.keys(productMap).length + ' ürün yüklü';
  }
  function loadMap() {
    try {
      const raw = localStorage.getItem('productMapV2');
      if (raw) productMap = JSON.parse(raw) || {};
    } catch { productMap = {}; }
    if (mapStat) mapStat.textContent = Object.keys(productMap).length + ' ürün yüklü';
  }

  // ---------- GNCPULUF (Genius 2 SQL) Çözücü ----------
  function parseGNCPULUF(txt) {
    const lines = txt.split(/\r?\n/);
    // PLU -> { name, priceDisp, priceNum, barcodes:Set }
    const byPLU = new Map();

    const ensurePLU = (plu) => {
      if (!byPLU.has(plu)) byPLU.set(plu, { name: '', priceDisp: '', priceNum: 0, barcodes: new Set() });
      return byPLU.get(plu);
    };

    for (let i = 0; i < lines.length; i++) {
      const L = lines[i];
      if (!L) continue;
      const parts = L.split(';');

      const type = parts[0];
      if (type === '1') {
        // 1;PLU;NAME;...
        const plu  = parts[1] ? parts[1].trim() : '';
        const name = (parts[2] || '').trim();
        if (plu) ensurePLU(plu).name = name;
      } else if (type === '3') {
        // 3;PLU;BARCODE;...
        const plu = parts[1] ? parts[1].trim() : '';
        const bc  = dig(parts[2] || '');
        if (plu && bc && isBarcode(bc)) ensurePLU(plu).barcodes.add(bc);
      } else if (type === '4') {
        // 4;PLU;...;...;...;PRICE;...  -> fiyat sondan bir önceki
        const plu = parts[1] ? parts[1].trim() : '';
        const priceRaw = parts.length >= 3 ? parts[parts.length - 2] : '';
        const p = priceDispFromRaw(priceRaw);
        if (plu && p.num > 0) {
          const slot = ensurePLU(plu);
          slot.priceDisp = p.disp;
          slot.priceNum  = p.num;
        }
      }
      // 5; ... diğerleri – göz ardı
    }

    // PLU kümelerini tekli map’e indir: her barkod ayrı kayıt
    const out = {};
    byPLU.forEach((v, plu) => {
      // isim veya fiyat gelmeyen PLU’lar da olabilir; yine de isim boşsa boş geçer
      v.barcodes.forEach((bc) => { out[bc] = { name: v.name || '', price: v.priceDisp || '' }; });
      // iç kullanım kodu (PLU) ile arama/direkt giriş isteniyorsa, 4–14 ise ekle
      if (/^\d{4,14}$/.test(plu)) out[plu] = { name: v.name || '', price: v.priceDisp || '' };
    });

    return out;
  }

  // ---------- CSV / JSON / Eski GDF fallback ----------
  function parseCSVorTXT(txt) {
    const lines = txt.split(/\r?\n/).filter(x => x.trim().length);
    const sep = lines[0].includes(';') ? ';' : ',';
    const res = {};
    for (const L of lines) {
      const cols = L.split(sep).map(s => s.trim());
      if (cols.length >= 2) {
        const code = dig(cols[0]);
        if (isBarcode(code)) {
          const name = cols[1];
          const p = priceDispFromRaw(cols[2] || '');
          res[code] = { name, price: p.disp };
        }
      }
    }
    return res;
  }

  // ---------- Dosya yükleme ----------
  async function readFileWithEncoding(file, encSelector) {
    if (!file) return '';
    try {
      // Seçimde “Türkçe (Windows-1254)” varsa bunu kullan
      const encName =
        encSelector && encSelector.value && /1254/.test(encSelector.value) ? 'windows-1254' : 'utf-8';

      if (encName === 'utf-8' && file.text) {
        return await file.text();
      } else {
        const buf = await file.arrayBuffer();
        const dec = new TextDecoder(encName);
        return dec.decode(buf);
      }
    } catch {
      return await file.text();
    }
  }

  function loadProductText(txt, srcName) {
    try {
      let map = {};
      const firstLine = (txt.match(/^[^\n\r]*/) || [''])[0];

      if (/^1;/.test(firstLine)) {
        // GNCPULUF: 1;/3;/4; kayıtları
        map = parseGNCPULUF(txt);
      } else if (txt.trim().startsWith('{')) {
        // JSON sözlük: { "869...": {name, price} }
        const obj = JSON.parse(txt);
        for (const [k, v] of Object.entries(obj)) {
          const code = dig(k);
          if (!isBarcode(code)) continue;
          if (typeof v === 'string') map[code] = { name: v, price: '' };
          else map[code] = { name: v.name || '', price: v.price || '' };
        }
      } else {
        // CSV/TXT: kod;isim;...;fiyat
        map = parseCSVorTXT(txt);
      }

      productMap = map;
      saveMap();

      alert(`${Object.keys(productMap).length} ürün yüklendi (${srcName || 'dosya'}).`);
    } catch (e) {
      console.error(e);
      alert('Veri çözümlenemedi. CSV/TXT (kod;isim;...;fiyat), JSON veya GNCPULUF verisi verin.');
    }
  }

  // ---------- Ürün bilgisi göster & sesler ----------
  function showProductInfo(code) {
    const rec = productMap[code] || null;
    setText(nameOut, rec ? (rec.name || '—') : 'Bulunamadı');
    setText(priceOut, rec ? (rec.price || '—') : '—');
    return !!rec;
  }

  function playOk() { try { if (beepOk) { beepOk.currentTime = 0; beepOk.play(); } } catch { } }
  function playErr() { try { if (beepErr) { beepErr.currentTime = 0; beepErr.play(); } } catch { } }

  // ---------- Liste işlemleri (kısa) ----------
  function saveItems() {
    try { localStorage.setItem('barcodeItemsV2', JSON.stringify(items)); } catch { }
    if (totalRows) setText(totalRows, Object.keys(items).length);
    if (totalQty)  setText(totalQty, Object.values(items).reduce((a, b) => a + (Number(b) || 0), 0));
    if (tbody) {
      tbody.innerHTML = '';
      Object.entries(items).forEach(([c, q]) => {
        const tr = document.createElement('tr');
        const nm = productMap[c]?.name || '';
        tr.innerHTML = `<td>${c}</td><td>${nm}</td><td class="right">${q}</td>
                        <td><button data-del="${c}">Sil</button></td>`;
        tbody.appendChild(tr);
      });
    }
  }
  function loadItems() {
    try { items = JSON.parse(localStorage.getItem('barcodeItemsV2') || '{}'); } catch { items = {}; }
    saveItems();
  }
  function addItem(code, q) {
    if (!code) return;
    const n = Math.max(1, Number(q) || 1);
    items[code] = (Number(items[code]) || 0) + n;
    lastOp = { code, qty: n };
    saveItems();
  }

  // ---------- Olaylar ----------
  // Dosya seçimi
  if (fileInput) {
    fileInput.addEventListener('change', async (e) => {
      const f = e.target.files?.[0];
      if (!f) return;
      const txt = await readFileWithEncoding(f, encSelect);
      loadProductText(txt, f.name);
      // aktif barkod kutusunda varsa hemen bilgiyi güncelle
      if (barcodeInp && barcodeInp.value) showProductInfo(dig(barcodeInp.value));
    });
  }

  // Üst barkod/kod girişi -> isim/fiyat ve ses
  if (barcodeInp) {
    barcodeInp.addEventListener('input', () => {
      const code = dig(barcodeInp.value);
      const ok = code.length >= 4 ? showProductInfo(code) : false;
      // sadece elle girişte ses istemiyorsan burayı yoruma alabilirsin
    });
  }

  // “Tamam” veya Enter → bilgi + ses
  function handleConfirm() {
    if (!barcodeInp) return;
    const code = dig(barcodeInp.value);
    if (!code) return;
    const found = showProductInfo(code);
    if (found) playOk(); else playErr();
    // miktar kutusuna odak (isteğin doğrultusunda)
    if (qtyInp) { qtyInp.focus(); qtyInp.select && qtyInp.select(); }
  }

  const btnConfirm = el('btnConfirm') || q('#btnConfirm') || q('button.accent');
  if (btnConfirm) btnConfirm.addEventListener('click', handleConfirm);
  if (barcodeInp) {
    barcodeInp.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') { ev.preventDefault(); handleConfirm(); }
    });
  }

  // Ekle
  if (btnAdd) {
    btnAdd.addEventListener('click', () => {
      const code = dig(barcodeInp?.value || '');
      if (!code) return;
      addItem(code, qtyInp ? qtyInp.value : 1);
      // ekledikten sonra alanları sıfırla
      if (barcodeInp) barcodeInp.value = '';
      if (qtyInp) qtyInp.value = 1;
      showProductInfo(''); // temizle
    });
  }
  // Geri Al
  if (btnUndo) {
    btnUndo.addEventListener('click', () => {
      if (!lastOp) return;
      const { code, qty } = lastOp;
      items[code] = (Number(items[code]) || 0) - qty;
      if (items[code] <= 0) delete items[code];
      lastOp = null;
      saveItems();
    });
  }
  // Liste satır silme
  if (tbody) {
    tbody.addEventListener('click', (e) => {
      const t = e.target.closest('[data-del]');
      if (t) {
        const c = t.getAttribute('data-del');
        delete items[c];
        saveItems();
      }
    });
  }
  // Ürün verisini temizle
  if (btnClearMap) {
    btnClearMap.addEventListener('click', () => {
      if (!confirm('Ürün verisini temizlemek istiyor musun?')) return;
      productMap = {};
      saveMap();
      // ekranı temizle
      showProductInfo('');
    });
  }

  // ---------- İlk açılış ----------
  loadMap();
  loadItems();

  // İlk anda isim/fiyat boşluğu “—” ile doldur
  setText(nameOut, '—');
  setText(priceOut, '—');
})();
