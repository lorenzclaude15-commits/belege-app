// Liest Betrag, Datum, Händler und MwSt-Satz aus dem erkannten Belegtext
// und schlägt eine Kategorie vor. Läuft im Browser und (für Tests) in Node.
(function (root) {
  'use strict';

  // Bekannte Händler -> Anzeigename + Standardkategorie
  const BRANDS = [
    ['aral', 'Aral', 'tanken'], ['shell', 'Shell', 'tanken'], ['esso', 'Esso', 'tanken'],
    ['jet tank', 'JET', 'tanken'], ['totalenergies', 'TotalEnergies', 'tanken'], ['omv', 'OMV', 'tanken'],
    ['agip', 'Agip', 'tanken'], ['avia', 'AVIA', 'tanken'], ['star tank', 'star', 'tanken'],
    ['allguth', 'Allguth', 'tanken'], ['tankstelle', null, 'tanken'],
    ['deutsche bahn', 'Deutsche Bahn', 'tanken'], ['db fernverkehr', 'Deutsche Bahn', 'tanken'],
    ['db vertrieb', 'Deutsche Bahn', 'tanken'], ['mvv', 'MVV', 'tanken'], ['apcoa', 'APCOA', 'tanken'],
    ['parkhaus', null, 'tanken'], ['contipark', 'Contipark', 'tanken'],
    ['media markt', 'MediaMarkt', 'anschaffung'], ['mediamarkt', 'MediaMarkt', 'anschaffung'],
    ['saturn', 'Saturn', 'anschaffung'], ['cyberport', 'Cyberport', 'anschaffung'],
    ['notebooksbilliger', 'notebooksbilliger.de', 'anschaffung'], ['conrad', 'Conrad', 'anschaffung'],
    ['apple', 'Apple', 'anschaffung'], ['amazon', 'Amazon', 'anschaffung'], ['otto office', 'OTTO Office', 'werbung'],
    ['viking', 'Viking', 'werbung'], ['mcpaper', 'McPaper', 'werbung'], ['staples', 'Staples', 'werbung'],
    ['deutsche post', 'Deutsche Post', 'werbung'], ['dhl', 'DHL', 'werbung'],
    ['thalia', 'Thalia', 'literatur'], ['hugendubel', 'Hugendubel', 'literatur'],
    ['telekom', 'Telekom', 'telefon'], ['vodafone', 'Vodafone', 'telefon'], ['telefonica', 'o2', 'telefon'],
    ['1&1', '1&1', 'telefon'], ['c&a', 'C&A', 'kleidung'], ['h&m', 'H&M', 'kleidung'], ['zara', 'Zara', 'kleidung'],
    ['breuninger', 'Breuninger', 'kleidung'], ['engelhorn', 'engelhorn', 'kleidung'],
    ['peek & cloppenburg', 'Peek & Cloppenburg', 'kleidung'], ['engelbert strauss', 'Engelbert Strauss', 'kleidung'],
  ];

  // Stichwörter im Belegtext -> Kategorie
  const KEYWORDS = {
    tanken: ['diesel', 'super e10', 'super e5', 'superbenzin', 'benzin', 'kraftstoff', 'zapfsäule', 'zapfsaeule',
      'liter', 'ladesäule', 'ladestrom', 'kwh', 'fahrkarte', 'fahrschein', 'bahncard', 'parkgebühr', 'parken', 'maut', 'vignette'],
    kleidung: ['berufskleidung', 'arbeitskleidung', 'schutzkleidung', 'sicherheitsschuh', 'kittel', 'workwear', 'anzug', 'sakko'],
    kongress: ['kongress', 'congress', 'tagung', 'seminar', 'fortbildung', 'weiterbildung', 'schulung', 'akademie',
      'teilnahmegebühr', 'teilnahmegebuehr', 'teilnehmer', 'messe', 'symposium', 'workshop', 'konferenz', 'ihk'],
    anschaffung: ['notebook', 'laptop', 'monitor', 'drucker', 'computer', 'tablet', 'ipad', 'smartphone', 'software',
      'lizenz', 'schreibtisch', 'bürostuhl', 'buerostuhl', 'festplatte', 'tastatur', 'headset', 'webcam'],
    werbung: ['bürobedarf', 'buerobedarf', 'schreibwaren', 'papier', 'toner', 'druckerpatrone', 'ordner', 'porto',
      'briefmarke', 'kopien', 'visitenkarten', 'arbeitsmittel', 'aktentasche'],
    bewirtung: ['restaurant', 'gaststätte', 'gaststaette', 'bewirtung', 'trinkgeld', 'pizzeria', 'ristorante',
      'gasthof', 'brauerei', 'wirtshaus', 'bistro', 'speisen', 'getränke', 'getraenke'],
    telefon: ['mobilfunk', 'telefon', 'internet', 'dsl', 'glasfaser', 'handyvertrag'],
    literatur: ['buchhandlung', 'fachbuch', 'fachzeitschrift', 'abonnement', 'verlag', 'zeitschrift'],
  };

  const TOTAL_WORDS = ['zu zahlen', 'zuzahlen', 'summe', 'gesamtbetrag', 'gesamt', 'total', 'endbetrag',
    'rechnungsbetrag', 'zahlbetrag', 'betrag eur', 'betrag', 'brutto'];
  const PAY_WORDS = ['ec-karte', 'ec karte', 'girocard', 'kartenzahlung', 'visa', 'mastercard', 'maestro', 'kreditkarte'];
  const SKIP_WORDS = ['netto', 'mwst', 'mwst.', 'ust', 'steuer', 'rückgeld', 'rueckgeld', 'gegeben', 'zwischensumme',
    'rabatt', 'pfand', 'punkte', 'payback', 'kurs'];

  const AMOUNT_RE = /(?:^|[^\d,.])(-?\d{1,3}(?:[.\s']\d{3})+|-?\d{1,6})\s?[,.]\s?(\d{2})(?![\d%]|[.,]\d)/g;

  function norm(s) {
    return (s || '').toLowerCase().replace(/\s+/g, ' ');
  }

  function amountsIn(line) {
    const out = [];
    let m;
    AMOUNT_RE.lastIndex = 0;
    while ((m = AMOUNT_RE.exec(line))) {
      const euros = parseInt(m[1].replace(/[.\s']/g, ''), 10);
      const v = Math.round((Math.abs(euros) + parseInt(m[2], 10) / 100) * 100) / 100;
      if (v > 0 && v < 100000) out.push(v);
    }
    return out;
  }

  function findAmount(lines) {
    const scored = new Map(); // Betrag -> Punktzahl
    const add = (v, p) => scored.set(v, Math.max(scored.get(v) || 0, p));
    lines.forEach(raw => {
      const l = norm(raw);
      const vals = amountsIn(raw);
      if (!vals.length) return;
      const skip = SKIP_WORDS.some(w => l.includes(w)) || /\d\s?%/.test(l);
      const total = TOTAL_WORDS.find(w => l.includes(w));
      const pay = PAY_WORDS.some(w => l.includes(w));
      vals.forEach(v => {
        let p = 1;
        if (total && !skip) p = 10 + (total === 'zu zahlen' || total === 'gesamtbetrag' || total === 'summe' ? 3 : 0);
        else if (pay && !skip) p = 6;
        else if (skip) p = 0;
        add(v, p);
      });
    });
    lines.forEach((raw, i) => {
      const l = norm(raw);
      if (TOTAL_WORDS.some(w => l.includes(w)) && !amountsIn(raw).length && lines[i + 1]) {
        amountsIn(lines[i + 1]).forEach(v => add(v, 9));
      }
    });
    const list = [...scored.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
    if (!list.length) return { amount: null, alternatives: [] };
    // Ohne Schlüsselwort: größter plausibler Betrag
    const best = list[0][1] >= 6 ? list[0][0] : Math.max(...list.filter(e => e[1] > 0).map(e => e[0]).concat([list[0][0]]));
    const alternatives = [best, ...list.map(e => e[0]).filter(v => v !== best)].slice(0, 4);
    return { amount: best, alternatives };
  }

  const MONTHS = { jan: 1, feb: 2, mär: 3, maer: 3, mar: 3, apr: 4, mai: 5, jun: 6, jul: 7, aug: 8, sep: 9, okt: 10, oct: 10, nov: 11, dez: 12, dec: 12 };

  function iso(y, m, d) {
    if (y < 100) y += 2000;
    const dt = new Date(Date.UTC(y, m - 1, d));
    if (dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
    return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }

  function findDate(text, today) {
    today = today || new Date();
    const max = new Date(today.getTime() + 2 * 864e5);
    const min = new Date(today.getFullYear() - 3, 0, 1);
    const found = [];
    let m;
    const re1 = /(\d{1,2})\s?[.\/-]\s?(\d{1,2})\s?[.\/-]\s?(\d{4}|\d{2})(?!\d)/g;
    while ((m = re1.exec(text))) found.push(iso(+m[3], +m[2], +m[1]));
    const re2 = /(\d{4})-(\d{2})-(\d{2})/g;
    while ((m = re2.exec(text))) found.push(iso(+m[1], +m[2], +m[3]));
    const re3 = /(\d{1,2})\.?\s+(jan|feb|mär|maer|mar|apr|mai|jun|jul|aug|sep|okt|oct|nov|dez|dec)[a-zä]*\.?\s+(\d{4})/gi;
    while ((m = re3.exec(text))) found.push(iso(+m[3], MONTHS[m[2].toLowerCase()], +m[1]));
    for (const d of found) {
      if (!d) continue;
      const dt = new Date(d + 'T12:00:00');
      if (dt >= min && dt <= max) return d;
    }
    return null;
  }

  function findVat(text) {
    const t = norm(text);
    const has19 = /19([,.]0+)?\s?%/.test(t);
    const has7 = /(^|[^\d,.])7([,.]0+)?\s?%/.test(t);
    if (has19 && !has7) return 19;
    if (has7 && !has19) return 7;
    return null;
  }

  function findMerchant(lines) {
    const all = norm(lines.join('\n'));
    for (const [key, name] of BRANDS) {
      if (name && all.includes(key)) return name;
    }
    for (const raw of lines.slice(0, 8)) {
      const l = raw.trim();
      const letters = (l.match(/[A-Za-zÄÖÜäöüß]/g) || []).length;
      if (letters < 3 || letters < l.length * 0.5) continue;
      if (/kassenbon|beleg|rechnung|quittung|willkommen|kundenbeleg|bon\b|www\.|tel\b|telefon|straße|str\./i.test(l)) continue;
      return l.replace(/[^\wÄÖÜäöüß&.\- ]/g, '').replace(/\s+/g, ' ').trim().slice(0, 40);
    }
    return '';
  }

  function merchantKey(merchant) {
    return norm(merchant).replace(/[^a-zäöüß0-9& ]/g, '').split(' ').filter(Boolean).slice(0, 2).join(' ');
  }

  // rules: { händlerschlüssel: kategorieId } aus früheren Bestätigungen
  function suggestCategory(text, merchant, rules, validIds) {
    const ok = id => !validIds || validIds.includes(id);
    const key = merchantKey(merchant);
    if (key && rules && rules[key] && ok(rules[key])) return { id: rules[key], reason: 'gelernt' };
    const t = norm(text) + ' ' + norm(merchant);
    if (rules) {
      for (const k of Object.keys(rules)) {
        if (k.length >= 4 && t.includes(k) && ok(rules[k])) return { id: rules[k], reason: 'gelernt' };
      }
    }
    for (const [k, , cat] of BRANDS) if (t.includes(k) && ok(cat)) return { id: cat, reason: 'händler' };
    let best = null, bestScore = 0;
    for (const [cat, words] of Object.entries(KEYWORDS)) {
      if (!ok(cat)) continue;
      const s = words.reduce((n, w) => n + (t.includes(w) ? 1 : 0), 0);
      if (s > bestScore) { best = cat; bestScore = s; }
    }
    return best ? { id: best, reason: 'stichwort' } : null;
  }

  function analyze(text, opts) {
    opts = opts || {};
    const lines = (text || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    const { amount, alternatives } = findAmount(lines);
    const merchant = findMerchant(lines);
    return {
      amount, alternatives,
      date: findDate(text || '', opts.today),
      vatRate: findVat(text || ''),
      merchant,
      suggestion: suggestCategory(text, merchant, opts.rules, opts.validIds),
    };
  }

  const api = { analyze, merchantKey, suggestCategory, amountsIn, findDate };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Extract = api;
})(typeof self !== 'undefined' ? self : this);
