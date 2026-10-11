// Rechenmodell: vom Brutto über Rücklagen (Steuer, Kredit, Versorgungswerk, Versicherungen) zur sicheren Netto-Entnahme.
// Reine Funktionen ohne DOM, damit sie sich auch ohne Browser prüfen lassen.
(function (root) {
  const DAY = 86400000;
  const FACTOR = { m: 1, q: 1 / 3, y: 1 / 12 };
  const INTERVAL_NAME = { m: 'monatlich', q: 'quartalsweise', y: 'jährlich' };
  const TAX_DATES = ['03-10', '06-10', '09-10', '12-10'];

  const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const parse = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const daysIn = (y, m) => new Date(y, m + 1, 0).getDate(); // m: 0-11
  const live = list => (list || []).filter(x => !x.deleted);
  const num = v => (Number.isFinite(+v) ? +v : 0);

  // Steueranteil am Brutto: erwartete Steuer geteilt durchs erwartete Brutto (nicht durchs zu versteuernde Einkommen)
  function taxRate(s) {
    const base = num(s.expectedBrutto) || num(s.taxableIncome);
    return base > 0 ? num(s.taxAmount) / base : 0;
  }
  function insMonthly(i) { return num(i.amount) * (FACTOR[i.interval] ?? 1); }
  // Praxis-Versicherungen gehen vom Brutto ab, private (z. B. PKV) erst vom Netto
  function isPraxis(i) { return i.praxis ?? /praxis|rechtss?chutz/i.test(i.name || ''); }
  function insMonthlyTotal(data, praxis = true) { return live(data.insurances).filter(i => isPraxis(i) === praxis).reduce((a, i) => a + insMonthly(i), 0); }

  // Zeitraum des Jahres, in dem die Praxis läuft (ab Startdatum)
  function span(data, year) {
    const start = data.settings.start ? parse(data.settings.start) : new Date(year, 0, 1);
    const from = start > new Date(year, 0, 1) ? start : new Date(year, 0, 1);
    const to = new Date(year, 11, 31);
    if (from > to) return null;
    return { from, to, months: 12 - from.getMonth() };
  }

  function fixedMonthly(data) {
    const s = data.settings;
    return { loan: num(s.loanYear) / 12, vw: num(s.vwYear) / 12, ins: insMonthlyTotal(data) };
  }

  // Regel pro Eingang: welcher Anteil vom Brutto geht in welche Rücklage, bezogen aufs erwartete Brutto des Jahres
  function rule(data, year) {
    const s = data.settings, w = span(data, year), q = taxRate(s);
    const fm = fixedMonthly(data), months = w ? w.months : 12;
    const exp = num(s.expectedBrutto);
    const share = v => (exp > 0 ? (v * months) / exp : 0);
    const parts = { tax: q, loan: share(fm.loan), vw: share(fm.vw), ins: share(fm.ins) };
    const net = 1 - parts.tax - parts.loan - parts.vw - parts.ins;
    return { ...parts, net: Math.max(0, net), months, fixedYear: (fm.loan + fm.vw + fm.ins) * months };
  }

  function split(data, year, brutto) {
    const r = rule(data, year), b = num(brutto);
    const out = { tax: b * r.tax, loan: b * r.loan, vw: b * r.vw, ins: b * r.ins };
    out.netto = Math.max(0, b - out.tax - out.loan - out.vw - out.ins);
    return out;
  }

  function entriesOf(data, year) {
    return live(data.entries).filter(e => e.date && e.date.startsWith(String(year))).sort((a, b) => a.date.localeCompare(b.date));
  }

  // Jede Buchung mit Vorschlag und Bewertung
  function rated(data, year) {
    return entriesOf(data, year).map(e => {
      const sug = split(data, year, e.brutto).netto;
      return { ...e, suggested: sug, over: num(e.netto) - sug > 0.5 };
    });
  }

  // Zeitanteiliger Rücklagen-Check: was seit Start bis "asOf" an Steuer und Fixkosten aufgelaufen ist
  function check(data, year, asOf) {
    const w = span(data, year);
    const ents = entriesOf(data, year).filter(e => e.date <= iso(asOf));
    const brutto = ents.reduce((a, e) => a + num(e.brutto), 0);
    const netto = ents.reduce((a, e) => a + num(e.netto), 0);
    const q = taxRate(data.settings), fm = fixedMonthly(data);
    let monthsEq = 0;
    if (w && asOf >= w.from) {
      const end = asOf < w.to ? asOf : w.to;
      monthsEq = ((Math.round((end - w.from) / DAY) + 1) / 365) * 12;
    }
    const need = { tax: brutto * q, loan: fm.loan * monthsEq, vw: fm.vw * monthsEq, ins: fm.ins * monthsEq };
    const needSum = need.tax + need.loan + need.vw + need.ins;
    const safe = brutto - needSum;
    return { brutto, netto, need, needSum, safe, available: safe - netto, monthsEq };
  }

  // Termine des Jahres: Steuervorauszahlungen, Versorgungswerk, Kredit, Versicherungen
  function schedule(data, year) {
    const s = data.settings, w = span(data, year), out = [];
    const pre = data.prepay || {};
    for (const md of TAX_DATES) {
      const date = `${year}-${md}`, o = pre[date] || {};
      out.push({ key: 'tax:' + date, date, kind: 'tax', name: 'Steuervorauszahlung', amount: o.amount ?? num(s.taxPrepay), paid: !!o.paid });
    }
    if (w) {
      for (let m = w.from.getMonth(); m < 12; m++) {
        const ym = `${year}-${String(m + 1).padStart(2, '0')}`;
        const day = d => String(Math.min(num(d) || 1, daysIn(year, m))).padStart(2, '0');
        if (num(s.vwYear)) out.push({ key: 'vw:' + ym, date: `${ym}-${day(s.vwDay || 28)}`, kind: 'vw', name: 'Ärzteversorgung (ca.)', amount: num(s.vwYear) / 12 });
        if (num(s.loanYear)) out.push({ key: 'loan:' + ym, date: `${ym}-${day(s.loanDay || 1)}`, kind: 'loan', name: 'Kreditrate', amount: num(s.loanYear) / 12 });
        for (const i of live(data.insurances)) {
          if (!num(i.amount)) continue;
          const first = m === w.from.getMonth();
          const due = i.interval === 'm' || (i.interval === 'q' && (m % 3 === 0 || first)) || (i.interval === 'y' && first);
          if (due) out.push({ key: `ins:${i.id}:${ym}`, date: `${ym}-01`, kind: 'ins', insId: i.id, name: i.name, amount: num(i.amount) });
        }
      }
    }
    return out.sort((a, b) => a.date.localeCompare(b.date) || a.kind.localeCompare(b.kind));
  }

  // Summen in einem Zeitraum [from, to] (ISO-Strings)
  function totals(data, year, from, to) {
    const q = taxRate(data.settings);
    const ents = entriesOf(data, year).filter(e => e.date >= from && e.date <= to);
    const t = { brutto: 0, netto: 0, taxReserve: 0, taxPaid: 0, taxDue: 0, vw: 0, loan: 0, ins: 0, insPraxis: 0, kv: 0, byIns: {} };
    for (const e of ents) { t.brutto += num(e.brutto); t.netto += num(e.netto); }
    t.taxReserve = t.brutto * q;
    for (const it of schedule(data, year)) {
      if (it.date < from || it.date > to) continue;
      if (it.kind === 'tax') { t.taxDue += it.amount; if (it.paid) t.taxPaid += it.amount; }
      else if (it.kind === 'ins') {
        t.ins += it.amount; t.byIns[it.insId] = (t.byIns[it.insId] || 0) + it.amount;
        if (isKV(data, it.insId)) t.kv += it.amount;
        const ins = live(data.insurances).find(x => x.id === it.insId);
        if (ins && isPraxis(ins)) t.insPraxis += it.amount;
      } else t[it.kind] += it.amount;
    }
    return t;
  }

  function isKV(data, id) {
    const i = live(data.insurances).find(x => x.id === id);
    return !!i && (i.kv || /kranken|pkv|gkv/i.test(i.name || ''));
  }

  // Versicherung je Zeitraum: Monat / Quartal / Jahr (rechnerisch) und tatsächlich fällig bis heute
  function insuranceTable(data, year, asOf) {
    const w = span(data, year);
    const months = w ? w.months : 12;
    const paid = totals(data, year, `${year}-01-01`, iso(asOf)).byIns;
    const rows = live(data.insurances).map(i => {
      const m = insMonthly(i);
      return { id: i.id, name: i.name, praxis: isPraxis(i), interval: INTERVAL_NAME[i.interval] || '', month: m, quarter: m * 3, year: m * months, toDate: paid[i.id] || 0 };
    });
    const sum = rows.reduce((a, r) => ({ month: a.month + r.month, quarter: a.quarter + r.quarter, year: a.year + r.year, toDate: a.toDate + r.toDate }), { month: 0, quarter: 0, year: 0, toDate: 0 });
    return { rows, sum, months };
  }

  // Monatstabelle fürs Jahr (Excel und Bilanz)
  function monthly(data, year) {
    const rows = [];
    let cb = 0, cn = 0;
    for (let m = 0; m < 12; m++) {
      const from = `${year}-${String(m + 1).padStart(2, '0')}-01`;
      const to = `${year}-${String(m + 1).padStart(2, '0')}-${daysIn(year, m)}`;
      const t = totals(data, year, from, to);
      cb += t.brutto; cn += t.netto;
      rows.push({ month: m, ...t, cumBrutto: cb, cumNetto: cn });
    }
    return rows;
  }

  // Geschätzte Restschuld: Startschuld minus Raten seit Start (Rate vereinfacht als Tilgung)
  function loanRest(data, asOf) {
    const s = data.settings;
    if (!s.start || !num(s.loanRest)) return num(s.loanRest);
    const st = parse(s.start);
    let months = 0;
    for (let d = new Date(st.getFullYear(), st.getMonth(), 1); d <= asOf; d.setMonth(d.getMonth() + 1)) {
      const due = new Date(d.getFullYear(), d.getMonth(), Math.min(num(s.loanDay) || 1, daysIn(d.getFullYear(), d.getMonth())));
      if (due >= st && due <= asOf) months++;
    }
    return Math.max(0, num(s.loanRest) - months * (num(s.loanYear) / 12));
  }

  function household(data) {
    return live(data.household).reduce((a, h) => a + num(h.amount), 0);
  }
  function privateIns(data) { return insMonthlyTotal(data, false); }

  const api = { iso, parse, taxRate, insMonthly, span, rule, split, rated, check, schedule, totals, insuranceTable, monthly, loanRest, household, privateIns, isPraxis, live, INTERVAL_NAME };
  if (typeof module !== 'undefined') module.exports = api; else root.Calc = api;
})(this);
