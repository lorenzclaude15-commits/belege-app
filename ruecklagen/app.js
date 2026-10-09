// Rücklagen-App: Oberfläche, Eingaben, Bilanz, Termine, Haushalt, Excel-Export
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt0 = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
const fmt2 = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' });
const eur = (v, d) => (d ? fmt2 : fmt0).format(Math.round((+v || 0) * 100) / 100);
const pct = v => `${(v * 100).toLocaleString('de-DE', { maximumFractionDigits: 1 })} %`;
const MONTHS = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const today = () => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), d.getDate()); };
const todayIso = () => Calc.iso(today());
const dmy = s => { const [y, m, d] = s.split('-'); return `${d}.${m}.${y}`; };

// Zahlen wie "7.500", "7500,50" oder "7500.5" verstehen
function parseNum(s) {
  s = String(s ?? '').trim().replace(/\s|€/g, '');
  if (!s) return 0;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : 0;
}
const numStr = v => (v ? String(Math.round(v * 100) / 100).replace('.', ',') : '');

const S = { view: 'home', year: new Date().getFullYear(), period: 'year' };
const D = () => Store.data;

function defaults() {
  const y = new Date().getFullYear(), t = Date.now();
  const ins = (name, interval, kv) => ({ id: uid(), name, amount: 0, interval, kv: !!kv, updatedAt: t });
  return {
    v: 1,
    settings: {
      updatedAt: t, start: `${y}-01-01`, expectedBrutto: 0, taxableIncome: 0, taxAmount: 0, taxPrepay: 0,
      vwYear: 0, vwDay: 28, loanRest: 0, loanYear: 0, loanDay: 1,
    },
    insurances: [
      ins('Private Krankenversicherung', 'm', true), ins('Berufsunfähigkeit', 'm'), ins('Lebensversicherung', 'y'),
      ins('Praxisausfallversicherung', 'y'), ins('Rechtsschutz', 'y'), ins('Unfallversicherung', 'y'), ins('Privathaftpflicht', 'y'),
    ],
    household: ['Haushalt / Essen', 'Miete', 'Unterhalt', 'Auto-Versicherung', 'Benzin'].map(name => ({ id: uid(), name, amount: 0, updatedAt: t })),
    entries: [],
    prepay: {},
    local: { pristine: true }, // bleibt auf dem Gerät, wird nicht synchronisiert
  };
}

async function persist() {
  if (D().local?.pristine) delete D().local.pristine;
  try { await Store.save(); } catch (e) { toast('Speichern fehlgeschlagen: ' + e.message); }
  refresh();
  scheduleSync();
}

// ---------- Synchronisation ----------
const syncReady = () => !!(Store.unlocked && D().local?.sync?.token && D().local?.sync?.pass);
function scheduleSync() {
  clearTimeout(scheduleSync.t);
  if (syncReady()) scheduleSync.t = setTimeout(() => syncNow(false), 2500);
}
async function syncNow(loud) {
  if (!syncReady() || syncNow.busy) return;
  if (!navigator.onLine) { if (loud) toast('Offline, Abgleich später'); return; }
  syncNow.busy = true;
  try {
    const merged = await Sync.run(D());
    if (!Store.unlocked) return;
    Store.data = merged;
    await Store.save();
    refresh();
    if (loud) toast('Abgeglichen');
  } catch (e) {
    if (loud) toast(e.message);
    else console.warn('Sync', e);
  } finally { syncNow.busy = false; }
}

function toast(text, ms = 3500) {
  $('#toastText').textContent = text;
  $('#toast').hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => { $('#toast').hidden = true; }, ms);
}

// ---------- Sperre ----------
function showLock(mode) {
  const el = $('#lock');
  el.hidden = false;
  const setup = mode === 'setup';
  el.innerHTML = `
    <img class="logo" src="icons/icon-192.png" alt="">
    <h2>${setup ? 'PIN festlegen' : 'Rücklagen'}</h2>
    <p class="hint">${setup ? 'Mindestens 6 Ziffern. Damit werden deine Daten auf diesem Gerät verschlüsselt. Ohne PIN kommt niemand an die Zahlen, auch du nicht, also gut merken.' : 'PIN eingeben'}</p>
    <input id="pin1" type="password" inputmode="numeric" autocomplete="off" placeholder="••••••">
    ${setup ? '<input id="pin2" type="password" inputmode="numeric" autocomplete="off" placeholder="wiederholen">' : ''}
    <div class="err" id="pinErr"></div>
    <button class="big primary" id="pinGo">${setup ? 'Loslegen' : 'Entsperren'}</button>`;
  const go = async () => {
    const p1 = $('#pin1').value.trim();
    $('#pinErr').textContent = '';
    if (setup) {
      if (!/^\d{6,}$/.test(p1)) { $('#pinErr').textContent = 'Bitte mindestens 6 Ziffern.'; return; }
      if (p1 !== $('#pin2').value.trim()) { $('#pinErr').textContent = 'Die beiden PINs sind verschieden.'; return; }
      $('#pinGo').disabled = true;
      await Store.create(p1, defaults());
      S.view = 'more';
    } else {
      $('#pinGo').disabled = true;
      try { await Store.unlock(p1); } catch (e) {
        $('#pinGo').disabled = false; $('#pin1').value = '';
        $('#pinErr').textContent = 'PIN falsch.'; return;
      }
    }
    el.hidden = true; el.innerHTML = '';
    show(S.view);
    syncNow(false);
  };
  $('#pinGo').onclick = go;
  el.querySelectorAll('input').forEach(i => i.addEventListener('keydown', e => { if (e.key === 'Enter') go(); }));
  setTimeout(() => $('#pin1').focus(), 50);
}

