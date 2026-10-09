// Abgleich Handy <-> PC über ein geheimes GitHub-Gist.
// Im Gist liegt nur ein verschlüsselter Block (AES-256, Schlüssel aus dem Sync-Passwort); GitHub sieht keine Zahlen.
(function (root) {
  const API = 'https://api.github.com';
  const FILE = 'ruecklagen.json';
  const DESC = 'Rücklagen-App Sync (verschlüsselt)';

  // Zusammenführen: pro Datensatz gewinnt die jüngste Änderung, Gelöschtes bleibt als Markierung erhalten
  function merge(a, b) {
    if (!b) return a;
    if (!a) return b;
    const byId = (x, y) => {
      const m = new Map();
      for (const r of [...(x || []), ...(y || [])]) {
        const cur = m.get(r.id);
        if (!cur || (r.updatedAt || 0) > (cur.updatedAt || 0)) m.set(r.id, r);
      }
      return [...m.values()];
    };
    const prepay = { ...(a.prepay || {}) };
    for (const [k, v] of Object.entries(b.prepay || {})) {
      if (!prepay[k] || (v.updatedAt || 0) > (prepay[k].updatedAt || 0)) prepay[k] = v;
    }
    return {
      ...a,
      settings: (b.settings?.updatedAt || 0) > (a.settings?.updatedAt || 0) ? b.settings : a.settings,
      insurances: byId(a.insurances, b.insurances),
      household: byId(a.household, b.household),
      entries: byId(a.entries, b.entries),
      prepay,
    };
  }

  const shared = data => { const { local, ...rest } = data; return rest; };

  async function gh(token, path, opts = {}) {
    const res = await fetch(API + path, {
      ...opts,
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json', ...(opts.headers || {}) },
    });
    if (res.status === 401) throw new Error('GitHub-Schlüssel ungültig oder abgelaufen');
    if (!res.ok) throw new Error(`GitHub antwortet mit Fehler ${res.status}`);
    return res.json();
  }

  async function findGist(token) {
    for (let page = 1; page <= 5; page++) {
      const list = await gh(token, `/gists?per_page=100&page=${page}`);
      const hit = list.find(g => g.files && g.files[FILE] && g.description === DESC);
      if (hit) return hit.id;
      if (list.length < 100) break;
    }
    return null;
  }

  async function readGist(token, id) {
    const g = await gh(token, `/gists/${id}`);
    const f = g.files[FILE];
    if (!f) return null;
    const text = f.truncated ? await (await fetch(f.raw_url)).text() : f.content;
    return JSON.parse(text);
  }

  // Ein kompletter Durchlauf: holen, zusammenführen, zurückschreiben. Gibt die zusammengeführten Daten zurück.
  async function run(data) {
    const cfg = data.local?.sync;
    if (!cfg?.token || !cfg?.pass) throw new Error('Sync ist nicht eingerichtet');
    let id = cfg.gistId || await findGist(cfg.token);
    let remote = null;
    if (id) {
      const box = await readGist(cfg.token, id);
      if (box) {
        try { remote = await Store.open(cfg.pass, box); } catch (e) { throw new Error('Sync-Passwort passt nicht zu den Daten auf GitHub'); }
      }
    }
    // Neues Gerät ohne eigene Eingaben übernimmt einfach den Stand von GitHub (sonst doppelte Standard-Versicherungen)
    const fresh = remote && data.local?.pristine;
    const merged = { ...(fresh ? remote : merge(shared(data), remote)), local: data.local };
    delete merged.local.pristine;
    const body = JSON.stringify({ description: DESC, files: { [FILE]: { content: JSON.stringify(await Store.seal(cfg.pass, shared(merged))) } } });
    if (id) await gh(cfg.token, `/gists/${id}`, { method: 'PATCH', body });
    else id = (await gh(cfg.token, '/gists', { method: 'POST', body: JSON.stringify({ ...JSON.parse(body), public: false }) })).id;
    merged.local = { ...merged.local, sync: { ...cfg, gistId: id, last: Date.now() } };
    return merged;
  }

  root.Sync = { merge, run };
  if (typeof module !== 'undefined') module.exports = { merge };
})(this);
