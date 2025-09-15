// ====== STATE ======
const state={items:{},scanning:false,currentDeviceId:null,singleShot:false};
let mediaStream=null,rafId=null,frames=0,duplicateGuard={code:null,until:0},lastOp=null,detector=null,off=null,octx=null;
let productMap={};

// ====== EL ======
const $ = sel => document.querySelector(sel);
const selCam   = $('#cameraSelect');
const video    = $('#video');
const statusEl = $('#scanStatus');
const fpsEl    = $('#fps');
const inpCode  = $('#barcode');
const inpQty   = $('#qty');
const tbody    = $('#tbody');
const totalRows= $('#totalRows');
const totalQty = $('#totalQty');
const inpFile  = $('#productFile');
const mapStat  = $('#mapStat');
const nameEl   = $('#productName');
const priceEl  = $('#productPrice');
const beep     = $('#beep');
const errBeep  = $('#err');
const btnOnce  = $('#btnScanOnce');

// ====== HELPERS ======
function render(){
  tbody.innerHTML=''; let sum=0;
  Object.entries(state.items).forEach(([c,q])=>{
    sum+=Number(q)||0;
    const name=(productMap[c]?.name)||'—';
    const tr=document.createElement('tr');
    tr.innerHTML=`<td>${c}</td><td>${name}</td><td class="right">${q}</td><td><button onclick="del('${c}')">Sil</button></td>`;
    tbody.appendChild(tr);
  });
  totalRows.textContent=Object.keys(state.items).length;
  totalQty.textContent=sum;
}
window.del=(c)=>{delete state.items[c];save();render();}
function upsert(c,q){ if(!c) return; const n=Math.max(1,Number(q)||1); state.items[c]=(Number(state.items[c])||0)+n; lastOp={code:c,qty:n}; save(); render(); }
function undo(){ if(!lastOp) return; const {code,qty}=lastOp; state.items[code]=(Number(state.items[code])||0)-qty; if(state.items[code]<=0) delete state.items[code]; lastOp=null; save(); render(); }
function save(){ localStorage.setItem('barcodeItems', JSON.stringify(state.items)); }
function load(){ const raw=localStorage.getItem('barcodeItems'); if(raw){ try{state.items=JSON.parse(raw);}catch{} } render(); }

function dl(name,content,type){ const a=document.createElement('a'); a.href=URL.createObjectURL(new Blob([content],{type})); a.download=name; a.click(); URL.revokeObjectURL(a.href); }
function exportTXT(){ const lines=Object.entries(state.items).map(([c,q])=>`${c};${q}`); dl((($('#filename').value)||'sayim')+'.txt', lines.join('\n'), 'text/plain'); }
function exportCSV(){ const lines=['barcode,qty',...Object.entries(state.items).map(([c,q])=>`${c},${q}`)]; dl((($('#filename').value)||'sayim')+'.csv', lines.join('\n'), 'text/csv'); }

function trLower(s){ return (s||'').toLocaleLowerCase('tr-TR'); }
function playBeep(a){ try{a.currentTime=0; a.play();}catch{} }

// ====== KAMERA / BarcodeDetector ======
// ... [kamera ve tarama kodları aynı, kısaltmadım burada; senin dosyanda vardı]

// ====== ÜRÜN BİLGİ ======
function showProductInfo(code){
  const p=productMap[code];
  if(p){ nameEl.textContent=p.name||'—'; priceEl.textContent=p.price||'—'; }
  else { nameEl.textContent='Bulunamadı'; priceEl.textContent='—'; }
}

// ====== PARSE ======
function normPriceStr(p){
  if(!p) return '';
  p = String(p).trim();
  if(!p) return '';

  const onlyNums = p.replace(/[^\d.,]/g, '');
  if(!onlyNums) return '';

  let decIdx = -1;
  for(let i=onlyNums.length-1;i>=0;i--){
    const ch = onlyNums[i];
    if((ch==='.'||ch===',') && i < onlyNums.length-1){
      const tail = onlyNums.slice(i+1);
      if(/^\d{1,2}$/.test(tail)){ decIdx = i; break; }
    }
  }

  let intPart, fracPart='';
  if(decIdx>=0){ intPart = onlyNums.slice(0,decIdx); fracPart = onlyNums.slice(decIdx+1); }
  else { intPart = onlyNums; }

  intPart = intPart.replace(/[.,]/g, '');
  let norm = intPart;
  if(fracPart){ fracPart = (fracPart+'00').slice(0,2); norm += '.'+fracPart; }
  const v = Number(norm);
  if(!isFinite(v)) return '';
  return v.toFixed(2).replace('.',',');
}

function parseTextToMap(txt){
  const lines = txt.split(/\r?\n/).filter(l=>l.trim().length);
  const map = {};
  for(const raw of lines){
    const sep = raw.includes(';') ? ';' : '\t';
    const cols = raw.split(sep).map(s=>s.trim());
    if(cols.length < 2) continue;

    const code = (cols[0]||'').replace(/\s+/g,'');
    const name = cols[1]||'';
    if(!code || !name) continue;

    let price = '';
    if(cols.length >= 3){
      price = normPriceStr(cols[2]);
      if(!price && cols[2]){
        const rawPrice = String(cols[2]).trim();
        const numish = rawPrice.replace(/[^\d.,]/g,'');
        if(numish){
          const guess = numish.includes('.') && !numish.includes(',') ? numish.replace('.',',') : numish;
          price = guess;
        } else {
          price = rawPrice;
        }
      }
    }
    if(!price){
      for(let i=cols.length-1;i>=2;i--){
        const p = normPriceStr(cols[i]);
        if(p){ price = p; break; }
      }
    }

    map[code] = {name, price};
  }
  return map;
}

// ====== DOSYA YÜKLE ======
// ... [yükleme, arama, UI olayları bölümü aynı kaldı]

