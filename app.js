/* app.js – GNCPULUF fiyat tespiti: satırın en sağındaki geçerli fiyat
   - GNCPULUF: 1;PLU;İSİM…, 3;PLU;BARKOD…, 4;PLU;…FİYAT… (nokta/virgül olabilir)
   - Aynı PLU birden çok barkod içerirse her barkod ayrı kayda dönüşür
   - PLU 4–14 hane ise doğrudan kod olarak da aranabilir (50526 gibi)
   - Bulunan üründe beep, bulunamayan üründe error çalar
*/

(function () {
  // ---------- State ----------
  let productMap = {}; // { code -> {name, price} }
  let items = {};
  let lastOp = null;

  // ---------- DOM ----------
  const $ = (s) => document.querySelector(s);
  const el = (id) => document.getElementById(id);

  const barcodeInp  = el('barcode') || $('#barcode') || $('[name="barcode"]');
  const qtyInp      = el('qty') || $('#qty');
  const nameOut     = el('productName') || $('#productName');
  const priceOut    = el('productPrice') || $('#productPrice');
  const mapStat     = el('mapStat') || $('#mapStat');
  const fileInput   = el('productFile') || $('#productFile') || $('input[type="file"]');
  const encSelect   = el('encoding') || $('#encoding');
  const btnAdd      = el('btnAdd') || $('#btnAdd');
  const btnUndo     = el('btnUndo') || $('#btnUndo');
  const btnConfirm  = el('btnConfirm') || $('#btnConfirm');
  const tbody       = el('tbody') || $('#tbody');
  const totalRows   = el('totalRows') || $('#totalRows');
  const totalQty    = el('totalQty') || $('#totalQty');
  const beepOk      = el('beepOk') || el('beep') || $('#beepOk') || $('#beep');
  const beepErr     = el('beepErr') || $('#beepErr');

  // ---------- Helpers ----------
  const dig = (s) => (s || '').replace(/\D+/g, '');
  const isCode = (s) => /^\d{4,14}$/.test(s); // iç kodlar + EAN’ler

  const setText = (node, t) => { if (node) node.textContent = t; };

  function normPrice(str) {
    // metinden sayıya + "12,34" gösterimine çevir
    if (!str) return { num: 0, disp: '' };
    let t = String(str).trim();
    // “1234.56” / “12.34” gibi
    if (/^\d+(?:\.\d+)?$/.test(t)) {
      const n = parseFloat(t);
      return { num: n || 0, disp: n ? n.toFixed(2).replace('.', ',') : '' };
    }
    // “1.234,56” / “12,34” gibi
    t = t.replace(/\./g, '').replace(',', '.');
    const n = parseFloat(t);
    return { num: isFinite(n) ? n : 0, disp: n ? n.toFixed(2).replace('.', ',') : '' };
  }

  function saveMap() {
    try { localStorage.setItem('productMapV2', JSON.stringify(productMap)); } catch {}
    if (mapStat) setText(mapStat, Object.keys(productMap).length + ' ürün yüklü');
  }
  function loadMap() {
    try { productMap = JSON.parse(localStorage.getItem('productMapV2') || '{}'); } catch { productMap = {}; }
    if (mapStat) setText(mapStat, Object.keys(productMap).length + ' ürün yüklü');
  }

  // ---------- GNCPULUF Parser ----------
  // Sağdan itibaren son geçerli fiyatı çek (örn. …;1;175.00;175.00;  veya  …;1;1.175,00; )
  function rightmostPriceFromLine(line) {
    // Ondalığı olan fiyat kalıpları: 12,34 | 12.34 | 1.234,56 | 1234.56
    const re = /\d{1,3}(?:\.\d{3})*,\d{2}|\d+\.\d{2}/g;
    let m, last = null;
    while ((m = re.exec(line))) last = m[0];
    return last || ''; // bulunmazsa boş
  }

  function parseGNCPULUF(txt) {
    const lines = txt.split(/\r?\n/);
    const byPLU = new Map(); // PLU -> { name, priceDisp, priceNum, barcodes:Set }

    const ensure = (plu) => {
      if (!byPLU.has(plu)) byPLU.set(plu, { name: '', priceDisp: '', priceNum: 0, barcodes: new Set() });
      return byPLU.get(plu);
    };

    for (let i = 0; i < lines.length; i++) {
      const L = lines[i];
      if (!L) continue;
      const type = L[0];
      if (type !== '1' && type !== '3' && type !== '4') continue;

      const parts = L.split(';');
      const plu = (parts[1] || '').trim();
      if (!plu) continue;

      if (type === '1') {
        const name = (parts[2] || '').trim();
        ensure(plu).name = name;
      } else if (type === '3') {
        const bc = dig(parts[2] || '');
        if (isCode(bc)) ensure(plu).barcodes.add(bc);
      } else if (type === '4') {
        const priceRaw = rightmostPriceFromLine(L);
        const p = normPrice(priceRaw);
        if (p.num > 0) {
          const slot = ensure(plu);
          slot.priceDisp = p.disp;
          slot.priceNum  = p.num;
        }
      }
    }

    // PLU kümelerini düz haritaya indir
    const out = {};
    byPLU.forEach((v, plu) => {
      v.barcodes.forEach((bc) => { out[bc] = { name: v.name || '', price: v.priceDisp || '' }; });
      if (isCode(plu)) out[plu] = { name: v.name || '', price: v.priceDisp || '' }; // 50526 vb.
    });
    return out;
  }

  // ---------- CSV/TXT (yedek) ----------
  function parseCSVorTXT(txt) {
    const lines = txt.split(/\r?\n/).filter(x => x.trim());
    const sep = lines[0]?.includes(';') ? ';' : ',';
    const res = {};
    for (const L of lines) {
      const cols = L.split(sep).map(s => s.trim());
      const code = dig(cols[0]);
      if (!isCode(code)) continue;
      const name = cols[1] || '';
      const p = normPrice(cols[2] || '');
      res[code] = { name, price: p.disp };
    }
    return res;
  }

  // ---------- File I/O ----------
  async function readFile(file, encSel) {
    if (!file) return '';
    try {
      const want1254 = encSel && /1254/.test(encSel.value || encSel.textContent || '');
      if (!want1254 && file.text) return await file.text();
      const buf = await file.arrayBuffer();
      const dec = new TextDecoder(want1254 ? 'windows-1254' : 'utf-8');
      return dec.decode(buf);
    } catch {
      return await file.text();
    }
  }

  function loadProductText(txt, src) {
    try {
      let map = {};
      const firstNonEmpty = (txt.match(/^[^\r\n]*/)||[''])[0];
      if (/^1;/.test(firstNonEmpty)) {
        map = parseGNCPULUF(txt);
      } else if (txt.trim().startsWith('{')) {
        const obj = JSON.parse(txt);
        for (const [k,v] of Object.entries(obj)) {
          const code = dig(k);
          if (!isCode(code)) continue;
          if (typeof v === 'string') map[code] = { name: v, price: '' };
          else map[code] = { name: v.name || '', price: v.price || '' };
        }
      } else {
        map = parseCSVorTXT(txt);
      }
      productMap = map;
      saveMap();
      alert(`${Object.keys(productMap).length} ürün yüklendi (${src||'dosya'}).`);
      if (barcodeInp?.value) showProductInfo(dig(barcodeInp.value));
    } catch (e) {
      console.error(e);
      alert('Veri çözümlenemedi. CSV/TXT (kod;isim;…;fiyat), JSON veya GNCPULUF verisi verin.');
    }
  }

  // ---------- UI/Audio ----------
  function showProductInfo(code) {
    const rec = productMap[code];
    setText(nameOut, rec ? (rec.name || '—') : 'Bulunamadı');
    setText(priceOut, rec ? (rec.price || '—') : '—');
    return !!rec;
  }
  const playOk  = () => { try { if (beepOk)  { beepOk.currentTime  = 0; beepOk.play();  } } catch {} };
  const playErr = () => { try { if (beepErr) { beepErr.currentTime = 0; beepErr.play(); } } catch {} };

  function saveItems() {
    try { localStorage.setItem('barcodeItemsV2', JSON.stringify(items)); } catch {}
    if (totalRows) setText(totalRows, Object.keys(items).length);
    if (totalQty)  setText(totalQty,  Object.values(items).reduce((a,b)=>a+(+b||0),0));
    if (!tbody) return;
    tbody.innerHTML = '';
    for (const [c,q] of Object.entries(items)) {
      const nm = productMap[c]?.name || '';
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${c}</td><td>${nm}</td><td class="right">${q}</td>
                      <td><button data-del="${c}">Sil</button></td>`;
      tbody.appendChild(tr);
    }
  }
  function loadItems() {
    try { items = JSON.parse(localStorage.getItem('barcodeItemsV2') || '{}'); } catch { items = {}; }
    saveItems();
  }
  function addItem(code, q) {
    if (!code) return;
    const n = Math.max(1, Number(q)||1);
    items[code] = (Number(items[code])||0) + n;
    lastOp = { code, qty:n };
    saveItems();
  }

  function handleConfirm() {
    const code = dig(barcodeInp?.value || '');
    if (!code) return;
    const found = showProductInfo(code);
    if (found) playOk(); else playErr();
    if (qtyInp) { qtyInp.focus(); qtyInp.select && qtyInp.select(); }
  }

  // ---------- Events ----------
  if (fileInput) {
    fileInput.addEventListener('change', async (e) => {
      const f = e.target.files?.[0];
      if (!f) return;
      const txt = await readFile(f, encSelect);
      loadProductText(txt, f.name);
    });
  }

  if (barcodeInp) {
    barcodeInp.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') { ev.preventDefault(); handleConfirm(); }
    });
    barcodeInp.addEventListener('input', () => {
      const code = dig(barcodeInp.value);
      if (code.length >= 4) showProductInfo(code); // sessiz önizleme
    });
  }
  if (btnConfirm) btnConfirm.addEventListener('click', handleConfirm);

  if (btnAdd) btnAdd.addEventListener('click', () => {
    const code = dig(barcodeInp?.value || '');
    if (!code) return;
    addItem(code, qtyInp ? qtyInp.value : 1);
    if (barcodeInp) barcodeInp.value = '';
    if (qtyInp) qtyInp.value = 1;
    showProductInfo('');
  });

  if (btnUndo) btnUndo.addEventListener('click', () => {
    if (!lastOp) return;
    const { code, qty } = lastOp;
    items[code] = (Number(items[code])||0) - qty;
    if (items[code] <= 0) delete items[code];
    lastOp = null;
    saveItems();
  });

  if (tbody) {
    tbody.addEventListener('click', (e) => {
      const b = e.target.closest('[data-del]');
      if (!b) return;
      delete items[b.getAttribute('data-del')];
      saveItems();
    });
  }

  const btnClearMap = el('btnClearMap') || $('#btnClearMap') || $('[data-clear-product]');
  if (btnClearMap) {
    btnClearMap.addEventListener('click', () => {
      if (!confirm('Ürün verisini temizlemek istiyor musun?')) return;
      productMap = {};
      saveMap();
      showProductInfo('');
    });
  }

  // ---------- Boot ----------
  loadMap();
  loadItems();
  setText(nameOut, '—'); setText(priceOut, '—');
})();