function lockNow() {
  Store.lock();
  document.querySelectorAll('dialog[open]').forEach(d => d.close());
  ['home', 'year', 'house', 'more'].forEach(v => { $('#view-' + v).innerHTML = ''; });
  showLock('unlock');
}

// ---------- Navigation ----------
const TITLES = { home: 'Start', year: 'Bilanz', house: 'Haushalt', more: 'Mehr' };
function show(view) {
  S.view = view;
  document.querySelectorAll('.view').forEach(v => { v.hidden = v.id !== 'view-' + view; });
  document.querySelectorAll('.bottomnav [data-view]').forEach(b => b.classList.toggle('active', b.dataset.view === view));
  $('#title').textContent = TITLES[view];
  refresh();
  window.scrollTo(0, 0);
}
function refresh() {
  if (!Store.unlocked) return;
  ({ home: renderHome, year: renderYear, house: renderHouse, more: renderMore })[S.view]();
}

function years() {
  const ys = new Set([new Date().getFullYear()]);
  Calc.live(D().entries).forEach(e => ys.add(+e.date.slice(0, 4)));
  return [...ys].sort((a, b) => b - a);
}
function asOf(year) {
  const t = today();
  return t.getFullYear() === year ? t : new Date(year, 11, 31);
}
function needsSetup() {
  const s = D().settings;
  return !s.expectedBrutto || !s.taxableIncome;
}

// ---------- Start ----------
function renderHome() {
  const el = $('#view-home'), year = new Date().getFullYear(), data = D();
  const chk = Calc.check(data, year, today());
  const rated = Calc.rated(data, year);
  const over = rated.filter(e => e.over);
  const r = Calc.rule(data, year);
  const open = Calc.schedule(data, year).filter(i => i.date >= todayIso() && !(i.kind === 'tax' && i.paid));
  const firsts = ['tax', 'vw'].map(k => open.find(i => i.kind === k)).filter(Boolean);
  const upcoming = [...firsts, ...open.filter(i => !firsts.includes(i))].slice(0, 4).sort((a, b) => a.date.localeCompare(b.date));
  const okNow = chk.available >= 0;

  el.innerHTML = `
    ${needsSetup() ? `<button class="banner" id="goSetup"><span style="font-size:26px">⚙️</span><span><b>Erst Werte eintragen</b><br><span class="small">Unter „Mehr“: Steuer, Kredit, Versorgungswerk, Versicherungen</span></span></button>` : ''}
    ${!okNow ? `<div class="alert"><b>⚠️ Zu viel entnommen</b>Du hast ${eur(-chk.available)} mehr entnommen, als nach Steuer, Kredit, Versorgungswerk und Versicherungen bis heute übrig ist.</div>` : ''}
    ${over.length ? `<div class="alert"><b>⚠️ ${over.length} ${over.length === 1 ? 'Entnahme liegt' : 'Entnahmen liegen'} über dem Vorschlag</b>Zusammen ${eur(over.reduce((a, e) => a + e.netto - e.suggested, 0))} zu viel. Details unten in der Liste.</div>` : ''}
    <div class="card hero">
      <div class="lbl">Jetzt noch sicher entnehmbar (${year})</div>
      <div class="total ${okNow ? 'ok' : 'bad'}">${eur(chk.available)}</div>
      <div class="small muted">Brutto bisher ${eur(chk.brutto)} · entnommen ${eur(chk.netto)}</div>
    </div>

    <div class="card calc">
      <h2>Brutto → Netto</h2>
      <label class="field"><span>Brutto-Eingang</span>
        <input id="calcIn" class="amount-input" inputmode="decimal" placeholder="0" autocomplete="off"></label>
      <div class="breakdown" id="calcOut"></div>
      <button class="big primary" id="calcBook">Als Eingang buchen</button>
      <p class="hint small">Regel ${year}: ${pct(r.net)} vom Brutto darfst du entnehmen (Steuer ${pct(r.tax)}, Kredit ${pct(r.loan)}, Versorgungswerk ${pct(r.vw)}, Versicherungen ${pct(r.ins)}).</p>
    </div>

    <div class="card">
      <h2>Nächste Termine</h2>
      ${upcoming.length ? upcoming.map(dueRow).join('') : '<p class="hint">Keine offenen Termine in diesem Jahr.</p>'}
    </div>

    <div class="monthhead">Eingänge ${year}</div>
    ${rated.length ? `<div class="list-card">${rated.slice().reverse().map(entryRow).join('')}</div>`
      : '<div class="empty"><div class="big-emoji">💶</div><p>Noch keine Eingänge. Tippe auf ＋, um einen Brutto-Eingang zu erfassen.</p></div>'}`;

  const out = () => {
    const b = parseNum($('#calcIn').value), x = Calc.split(data, year, b);
    $('#calcOut').innerHTML = breakdownHtml(b, x);
  };
  $('#calcIn').oninput = out; out();
  $('#calcBook').onclick = () => openEntry(null, parseNum($('#calcIn').value));
  $('#goSetup')?.addEventListener('click', () => show('more'));
  el.querySelectorAll('[data-entry]').forEach(b => b.onclick = () => openEntry(b.dataset.entry));
}

function breakdownHtml(b, x) {
  return `
    <div class="ln"><span>Brutto</span><span>${eur(b)}</span></div>
    <div class="ln"><span class="m">− Steuer + Soli</span><span class="m">${eur(x.tax)}</span></div>
    <div class="ln"><span class="m">− Kredit</span><span class="m">${eur(x.loan)}</span></div>
    <div class="ln"><span class="m">− Ärzteversorgung</span><span class="m">${eur(x.vw)}</span></div>
    <div class="ln"><span class="m">− Versicherungen inkl. PKV</span><span class="m">${eur(x.ins)}</span></div>
    <div class="ln sum"><span>Netto-Entnahme</span><span>${eur(x.netto)}</span></div>`;
}

