/* Belege – Steuerbelege scannen, sortieren, exportieren.
   Alle Daten bleiben im Browser-Speicher (IndexedDB) auf dem Handy. */
'use strict';

const DEFAULT_CATEGORIES = [
  { id: 'werbung', name: 'Werbungskosten / Arbeitsmittel', icon: '💼' },
  { id: 'tanken', name: 'Tanken / Fahrtkosten', icon: '⛽' },
  { id: 'kleidung', name: 'Berufskleidung', icon: '👔' },
  { id: 'kongress', name: 'Kongresse / Fortbildung', icon: '🎓' },
  { id: 'anschaffung', name: 'Anschaffungen fürs Geschäft', icon: '🖥️' },
  { id: 'bewirtung', name: 'Bewirtung', icon: '🍽️' },
  { id: 'telefon', name: 'Telefon / Internet', icon: '📱' },
  { id: 'literatur', name: 'Fachliteratur', icon: '📚' },
  { id: 'sonstiges', name: 'Sonstiges', icon: '🧾' },
];
const MONTHS = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];
const MONTHS_LONG = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];

/* ---------- Speicher ---------- */
const DB = {
  db: null,
  open() {
    return new Promise((res, rej) => {
      const req = indexedDB.open('belege', 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        db.createObjectStore('receipts', { keyPath: 'id' });
        db.createObjectStore('meta');
      };
      req.onsuccess = () => { this.db = req.result; res(); };
      req.onerror = () => rej(req.error);
    });
  },
  tx(store, mode, fn) {
    return new Promise((res, rej) => {
      const t = this.db.transaction(store, mode);
      const r = fn(t.objectStore(store));
      t.oncomplete = () => res(r && 'result' in r ? r.result : undefined);
      t.onerror = () => rej(t.error);
      t.onabort = () => rej(t.error);
    });
  },
  all() { return this.tx('receipts', 'readonly', s => s.getAll()); },
  get(id) { return this.tx('receipts', 'readonly', s => s.get(id)); },
  put(r) { return this.tx('receipts', 'readwrite', s => s.put(r)); },
  del(id) { return this.tx('receipts', 'readwrite', s => s.delete(id)); },
  getMeta(k) { return this.tx('meta', 'readonly', s => s.get(k)); },
  setMeta(k, v) { return this.tx('meta', 'readwrite', s => s.put(v, k)); },
};

const S = {
  receipts: [],
  categories: DEFAULT_CATEGORIES,
  rules: {},
  settings: { name: '' },
  view: 'home',
  year: new Date().getFullYear(),
  listFilter: { q: '', cat: '' },
  inboxIndex: 0,
};

/* ---------- Hilfsfunktionen ---------- */
const $ = sel => document.querySelector(sel);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const eur = v => v == null || isNaN(v) ? '–' : v.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' });
const num = v => v == null ? '' : v.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const parseNum = s => {
  if (s == null) return null;
  s = String(s).trim().replace(/\s|€/g, '');
  if (!s) return null;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  const v = parseFloat(s);
  return isNaN(v) ? null : Math.round(v * 100) / 100;
};
const fmtDate = d => d ? new Date(d + 'T12:00:00').toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' }) : 'ohne Datum';
const todayIso = () => new Date().toISOString().slice(0, 10);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const yearOf = r => r.date ? +r.date.slice(0, 4) : new Date(r.createdAt).getFullYear();
const cat = id => S.categories.find(c => c.id === id) || { id, name: 'Unbekannt', icon: '❔' };
const urls = new Map();
const blobUrl = (key, blob) => {
  if (!blob) return '';
  if (!urls.has(key)) urls.set(key, URL.createObjectURL(blob));
  return urls.get(key);
};
const dropUrl = key => { if (urls.has(key)) { URL.revokeObjectURL(urls.get(key)); urls.delete(key); } };

function loadScript(src) {
  return new Promise((res, rej) => {
    if (document.querySelector(`script[src="${src}"]`)) return res();
    const s = document.createElement('script');
    s.src = src; s.onload = res; s.onerror = () => rej(new Error('Konnte ' + src + ' nicht laden'));
    document.head.appendChild(s);
  });
}

let toastTimer;
function toast(text, action, onAction, ms = 4500) {
  $('#toastText').textContent = text;
  const b = $('#toastAction');
  b.hidden = !action;
  b.textContent = action || '';
  b.onclick = () => { $('#toast').hidden = true; onAction && onAction(); };
  $('#toast').hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { $('#toast').hidden = true; }, ms);
}

async function save(r) {
  await DB.put(r);
  const i = S.receipts.findIndex(x => x.id === r.id);
  if (i >= 0) S.receipts[i] = r; else S.receipts.push(r);
}

