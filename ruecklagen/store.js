// Verschlüsselter Speicher: alle Daten liegen nur AES-256-GCM-verschlüsselt im Browser.
// Der Schlüssel entsteht aus der PIN (PBKDF2) und existiert nur im Arbeitsspeicher, solange die App entsperrt ist.
(function (root) {
  const KEY = 'ruecklagen-data-v1';
  const ITER = 310000;
  const te = new TextEncoder(), td = new TextDecoder();
  const b64 = buf => btoa(String.fromCharCode(...new Uint8Array(buf)));
  const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));

  async function derive(pin, salt) {
    const base = await crypto.subtle.importKey('raw', te.encode(pin), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: ITER, hash: 'SHA-256' }, base,
      { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }
  async function seal(key, salt, obj) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, te.encode(JSON.stringify(obj)));
    return { format: 'ruecklagen-v1', salt: b64(salt), iv: b64(iv), ct: b64(ct) };
  }
  async function open(key, box) {
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(box.iv) }, key, unb64(box.ct));
    return JSON.parse(td.decode(pt));
  }

  const Store = {
    data: null,
    _key: null,
    _salt: null,
    exists() { try { return !!localStorage.getItem(KEY); } catch (e) { return false; } },
    async create(pin, data) {
      this._salt = crypto.getRandomValues(new Uint8Array(16));
      this._key = await derive(pin, this._salt);
      this.data = data;
      await this.save();
      try { await navigator.storage?.persist?.(); } catch (e) { /* optional */ }
    },
    async unlock(pin) {
      const box = JSON.parse(localStorage.getItem(KEY));
      const salt = unb64(box.salt), key = await derive(pin, salt);
      this.data = await open(key, box); // wirft bei falscher PIN
      this._key = key; this._salt = salt;
    },
    async save() {
      if (!this._key) throw new Error('gesperrt');
      localStorage.setItem(KEY, JSON.stringify(await seal(this._key, this._salt, this.data)));
    },
    lock() { this._key = null; this._salt = null; this.data = null; },
    get unlocked() { return !!this._key; },
    async changePin(pin) {
      this._salt = crypto.getRandomValues(new Uint8Array(16));
      this._key = await derive(pin, this._salt);
      await this.save();
    },
    // Sicherung: genau so verschlüsselt wie der Speicher, nur mit derselben PIN lesbar
    async backup() { const { local, ...rest } = this.data; return JSON.stringify(await seal(this._key, this._salt, rest)); },
    async readBackup(text, pin) {
      const box = JSON.parse(text);
      if (box.format !== 'ruecklagen-v1') return box; // unverschlüsselte Startwerte
      return open(await derive(pin, unb64(box.salt)), box);
    },
    wipe() { localStorage.removeItem(KEY); this.lock(); },
    // für die spätere Synchronisation
    seal: async (pass, obj) => { const salt = crypto.getRandomValues(new Uint8Array(16)); return seal(await derive(pass, salt), salt, obj); },
    open: async (pass, box) => open(await derive(pass, unb64(box.salt)), box),
  };
  root.Store = Store;
})(this);