function entryRow(e) {
  return `<button class="item entry" data-entry="${e.id}">
    <span><span class="t">${dmy(e.date)} · Brutto ${eur(e.brutto)}</span>
      <span class="s">Vorschlag ${eur(e.suggested)}${e.note ? ' · ' + esc(e.note) : ''}</span></span>
    <span class="a ${e.over ? 'warn' : ''}">${e.over ? '⚠️ ' : ''}${eur(e.netto)}</span></button>`;
}

function dueRow(i) {
  const [y, m, d] = i.date.split('-');
  const past = i.date < todayIso();
  const ic = { tax: '🏛️', vw: '🩺', loan: '🏦', ins: '🛡️' }[i.kind];
  const tax = i.kind === 'tax';
  return `<div class="due ${past && (!tax || i.paid) ? 'past' : ''}">
    <div class="d"><b>${d}</b><span>${MONTHS[+m - 1]}</span></div>
    <div><div class="t">${ic} ${esc(i.name)}</div>
      <div class="s">${tax ? (i.paid ? 'bezahlt' : past ? 'offen, Termin vorbei' : 'offen') : i.kind === 'vw' ? 'Abbuchung ca. zum Monatsende' : 'Lastschrift'}</div></div>
    <div class="a">${eur(i.amount)}</div></div>`;
}

// ---------- Eingang erfassen ----------
function openEntry(id, brutto) {
  const data = D();
  const e = id ? data.entries.find(x => x.id === id) : { date: todayIso(), brutto: brutto || 0, netto: null, note: '' };
  const dlg = $('#entryDlg');
  $('#entryBody').innerHTML = `
    <h2>${id ? 'Eingang bearbeiten' : 'Neuer Eingang'}</h2>
    <div class="two">
      <label class="field"><span>Datum</span><input id="eDate" type="date" value="${e.date}"></label>
      <label class="field"><span>Brutto</span><input id="eBrutto" inputmode="decimal" value="${numStr(e.brutto)}" placeholder="0"></label>
    </div>
    <div class="breakdown" id="eOut"></div>
    <label class="field"><span>Tatsächlich aufs Privatkonto überwiesen</span>
      <input id="eNetto" class="amount-input" inputmode="decimal" value="${e.netto != null ? numStr(e.netto) : ''}"></label>
    <div id="eWarn"></div>
    <label class="field"><span>Notiz</span><input id="eNote" value="${esc(e.note)}" placeholder="optional"></label>
    <button class="big primary" id="eSave">Speichern</button>
    ${id ? '<button class="text danger" id="eDel">Eingang löschen</button>' : ''}
    <button class="text" id="eCancel">Abbrechen</button>`;
  let touched = e.netto != null;
  const upd = () => {
    const year = +($('#eDate').value || todayIso()).slice(0, 4);
    const b = parseNum($('#eBrutto').value), x = Calc.split(data, year, b);
    $('#eOut').innerHTML = breakdownHtml(b, x);
    if (!touched) $('#eNetto').value = numStr(Math.floor(x.netto));
    const n = parseNum($('#eNetto').value);
    $('#eWarn').innerHTML = n - x.netto > 0.5
      ? `<div class="alert"><b>⚠️ ${eur(n - x.netto)} über dem Vorschlag</b>Dann reicht das Brutto nicht mehr für Steuer, Kredit, Versorgungswerk und Versicherungen.</div>` : '';
  };
  $('#eBrutto').oninput = upd; $('#eDate').oninput = upd;
  $('#eNetto').oninput = () => { touched = true; upd(); };
  upd();
  $('#eSave').onclick = async () => {
    const rec = { date: $('#eDate').value || todayIso(), brutto: parseNum($('#eBrutto').value), netto: parseNum($('#eNetto').value), note: $('#eNote').value.trim(), updatedAt: Date.now() };
    if (!rec.brutto) { $('#eBrutto').classList.add('shake'); setTimeout(() => $('#eBrutto').classList.remove('shake'), 400); return; }
    if (id) Object.assign(e, rec); else data.entries.push({ id: uid(), ...rec });
    dlg.close();
    await persist();
    toast('Gespeichert');
  };
  if (id) $('#eDel').onclick = async () => {
    if (!confirm('Diesen Eingang löschen?')) return;
    Object.assign(e, { deleted: true, updatedAt: Date.now() });
    dlg.close(); await persist();
  };
  $('#eCancel').onclick = () => dlg.close();
  dlg.showModal();
}

// ---------- Bilanz ----------
function periodRange(year) {
  const t = asOf(year), m = t.getMonth();
  const pad = n => String(n).padStart(2, '0');
  const last = mm => new Date(year, mm + 1, 0).getDate();
  switch (S.period) {
    case 'month': return { from: `${year}-${pad(m + 1)}-01`, to: `${year}-${pad(m + 1)}-${last(m)}`, label: `${MONTHS[m]} ${year}` };
    case 'quarter': { const q0 = m - (m % 3); return { from: `${year}-${pad(q0 + 1)}-01`, to: `${year}-${pad(q0 + 3)}-${last(q0 + 2)}`, label: `Q${q0 / 3 + 1} ${year}` }; }
    case 'todate': return { from: `${year}-01-01`, to: Calc.iso(t), label: `bis ${dmy(Calc.iso(t))}` };
    default: return { from: `${year}-01-01`, to: `${year}-12-31`, label: `Jahr ${year}` };
  }
}