/* ---------- Bilder & PDFs ---------- */
function canvasToBlob(c, type = 'image/jpeg', q = 0.8) {
  return new Promise(res => c.toBlob(res, type, q));
}
function scaled(src, w, h, max) {
  const k = Math.min(1, max / Math.max(w, h));
  const c = document.createElement('canvas');
  c.width = Math.round(w * k); c.height = Math.round(h * k);
  c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
  return c;
}
// Graustufen + Kontrast für bessere Texterkennung
function ocrCanvas(src) {
  const c = scaled(src, src.width, src.height, 2200);
  const ctx = c.getContext('2d', { willReadFrequently: true });
  const img = ctx.getImageData(0, 0, c.width, c.height);
  const d = img.data;
  let lo = 255, hi = 0;
  const g = new Uint8ClampedArray(d.length / 4);
  for (let i = 0, j = 0; i < d.length; i += 4, j++) {
    const v = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    g[j] = v;
  }
  const hist = new Array(256).fill(0);
  g.forEach(v => hist[v]++);
  let acc = 0; const n = g.length;
  for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc > n * 0.02) { lo = v; break; } }
  acc = 0;
  for (let v = 255; v >= 0; v--) { acc += hist[v]; if (acc > n * 0.02) { hi = v; break; } }
  const span = Math.max(30, hi - lo);
  for (let i = 0, j = 0; i < d.length; i += 4, j++) {
    const v = Math.max(0, Math.min(255, (g[j] - lo) * 255 / span));
    d[i] = d[i + 1] = d[i + 2] = v;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

async function prepareImage(file) {
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const full = scaled(bmp, bmp.width, bmp.height, 2000);
  const thumb = scaled(bmp, bmp.width, bmp.height, 360);
  const out = {
    file: await canvasToBlob(full, 'image/jpeg', 0.8),
    fileType: 'image/jpeg',
    thumb: await canvasToBlob(thumb, 'image/jpeg', 0.7),
    ocrSource: full,
  };
  bmp.close && bmp.close();
  return out;
}

async function preparePdf(file) {
  await loadScript('vendor/pdf.min.js');
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.js';
  const doc = await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
  let text = '';
  for (let p = 1; p <= Math.min(doc.numPages, 4); p++) {
    const tc = await (await doc.getPage(p)).getTextContent();
    text += tc.items.map(it => it.str + (it.hasEOL ? '\n' : ' ')).join('') + '\n';
  }
  const page = await doc.getPage(1);
  const vp0 = page.getViewport({ scale: 1 });
  const vp = page.getViewport({ scale: Math.min(3, 1800 / Math.max(vp0.width, vp0.height)) });
  const c = document.createElement('canvas');
  c.width = vp.width; c.height = vp.height;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
  await page.render({ canvasContext: ctx, viewport: vp }).promise;
  const thumb = scaled(c, c.width, c.height, 360);
  return {
    file, fileType: 'application/pdf',
    thumb: await canvasToBlob(thumb, 'image/jpeg', 0.7),
    text: text.replace(/[ \t]+/g, ' ').trim(),
    ocrSource: c,
  };
}

/* ---------- Texterkennung (läuft lokal auf dem Handy) ---------- */
let workerPromise = null;
async function getWorker() {
  if (!workerPromise) {
    workerPromise = (async () => {
      await loadScript('vendor/tesseract.min.js');
      const base = new URL('vendor/', location.href).href;
      const w = await Tesseract.createWorker('deu', 1, {
        workerPath: base + 'worker.min.js',
        corePath: base + 'core/',
        langPath: base + 'lang',
        gzip: true,
        cacheMethod: 'none',
        workerBlobURL: false,
      });
      await w.setParameters({ tessedit_pageseg_mode: '4', preserve_interword_spaces: '1' });
      return w;
    })();
    workerPromise.catch(() => { workerPromise = null; });
  }
  return workerPromise;
}

const queue = [];
let queueBusy = false;
const pendingSources = new Map(); // id -> Canvas/Text für die Erkennung

function setOcrStatus() {
  const n = queue.length + (queueBusy ? 1 : 0);
  $('#ocrStatus').hidden = n === 0;
  $('#ocrStatusText').textContent = n > 1 ? `Lese ${n} Belege …` : 'Lese Beleg …';
}

async function runQueue() {
  if (queueBusy) return;
  queueBusy = true;
  while (queue.length) {
    setOcrStatus();
    const id = queue.shift();
    const r = S.receipts.find(x => x.id === id);
    if (!r) continue;
    try {
      let text = '';
      const src = pendingSources.get(id);
      if (src && src.text && src.text.length > 25) {
        text = src.text; // PDF mit Textebene (z. B. Adobe Scan)
      } else {
        let canvas = src && src.canvas;
        if (!canvas) {
          if (r.fileType === 'application/pdf') canvas = (await preparePdf(r.file)).ocrSource;
          else canvas = (await prepareImage(r.file)).ocrSource;
        }
        const w = await getWorker();
        const res = await w.recognize(ocrCanvas(canvas));
        text = res.data.text || '';
      }
      applyText(r, text);
    } catch (e) {
      console.error(e);
      r.ocrError = String(e.message || e);
      r.status = 'inbox';
    }
    pendingSources.delete(id);
    await save(r);
    refresh();
  }
  queueBusy = false;
  setOcrStatus();
}

function applyText(r, text) {
  const x = Extract.analyze(text, { rules: S.rules, validIds: S.categories.map(c => c.id) });
  r.ocrText = text;
  r.status = 'inbox';
  if (r.amount == null) r.amount = x.amount;
  r.alternatives = x.alternatives;
  if (!r.date) r.date = x.date;
  if (r.vatRate == null) r.vatRate = x.vatRate;
  if (!r.merchant) r.merchant = x.merchant;
  r.suggestion = x.suggestion;
}

async function importFiles(files) {
  let n = 0;
  for (const f of files) {
    try {
      const isPdf = f.type === 'application/pdf' || /\.pdf$/i.test(f.name || '');
      const p = isPdf ? await preparePdf(f) : await prepareImage(f);
      const r = {
        id: uid(), createdAt: Date.now(), status: 'processing',
        date: null, amount: null, vatRate: null, merchant: '', category: null, note: '',
        file: p.file, fileType: p.fileType, fileName: f.name || '', thumb: p.thumb,
      };
      pendingSources.set(r.id, { canvas: p.ocrSource, text: p.text });
      await save(r);
      queue.push(r.id);
      n++;
    } catch (e) {
      console.error(e);
      toast('Datei konnte nicht gelesen werden: ' + (f.name || 'Foto'));
    }
  }
  if (n) {
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
    toast(n === 1 ? 'Beleg aufgenommen und wird gelesen' : `${n} Belege aufgenommen`, 'Noch einen', () => $('#camInput').click());
    S.inboxIndex = 0;
    show('inbox');
    runQueue();
  }
}

// Dateien, die per „Teilen“ (z. B. aus Adobe Scan) an die App geschickt wurden
async function takeSharedFiles() {
  if (!('caches' in window)) return;
  const c = await caches.open('share-inbox');
  const keys = await c.keys();
  if (!keys.length) return;
  const files = [];
  for (const k of keys) {
    const resp = await c.match(k);
    const blob = await resp.blob();
    const name = decodeURIComponent(resp.headers.get('x-name') || 'beleg');
    files.push(new File([blob], name, { type: blob.type || resp.headers.get('content-type') || '' }));
    await c.delete(k);
  }
  if (location.search) history.replaceState(null, '', location.pathname);
  await importFiles(files);
}

/* ---------- Ansichten ---------- */
function show(view) {
  S.view = view;
  document.querySelectorAll('.view').forEach(v => { v.hidden = v.id !== 'view-' + view; });
  document.querySelectorAll('.bottomnav [data-view]').forEach(b => b.classList.toggle('active', b.dataset.view === view));
  $('#title').textContent = { home: 'Übersicht', inbox: 'Sortieren', list: 'Belege', more: 'Mehr' }[view];
  refresh();
  window.scrollTo(0, 0);
}

function refresh() {
  const inbox = S.receipts.filter(r => r.status !== 'done');
  $('#inboxBadge').hidden = !inbox.length;
  $('#inboxBadge').textContent = inbox.length;
  if (S.view === 'home') renderHome();
  if (S.view === 'inbox') renderInbox();
  if (S.view === 'list') renderList();
  if (S.view === 'more') renderMore();
}

function years() {
  const ys = new Set(S.receipts.map(yearOf));
  ys.add(new Date().getFullYear());
  return [...ys].sort((a, b) => b - a);
}

function yearChips(onPick) {
  const wrap = document.createElement('div');
  wrap.className = 'chips';
  years().forEach(y => {
    const b = document.createElement('button');
    b.className = 'chip' + (y === S.year ? ' on' : '');
    b.textContent = y;
    b.onclick = () => { S.year = y; onPick(); };
    wrap.appendChild(b);
  });
  return wrap;
}

function totals(year) {
  const done = S.receipts.filter(r => r.status === 'done' && yearOf(r) === year);
  const byCat = new Map(S.categories.map(c => [c.id, { n: 0, sum: 0 }]));
  const byMonth = new Array(12).fill(0);
  let sum = 0;
  done.forEach(r => {
    const a = r.amount || 0;
    sum += a;
    if (!byCat.has(r.category)) byCat.set(r.category, { n: 0, sum: 0 });
    const t = byCat.get(r.category); t.n++; t.sum += a;
    if (r.date) byMonth[+r.date.slice(5, 7) - 1] += a;
  });
  return { done, byCat, byMonth, sum };
}

function renderHome() {
  const el = $('#view-home');
  el.innerHTML = '';
  el.appendChild(yearChips(renderHome));
  const t = totals(S.year);
  const inbox = S.receipts.filter(r => r.status !== 'done').length;
  let html = '';
  if (inbox) {
    html += `<button class="banner" id="goInbox" style="margin-top:12px"><span style="font-size:26px">📥</span>
      <span><b>${inbox} ${inbox === 1 ? 'Beleg wartet' : 'Belege warten'} aufs Sortieren</b><br><span class="small muted">Ein Tipp pro Beleg genügt</span></span></button>`;
  }
  html += `<div class="card" style="margin-top:12px">
    <div class="muted small">Steuerlich relevante Ausgaben ${S.year}</div>
    <div class="total">${eur(t.sum)}</div>
    <div class="muted small">${t.done.length} ${t.done.length === 1 ? 'Beleg' : 'Belege'} sortiert</div>
  </div>`;
  const maxCat = Math.max(1, ...[...t.byCat.values()].map(v => v.sum));
  html += `<div class="card"><h3>Nach Kategorie</h3>`;
  const rows = S.categories.map(c => ({ c, v: t.byCat.get(c.id) })).filter(x => x.v.n);
  if (!rows.length) html += `<p class="hint">Noch keine sortierten Belege in ${S.year}. Tippe unten auf 📷, um den ersten zu scannen.</p>`;
  rows.sort((a, b) => b.v.sum - a.v.sum).forEach(({ c, v }) => {
    html += `<button class="catrow" data-cat="${esc(c.id)}"><span class="ic">${esc(c.icon)}</span>
      <span>${esc(c.name)} <span class="muted small">· ${v.n}</span></span><span class="sum">${eur(v.sum)}</span>
      <span class="bar"><i style="width:${(v.sum / maxCat * 100).toFixed(1)}%"></i></span></button>`;
  });
  html += `</div>`;
  const maxM = Math.max(1, ...t.byMonth);
  html += `<div class="card"><h3>Nach Monat</h3><div class="months">${t.byMonth.map((m, i) =>
    `<div title="${MONTHS[i]}: ${eur(m)}" style="height:${(m / maxM * 100).toFixed(1)}%"></div>`).join('')}</div>
    <div class="monthlbl">${MONTHS.map(m => `<span>${m[0]}</span>`).join('')}</div></div>`;
  html += `<button class="big primary" id="homeExport">📤 Paket für den Steuerberater ${S.year}</button>`;
  html += backupHint();
  el.insertAdjacentHTML('beforeend', html);
  el.querySelector('#goInbox')?.addEventListener('click', () => { S.inboxIndex = 0; show('inbox'); });
  el.querySelectorAll('.catrow').forEach(b => b.onclick = () => { S.listFilter.cat = b.dataset.cat; show('list'); });
  el.querySelector('#homeExport').onclick = () => exportPackage(S.year);
  el.querySelector('#backupNow')?.addEventListener('click', makeBackup);
}

function backupHint() {
  const last = S.settings.lastBackup || 0;
  const n = S.receipts.length;
  if (n < 10 || Date.now() - last < 30 * 864e5) return '';
  return `<div class="card" style="background:var(--warn-soft)"><b>Datensicherung empfohlen</b>
    <p class="hint" style="margin:6px 0">Deine Belege liegen nur auf diesem Handy. Speichere ab und zu eine Sicherung, z. B. in Google Drive.</p>
    <button class="small-btn" id="backupNow">Sicherung jetzt speichern</button></div>`;
}

/* ---------- Sortieren ---------- */
function inboxList() {
  return S.receipts.filter(r => r.status !== 'done').sort((a, b) => a.createdAt - b.createdAt);
}

function renderInbox() {
  const el = $('#view-inbox');
  const list = inboxList();
  if (!list.length) {
    el.innerHTML = `<div class="empty"><div class="big-emoji">✅</div><h2>Alles sortiert</h2>
      <p>Neue Belege landen hier. Tippe auf 📷 zum Scannen oder teile einen Scan aus Adobe Scan an „Belege“.</p></div>`;
    return;
  }
  if (S.inboxIndex >= list.length) S.inboxIndex = 0;
  const r = list[S.inboxIndex];
  el.innerHTML = `<div class="progress"><span class="muted">Beleg ${S.inboxIndex + 1} von ${list.length}</span>
    ${list.length > 1 ? '<button class="small-btn" id="later">Später ›</button>' : ''}</div><div class="card slide-in" id="inboxCard"></div>`;
  renderForm(el.querySelector('#inboxCard'), r, 'inbox');
  el.querySelector('#later')?.addEventListener('click', () => { S.inboxIndex = (S.inboxIndex + 1) % list.length; renderInbox(); });
}

function preview(r) {
  const src = blobUrl('t' + r.id, r.thumb);
  return `<img class="receipt-img" src="${src}" alt="Beleg" data-open="${esc(r.id)}">
    ${r.fileType === 'application/pdf' ? '<span class="pdf-badge">PDF</span> ' : ''}<span class="small muted">Tippen zum Vergrößern</span>`;
}

// Formular für einen Beleg; mode = 'inbox' (Kategorie-Tipp speichert) oder 'edit'
function renderForm(el, r, mode) {
  const sug = r.suggestion && r.suggestion.id;
  const reason = { gelernt: 'so hast du diesen Händler zuletzt sortiert', 'händler': 'bekannter Händler', stichwort: 'Stichwort im Beleg' };
  const cats = [...S.categories];
  if (mode === 'inbox' && sug) cats.sort((a, b) => (b.id === sug) - (a.id === sug));
  const alts = (r.alternatives || []).filter(v => v !== r.amount);
  el.innerHTML = `
    ${preview(r)}
    ${r.status === 'processing' ? '<div class="reading"><span class="spinner"></span>Beleg wird gelesen … du kannst schon ausfüllen.</div>' : ''}
    ${r.ocrError ? '<div class="reading">Text konnte nicht gelesen werden, bitte Betrag selbst eintragen.</div>' : ''}
    <label class="field"><span>Betrag (brutto)</span>
      <input class="amount-input" id="fAmount" inputmode="decimal" placeholder="0,00" value="${esc(num(r.amount))}"></label>
    ${alts.length ? `<div class="chips" id="alts"><span class="small muted" style="align-self:center">Andere Beträge auf dem Beleg:</span>${alts.map(v => `<button class="chip" data-v="${v}">${num(v)}</button>`).join('')}</div>` : ''}
    <div class="two" style="margin-top:10px">
      <label class="field"><span>Datum</span><input type="date" id="fDate" value="${esc(r.date || '')}" max="${todayIso()}"></label>
      <label class="field"><span>MwSt</span><select id="fVat">
        <option value="">unbekannt / gemischt</option>
        ${[19, 7, 0].map(v => `<option value="${v}" ${r.vatRate === v ? 'selected' : ''}>${v} %</option>`).join('')}
      </select></label>
    </div>
    <label class="field"><span>Händler / Aussteller</span><input id="fMerchant" value="${esc(r.merchant || '')}" placeholder="z. B. Aral"></label>
    <label class="field"><span>Notiz (optional)</span><input id="fNote" value="${esc(r.note || '')}" placeholder="z. B. Fahrt zum Kunden, Kongress München"></label>
    ${mode === 'inbox' && sug ? `<div class="suggest">💡 Vorschlag: <b>${esc(cat(sug).name)}</b> (${reason[r.suggestion.reason] || ''})</div>` : ''}
    <div class="small muted" style="margin-top:12px">${mode === 'inbox' ? 'Kategorie antippen – damit ist der Beleg gespeichert:' : 'Kategorie:'}</div>
    <div class="catgrid">${cats.map(c => `<button class="catbtn${c.id === sug && mode === 'inbox' ? ' sug' : ''}${mode === 'edit' && c.id === r.category ? ' cur' : ''}" data-cat="${esc(c.id)}">
      <span class="ic">${esc(c.icon)}</span><span>${esc(c.name)}</span></button>`).join('')}</div>
    ${mode === 'edit' ? `<button class="big primary" id="fSave" style="margin-top:16px">Speichern</button>` : ''}
    <div class="row" style="margin-top:10px">
      <button class="text danger" id="fDelete" style="width:auto">🗑️ ${mode === 'inbox' ? 'Kein Steuerbeleg – löschen' : 'Beleg löschen'}</button>
      <span class="spacer"></span>
      ${mode === 'edit' ? '<button class="text" data-close style="width:auto">Abbrechen</button>' : ''}
    </div>`;

  let chosen = mode === 'edit' ? r.category : null;
  const read = () => ({
    amount: parseNum(el.querySelector('#fAmount').value),
    date: el.querySelector('#fDate').value || null,
    vatRate: el.querySelector('#fVat').value === '' ? null : +el.querySelector('#fVat').value,
    merchant: el.querySelector('#fMerchant').value.trim(),
    note: el.querySelector('#fNote').value.trim(),
  });
  const needAmount = () => {
    const a = el.querySelector('#fAmount');
    a.classList.remove('shake'); void a.offsetWidth; a.classList.add('shake');
    a.focus();
    toast('Bitte zuerst den Betrag eintragen');
  };

  el.querySelector('[data-open]').onclick = () => openOriginal(r);
  el.querySelectorAll('#alts .chip').forEach(b => b.onclick = () => { el.querySelector('#fAmount').value = num(+b.dataset.v); });
  el.querySelectorAll('.catbtn').forEach(b => b.onclick = async () => {
    if (mode === 'edit') {
      chosen = b.dataset.cat;
      el.querySelectorAll('.catbtn').forEach(x => x.classList.toggle('cur', x === b));
      return;
    }
    const v = read();
    if (v.amount == null || v.amount <= 0) return needAmount();
    const before = { ...r };
    Object.assign(r, v, { category: b.dataset.cat, status: 'done', doneAt: Date.now() });
    learn(r);
    await save(r);
    if (!v.date) toast('Gespeichert – ohne Datum zählt der Beleg zum aktuellen Jahr');
    toast(`Gespeichert: ${cat(r.category).icon} ${cat(r.category).name}`, 'Rückgängig', async () => {
      Object.assign(r, before);
      await save(r);
      S.inboxIndex = inboxList().findIndex(x => x.id === r.id);
      show('inbox');
    });
    refresh();
  });
  el.querySelector('#fSave')?.addEventListener('click', async () => {
    const v = read();
    if (v.amount == null || v.amount <= 0) return needAmount();
    Object.assign(r, v, { category: chosen || r.category });
    if (r.category) { r.status = 'done'; learn(r); }
    await save(r);
    $('#editDlg').close();
    toast('Änderungen gespeichert');
    refresh();
  });
  el.querySelector('#fDelete').onclick = async () => {
    if (!confirm('Diesen Beleg wirklich löschen?')) return;
    await DB.del(r.id);
    S.receipts = S.receipts.filter(x => x.id !== r.id);
    dropUrl('t' + r.id); dropUrl('f' + r.id);
    if ($('#editDlg').open) $('#editDlg').close();
    toast('Beleg gelöscht', 'Rückgängig', async () => { await save(r); refresh(); });
    refresh();
  };
  el.querySelectorAll('[data-close]').forEach(b => b.onclick = () => b.closest('dialog').close());
}

function learn(r) {
  const key = Extract.merchantKey(r.merchant);
  if (key && key.length >= 3 && r.category) {
    S.rules[key] = r.category;
    DB.setMeta('rules', S.rules);
  }
}

function openOriginal(r) {
  const body = $('#imgBody');
  const src = blobUrl('f' + r.id, r.file);
  if (r.fileType === 'application/pdf') {
    body.innerHTML = `<div style="padding:70px 16px;color:#fff;text-align:center">
      <img src="${blobUrl('t' + r.id, r.thumb)}" style="max-width:100%;background:#fff"><p><a style="color:#7ee0d3" href="${src}" target="_blank" rel="noopener">PDF öffnen</a></p></div>`;
  } else {
    body.innerHTML = `<img src="${src}" alt="Beleg">`;
  }
  $('#imgDlg').showModal();
}

/* ---------- Liste ---------- */
function renderList() {
  const el = $('#view-list');
  const f = S.listFilter;
  el.innerHTML = '';
  el.appendChild(yearChips(renderList));
  el.insertAdjacentHTML('beforeend', `
    <input class="search" id="q" placeholder="🔍 Suchen (Händler, Notiz, Betrag)" value="${esc(f.q)}" style="margin-top:10px">
    <div class="chips" id="catChips"><button class="chip${!f.cat ? ' on' : ''}" data-cat="">Alle</button>
      ${S.categories.map(c => `<button class="chip${f.cat === c.id ? ' on' : ''}" data-cat="${esc(c.id)}">${esc(c.icon)} ${esc(c.name)}</button>`).join('')}</div>
    <div id="listBody"></div>`);
  el.querySelector('#q').oninput = e => { f.q = e.target.value; drawItems(); };
  el.querySelectorAll('#catChips .chip').forEach(b => b.onclick = () => { f.cat = b.dataset.cat; renderList(); });
  const active = el.querySelector('#catChips .chip.on');
  active && active.scrollIntoView({ inline: 'center', block: 'nearest' });
  drawItems();
}

function drawItems() {
  const f = S.listFilter;
  const q = f.q.trim().toLowerCase();
  const items = S.receipts
    .filter(r => r.status === 'done' && yearOf(r) === S.year && (!f.cat || r.category === f.cat))
    .filter(r => !q || [r.merchant, r.note, num(r.amount), cat(r.category).name].join(' ').toLowerCase().includes(q))
    .sort((a, b) => (b.date || '').localeCompare(a.date || '') || b.createdAt - a.createdAt);
  const body = $('#listBody');
  if (!items.length) {
    body.innerHTML = `<div class="empty"><div class="big-emoji">🗂️</div><p>Keine Belege gefunden.</p></div>`;
    return;
  }
  const sum = items.reduce((s, r) => s + (r.amount || 0), 0);
  let html = `<div class="row" style="margin:12px 4px 0"><span class="muted small">${items.length} Belege</span><span class="spacer"></span><b>${eur(sum)}</b></div>`;
  let month = null;
  items.forEach((r, i) => {
    const m = r.date ? MONTHS_LONG[+r.date.slice(5, 7) - 1] : 'Ohne Datum';
    if (m !== month) {
      if (month !== null) html += '</div>';
      html += `<div class="monthhead">${m}</div><div class="list-card">`;
      month = m;
    }
    const c = cat(r.category);
    html += `<button class="item" data-id="${esc(r.id)}">
      ${r.thumb ? `<img src="${blobUrl('t' + r.id, r.thumb)}" alt="" loading="lazy">` : '<span class="noimg">🧾</span>'}
      <span style="min-width:0"><div class="t">${esc(r.merchant || 'Unbekannt')}</div>
      <div class="s">${c.icon} ${esc(c.name)} · ${fmtDate(r.date)}${r.note ? ' · ' + esc(r.note) : ''}</div></span>
      <span class="a">${eur(r.amount)}</span></button>`;
    if (i === items.length - 1) html += '</div>';
  });
  body.innerHTML = html;
  body.querySelectorAll('.item').forEach(b => b.onclick = () => openEdit(b.dataset.id));
}

function openEdit(id) {
  const r = S.receipts.find(x => x.id === id);
  if (!r) return;
  renderForm($('#editBody'), r, 'edit');
  $('#editDlg').showModal();
}

/* ---------- Mehr: Export, Kategorien, Sicherung ---------- */
function renderMore() {
  const el = $('#view-more');
  el.innerHTML = '';
  el.insertAdjacentHTML('beforeend', `<div class="card"><h3>Export für den Steuerberater</h3>
    <p class="hint" style="margin-top:0">Jahr wählen:</p></div>`);
  const card = el.querySelector('.card');
  card.appendChild(yearChips(renderMore));
  card.insertAdjacentHTML('beforeend', `
    <button class="big primary" id="exPkg">📦 Excel + alle Belege (ZIP)</button>
    <button class="big" id="exXlsx">📊 Nur Excel-Tabelle</button>
    <p class="hint">Die Excel-Datei enthält eine Übersicht mit Summen je Kategorie, alle Einzelbelege und eine Monatsübersicht. Im ZIP liegen zusätzlich die Belegfotos, nach Kategorie sortiert und passend zur Nummer in der Tabelle.</p>
    <label class="field"><span>Dein Name (steht oben in der Excel-Datei)</span><input id="setName" value="${esc(S.settings.name || '')}" placeholder="z. B. Georg Lorenz"></label>`);

  el.insertAdjacentHTML('beforeend', `<div class="card"><h3>Kategorien</h3>
    <div id="catList">${S.categories.map(c => {
      const n = S.receipts.filter(r => r.category === c.id).length;
      return `<div class="setrow" data-id="${esc(c.id)}"><input class="emoji" value="${esc(c.icon)}" maxlength="4" aria-label="Symbol">
        <input class="name" value="${esc(c.name)}" aria-label="Name"><button class="small-btn danger" data-del ${n ? `title="${n} Belege"` : ''}>✕</button></div>`;
    }).join('')}</div>
    <button class="small-btn" id="catAdd" style="margin-top:10px">＋ Kategorie hinzufügen</button></div>`);

  el.insertAdjacentHTML('beforeend', `<div class="card"><h3>Datensicherung</h3>
    <p class="hint" style="margin-top:0">Deine Belege liegen nur auf diesem Handy. Eine Sicherung enthält alle Daten und Fotos; speichere sie z. B. in Google Drive.
    ${S.settings.lastBackup ? `<br>Letzte Sicherung: ${new Date(S.settings.lastBackup).toLocaleDateString('de-DE')}` : ''}</p>
    <button class="big" id="bkSave">💾 Sicherung speichern</button>
    <button class="big" id="bkLoad">♻️ Sicherung wiederherstellen</button>
    <p class="hint small" id="storeInfo"></p></div>`);

  el.insertAdjacentHTML('beforeend', `<div class="card"><h3>So geht’s</h3>
    <p class="hint" style="margin-top:0"><b>Scannen:</b> 📷 unten antippen, Beleg flach und gut beleuchtet fotografieren. Betrag, Datum und Händler werden auf dem Handy erkannt, ohne Internet.<br>
    <b>Adobe Scan:</b> Scan öffnen, „Teilen“ und dann „Belege“ wählen.<br>
    <b>Sortieren:</b> Betrag prüfen und die Kategorie antippen. Die App merkt sich, wie du einen Händler sortierst, und schlägt es beim nächsten Mal vor.<br>
    <b>Jahresende:</b> Hier „Excel + alle Belege“ erstellen und an den Steuerberater schicken.</p></div>`);

  el.querySelector('#exPkg').onclick = () => exportPackage(S.year);
  el.querySelector('#exXlsx').onclick = () => exportExcelOnly(S.year);
  el.querySelector('#setName').onchange = e => { S.settings.name = e.target.value.trim(); DB.setMeta('settings', S.settings); };
  el.querySelectorAll('#catList .setrow').forEach(row => {
    const id = row.dataset.id;
    const c = S.categories.find(x => x.id === id);
    row.querySelector('.emoji').onchange = e => { c.icon = e.target.value.trim() || '🧾'; saveCats(); };
    row.querySelector('.name').onchange = e => { c.name = e.target.value.trim() || c.name; saveCats(); };
    row.querySelector('[data-del]').onclick = async () => {
      const used = S.receipts.filter(r => r.category === id);
      if (S.categories.length <= 1) return;
      const target = S.categories.find(x => x.id !== id && x.id === 'sonstiges') || S.categories.find(x => x.id !== id);
      if (!confirm(used.length ? `${used.length} Belege dieser Kategorie werden nach „${target.name}“ verschoben. Kategorie löschen?` : `Kategorie „${c.name}“ löschen?`)) return;
      for (const r of used) { r.category = target.id; await save(r); }
      S.categories = S.categories.filter(x => x.id !== id);
      saveCats(); renderMore();
    };
  });
  el.querySelector('#catAdd').onclick = () => {
    const name = prompt('Name der neuen Kategorie:');
    if (!name) return;
    S.categories.push({ id: 'k' + uid(), name: name.trim(), icon: '🏷️' });
    saveCats(); renderMore();
  };
  el.querySelector('#bkSave').onclick = makeBackup;
  el.querySelector('#bkLoad').onclick = () => $('#restoreInput').click();
  if (navigator.storage && navigator.storage.estimate) {
    Promise.all([navigator.storage.estimate(), navigator.storage.persisted ? navigator.storage.persisted() : false]).then(([e, p]) => {
      const info = el.querySelector('#storeInfo');
      if (info) info.textContent = `Belegt: ${(e.usage / 1048576).toFixed(1)} MB · ${S.receipts.length} Belege · Speicher ${p ? 'dauerhaft geschützt' : 'nicht dauerhaft geschützt (App installieren hilft)'}`;
    });
  }
}

function saveCats() { DB.setMeta('categories', S.categories); }

/* ---------- Excel ---------- */
function slug(s, n = 24) {
  return (s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/ß/g, 'ss')
    .replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, n) || 'Beleg';
}

