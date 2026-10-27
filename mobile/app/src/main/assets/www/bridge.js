/* Talks to the Android side (PurgoNative). Falls back to a demo backend in a normal browser. */
(function () {
  const pending = new Map();
  const listeners = {};
  let seq = 1;

  window.__native = {
    done(id, ok) {
      const p = pending.get(id); if (!p) return;
      pending.delete(id);
      fetch('/result?id=' + encodeURIComponent(id)).then(r => r.json()).then(v => ok ? p.resolve(v) : p.reject(v || { error: 'failed' }), p.reject);
    },
    event(name, data) {
      if (name === 'progress') { const p = pending.get(data.id); if (p && p.onProgress) p.onProgress(data.data); return; }
      (listeners[name] || []).forEach(fn => { try { fn(data); } catch (e) { console.error(e); } });
    },
    back() { return window.onNativeBack ? !!window.onNativeBack() : false; },
  };

  const real = !!window.PurgoNative;

  window.N = {
    real,
    call(method, args = {}, onProgress) {
      const id = 'c' + (seq++) + '_' + Date.now();
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject, onProgress });
        if (real) window.PurgoNative.call(id, method, JSON.stringify(args));
        else Demo.call(id, method, args);
      });
    },
    cancel(id) { if (real) window.PurgoNative.cancel(id); },
    on(name, fn) { (listeners[name] = listeners[name] || []).push(fn); },
    thumb(p, s = 256) { return real ? '/thumb?s=' + s + '&p=' + encodeURIComponent(p) : Demo.thumb(p); },
    file(p) { return real ? '/file?p=' + encodeURIComponent(p) : Demo.thumb(p, true); },
    icon(pkg) { return real ? '/icon?pkg=' + encodeURIComponent(pkg) : null; },
  };

  // ------------------------------------------------------------------ demo backend
  const Demo = window.Demo = {
    ROOT: '/storage/emulated/0',
    rnd: (() => { let s = 7; return () => (s = (s * 16807) % 2147483647) / 2147483647; })(),
    files: null,
    bin: [],
    env: { sdk: 34, allFiles: true, usage: true, total: 128e9, free: 31.4e9, version: '1.0.0', device: 'Demo phone', bin: true, canClearAllCache: true, insets: { top: 28, bottom: 16 } },
    call(id, method, args) {
      if (window.DEMO_ENV && !this._envApplied) { Object.assign(this.env, window.DEMO_ENV); this._envApplied = true; }
      const done = (v, ok = true, ms = 300) => setTimeout(() => { const p = pending.get(id); if (!p) return; pending.delete(id); ok ? p.resolve(v) : p.reject(v); }, ms);
      const prog = d => { const p = pending.get(id); if (p && p.onProgress) p.onProgress(d); };
      const speed = window.DEMO_SPEED || 1;
      const steps = async (n, ms, fn) => { for (let i = 1; i <= n; i++) { await new Promise(r => setTimeout(r, ms / speed)); fn(i / n, i); } };
      this.ensure();
      switch (method) {
        case 'env': return done(Object.assign({}, this.env, { indexed: !!this.indexed }), true, 50);
        case 'scan': {
          if (args.reuse && this.indexed) return done(this.summary(), true, 50);
          steps(30, 2600 / 30, (f, i) => prog({ stage: 'Scanning storage', files: Math.round(this.files.length * f * 40), bytes: 86e9 * f, dir: this.ROOT + ['/DCIM/Camera', '/Android/media/com.whatsapp/WhatsApp/Media', '/Download', '/Movies', '/Music', '/Pictures/Instagram'][i % 6] }))
            .then(() => { this.indexed = true; done(this.summary(), true, 50); });
          return;
        }
        case 'large': return done(this.large(args), true, 350);
        case 'junk': return done(this.junk(), true, 700);
        case 'duplicates': steps(20, 2400 / 20, f => prog({ stage: f < .4 ? 'Comparing files' : 'Verifying duplicates', pct: f })).then(() => done(this.dups(), true, 50)); return;
        case 'photos': steps(40, 3600 / 40, (f, i) => prog({ stage: 'Looking at your photos', pct: f, done: Math.round(f * 1240), total: 1240, current: this.photos()[i % 30].p })).then(() => done(this.smart(), true, 50)); return;
        case 'chat': return done(this.chat(), true, 400);
        case 'chatFiles': return done({ items: this.files.filter(f => f.p.startsWith(args.dir + '/')).sort((a, b) => b.s - a.s) }, true, 300);
        case 'apps': steps(10, 900 / 10, f => prog({ stage: 'Reading apps', pct: f })).then(() => done(this.apps(), true, 50)); return;
        case 'uninstall': {
          (async () => {
            for (let i = 0; i < args.pkgs.length; i++) {
              const pkg = args.pkgs[i];
              window.__native.event('uninstallStart', { pkg, left: args.pkgs.length - i - 1 });
              await new Promise(r => setTimeout(r, 1300 / speed));
              this._apps = this._apps.filter(a => a.pkg !== pkg);
              window.__native.event('uninstall', { pkg, ok: true, left: args.pkgs.length - i - 1 });
            }
            window.__native.event('uninstallDone', { total: args.pkgs.length });
          })();
          return done(true, true, 50);
        }
        case 'cacheTotal': return done({ bytes: this.apps().totalCache }, true, 400);
        case 'clearAllCache': setTimeout(() => window.__native.event('cacheCleared', { ok: true, freed: 2.31e9, after: 0.4e9 }), 1800 / speed); return done({ supported: true });
        case 'delete': {
          const paths = args.paths; let bytes = 0;
          (async () => {
            for (let i = 0; i < paths.length; i++) {
              await new Promise(r => setTimeout(r, Math.max(40, 1600 / paths.length) / speed));
              const f = this.files.find(x => x.p === paths[i]);
              const s = f ? f.s : 5e6; bytes += s;
              if (args.bin !== false && this.env.bin) this.bin.push({ id: 'b' + Date.now() + i, p: paths[i], n: paths[i].split('/').pop(), orig: paths[i], s, m: Date.now(), t: f ? f.t : 'folder', expires: Date.now() + 30 * 864e5 });
              prog({ done: i + 1, total: paths.length, path: paths[i], ok: true, bytes });
            }
            this.files = this.files.filter(f => !paths.some(p => f.p === p || f.p.startsWith(p + '/')));
            done({ ok: paths.length, failed: 0, bytes, binned: args.bin !== false && this.env.bin }, true, 150);
          })();
          return;
        }
        case 'bin': return done({ items: this.bin.slice().reverse(), bytes: this.bin.reduce((a, b) => a + b.s, 0) }, true, 200);
        case 'restore': this.bin = this.bin.filter(b => !args.ids.includes(b.id)); return done({ ok: args.ids.length, failed: 0 }, true, 600);
        case 'emptyBin': { const n = args.ids ? args.ids.length : this.bin.length; const b = this.bin.filter(x => !args.ids || args.ids.includes(x.id)).reduce((a, x) => a + x.s, 0); this.bin = args.ids ? this.bin.filter(x => !args.ids.includes(x.id)) : []; return done({ ok: n, bytes: b }, true, 500); }
        case 'browse': return done(this.browse(args.path || this.ROOT), true, 200);
        case 'setSetting': this.env[args.key] = args.value; return done(true, true, 30);
        default: return done(true, true, 100);
      }
    },
    ensure() {
      if (this.files) return;
      const R = this.ROOT, rnd = this.rnd, D = 864e5, now = Date.now();
      const f = []; const add = (p, s, t, age) => f.push({ p, n: p.split('/').pop(), s: Math.round(s), m: now - age * D, t });
      for (let i = 0; i < 60; i++) add(`${R}/DCIM/Camera/IMG_2026${String(1000 + i * 7).slice(1)}_${100 + i}.jpg`, 2.4e6 + rnd() * 3e6, 'image', i * 3 + rnd());
      for (let i = 0; i < 12; i++) add(`${R}/DCIM/Camera/VID_2026${String(1000 + i * 9).slice(1)}.mp4`, 80e6 + rnd() * 900e6, 'video', i * 9);
      for (let i = 0; i < 24; i++) add(`${R}/Pictures/Screenshots/Screenshot_2026${1000 + i}.png`, 3e5 + rnd() * 9e5, 'image', i * 5);
      for (let i = 0; i < 40; i++) add(`${R}/Android/media/com.whatsapp/WhatsApp/Media/WhatsApp Images/IMG-2026${1000 + i}-WA00${i}.jpg`, 1e5 + rnd() * 3e5, 'image', i * 4);
      for (let i = 0; i < 14; i++) add(`${R}/Android/media/com.whatsapp/WhatsApp/Media/WhatsApp Video/VID-2026${1000 + i}-WA00${i}.mp4`, 4e6 + rnd() * 40e6, 'video', i * 11);
      for (let i = 0; i < 30; i++) add(`${R}/Android/media/com.whatsapp/WhatsApp/Media/WhatsApp Voice Notes/2026${40 + i}/PTT-2026-WA00${i}.opus`, 2e4 + rnd() * 3e5, 'audio', i * 3);
      for (let i = 0; i < 8; i++) add(`${R}/Android/media/com.whatsapp/WhatsApp/Media/WhatsApp Documents/Factura_${2026 - i}.pdf`, 1e5 + rnd() * 2e6, 'doc', i * 30);
      for (let i = 0; i < 10; i++) add(`${R}/Telegram/Telegram Video/${i}_video.mp4`, 10e6 + rnd() * 200e6, 'video', i * 6);
      for (let i = 0; i < 12; i++) add(`${R}/Telegram/Telegram Images/${i}_photo.jpg`, 1e5 + rnd() * 6e5, 'image', i * 6);
      ['Spotify_setup.apk', 'Minecraft-1.21.apk', 'Revolut.apk', 'old_backup.zip', 'Contract_chirie.pdf', 'Film 2025 1080p.mkv', 'presentation.pptx'].forEach((n, i) => add(`${R}/Download/${n}`, [62e6, 820e6, 110e6, 1.4e9, 2e5, 2.3e9, 14e6][i], ['apk', 'apk', 'apk', 'archive', 'doc', 'video', 'doc'][i], [5, 200, 40, 300, 120, 160, 10][i]));
      for (let i = 0; i < 10; i++) add(`${R}/Music/Track ${i + 1}.mp3`, 6e6 + rnd() * 6e6, 'audio', 400);
      add(`${R}/Movies/Vacanta Grecia 4K.mp4`, 3.8e9, 'video', 90);
      add(`${R}/Movies/Nunta Andrei.mp4`, 2.9e9, 'video', 380);
      // duplicates
      add(`${R}/Download/IMG_20261003_101.jpg`, f[3].s, 'image', 20); f[f.length - 1].s = f[3].s;
      add(`${R}/Pictures/Instagram/IMG_20261003_101.jpg`, f[3].s, 'image', 18);
      add(`${R}/Download/Film 2025 1080p (1).mkv`, 2.3e9, 'video', 150);
      this.files = f;
    },
    summary() {
      const c = {}; ['image', 'video', 'audio', 'doc', 'apk', 'archive', 'other'].forEach(t => c[t] = { bytes: 0, count: 0 });
      this.files.forEach(f => { c[f.t].bytes += f.s; c[f.t].count += 40; });
      const raw = Object.values(c).reduce((s, x) => s + x.bytes, 0), k = 52e9 / raw;
      Object.values(c).forEach(x => x.bytes *= k); c.other.bytes += 6e9; c.other.count += 4000;
      return { files: this.files.length * 40 + 4000, bytes: 86e9, categories: c, scannedAt: Date.now() };
    },
    large(a) { const it = this.files.filter(f => f.s >= (a.min || 50e6) && (a.type === 'all' || !a.type || f.t === a.type)).sort((x, y) => y.s - x.s); return { items: it, bytes: it.reduce((s, f) => s + f.s, 0), count: it.length }; },
    photos() { return this.files.filter(f => f.t === 'image'); },
    junk() {
      const R = this.ROOT, now = Date.now(), D = 864e5;
      const mk = (p, s, rec, why, t = 'other', age = 10) => ({ p, n: p.split('/').pop(), s, m: now - age * D, t, rec, why });
      const temp = Array.from({ length: 9 }, (_, i) => mk(`${R}/${['Android/media/com.zhiliaoapp.musically/cache', 'Pictures/.tmp', 'Download/.pending', 'Documents/logs'][i % 4]}/${['crash_', 'upload_', 'session_', 'app_'][i % 4]}${1000 + i}.${['tmp', 'log', 'tmp', 'log'][i % 4]}`, 2e5 + this.rnd() * 14e6, true, i % 2 ? 'Log file' : 'Temporary file'));
      const thumbs = Array.from({ length: 6 }, (_, i) => mk(`${R}/DCIM/.thumbnails/${1700000000 + i * 7}.jpg`, 4e6 + this.rnd() * 30e6, true, 'Gallery thumbnail cache — Android rebuilds it when needed', 'image'));
      const apks = [mk(`${R}/Download/Spotify_setup.apk`, 62e6, true, 'Already installed — this installer is no longer needed', 'apk', 5), mk(`${R}/Download/Revolut.apk`, 110e6, true, 'Already installed — this installer is no longer needed', 'apk', 40), mk(`${R}/Download/Minecraft-1.21.apk`, 820e6, false, 'App not installed (v1.21.0)', 'apk', 200)];
      const residual = [Object.assign(mk(`${R}/Android/media/com.zhiliaoapp.musically`, 412e6, true, 'Media folder of an app that is no longer installed', 'folder', 80), { c: 812 }), Object.assign(mk(`${R}/com.facebook.katana`, 38e6, false, 'Folder named after an app that is not installed — check before deleting', 'folder', 300), { c: 41 })];
      const empty = ['Pictures/Snapseed', 'Movies/CapCut', 'Documents/Scanner', 'Download/Telegram Desktop', 'Lightroom'].map(p => Object.assign(mk(`${R}/${p}`, 0, true, 'Empty folder', 'folder'), { c: 0 }));
      const trashed = Array.from({ length: 4 }, (_, i) => mk(`${R}/DCIM/Camera/.trashed-17${i}-IMG_${i}.jpg`, 3e6, true, 'Already in the system trash — would be erased automatically later', 'image'));
      const oldDl = [mk(`${R}/Download/old_backup.zip`, 1.4e9, false, 'Downloaded more than 3 months ago', 'archive', 300), mk(`${R}/Download/Contract_chirie.pdf`, 2e5, false, 'Downloaded more than 3 months ago', 'doc', 120)];
      const cat = (id, title, desc, items) => ({ id, title, desc, items, bytes: items.reduce((a, b) => a + b.s, 0) });
      return { categories: [cat('temp', 'Temporary & log files', 'Files apps leave behind while working', temp), cat('thumbs', 'Thumbnail cache', 'Small preview images your gallery can rebuild', thumbs), cat('apks', 'Installer files (APK)', 'Setup files of apps you already installed', apks), cat('residual', 'Leftovers of removed apps', 'Folders that belonged to uninstalled apps', residual), cat('empty', 'Empty folders', 'Folders with nothing inside', empty), cat('trashed', 'System trash', 'Items you already deleted in the gallery', trashed), cat('olddl', 'Old downloads', 'Downloads you haven\'t touched in months — review them', oldDl)] };
    },
    dups() {
      const f = this.files; const by = n => f.filter(x => x.n === n || x.n === n.replace('.mkv', ' (1).mkv'));
      const g1 = f.filter(x => x.s === f[3].s && x.t === 'image').map((x, i) => Object.assign({}, x, { keep: i === 0, rec: i !== 0 }));
      const g2 = by('Film 2025 1080p.mkv').map((x, i) => Object.assign({}, x, { keep: i === 0, rec: i !== 0 }));
      const wa = f.filter(x => x.p.includes('WhatsApp Images')).slice(0, 6);
      const groups = [{ size: g2[0].s, count: g2.length, items: g2, t: 'video' }, { size: g1[0].s, count: g1.length, items: g1, t: 'image' }];
      for (let i = 0; i < 3; i++) { const a = wa[i * 2], b = Object.assign({}, wa[i * 2], { p: wa[i * 2].p.replace('WhatsApp Images/', 'WhatsApp Images/Sent/') }); groups.push({ size: a.s, count: 2, t: 'image', items: [Object.assign({}, a, { keep: true, rec: false }), Object.assign({}, b, { keep: false, rec: true })] }); }
      return { groups, wasted: groups.reduce((s, g) => s + g.size * (g.count - 1), 0) };
    },
    smart() {
      const ph = this.files.filter(f => f.p.includes('/DCIM/Camera/') && f.t === 'image');
      const sim = []; for (let i = 0; i < 5; i++) { const items = ph.slice(i * 4, i * 4 + 3 + (i % 2)).map((x, k) => Object.assign({}, x, { keep: k === 1, rec: k !== 1, sharp: 20 + k * 5 })); sim.push({ items, count: items.length }); }
      const blurry = ph.slice(30, 36).map(x => Object.assign({}, x, { sharp: 5 })), dark = ph.slice(40, 43).map(x => Object.assign({}, x, { bright: 14 }));
      const shots = this.files.filter(f => f.p.includes('Screenshots')).map(x => Object.assign({}, x, { rec: Date.now() - x.m > 30 * 864e5 }));
      const sb = a => a.reduce((s, x) => s + x.s, 0);
      return { similar: { groups: sim, bytes: sim.reduce((s, g) => s + sb(g.items.filter(x => x.rec)), 0) }, blurry: { items: blurry, bytes: sb(blurry) }, dark: { items: dark, bytes: sb(dark) }, screenshots: { items: shots, bytes: sb(shots) }, analysed: 1240 };
    },
    chat() {
      const R = this.ROOT; const sum = d => { const l = this.files.filter(f => f.p.startsWith(d + '/')); return { bytes: l.reduce((a, b) => a + b.s, 0) * 6, count: l.length * 6 }; };
      const wa = R + '/Android/media/com.whatsapp/WhatsApp/Media', tg = R + '/Telegram';
      const cats = (base, pre, names, kinds) => names.map((n, i) => Object.assign({ id: base + '/' + pre + n, title: n, path: base + '/' + pre + n, kind: kinds[i] }, sum(base + '/' + pre + n))).filter(c => c.count);
      const a1 = cats(wa, 'WhatsApp ', ['Video', 'Images', 'Voice Notes', 'Documents'], ['video', 'image', 'audio', 'doc']);
      const a2 = cats(tg, 'Telegram ', ['Video', 'Images'], ['video', 'image']);
      const tot = c => c.reduce((a, b) => a + b.bytes, 0);
      return { apps: [{ id: 'whatsapp', name: 'WhatsApp', bytes: tot(a1), count: a1.reduce((a, b) => a + b.count, 0), cats: a1 }, { id: 'telegram', name: 'Telegram', bytes: tot(a2), count: a2.reduce((a, b) => a + b.count, 0), cats: a2 }] };
    },
    apps() {
      if (!this._apps) {
        const now = Date.now(), D = 864e5;
        const l = [['TikTok', 'com.zhiliaoapp.musically', 2.1e9, 1.3e9, 2], ['Facebook', 'com.facebook.katana', 1.4e9, 0.62e9, 1], ['Instagram', 'com.instagram.android', 1.1e9, 0.41e9, 0], ['Genshin Impact', 'com.miHoYo.GenshinImpact', 18.2e9, 0.1e9, 94], ['Netflix', 'com.netflix.mediaclient', 0.9e9, 0.08e9, 40], ['Spotify', 'com.spotify.music', 1.8e9, 0.7e9, 3], ['Duolingo', 'com.duolingo', 0.4e9, 0.05e9, 210], ['Candy Crush Saga', 'com.king.candycrushsaga', 0.6e9, 0.03e9, 160], ['Revolut', 'com.revolut.revolut', 0.5e9, 0.06e9, 6], ['Shazam', 'com.shazam.android', 0.12e9, 0.02e9, 75], ['Bolt', 'ee.mtakso.client', 0.3e9, 0.04e9, 12], ['CapCut', 'com.lemon.lvoverseas', 1.2e9, 0.9e9, 48], ['Google Translate', 'com.google.android.apps.translate', 0.2e9, 0.01e9, 33], ['eMAG', 'ro.emag.android', 0.35e9, 0.12e9, 9]];
        this._apps = l.map(([name, pkg, total, cache, days], i) => ({ pkg, name, version: '1.' + i + '.0', installed: now - (400 - i * 20) * D, updated: now - i * 3 * D, app: total * .4, data: total * .6 - cache, cache, total, lastUsed: now - days * D }));
      }
      const a = this._apps;
      return { apps: a, usage: true, totalApp: a.reduce((s, x) => s + x.app, 0), totalData: a.reduce((s, x) => s + x.data, 0), totalCache: a.reduce((s, x) => s + x.cache, 0) };
    },
    browse(path) {
      const kids = new Map();
      this.files.forEach(f => {
        if (!f.p.startsWith(path + '/')) return;
        const rest = f.p.slice(path.length + 1); const i = rest.indexOf('/');
        if (i < 0) kids.set(f.p, f);
        else { const d = path + '/' + rest.slice(0, i); const k = kids.get(d) || { p: d, n: rest.slice(0, i), s: 0, c: 0, t: 'folder', m: Date.now() }; k.s += f.s * 6; k.c += 6; kids.set(d, k); }
      });
      const items = [...kids.values()].sort((a, b) => b.s - a.s);
      return { path, root: this.ROOT, items, bytes: items.reduce((a, b) => a + b.s, 0) };
    },
    thumb(p, big) {
      let h = 0; for (const c of p) h = (h * 31 + c.charCodeAt(0)) | 0; h = Math.abs(h);
      const hue = h % 360, h2 = (hue + 40 + (h % 60)) % 360, t = (p.split('.').pop() || '').toLowerCase();
      const isVid = ['mp4', 'mkv'].includes(t);
      const sky = `hsl(${hue} 70% ${45 + h % 20}%)`, ground = `hsl(${h2} 55% ${25 + h % 15}%)`;
      const sun = `<circle cx="${30 + h % 40}" cy="${22 + h % 12}" r="${8 + h % 6}" fill="hsl(${(hue + 180) % 360} 90% 80%)" opacity=".9"/>`;
      const hills = `<path d="M0 ${70 + h % 10} Q 25 ${50 + h % 15} 50 ${66 + h % 8} T 100 ${58 + h % 12} V100 H0Z" fill="${ground}"/><path d="M0 ${84 + h % 6} Q 35 ${72 + h % 8} 70 ${82} T 100 ${78} V100 H0Z" fill="hsl(${h2} 50% 18%)" opacity=".85"/>`;
      const shot = p.includes('Screenshot') ? `<rect x="22" y="6" width="56" height="88" rx="8" fill="#111"/><rect x="26" y="14" width="48" height="10" rx="3" fill="hsl(${hue} 70% 60%)"/><rect x="26" y="28" width="48" height="26" rx="3" fill="#333"/><rect x="26" y="58" width="30" height="5" rx="2" fill="#555"/><rect x="26" y="66" width="40" height="5" rx="2" fill="#444"/>` : '';
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" preserveAspectRatio="xMidYMid slice"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${sky}"/><stop offset="1" stop-color="hsl(${(hue + 20) % 360} 60% 70%)"/></linearGradient></defs><rect width="100" height="100" fill="${shot ? '#e9e9f0' : 'url(#g)'}"/>${shot || sun + hills}${isVid && !big ? '' : ''}</svg>`;
      if (!['jpg', 'jpeg', 'png', 'mp4', 'mkv', 'webp'].includes(t)) return null;
      return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
    },
  };
})();