function renderYear() {
  const el = $('#view-year'), data = D(), year = S.year;
  const p = periodRange(year), t = Calc.totals(data, year, p.from, p.to);
  const chk = Calc.check(data, year, asOf(year));
  const r = Calc.rule(data, year), s = data.settings;
  const it = Calc.insuranceTable(data, year, asOf(year));
  const sched = Calc.schedule(data, year);
  const mon = Calc.monthly(data, year);
  const expB = +s.expectedBrutto || 0;
  const kpi = (l, v, sub) => `<div class="kpi"><div class="l">${l}</div><div class="v">${v}</div>${sub ? `<div class="s">${sub}</div>` : ''}</div>`;

  el.innerHTML = `
    <div class="chips" style="margin-bottom:10px">${years().map(y => `<button class="chip ${y === year ? 'on' : ''}" data-year="${y}">${y}</button>`).join('')}</div>
    <div class="seg">${[['month', 'Monat'], ['quarter', 'Quartal'], ['year', 'Jahr'], ['todate', 'bis heute']].map(([k, l]) => `<button data-period="${k}" class="${S.period === k ? 'on' : ''}">${l}</button>`).join('')}</div>
    <div class="monthhead" style="margin-top:0">${p.label}</div>
    <div class="kpis">
      ${kpi('Brutto', eur(t.brutto))}
      ${kpi('Netto entnommen', eur(t.netto))}
      ${kpi('Steuer voraussichtlich', eur(t.taxReserve), `${pct(r.tax)} vom Brutto`)}
      ${kpi('Steuer abgeführt', eur(t.taxPaid), `fällig ${eur(t.taxDue)}`)}
      ${kpi('Ärzteversorgung', eur(t.vw), 'Abbuchungen im Zeitraum')}
      ${kpi('Kredit', eur(t.loan), `Restschuld ca. ${eur(Calc.loanRest(data, asOf(year)))}`)}
      ${kpi('Krankenkasse', eur(t.kv))}
      ${kpi('Versicherungen gesamt', eur(t.ins), 'inkl. Krankenkasse')}
    </div>

    <div class="card">
      <h2>Rücklagen-Check bis ${dmy(Calc.iso(asOf(year)))}</h2>
      <div class="breakdown">
        <div class="ln"><span>Brutto</span><span>${eur(chk.brutto)}</span></div>
        <div class="ln"><span class="m">− Steuer-Rücklage</span><span class="m">${eur(chk.need.tax)}</span></div>
        <div class="ln"><span class="m">− Kredit (anteilig)</span><span class="m">${eur(chk.need.loan)}</span></div>
        <div class="ln"><span class="m">− Ärzteversorgung (anteilig)</span><span class="m">${eur(chk.need.vw)}</span></div>
        <div class="ln"><span class="m">− Versicherungen (anteilig)</span><span class="m">${eur(chk.need.ins)}</span></div>
        <div class="ln"><span>= sicher entnehmbar</span><span>${eur(chk.safe)}</span></div>
        <div class="ln"><span class="m">− schon entnommen</span><span class="m">${eur(chk.netto)}</span></div>
        <div class="ln sum"><span>${chk.available >= 0 ? 'Noch frei' : 'Zu viel entnommen'}</span><span style="color:var(${chk.available >= 0 ? '--ok' : '--danger'})">${eur(chk.available)}</span></div>
      </div>
    </div>

    <div class="card">
      <h2>Prognose ${year}</h2>
      <div class="breakdown">
        <div class="ln"><span>Erwartetes Brutto</span><span>${eur(expB)}</span></div>
        <div class="ln"><span class="m">Steuer + Soli erwartet</span><span class="m">${eur(expB * r.tax)}</span></div>
        <div class="ln"><span class="m">Steuervorauszahlungen gesamt</span><span class="m">${eur(sched.filter(i => i.kind === 'tax').reduce((a, i) => a + i.amount, 0))}</span></div>
        <div class="ln"><span class="m">Ärzteversorgung im Jahr</span><span class="m">${eur(sched.filter(i => i.kind === 'vw').reduce((a, i) => a + i.amount, 0))}</span></div>
        <div class="ln"><span class="m">Kredit + Versicherungen im Jahr</span><span class="m">${eur(sched.filter(i => i.kind === 'loan' || i.kind === 'ins').reduce((a, i) => a + i.amount, 0))}</span></div>
        <div class="ln sum"><span>Netto möglich</span><span>${eur(expB * r.net)}</span></div>
        <div class="ln"><span class="m">pro Monat (${r.months} Monate)</span><span class="m">${eur((expB * r.net) / (r.months || 12))}</span></div>
      </div>
    </div>

    <div class="card">
      <h2>Versicherungen</h2>
      <div class="scroll-x"><table class="tbl">
        <tr><th>Versicherung</th><th>Monat</th><th>Quartal</th><th>Jahr</th><th>bis heute</th></tr>
        ${it.rows.map(x => `<tr><td>${esc(x.name)}<div class="small muted">${x.interval}</div></td><td>${eur(x.month)}</td><td>${eur(x.quarter)}</td><td>${eur(x.year)}</td><td>${eur(x.toDate)}</td></tr>`).join('')}
        <tr class="sum"><td>Summe</td><td>${eur(it.sum.month)}</td><td>${eur(it.sum.quarter)}</td><td>${eur(it.sum.year)}</td><td>${eur(it.sum.toDate)}</td></tr>
      </table></div>
      <p class="hint small">„Jahr“ = ${it.months} Monate ab Start. „bis heute“ = tatsächlich fällig gewordene Beiträge.</p>
    </div>

    <div class="card">
      <h2>Monate</h2>
      <div class="scroll-x"><table class="tbl">
        <tr><th>Monat</th><th>Brutto</th><th>Netto</th><th>Steuer</th><th>Fixkosten</th><th>Σ Brutto</th></tr>
        ${mon.filter(m => m.brutto || m.netto || m.vw || m.loan || m.ins || m.taxDue).map(m => `<tr><td>${MONTHS[m.month]}</td><td>${eur(m.brutto)}</td><td>${eur(m.netto)}</td><td>${eur(m.taxReserve)}</td><td>${eur(m.vw + m.loan + m.ins)}</td><td>${eur(m.cumBrutto)}</td></tr>`).join('')}
      </table></div>
    </div>

    <div class="card">
      <h2>Termine ${year}</h2>
      <p class="hint small">Steuervorauszahlungen abhaken, wenn bezahlt. Betrag antippen zum Ändern.</p>
      ${sched.filter(i => i.kind === 'tax' || i.kind === 'vw').map(i => i.kind === 'tax' ? taxRow(i) : dueRow(i)).join('')}
      <details><summary class="text" style="padding:12px 0;color:var(--primary);font-weight:600">Alle Lastschriften für Kredit und Versicherungen</summary>
        ${sched.filter(i => i.kind === 'loan' || i.kind === 'ins').map(dueRow).join('')}</details>
    </div>

    <button class="big primary" id="xlsBtn">📗 Excel für ${year} erstellen</button>`;

  el.querySelectorAll('[data-year]').forEach(b => b.onclick = () => { S.year = +b.dataset.year; renderYear(); });
  el.querySelectorAll('[data-period]').forEach(b => b.onclick = () => { S.period = b.dataset.period; renderYear(); });
  el.querySelectorAll('[data-paid]').forEach(c => c.onchange = () => setPrepay(c.dataset.paid, { paid: c.checked }));
  el.querySelectorAll('[data-amt]').forEach(b => b.onclick = () => {
    const v = prompt('Betrag dieser Vorauszahlung in €', numStr(+b.dataset.val));
    if (v != null) setPrepay(b.dataset.amt, { amount: parseNum(v) });
  });
  $('#xlsBtn').onclick = () => exportExcel(year);
}