function yearRows(year) {
  const order = new Map(S.categories.map((c, i) => [c.id, i]));
  const rows = S.receipts.filter(r => r.status === 'done' && yearOf(r) === year)
    .sort((a, b) => (order.get(a.category) ?? 99) - (order.get(b.category) ?? 99) || (a.date || '').localeCompare(b.date || ''));
  return rows.map((r, i) => {
    const c = cat(r.category);
    const ci = (order.get(r.category) ?? 98) + 1;
    const ext = r.fileType === 'application/pdf' ? 'pdf' : 'jpg';
    const folder = `${String(ci).padStart(2, '0')}_${slug(c.name, 30)}`;
    const nr = i + 1;
    const fname = `${String(nr).padStart(3, '0')}_${r.date || 'ohne-Datum'}_${slug(r.merchant)}_${num(r.amount).replace(/\./g, '')}EUR.${ext}`;
    return { r, c, nr, path: `${folder}/${fname}` };
  });
}

async function buildWorkbook(year) {
  await loadScript('vendor/exceljs.min.js');
  const rows = yearRows(year);
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Belege-App';
  wb.created = new Date();
  const head = { font: { bold: true, color: { argb: 'FFFFFFFF' } }, fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F766E' } } };
  const EUR = '#,##0.00 "€"';
  const thin = { style: 'thin', color: { argb: 'FFD0D7D6' } };

  const ov = wb.addWorksheet('Übersicht');
  const last = rows.length + 1;
  // Blatt „Belege“
  const ws = wb.addWorksheet('Belege', { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = [
    { header: 'Nr.', key: 'nr', width: 6 },
    { header: 'Datum', key: 'date', width: 12 },
    { header: 'Händler / Aussteller', key: 'merchant', width: 28 },
    { header: 'Kategorie', key: 'cat', width: 30 },
    { header: 'Notiz', key: 'note', width: 30 },
    { header: 'Betrag brutto', key: 'amount', width: 15 },
    { header: 'MwSt-Satz', key: 'vat', width: 11 },
    { header: 'MwSt', key: 'vatAmt', width: 12 },
    { header: 'Netto', key: 'net', width: 13 },
    { header: 'Datei im ZIP', key: 'file', width: 48 },
  ];
  ws.getRow(1).eachCell(c => Object.assign(c, head));
  rows.forEach(({ r, c, nr, path }, i) => {
    const n = i + 2;
    const vat = r.vatRate == null ? null : r.vatRate / 100;
    const vatAmt = vat == null ? null : Math.round(r.amount * vat / (1 + vat) * 100) / 100;
    ws.addRow({
      nr, date: r.date ? new Date(r.date + 'T12:00:00') : null, merchant: r.merchant || '', cat: c.name, note: r.note || '',
      amount: r.amount, vat,
      vatAmt: vat == null ? null : { formula: `ROUND(F${n}*G${n}/(1+G${n}),2)`, result: vatAmt },
      net: vat == null ? null : { formula: `F${n}-H${n}`, result: Math.round((r.amount - vatAmt) * 100) / 100 },
      file: path,
    });
  });
  ws.getColumn('date').numFmt = 'dd.mm.yyyy';
  ['amount', 'vatAmt', 'net'].forEach(k => { ws.getColumn(k).numFmt = EUR; });
  ws.getColumn('vat').numFmt = '0%';
  ws.autoFilter = { from: 'A1', to: `J${Math.max(1, rows.length + 1)}` };
  const sumRow = ws.addRow({ merchant: 'Summe', amount: { formula: `SUBTOTAL(9,F2:F${last})`, result: rows.reduce((s, x) => s + x.r.amount, 0) } });
  sumRow.font = { bold: true };
  sumRow.getCell('amount').border = { top: { style: 'double' } };

  // Blatt „Übersicht“
  ov.columns = [{ width: 34 }, { width: 10 }, { width: 18 }, { width: 16 }];
  ov.getCell('A1').value = `Steuerlich relevante Belege ${year}`;
  ov.getCell('A1').font = { bold: true, size: 16 };
  ov.getCell('A2').value = [S.settings.name, `erstellt am ${new Date().toLocaleDateString('de-DE')}`].filter(Boolean).join(' · ');
  ov.getCell('A2').font = { color: { argb: 'FF5D6B69' } };
  const hdr = ov.getRow(4);
  hdr.values = ['Kategorie', 'Anzahl', 'Summe brutto', 'davon MwSt'];
  hdr.eachCell(c => Object.assign(c, head));
  const cats = S.categories.filter(c => rows.some(x => x.r.category === c.id));
  cats.forEach((c, i) => {
    const n = 5 + i;
    const mine = rows.filter(x => x.r.category === c.id);
    const sum = mine.reduce((s, x) => s + x.r.amount, 0);
    const vat = mine.reduce((s, x) => s + (x.r.vatRate == null ? 0 : Math.round(x.r.amount * x.r.vatRate / (100 + x.r.vatRate) * 100) / 100), 0);
    const row = ov.getRow(n);
    row.getCell(1).value = c.name;
    row.getCell(2).value = { formula: `COUNTIF(Belege!$D$2:$D$${last},A${n})`, result: mine.length };
    row.getCell(3).value = { formula: `SUMIF(Belege!$D$2:$D$${last},A${n},Belege!$F$2:$F$${last})`, result: sum };
    row.getCell(4).value = { formula: `SUMIF(Belege!$D$2:$D$${last},A${n},Belege!$H$2:$H$${last})`, result: vat };
    row.eachCell(cell => { cell.border = { bottom: thin }; });
  });
  const tn = 5 + cats.length;
  const tr = ov.getRow(tn);
  tr.getCell(1).value = 'Gesamt';
  tr.getCell(2).value = { formula: `SUM(B5:B${tn - 1})`, result: rows.length };
  tr.getCell(3).value = { formula: `SUM(C5:C${tn - 1})`, result: rows.reduce((s, x) => s + x.r.amount, 0) };
  tr.getCell(4).value = { formula: `SUM(D5:D${tn - 1})`, result: rows.reduce((s, x) => s + (x.r.vatRate == null ? 0 : Math.round(x.r.amount * x.r.vatRate / (100 + x.r.vatRate) * 100) / 100), 0) };
  tr.font = { bold: true };
  tr.eachCell(c => { c.border = { top: { style: 'double' } }; });
  ov.getColumn(3).numFmt = EUR; ov.getColumn(4).numFmt = EUR;
  const noDate = rows.filter(x => !x.r.date).length;
  const mixed = rows.filter(x => x.r.vatRate == null).length;
  let noteRow = tn + 2;
  ov.getCell(`A${noteRow++}`).value = 'Einzelbelege siehe Blatt „Belege“, Belegfotos im ZIP unter der jeweiligen Nr.';
  if (mixed) ov.getCell(`A${noteRow++}`).value = `${mixed} Belege ohne eindeutigen MwSt-Satz (z. B. 7 % und 19 % gemischt) – MwSt dort nicht berechnet.`;
  if (noDate) ov.getCell(`A${noteRow++}`).value = `${noDate} Belege ohne Datum.`;

  // Blatt „Monate“
  const mo = wb.addWorksheet('Monate', { views: [{ state: 'frozen', xSplit: 1, ySplit: 1 }] });
  mo.columns = [{ width: 32 }, ...MONTHS.map(() => ({ width: 11 })), { width: 13 }];
  const mh = mo.getRow(1);
  mh.values = ['Kategorie', ...MONTHS, 'Summe'];
  mh.eachCell(c => Object.assign(c, head));
  cats.forEach((c, i) => {
    const n = 2 + i;
    const row = mo.getRow(n);
    row.getCell(1).value = c.name;
    for (let m = 0; m < 12; m++) {
      const res = rows.filter(x => x.r.category === c.id && x.r.date && +x.r.date.slice(5, 7) === m + 1).reduce((s, x) => s + x.r.amount, 0);
      const to = m === 11 ? `DATE(${year + 1},1,1)` : `DATE(${year},${m + 2},1)`;
      row.getCell(m + 2).value = {
        formula: `SUMIFS(Belege!$F$2:$F$${last},Belege!$D$2:$D$${last},$A${n},Belege!$B$2:$B$${last},">="&DATE(${year},${m + 1},1),Belege!$B$2:$B$${last},"<"&${to})`,
        result: res,
      };
    }
    row.getCell(14).value = { formula: `SUM(B${n}:M${n})`, result: rows.filter(x => x.r.category === c.id && x.r.date).reduce((s, x) => s + x.r.amount, 0) };
  });
  for (let k = 2; k <= 14; k++) mo.getColumn(k).numFmt = EUR;

  wb.worksheets.forEach(w => { w.properties.defaultRowHeight = 18; });
  const buf = await wb.xlsx.writeBuffer();
  return { blob: new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), rows };
}

async function exportExcelOnly(year) {
  const n = S.receipts.filter(r => r.status === 'done' && yearOf(r) === year).length;
  if (!n) return toast(`Keine sortierten Belege in ${year}`);
  toast('Excel wird erstellt …');
  try {
    const { blob } = await buildWorkbook(year);
    deliver(blob, `Belege_${year}${S.settings.name ? '_' + slug(S.settings.name) : ''}.xlsx`, `${n} Belege aus ${year}`);
  } catch (e) { console.error(e); toast('Fehler beim Erstellen: ' + e.message); }
}

async function exportPackage(year) {
  const n = S.receipts.filter(r => r.status === 'done' && yearOf(r) === year).length;
  if (!n) return toast(`Keine sortierten Belege in ${year}`);
  const open = S.receipts.filter(r => r.status !== 'done').length;
  if (open && !confirm(`${open} Belege sind noch nicht sortiert und fehlen im Export. Trotzdem fortfahren?`)) return;
  toast('Paket wird erstellt …', null, null, 10000);
  try {
    const { blob, rows } = await buildWorkbook(year);
    await loadScript('vendor/jszip.min.js');
    const zip = new JSZip();
    const base = `Belege_${year}${S.settings.name ? '_' + slug(S.settings.name) : ''}`;
    zip.file(`${base}.xlsx`, blob);
    rows.forEach(({ r, path }) => zip.file(`Belege/${path}`, r.file));
    const out = await zip.generateAsync({ type: 'blob', compression: 'STORE' });
    deliver(out, `${base}.zip`, `${n} Belege aus ${year}, Excel-Tabelle und alle Belegfotos (${(out.size / 1048576).toFixed(1)} MB)`);
  } catch (e) { console.error(e); toast('Fehler beim Erstellen: ' + e.message); }
}

function deliver(blob, filename, info) {
  $('#toast').hidden = true;
  const file = new File([blob], filename, { type: blob.type });
  $('#deliverTitle').textContent = filename;
  $('#deliverInfo').textContent = info + '. Tipp: Nach dem Herunterladen kannst du die Datei aus „Downloads“ per Mail an den Steuerberater senden.';
  const canShare = navigator.canShare && navigator.canShare({ files: [file] });
  $('#deliverShare').hidden = !canShare;
  $('#deliverShare').onclick = async () => {
    try { await navigator.share({ files: [file], title: filename }); $('#deliverDlg').close(); } catch (e) { /* abgebrochen */ }
  };
  $('#deliverSave').onclick = () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 60000);
    $('#deliverDlg').close();
    toast('Gespeichert unter „Downloads“');
  };
  $('#deliverDlg').showModal();
}

