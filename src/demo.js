// Fake data + simulated jobs, used only when running outside Windows (UI previews).
const day = 86400000;
const now = Date.now();
const raw = [
  ['Brave', 'Brave Software Inc', '156.1.98.60', 550.76, 3, 32],
  ['IObit Malware Fighter 13', 'IObit', '13.5.0.1684', 178.72, 2, 32],
  ['Microsoft Visual C++ v14 Redistributable (x64) - 14.51.36247', 'Microsoft Corporation', '14.51.36247.0', 20.83, 2, 32],
  ['Microsoft Visual Studio Installer', 'Microsoft Corporation', '4.11.24.2075', 141.68, 2, 64],
  ['Adobe Acrobat (64-bit)', 'Adobe', '24.002.20759', 1270, 67, 64],
  ['Android Studio', 'Google LLC', '2026.2', 3980, 13, 64],
  ['BlueStacks Services', 'now.gg, Inc.', '3.0.9', 319.24, 383, 64],
  ['Counter-Strike-16', '', '', 457.9, 268, 32],
  ['Discord', 'Discord Inc.', '1.0.9238', 117.09, 156, 64],
  ['Driver Booster 13', 'IObit', '13.6.0', 117.3, 73, 32],
  ['Exodus', 'Exodus Movement Inc', '26.8.27', 180.21, 21, 64],
  ['Forza Horizon 6', '', '', 1.47, 156, 32],
  ['Lightshot-5.5.0.7', 'Skillbrains', '5.5.0.7', 3.98, 384, 32],
  ['Microsoft Office Mondo 2016 - en-us', 'Microsoft Corporation', '16.0.15726.20202', 2980, 384, 64],
  ['Rockstar Games Launcher', 'Rockstar Games', '1.0.92.2148', 412.5, 120, 64],
  ['Rockstar Games SDK', 'Rockstar Games', '2.4.1', 34.2, 120, 64],
  ['Spotify', 'Spotify AB', '1.2.71.421', 412.1, 44, 64],
  ['Steam', 'Valve Corporation', '2.10.91.91', 1040, 410, 32],
  ['VLC media player', 'VideoLAN', '3.0.21', 168.4, 300, 64],
  ['7-Zip 24.08 (x64)', 'Igor Pavlov', '24.08', 5.6, 500, 64],
  ['Google Chrome', 'Google LLC', '141.0.7390.66', 610.3, 290, 64],
  ['Notepad++ (64-bit x64)', 'Notepad++ Team', '8.8.5', 14.9, 210, 64],
  ['OBS Studio', 'OBS Project', '31.1.2', 498.1, 95, 64],
  ['WinRAR 7.13 (64-bit)', 'win.rar GmbH', '7.13.0', 9.4, 180, 64],
  ['Zoom Workplace', 'Zoom Video Communications, Inc.', '6.6.1', 302.7, 60, 64],
];

function programs() {
  return raw.map(([name, publisher, version, mb, ago, bits], i) => ({
    id: 'demo' + i, name, publisher, version, size: Math.round(mb * 1048576), installDate: now - ago * day,
    bits, isMsi: /Visual C\+\+|Office|Acrobat/.test(name), installLocation: 'C:\\Program Files\\' + name.split(' ')[0],
    uninstallString: '"C:\\Program Files\\' + name.split(' ')[0] + '\\uninstall.exe"', regPath: 'HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\' + name,
    website: publisher ? 'https://example.com' : '', comments: '', perUser: i % 7 === 3,
  }));
}

function apps() {
  const a = [['Calculator', 'Microsoft Corporation'], ['Clipchamp', 'Clipchamp'], ['Microsoft To Do', 'Microsoft Corporation'], ['Netflix', 'Netflix, Inc.'],
    ['Spotify Music', 'Spotify AB'], ['Xbox', 'Microsoft Corporation'], ['WhatsApp', 'WhatsApp Inc.'], ['Solitaire & Casual Games', 'Microsoft Studios'],
    ['Weather', 'Microsoft Corporation'], ['Photos', 'Microsoft Corporation'], ['TikTok', 'TikTok Pte. Ltd.'], ['Phone Link', 'Microsoft Corporation']];
  return a.map(([name, pub], i) => ({ id: 'app' + i, full: 'app' + i, name, publisher: pub, version: '1.' + (i * 7 % 30) + '.' + (1000 + i * 37), installDate: now - i * 9 * day, store: true, icon: null }));
}