function taxRow(i) {
  const [y, m, d] = i.date.split('-');
  const late = !i.paid && i.date < todayIso();
  return `<div class="due ${i.paid ? 'past' : ''}">
    <div class="d"><b>${d}</b><span>${MONTHS[+m - 1]}</span></div>
    <div><div class="t">🏛️ Steuervorauszahlung</div><div class="s" style="${late ? 'color:var(--danger)' : ''}">${i.paid ? 'bezahlt' : late ? 'offen, Termin vorbei' : 'offen'}</div></div>
    <div class="row"><button class="small-btn" data-amt="${i.date}" data-val="${i.amount}">${eur(i.amount)}</button>
      <input type="checkbox" class="check" data-paid="${i.date}" ${i.paid ? 'checked' : ''} aria-label="bezahlt"></div></div>`;
}

async function setPrepay(date, patch) {
  const data = D(), cur = data.prepay[date] || {};
  data.prepay[date] = { amount: cur.amount ?? (+data.settings.taxPrepay || 0), paid: !!cur.paid, ...patch, updatedAt: Date.now() };
  await persist();
}

// ---------- Haushalt ----------
function renderHouse() {
  const el = $('#view-house'), data = D(), year = new Date().getFullYear();
  const chk = Calc.check(data, year, today());
  const months = Math.max(1, chk.monthsEq);
  const avgNet = chk.netto / months;
  const hh = Calc.household(data);
  const r = Calc.rule(data, year);
  const planNet = (+data.settings.expectedBrutto || 0) * r.net / (r.months || 12);
  el.innerHTML = `
    <div class="card hero">
      <div class="lbl">Nach Haushalt frei pro Monat</div>
      <div class="total ${avgNet - hh >= 0 ? 'ok' : 'bad'}">${eur(avgNet - hh)}</div>
      <div class="small muted">Ø entnommen ${eur(avgNet)} − Haushalt ${eur(hh)}</div>
    </div>
    <div class="card">
      <div class="breakdown">
        <div class="ln"><span>Netto möglich laut Prognose / Monat</span><span>${eur(planNet)}</span></div>
        <div class="ln"><span class="m">− Haushalt / Monat</span><span class="m">${eur(hh)}</span></div>
        <div class="ln sum"><span>Rest laut Prognose</span><span>${eur(planNet - hh)}</span></div>
      </div>
    </div>
    <div class="card">
      <h2>Monatliche Haushaltskosten</h2>
      <p class="hint small">Werden vom Netto bezahlt, nicht vom Geschäftskonto.</p>
      <div id="hhList">${Calc.live(data.household).map(h => `<div class="edrow hh">
        <input data-hname="${h.id}" value="${esc(h.name)}"><input class="num" inputmode="decimal" data-hamt="${h.id}" value="${numStr(h.amount)}" placeholder="0">
        <button data-hdel="${h.id}" aria-label="löschen">✕</button></div>`).join('')}</div>
      <button class="text" id="hhAdd">＋ Posten hinzufügen</button>
    </div>`;
  const find = id => data.household.find(h => h.id === id);
  el.querySelectorAll('[data-hname]').forEach(i => i.onchange = () => { Object.assign(find(i.dataset.hname), { name: i.value, updatedAt: Date.now() }); persist(); });
  el.querySelectorAll('[data-hamt]').forEach(i => i.onchange = () => { Object.assign(find(i.dataset.hamt), { amount: parseNum(i.value), updatedAt: Date.now() }); persist(); });
  el.querySelectorAll('[data-hdel]').forEach(b => b.onclick = () => { Object.assign(find(b.dataset.hdel), { deleted: true, updatedAt: Date.now() }); persist(); });
  $('#hhAdd').onclick = () => { data.household.push({ id: uid(), name: 'Neuer Posten', amount: 0, updatedAt: Date.now() }); persist(); };
}