/* ---------- Sicherung ---------- */
async function makeBackup() {
  toast('Sicherung wird erstellt …', null, null, 10000);
  try {
    await loadScript('vendor/jszip.min.js');
    const zip = new JSZip();
    const data = S.receipts.map(r => {
      const { file, thumb, ...rest } = r;
      return rest;
    });
    zip.file('belege.json', JSON.stringify({ version: 1, created: new Date().toISOString(), categories: S.categories, rules: S.rules, settings: S.settings, receipts: data }));
    S.receipts.forEach(r => {
      if (r.file) zip.file(`dateien/${r.id}`, r.file);
      if (r.thumb) zip.file(`vorschau/${r.id}`, r.thumb);
    });
    const out = await zip.generateAsync({ type: 'blob', compression: 'STORE' });
    S.settings.lastBackup = Date.now();
    await DB.setMeta('settings', S.settings);
    deliver(out, `Belege_Sicherung_${todayIso()}.zip`, `${S.receipts.length} Belege. Lege die Datei z. B. in Google Drive ab`);
  } catch (e) { console.error(e); toast('Sicherung fehlgeschlagen: ' + e.message); }
}

async function restoreBackup(file) {
  try {
    await loadScript('vendor/jszip.min.js');
    const zip = await JSZip.loadAsync(file);
    const meta = JSON.parse(await zip.file('belege.json').async('string'));
    const have = new Set(S.receipts.map(r => r.id));
    const neu = meta.receipts.filter(r => !have.has(r.id));
    if (!confirm(`Sicherung vom ${new Date(meta.created).toLocaleDateString('de-DE')}: ${meta.receipts.length} Belege, davon ${neu.length} neu. Neue Belege übernehmen?`)) return;
    for (const r of neu) {
      const f = zip.file(`dateien/${r.id}`), t = zip.file(`vorschau/${r.id}`);
      r.file = f ? new Blob([await f.async('arraybuffer')], { type: r.fileType }) : null;
      r.thumb = t ? new Blob([await t.async('arraybuffer')], { type: 'image/jpeg' }) : null;
      if (r.status === 'processing') r.status = 'inbox';
      await save(r);
    }
    for (const c of meta.categories || []) if (!S.categories.some(x => x.id === c.id)) S.categories.push(c);
    S.rules = { ...(meta.rules || {}), ...S.rules };
    await DB.setMeta('categories', S.categories);
    await DB.setMeta('rules', S.rules);
    toast(`${neu.length} Belege wiederhergestellt`);
    refresh();
  } catch (e) { console.error(e); toast('Das ist keine gültige Sicherung'); }
}