function startup() {
  const s = [['Discord', 'Discord Inc.', true, 'Current user'], ['Steam Client Bootstrapper', 'Valve Corporation', true, 'Current user'],
    ['Spotify', 'Spotify AB', false, 'Current user'], ['Lightshot', 'Skillbrains', true, 'All users (32-bit)'],
    ['BlueStacks Services', 'now.gg, Inc.', true, 'All users'], ['IObit Malware Fighter', 'IObit', true, 'All users (32-bit)'],
    ['OneDrive', 'Microsoft Corporation', false, 'Current user'], ['Rockstar Games Launcher', 'Rockstar Games', false, 'Startup folder (you)']];
  return s.map(([name, company, enabled, scope], i) => ({ id: 'st' + i, name, company, enabled, scope, command: '"C:\\Program Files\\' + name + '\\' + name.split(' ')[0] + '.exe" --minimized', icon: null }));
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

class DemoJob {
  constructor({ id, type, programs, options, send }) {
    Object.assign(this, { id, type, programs, options: options || {}, send });
    this.waiters = {}; this.skipWait = false; this.cancelled = false;
  }
  emit(ev) { this.send({ jobId: this.id, ...ev }); }
  log(text, level = 'info', index) { this.emit({ type: 'log', text, level, index }); }
  step(step, status, extra = {}) { this.emit({ type: 'step', step, status, ...extra }); }
  ask(kind, payload) { return new Promise(r => { this.waiters[kind] = r; this.emit({ type: 'ask', kind, ...payload }); }); }
  answer(kind, v) { const w = this.waiters[kind]; if (w) { delete this.waiters[kind]; w(v); } }
  cancel() { this.cancelled = true; Object.keys(this.waiters).forEach(k => this.answer(k, null)); }

  async run() {
    const speed = Number(process.env.PURGO_DEMO_SPEED || 1);
    const w = ms => sleep(ms / speed);
    const summary = { programs: this.programs.length, uninstalled: 0, programBytes: 0, leftoversRemoved: 0, leftoversFound: 0, failed: 0, bytes: 0 };
    if (this.options.restorePoint && this.type !== 'forced') {
      this.step('restore', 'active'); this.log('Creating a System Restore point (this can take up to a minute)…'); await w(2200);
      this.log('Restore point created', 'ok'); this.step('restore', 'done');
    } else this.step('restore', 'skipped');
    for (let i = 0; i < this.programs.length && !this.cancelled; i++) {
      const p = this.programs[i];
      this.emit({ type: 'program', index: i, status: 'running' });
      this.log(p.name, 'title', i);
      if (this.type !== 'forced') {
        this.step('uninstall', 'active', { index: i });
        this.log(this.type === 'batch' ? 'Running the uninstaller silently…' : 'Launching the program\'s own uninstaller — follow its window if one appears…', 'info', i);
        this.log('› "C:\\Program Files\\' + p.name.split(' ')[0] + '\\uninstall.exe"', 'cmd', i);
        this.emit({ type: 'waiting', index: i, waiting: true });
        for (let t = 0; t < 30 && !this.skipWait; t++) await w(100);
        this.skipWait = false;
        this.emit({ type: 'waiting', index: i, waiting: false });
        this.log('Uninstaller finished', 'ok', i); summary.uninstalled++; summary.programBytes += p.size || 0;
        this.step('uninstall', 'done', { index: i });
      } else this.step('uninstall', 'skipped');
      this.step('scan', 'active', { index: i });
      this.log('Scanning for leftovers (moderate mode)…', 'info', i);
      await w(1800);
      const n = p.name.split(' ')[0];
      const items = [
        { kind: 'folder', path: 'C:\\Program Files\\' + n, reason: 'Install folder', recommended: true, size: 48211000, files: 212 },
        { kind: 'folder', path: 'C:\\Users\\You\\AppData\\Roaming\\' + n, reason: 'Folder named after the program', recommended: true, size: 3211000, files: 41 },
        { kind: 'folder', path: 'C:\\Users\\You\\AppData\\Local\\' + n, reason: 'Folder named after the program', recommended: true, size: 120880000, files: 930 },
        { kind: 'file', path: 'C:\\Users\\Public\\Desktop\\' + p.name + '.lnk', reason: 'Shortcut', recommended: true, size: 2100 },
        { kind: 'folder', path: 'C:\\Users\\You\\Documents\\' + n, reason: 'Folder in Documents (may contain your saves/files)', recommended: false, size: 9120000, files: 18 },
        { kind: 'key', path: 'HKEY_CURRENT_USER\\SOFTWARE\\' + n, reason: 'Program settings key', recommended: true },
        { kind: 'key', path: 'HKEY_LOCAL_MACHINE\\SOFTWARE\\WOW6432Node\\' + n, reason: 'Program settings key', recommended: true },
        { kind: 'value', path: 'HKEY_CURRENT_USER\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run', value: n, reason: 'Starts with Windows', recommended: true },
        { kind: 'key', path: 'HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\' + n.toLowerCase() + '.exe', reason: 'App path registration', recommended: true },
        { kind: 'key', path: 'HKEY_LOCAL_MACHINE\\SYSTEM\\CurrentControlSet\\Services\\' + n + 'Svc', reason: 'Windows service of this program', recommended: false },
      ].slice(0, process.env.PURGO_DEMO_EMPTY ? 0 : 6 + (i % 5)).map((x, k) => ({ ...x, id: k }));
      summary.leftoversFound += items.length;
      this.log(`${items.length} leftover(s) found — ${items.filter(x => x.kind === 'folder' || x.kind === 'file').length} on disk, ${items.filter(x => x.kind === 'key' || x.kind === 'value').length} in the registry`, 'ok', i);
      this.step('scan', 'done', { index: i, count: items.length });
      let sel;
      if (!items.length) { this.step('clean', 'skipped', { index: i }); this.emit({ type: 'program', index: i, status: 'done', found: 0 }); continue; }
      if (this.type === 'batch') sel = items.filter(x => x.recommended);
      else {
        this.step('review', 'active', { index: i });
        const ids = await this.ask('leftovers', { items, program: p.name });
        if (!ids) break;
        sel = items.filter(x => ids.includes(x.id));
        this.step('review', 'done', { index: i });
      }
      this.step('clean', 'active', { index: i, total: sel.length });
      this.log(`Deleting ${sel.length} leftover(s)…`, 'info', i);
      let k = 0;
      for (const it of sel) {
        await w(260); k++; summary.leftoversRemoved++; summary.bytes += it.size || 0;
        this.emit({ type: 'deleted', index: i, id: it.id, ok: true, done: k, total: sel.length, path: it.path, value: it.value, kind: it.kind });
      }
      this.log(`${sel.length} leftover(s) processed`, 'ok', i);
      this.step('clean', 'done', { index: i });
      this.emit({ type: 'program', index: i, status: 'done', found: items.length });
    }
    summary.seconds = 42; summary.cancelled = this.cancelled;
    this.step('done', 'done');
    this.emit({ type: 'finished', summary });
  }
}

module.exports = { programs, apps, startup, DemoJob };