// ---------- Mehr ----------
const FIELDS = [
  ['start', 'Start Praxis / Rechnungszeitraum ab', 'date'],
  ['expectedBrutto', 'Erwartetes Brutto im Jahr (ab Start)'],
  ['taxableIncome', 'Erwartetes zu versteuerndes Einkommen'],
  ['taxAmount', 'Erwartete Einkommensteuer + Soli im Jahr'],
  ['taxPrepay', 'Steuervorauszahlung pro Quartal'],
  ['vwYear', 'Ärzteversorgung Beitrag pro Jahr'],
  ['vwDay', 'Ärzteversorgung Abbuchung ca. am Tag', 'day'],
  ['loanRest', 'Kredit Restschuld zum Start'],
  ['loanYear', 'Kredit Raten pro Jahr'],
  ['loanDay', 'Kreditrate fällig am Tag', 'day'],
];

function renderMore() {
  const el = $('#view-more'), data = D(), s = data.settings;
  const r = Calc.rule(data, new Date().getFullYear());
  el.innerHTML = `
    <div class="card setgrid">
      <h2>Werte</h2>
      ${FIELDS.map(([k, l, type]) => `<label class="field"><span>${l}</span>
        <input data-set="${k}" ${type === 'date' ? `type="date" value="${s[k] || ''}"` : `inputmode="${type === 'day' ? 'numeric' : 'decimal'}" value="${type === 'day' ? (s[k] || '') : numStr(s[k])}" placeholder="0"`}></label>`).join('')}
      <p class="hint small">Steuersatz daraus: ${pct(r.tax)}. Entnahme-Regel: ${pct(r.net)} vom Brutto.</p>
    </div>

    <div class="card">
      <h2>Versicherungen</h2>
      <p class="hint small">Beitrag so eintragen, wie er abgebucht wird.</p>
      ${Calc.live(data.insurances).map(i => `<div class="edrow">
        <input data-iname="${i.id}" value="${esc(i.name)}">
        <input class="num" inputmode="decimal" data-iamt="${i.id}" value="${numStr(i.amount)}" placeholder="0">
        <select data-iint="${i.id}">${Object.entries(Calc.INTERVAL_NAME).map(([k, l]) => `<option value="${k}" ${i.interval === k ? 'selected' : ''}>${l}</option>`).join('')}</select>
        <button data-idel="${i.id}" aria-label="löschen">✕</button></div>`).join('')}
      <button class="text" id="insAdd">＋ Versicherung hinzufügen</button>
    </div>

    <div class="card">
      <h2>Daten</h2>
      <button class="big" id="xls">📗 Excel-Jahresbilanz ${S.year}</button>
      <button class="big" id="bak">💾 Sicherung speichern</button>
      <button class="big" id="res">📂 Sicherung / Startwerte laden</button>
      <p class="hint small">Die Sicherung ist mit deiner PIN verschlüsselt. Leg sie z. B. in Google Drive ab, falls das Handy verloren geht.</p>
    </div>

    <div class="card">
      <h2>Mit PC synchronisieren</h2>
      ${D().local?.sync?.token ? `<p class="hint small">Eingerichtet. ${D().local.sync.last ? 'Zuletzt abgeglichen ' + new Date(D().local.sync.last).toLocaleString('de-DE') : 'Noch nicht abgeglichen'}.</p>
        <button class="big" id="syncGo">🔄 Jetzt abgleichen</button>
        <button class="text danger" id="syncOff">Synchronisation auf diesem Gerät ausschalten</button>`
      : `<p class="hint small">Handy und PC gleichen sich über ein geheimes GitHub-Gist ab. Dort liegt nur ein verschlüsselter Block, lesbar nur mit deinem Sync-Passwort. Auf beiden Geräten denselben Schlüssel und dasselbe Passwort eintragen.</p>
        <label class="field"><span>GitHub-Schlüssel (Token mit Recht „gist“)</span><input id="syncTok" autocomplete="off" placeholder="ghp_…"></label>
        <label class="field"><span>Sync-Passwort (mind. 10 Zeichen)</span><input id="syncPass" type="password" autocomplete="new-password"></label>
        <button class="big primary" id="syncSet">Synchronisation einschalten</button>`}
    </div>

    <div class="card">
      <h2>Sicherheit</h2>
      <p class="hint small">Alle Daten liegen nur auf diesem Gerät, verschlüsselt (AES-256). Die App sperrt sich nach 3 Minuten im Hintergrund.</p>
      <button class="big" id="pinChg">🔑 PIN ändern</button>
      <button class="text danger" id="wipe">Alle Daten auf diesem Gerät löschen</button>
    </div>`;

  el.querySelectorAll('[data-set]').forEach(i => i.onchange = () => {
    const k = i.dataset.set;
    s[k] = i.type === 'date' ? i.value : parseNum(i.value);
    s.updatedAt = Date.now();
    persist();
  });
  const ins = id => data.insurances.find(x => x.id === id);
  const touch = (id, patch) => { Object.assign(ins(id), patch, { updatedAt: Date.now() }); persist(); };
  el.querySelectorAll('[data-iname]').forEach(i => i.onchange = () => touch(i.dataset.iname, { name: i.value }));
  el.querySelectorAll('[data-iamt]').forEach(i => i.onchange = () => touch(i.dataset.iamt, { amount: parseNum(i.value) }));
  el.querySelectorAll('[data-iint]').forEach(i => i.onchange = () => touch(i.dataset.iint, { interval: i.value }));
  el.querySelectorAll('[data-idel]').forEach(b => b.onclick = () => { if (confirm('Versicherung entfernen?')) touch(b.dataset.idel, { deleted: true }); });
  $('#insAdd').onclick = () => { data.insurances.push({ id: uid(), name: 'Neue Versicherung', amount: 0, interval: 'm', updatedAt: Date.now() }); persist(); };
  $('#xls').onclick = () => exportExcel(S.year);
  $('#syncGo')?.addEventListener('click', () => syncNow(true));
  $('#syncOff')?.addEventListener('click', async () => {
    if (!confirm('Synchronisation hier ausschalten? Die Daten auf diesem Gerät bleiben erhalten.')) return;
    delete D().local.sync; await Store.save(); renderMore();
  });
  $('#syncSet')?.addEventListener('click', async () => {
    const token = $('#syncTok').value.trim(), pass = $('#syncPass').value;
    if (!/^(ghp_|github_pat_|gho_)/.test(token)) { toast('Das sieht nicht nach einem GitHub-Schlüssel aus'); return; }
    if (pass.length < 10) { toast('Sync-Passwort braucht mindestens 10 Zeichen'); return; }
    D().local = { ...(D().local || {}), sync: { token, pass } };
    await Store.save();
    await syncNow(true);
    renderMore();
  });
  $('#bak').onclick = async () => deliver(new Blob([await Store.backup()], { type: 'application/json' }), `Ruecklagen_Sicherung_${todayIso()}.json`, 'Verschlüsselt mit deiner PIN');
  $('#res').onclick = () => $('#restoreInput').click();
  $('#pinChg').onclick = async () => {
    const p = prompt('Neue PIN (mindestens 6 Ziffern)');
    if (p == null) return;
    if (!/^\d{6,}$/.test(p.trim())) { toast('PIN braucht mindestens 6 Ziffern'); return; }
    if (prompt('Neue PIN wiederholen') !== p) { toast('PINs stimmen nicht überein'); return; }
    await Store.changePin(p.trim()); toast('PIN geändert');
  };
  $('#wipe').onclick = () => {
    if (prompt('Wirklich alles löschen? Dann LÖSCHEN eintippen.') !== 'LÖSCHEN') return;
    Store.wipe(); location.reload();
  };
}