/* ---------- Start ---------- */
async function init() {
  await DB.open();
  S.receipts = (await DB.all()) || [];
  S.categories = (await DB.getMeta('categories')) || DEFAULT_CATEGORIES.map(c => ({ ...c }));
  S.rules = (await DB.getMeta('rules')) || {};
  S.settings = (await DB.getMeta('settings')) || { name: '' };

  document.querySelectorAll('.bottomnav [data-view]').forEach(b => b.onclick = () => { if (b.dataset.view === 'inbox') S.inboxIndex = 0; show(b.dataset.view); });
  $('#scanBtn').onclick = () => $('#scanSheet').showModal();
  $('#scanCam').onclick = () => { $('#scanSheet').close(); $('#camInput').click(); };
  $('#scanPick').onclick = () => { $('#scanSheet').close(); $('#pickInput').click(); };
  $('#camInput').onchange = e => { importFiles([...e.target.files]); e.target.value = ''; };
  $('#pickInput').onchange = e => { importFiles([...e.target.files]); e.target.value = ''; };
  $('#restoreInput').onchange = e => { if (e.target.files[0]) restoreBackup(e.target.files[0]); e.target.value = ''; };
  document.querySelectorAll('dialog').forEach(d => {
    d.addEventListener('click', e => { if (e.target === d) d.close(); });
    d.querySelectorAll(':scope > [data-close]').forEach(b => b.onclick = () => d.close());
  });
  $('#editDlg').addEventListener('close', () => { $('#editBody').innerHTML = ''; });

  // Belege, deren Erkennung beim letzten Mal unterbrochen wurde
  S.receipts.filter(r => r.status === 'processing').forEach(r => queue.push(r.id));
  show(S.receipts.some(r => r.status !== 'done') ? 'inbox' : 'home');
  runQueue();

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(e => console.warn('Service Worker', e));
  }
  await takeSharedFiles();
  document.addEventListener('visibilitychange', () => { if (!document.hidden) takeSharedFiles(); });
}

init().catch(e => {
  console.error(e);
  document.body.insertAdjacentHTML('afterbegin', `<p style="padding:16px;color:#b42318">Start fehlgeschlagen: ${esc(e.message)}</p>`);
});