async function restore(file) {
  const text = await file.text();
  let obj;
  try {
    const box = JSON.parse(text);
    const pin = box.format === 'ruecklagen-v1' ? prompt('PIN, mit der die Sicherung erstellt wurde') : '';
    if (pin == null) return;
    obj = await Store.readBackup(text, pin);
  } catch (e) { toast('Datei lässt sich nicht lesen (falsche PIN?)'); return; }
  if (!obj || !obj.settings) { toast('Das ist keine Rücklagen-Datei'); return; }
  if (!confirm('Daten aus der Datei übernehmen? Die aktuellen Daten auf diesem Gerät werden ersetzt.')) return;
  Store.data = { ...defaults(), ...obj, prepay: obj.prepay || {}, local: D().local };
  await persist();
  toast('Daten übernommen');
}

// ---------- Excel ----------
function loadScript(src) {
  if (window.ExcelJS) return Promise.resolve();
  return new Promise((ok, fail) => {
    const sc = document.createElement('script');
    sc.src = src; sc.onload = ok; sc.onerror = fail;
    document.head.appendChild(sc);
  });
}

async function exportExcel(year) {
  try { await loadScript('vendor/exceljs.min.js'); } catch (e) { toast('Excel-Modul fehlt, bitte einmal online öffnen'); return; }
  const data = D(), s = data.settings, wb = new ExcelJS.Workbook();
  const money = '#,##0.00 "€"', T = asOf(year), r = Calc.rule(data, year);
  const head = ws => { const h = ws.getRow(1); h.font = { bold: true, color: { argb: 'FFFFFFFF' } }; h.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F766E' } }; ws.views = [{ state: 'frozen', ySplit: 1 }]; };
  const setMoney = (ws, cols) => cols.forEach(c => { ws.getColumn(c).numFmt = money; });

  // 1. Jahresbilanz
  const ytd = Calc.totals(data, year, `${year}-01-01`, Calc.iso(T)), all = Calc.totals(data, year, `${year}-01-01`, `${year}-12-31`);
  const chk = Calc.check(data, year, T);
  const b = wb.addWorksheet('Jahresbilanz');
  b.columns = [{ header: `Jahresbilanz ${year}`, width: 46 }, { header: `bis ${dmy(Calc.iso(T))}`, width: 18 }, { header: 'ganzes Jahr', width: 18 }];
  head(b);
  [
    ['Brutto-Einnahmen kumuliert', ytd.brutto, all.brutto],
    ['Netto-Entnahmen kumuliert', ytd.netto, all.netto],
    ['Einkommensteuer + Soli voraussichtlich', ytd.taxReserve, (+s.expectedBrutto || 0) * r.tax],
    ['Steuervorauszahlungen fällig', ytd.taxDue, all.taxDue],
    ['Steuervorauszahlungen abgeführt', ytd.taxPaid, all.taxPaid],
    ['Steuer: Rücklage minus abgeführt', ytd.taxReserve - ytd.taxPaid, null],
    ['Ärzteversorgung', ytd.vw, all.vw],
    ['Kredit (Raten)', ytd.loan, all.loan],
    ['Krankenkasse bezahlt', ytd.kv, all.kv],
    ['Versicherungen gesamt (inkl. Krankenkasse)', ytd.ins, all.ins],
    ['Rücklagen-Check: noch sicher entnehmbar', chk.available, null],
    ['Kredit Restschuld geschätzt', Calc.loanRest(data, T), null],
    ['Haushalt pro Monat (vom Netto)', Calc.household(data), null],
  ].forEach(row => b.addRow(row));
  b.addRow([]);
  b.addRow(['Parameter', 'Wert']).font = { bold: true };
  [
    ['Steuersatz auf Brutto', r.tax], ['Entnahme-Regel (Anteil vom Brutto)', r.net],
    ['Steuervorauszahlung pro Quartal', +s.taxPrepay || 0], ['Ärzteversorgung pro Jahr', +s.vwYear || 0],
    ['Kreditraten pro Jahr', +s.loanYear || 0], ['Erwartetes Brutto im Jahr', +s.expectedBrutto || 0],
  ].forEach(([l, v], i) => { const row = b.addRow([l, v]); if (i < 2) row.getCell(2).numFmt = '0.0%'; });
  setMoney(b, [2, 3]);
  b.eachRow((row, n) => { if (n >= 17 && n <= 18) row.getCell(2).numFmt = '0.0%'; });

  // 2. Monate kumuliert
  const m = wb.addWorksheet('Monate');
  m.columns = ['Monat', 'Brutto', 'Netto entnommen', 'Steuer-Rücklage', 'Steuer abgeführt', 'Ärzteversorgung', 'Kredit', 'Krankenkasse', 'Versicherungen', 'Σ Brutto', 'Σ Netto']
    .map((h, i) => ({ header: h, width: i ? 16 : 10 }));
  head(m);
  const mon = Calc.monthly(data, year);
  mon.forEach(x => m.addRow([MONTHS[x.month], x.brutto, x.netto, x.taxReserve, x.taxPaid, x.vw, x.loan, x.kv, x.ins, x.cumBrutto, x.cumNetto]));
  const sumRow = m.addRow(['Summe', ...[2, 3, 4, 5, 6, 7, 8, 9].map(c => ({ formula: `SUM(${m.getColumn(c).letter}2:${m.getColumn(c).letter}13)` }))]);
  sumRow.font = { bold: true };
  setMoney(m, [2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);

  // 3. Entnahmen
  const e = wb.addWorksheet('Entnahmen');
  e.columns = ['Datum', 'Brutto', 'Netto entnommen', 'Vorschlag', 'Differenz', 'Bewertung', 'Notiz'].map((h, i) => ({ header: h, width: [12, 14, 16, 14, 14, 12, 30][i] }));
  head(e);
  Calc.rated(data, year).forEach(x => {
    const row = e.addRow([Calc.parse(x.date), x.brutto, x.netto, x.suggested, x.netto - x.suggested, x.over ? 'zu viel' : 'o.k.', x.note || '']);
    row.getCell(1).numFmt = 'dd.mm.yyyy';
    if (x.over) row.getCell(6).font = { bold: true, color: { argb: 'FFB42318' } };
  });
  setMoney(e, [2, 3, 4, 5]);

  // 4. Versicherungen
  const it = Calc.insuranceTable(data, year, T);
  const v = wb.addWorksheet('Versicherungen');
  v.columns = ['Versicherung', 'Zahlweise', 'pro Monat', 'pro Quartal', `pro Jahr (${it.months} Mon.)`, 'bezahlt bis heute'].map((h, i) => ({ header: h, width: i ? 16 : 32 }));
  head(v);
  it.rows.forEach(x => v.addRow([x.name, x.interval, x.month, x.quarter, x.year, x.toDate]));
  v.addRow(['Summe', '', it.sum.month, it.sum.quarter, it.sum.year, it.sum.toDate]).font = { bold: true };
  setMoney(v, [3, 4, 5, 6]);

  // 5. Termine
  const t = wb.addWorksheet('Termine');
  t.columns = ['Datum', 'Was', 'Betrag', 'Status'].map((h, i) => ({ header: h, width: [12, 34, 14, 14][i] }));
  head(t);
  Calc.schedule(data, year).forEach(x => {
    const row = t.addRow([Calc.parse(x.date), x.name, x.amount, x.kind === 'tax' ? (x.paid ? 'bezahlt' : 'offen') : (x.date <= Calc.iso(T) ? 'fällig gewesen' : 'kommt')]);
    row.getCell(1).numFmt = 'dd.mm.yyyy';
  });
  setMoney(t, [3]);

  // 6. Haushalt
  const h = wb.addWorksheet('Haushalt');
  h.columns = [{ header: 'Posten', width: 30 }, { header: 'pro Monat', width: 14 }, { header: 'pro Jahr', width: 14 }];
  head(h);
  Calc.live(data.household).forEach(x => h.addRow([x.name, +x.amount || 0, (+x.amount || 0) * 12]));
  setMoney(h, [2, 3]);

  const buf = await wb.xlsx.writeBuffer();
  deliver(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `Ruecklagen_${year}.xlsx`, `Jahresbilanz ${year} mit Monaten, Entnahmen, Versicherungen und Terminen`);
}

function deliver(blob, filename, info) {
  const file = new File([blob], filename, { type: blob.type });
  const canShare = !!(navigator.canShare && navigator.canShare({ files: [file] }));
  $('#deliverTitle').textContent = filename;
  $('#deliverInfo').textContent = info + '.';
  $('#deliverShare').hidden = !canShare;
  $('#deliverShare').onclick = async () => {
    try { await navigator.share({ files: [file], title: filename }); $('#deliverDlg').close(); } catch (e) { /* abgebrochen */ }
  };
  $('#deliverSave').onclick = () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    $('#deliverDlg').close();
  };
  $('#deliverDlg').showModal();
}

// ---------- Start ----------
function init() {
  document.querySelectorAll('.bottomnav [data-view]').forEach(b => b.onclick = () => show(b.dataset.view));
  $('#addBtn').onclick = () => Store.unlocked && openEntry(null);
  $('#lockBtn').onclick = lockNow;
  document.querySelectorAll('[data-close]').forEach(b => b.onclick = () => b.closest('dialog').close());
  $('#restoreInput').onchange = e => { const f = e.target.files[0]; e.target.value = ''; if (f) restore(f); };
  let hiddenAt = 0;
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) hiddenAt = Date.now();
    else if (Store.unlocked && Date.now() - hiddenAt > 180000 && hiddenAt) lockNow();
    else if (Store.unlocked) syncNow(false);
  });
  if (!window.crypto?.subtle) {
    document.body.innerHTML = '<p style="padding:24px">Diese App braucht eine sichere Verbindung (https). Bitte über den richtigen Link öffnen.</p>';
    return;
  }
  showLock(Store.exists() ? 'unlock' : 'setup');
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(e => console.warn('Service Worker', e));
}
init();
