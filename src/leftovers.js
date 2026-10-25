// Finds and removes what a program leaves behind (folders, shortcuts, registry keys/values).
const fs = require('fs');
const path = require('path');
const { runPSJson, run, psq } = require('./ps');
const { coreName } = require('./programs');

let electronApp = null;
function setApp(a) { electronApp = a; }

const env = k => process.env[k] || '';
function gp(name) { try { return electronApp ? electronApp.getPath(name) : ''; } catch (e) { return ''; } }

const GENERIC = new Set([
  'microsoft', 'windows', 'common files', 'intel', 'amd', 'nvidia', 'nvidia corporation', 'google', 'adobe', 'apple',
  'oracle', 'java', 'temp', 'tmp', 'cache', 'data', 'app', 'apps', 'update', 'updater', 'setup', 'installer',
  'program', 'programs', 'software', 'system', 'tools', 'games', 'packages', 'local', 'roaming', 'bin', 'help',
  'inc', 'llc', 'ltd', 'corporation', 'corp', 'the', 'free', 'pro', 'plus', 'lite', 'edition', 'visual c++',
  'redistributable', 'runtime', 'driver', 'drivers', 'service', 'services', 'launcher', 'client', 'classes',
  'policies', 'wow6432node', 'clients', 'registeredapplications', 'odbc', 'mozilla', 'mozillaplugins', 'node.js',
]);

// ---------- Safety ----------
function protectedFolders() {
  const local = env('LOCALAPPDATA'), roaming = env('APPDATA'), pd = env('ProgramData'), up = env('USERPROFILE');
  const list = [
    env('SystemRoot'), env('ProgramFiles'), env('ProgramFiles(x86)'), env('ProgramW6432'), env('CommonProgramFiles'),
    env('CommonProgramFiles(x86)'), pd, roaming, local, up, env('PUBLIC'), path.dirname(up || 'C:\\Users\\x'),
    path.join(local, 'Programs'), path.join(local, 'Temp'), path.join(local, 'Packages'), path.join(local, 'Microsoft'),
    path.join(path.dirname(local || 'C:\\x\\Local'), 'LocalLow'), path.join(roaming, 'Microsoft'),
    path.join(pd, 'Microsoft'), path.join(pd, 'Package Cache'), path.join(env('ProgramFiles'), 'Common Files'),
    path.join(env('ProgramFiles(x86)'), 'Common Files'), path.join(env('ProgramFiles'), 'WindowsApps'),
    path.join(env('ProgramFiles'), 'Microsoft'), path.join(env('ProgramFiles(x86)'), 'Microsoft'),
    gp('desktop'), gp('documents'), gp('downloads'), gp('music'), gp('pictures'), gp('videos'),
    path.join(roaming, 'Microsoft\\Windows\\Start Menu\\Programs'), path.join(pd, 'Microsoft\\Windows\\Start Menu\\Programs'),
    path.join(roaming, 'Microsoft\\Windows\\Start Menu\\Programs\\Startup'),
  ];
  return new Set(list.filter(Boolean).map(p => p.replace(/\\+$/, '').toLowerCase()));
}

function isDeletableFolder(p) {
  if (!p) return false;
  let full;
  try { full = path.resolve(p).replace(/\\+$/, ''); } catch (e) { return false; }
  if (full.length <= 3) return false;
  const lower = full.toLowerCase();
  const prot = protectedFolders();
  if (prot.has(lower)) return false;
  if ([...prot].some(x => x.startsWith(lower + '\\'))) return false;            // ancestor of a protected folder
  const pd = env('ProgramData'), pf = env('ProgramFiles'), pf86 = env('ProgramFiles(x86)');
  const deep = [path.join(pd, 'Microsoft\\Windows'), path.join(pf, 'WindowsApps'), path.join(pf, 'Common Files'),
    path.join(pf86, 'Common Files'), path.join(pd, 'Package Cache'), path.join(pd, 'Microsoft'),
    path.join(env('LOCALAPPDATA'), 'Microsoft'), path.join(env('APPDATA'), 'Microsoft'), path.join(env('LOCALAPPDATA'), 'Packages')]
    .filter(x => x.length > 4).map(s => s.toLowerCase());
  const startMenus = [path.join(pd, 'Microsoft\\Windows\\Start Menu\\Programs'), path.join(env('APPDATA'), 'Microsoft\\Windows\\Start Menu\\Programs')].map(x => x.toLowerCase());
  const inStartMenu = startMenus.some(x => lower.startsWith(x + '\\')) && !/\\startup(\\|$)/i.test(lower);
  if (!inStartMenu && deep.some(x => lower === x || lower.startsWith(x + '\\'))) return false;
  if (/^[a-z]:\\users\\[^\\]+$/i.test(full)) return false;                         // any user profile root
  const win = env('SystemRoot').toLowerCase();
  if (win && (lower === win || lower.startsWith(win + '\\'))) return false;
  const parts = full.split('\\').filter(Boolean);
  if (parts.length < 2) return false;
  if (parts.length === 2 && /^(windows|users|program files|program files \(x86\)|programdata|boot|recovery|system volume information|\$recycle\.bin|perflogs)$/i.test(parts[1])) return false;
  return true;
}

const PROTECTED_KEYS = [
  'SOFTWARE', 'SOFTWARE\\WOW6432Node', 'SOFTWARE\\Microsoft', 'SOFTWARE\\WOW6432Node\\Microsoft', 'SOFTWARE\\Classes',
  'SOFTWARE\\Policies', 'SOFTWARE\\WOW6432Node\\Classes', 'SOFTWARE\\Microsoft\\Windows', 'SOFTWARE\\Microsoft\\Windows\\CurrentVersion',
  'SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall', 'SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
  'SYSTEM', 'SYSTEM\\CurrentControlSet', 'SYSTEM\\CurrentControlSet\\Services', 'SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run',
  'SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths', 'SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\App Paths',
].map(s => s.toLowerCase());

function isDeletableKey(full) {
  const i = full.indexOf('\\');
  if (i < 0) return false;
  const sub = full.slice(i + 1).replace(/^\\+|\\+$/g, '');
  if (!sub.includes('\\')) return false;
  return !PROTECTED_KEYS.includes(sub.toLowerCase());
}

// ---------- Name matching ----------
function makeMatcher(program) {
  const names = [];
  const add = n => {
    if (!n) return;
    n = String(n).trim();
    if (n.length < 3 || GENERIC.has(n.toLowerCase())) return;
    if (!names.some(x => x.toLowerCase() === n.toLowerCase())) names.push(n);
  };
  const core = coreName(program.name);
  add(core); add(program.name); add(core.replace(/\s+/g, ''));
  if (program.installLocation) {
    // only trust the folder name if it actually resembles the program name (not "Application", "x64", "130.0.1")
    const base = path.basename(program.installLocation);
    const nb = base.toLowerCase().replace(/\s+/g, ''), nc = core.toLowerCase().replace(/\s+/g, '');
    if (!/^\d/.test(base) && nc.length >= 3 && (nb.includes(nc.slice(0, 4)) || nc.includes(nb.slice(0, 4)))) add(base);
  }
  (program.extraNames || []).forEach(add);

  const pubs = [];
  if (program.publisher) {
    const cleaned = program.publisher.replace(/[,.]?\s*(Inc|LLC|Ltd|GmbH|Corporation|Corp|Co|S\.?A|B\.?V|Limited|Software)\.?\s*$/i, '').replace(/^[\s,.]+|[\s,.]+$/g, '');
    [program.publisher.trim(), cleaned].forEach(x => {
      if (x && x.length >= 3 && !GENERIC.has(x.toLowerCase()) && !/^(microsoft|windows)/i.test(x) && !pubs.includes(x)) pubs.push(x);
    });
  }
  const norm = s => s.toLowerCase().replace(/\s+/g, '');
  const exact = n => !!n && !GENERIC.has(n.toLowerCase()) && names.some(x => norm(x) === norm(n));
  const contains = n => !!n && !GENERIC.has(n.toLowerCase()) && names.some(x => x.length >= 5 && norm(n).includes(norm(x)));
  const isPub = n => !!n && pubs.some(p => p.toLowerCase() === n.toLowerCase());
  // names that other installed programs also map to (e.g. two Python versions both -> "Python")
  const others = new Set((program.otherNames || []).map(norm));
  const shared = n => !!n && others.has(norm(n));
  return { names, pubs, exact, contains, isPub, shared };
}

// ---------- Scanner ----------
async function scanLeftovers(program, mode = 'moderate') {
  const m = makeMatcher(program);
  const results = [];
  const seen = new Set();
  const otherLocs = (program.otherLocations || []).map(s => s.toLowerCase().replace(/\\+$/, ''));
  const add = (kind, p, reason, rec, value) => {
    const k = (kind + '|' + p + '|' + (value || '')).toLowerCase();
    if (seen.has(k)) return;
    if (rec && (kind === 'folder' || kind === 'file')) {
      const l = p.toLowerCase();
      if (otherLocs.some(o => o === l || o.startsWith(l + '\\') || l.startsWith(o + '\\'))) { rec = false; reason += ' — shared with another installed program'; }
    }
    if (rec && (kind === 'folder' || kind === 'key') && m.shared(p.split('\\').pop())) { rec = false; reason += ' — another installed program uses this name'; }
    if (kind === 'folder' && !isDeletableFolder(p)) return;
    if (kind === 'key' && !isDeletableKey(p)) return;
    seen.add(k);
    results.push({ kind, path: p, value: value || null, reason, recommended: !!rec });
  };

  // ---- Files & folders ----
  const loc = program.installLocation;
  if (loc && fs.existsSync(loc)) {
    let rec = !program.locationGuessed;
    // never auto-remove a folder that holds big user content (game libraries etc.)
    try { if (fs.readdirSync(loc).some(n => /^(steamapps|games|library|saves?|savegames|userdata|profiles)$/i.test(n))) rec = false; } catch (e) {}
    add('folder', loc, program.locationGuessed ? 'Probable install folder' : 'Install folder', rec);
  }

  const roaming = env('APPDATA'), local = env('LOCALAPPDATA'), pd = env('ProgramData');
  const roots = [
    env('ProgramFiles'), env('ProgramFiles(x86)'), pd, roaming, local, path.join(local, 'Programs'),
    path.join(path.dirname(local), 'LocalLow'), path.join(roaming, 'Microsoft\\Windows\\Start Menu\\Programs'),
    path.join(pd, 'Microsoft\\Windows\\Start Menu\\Programs'), gp('documents'),
  ].filter(d => d && fs.existsSync(d));

  for (const root of [...new Set(roots.map(r => r.toLowerCase()))].map(l => roots.find(r => r.toLowerCase() === l))) {
    let dirs = [];
    try { dirs = fs.readdirSync(root, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name); } catch (e) { continue; }
    const isDocs = root.toLowerCase() === (gp('documents') || '').toLowerCase();
    for (const dn of dirs) {
      const full = path.join(root, dn);
      if (m.exact(dn)) add('folder', full, isDocs ? 'Folder in Documents (may contain your saves/files)' : 'Folder named after the program', !isDocs);
      else if (mode === 'advanced' && m.contains(dn)) add('folder', full, 'Folder name contains the program name', false);

      if (m.isPub(dn)) {
        let subs = [];
        try { subs = fs.readdirSync(full, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name); } catch (e) {}
        for (const sn of subs) {
          if (m.exact(sn)) add('folder', path.join(full, sn), 'Program folder inside the publisher folder', true);
          else if (mode !== 'safe' && m.contains(sn)) add('folder', path.join(full, sn), 'Related folder inside the publisher folder', false);
        }
        let files = 99;
        try { files = fs.readdirSync(full, { withFileTypes: true }).filter(d => d.isFile()).length; } catch (e) {}
        if (mode !== 'safe' && subs.length > 0 && subs.every(s => m.exact(s) || m.contains(s)) && files < 2)
          add('folder', full, 'Publisher folder (contains only this program)', false);
      }
    }
  }

  // Shortcuts (.lnk)
  const lnkDirs = [gp('desktop'), path.join(env('PUBLIC'), 'Desktop'),
    path.join(roaming, 'Microsoft\\Windows\\Start Menu\\Programs'), path.join(pd, 'Microsoft\\Windows\\Start Menu\\Programs'),
    path.join(roaming, 'Microsoft\\Windows\\Start Menu\\Programs\\Startup'), path.join(pd, 'Microsoft\\Windows\\Start Menu\\Programs\\Startup')];
  for (const d of lnkDirs) {
    let files = [];
    try { files = fs.readdirSync(d).filter(f => /\.lnk$/i.test(f)); } catch (e) { continue; }
    for (const f of files) {
      const base = f.replace(/\.lnk$/i, '');
      if (m.exact(base)) add('file', path.join(d, f), 'Shortcut', true);
      else if (mode !== 'safe' && m.contains(base)) add('file', path.join(d, f), 'Shortcut', false);
    }
  }

  // ---- Registry (gathered in one PowerShell call) ----
  const reg = await gatherRegistry(program, m.pubs, mode === 'advanced');
  if (reg) {
    if (reg.uninstallExists) add('key', program.regPath, 'Uninstall entry still in the registry', true);
    for (const root of Object.keys(reg.tops || {})) {
      for (const s of reg.tops[root] || []) {
        if (m.exact(s)) add('key', root + '\\' + s, 'Program settings key', true);
        else if (mode === 'advanced' && m.contains(s)) add('key', root + '\\' + s, 'Key name contains the program name', false);
      }
    }
    for (const pk of reg.pubChildren || []) {
      for (const c of pk.children || []) {
        if (m.exact(c)) add('key', pk.key + '\\' + c, 'Program key under the publisher', true);
        else if (mode !== 'safe' && m.contains(c)) add('key', pk.key + '\\' + c, 'Related key under the publisher', false);
      }
      if (mode !== 'safe' && pk.children && pk.children.length && pk.children.every(c => m.exact(c) || m.contains(c)))
        add('key', pk.key, 'Publisher key (contains only this program)', false);
    }
    if (loc) {
      const inside = v => !!v && expandLower(v).includes(loc.toLowerCase().replace(/\\+$/, '') + '\\');
      for (const r of reg.run || []) if (inside(r.value)) add('value', r.key, 'Starts with Windows', true, r.name);
      for (const a of reg.appPaths || []) if (inside(a.value)) add('key', a.key, 'App path registration', true);
      for (const s of reg.services || []) if (inside(s.image)) add('key', s.key, 'Windows service of this program', false);
    }
  }

  // Drop children of listed parents
  const final = results.filter(r => !results.some(o => o !== r && (o.recommended || !r.recommended) &&
    ((o.kind === 'folder' && (r.kind === 'folder' || r.kind === 'file')) || (o.kind === 'key' && r.kind === 'key')) &&
    r.path.toLowerCase().startsWith(o.path.toLowerCase() + '\\')));

  // Sizes for folders/files
  for (const r of final) {
    if (r.kind === 'file') { try { r.size = fs.statSync(r.path).size; } catch (e) { r.size = 0; } }
  }
  final.forEach((r, i) => r.id = i);
  return final;
}

function expandLower(v) {
  return String(v).replace(/%([^%]+)%/g, (m, n) => process.env[n] || process.env[n.toUpperCase()] || m).replace(/"/g, '').toLowerCase();
}

async function gatherRegistry(program, pubs, advanced) {
  if (process.platform !== 'win32') return null;
  const script = `
$pubs = @(${pubs.map(psq).join(',')})
function OpenKey($full) {
  $i = $full.IndexOf('\\'); $h = $full.Substring(0,$i); $s = $full.Substring($i+1)
  $hive = if ($h -eq 'HKEY_LOCAL_MACHINE') { 'LocalMachine' } else { 'CurrentUser' }
  $view = if ([Environment]::Is64BitOperatingSystem) { 'Registry64' } else { 'Default' }
  return [Microsoft.Win32.RegistryKey]::OpenBaseKey($hive, $view).OpenSubKey($s)
}
$res = [ordered]@{ uninstallExists = $false; tops = [ordered]@{}; pubChildren = @(); run = @(); appPaths = @(); services = @() }
$u = OpenKey ${psq(program.regPath || 'HKEY_CURRENT_USER\\__none__')}
if ($u) { $res.uninstallExists = $true; $u.Close() }
foreach ($root in 'HKEY_CURRENT_USER\\SOFTWARE','HKEY_LOCAL_MACHINE\\SOFTWARE','HKEY_LOCAL_MACHINE\\SOFTWARE\\WOW6432Node') {
  $k = OpenKey $root; if (-not $k) { continue }
  $names = $k.GetSubKeyNames(); $res.tops[$root] = $names
  foreach ($n in $names) {
    if ($pubs -contains $n) { $pk = $k.OpenSubKey($n); if ($pk) { $res.pubChildren += [pscustomobject]@{ key = "$root\\$n"; children = @($pk.GetSubKeyNames()) }; $pk.Close() } }
  }
  $k.Close()
}
foreach ($rk in 'HKEY_CURRENT_USER\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run','HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run','HKEY_LOCAL_MACHINE\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Run') {
  $k = OpenKey $rk; if (-not $k) { continue }
  foreach ($v in $k.GetValueNames()) { $res.run += [pscustomobject]@{ key = $rk; name = $v; value = "$($k.GetValue($v))" } }
  $k.Close()
}
foreach ($ap in 'HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths','HKEY_LOCAL_MACHINE\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\App Paths','HKEY_CURRENT_USER\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths') {
  $k = OpenKey $ap; if (-not $k) { continue }
  foreach ($s in $k.GetSubKeyNames()) { $sk = $k.OpenSubKey($s); if ($sk) { $res.appPaths += [pscustomobject]@{ key = "$ap\\$s"; value = "$($sk.GetValue(''))" }; $sk.Close() } }
  $k.Close()
}
if (${advanced ? '$true' : '$false'}) {
  $svc = 'HKEY_LOCAL_MACHINE\\SYSTEM\\CurrentControlSet\\Services'
  $k = OpenKey $svc
  if ($k) { foreach ($s in $k.GetSubKeyNames()) { $sk = $k.OpenSubKey($s); if ($sk) { $ip = $sk.GetValue('ImagePath'); if ($ip) { $res.services += [pscustomobject]@{ key = "$svc\\$s"; image = "$ip" } }; $sk.Close() } }; $k.Close() }
}
ConvertTo-Json -InputObject ([pscustomobject]$res) -Depth 4 -Compress
`;
  const r = await runPSJson(script);
  if (!r || Array.isArray(r)) return null;
  const arr = v => v == null ? [] : (Array.isArray(v) ? v : [v]);
  const tops = {};
  for (const k of Object.keys(r.tops || {})) tops[k] = arr(r.tops[k]);
  return {
    uninstallExists: !!r.uninstallExists, tops,
    pubChildren: arr(r.pubChildren).map(p => ({ key: p.key, children: arr(p.children) })),
    run: arr(r.run), appPaths: arr(r.appPaths), services: arr(r.services),
  };
}

// ---------- Delete ----------
function backupDir() {
  const d = path.join(env('ProgramData') || env('TEMP'), 'Purgo', 'Backups', new Date().toISOString().slice(0, 10));
  try { fs.mkdirSync(d, { recursive: true }); } catch (e) {}
  return d;
}

async function backupKey(key) {
  const safe = key.replace(/[\\/:*?"<>|]/g, '_').slice(-110);
  const file = path.join(backupDir(), new Date().toTimeString().slice(0, 8).replace(/:/g, '') + '_' + safe + '.reg');
  const r = await run('reg.exe', ['export', key, file, '/y']);
  if (r.code !== 0) throw new Error('Registry backup failed, nothing was deleted');
}

async function keyExists(key) {
  return (await run('reg.exe', ['query', key])).code === 0;
}

async function deleteItem(item, shell) {
  try {
    if (item.kind === 'folder' || item.kind === 'file') {
      if (item.kind === 'folder' && !isDeletableFolder(item.path)) return { ok: false, error: 'Protected location' };
      if (!fs.existsSync(item.path)) return { ok: true };
      try { await shell.trashItem(item.path); }
      catch (e) {
        // Only the program's own install folder may be deleted permanently; user data must stay recoverable
        if (item.reason !== 'Install folder') return { ok: false, error: 'Could not move to the Recycle Bin: ' + e.message };
        await fs.promises.rm(item.path, { recursive: true, force: true });
      }
      return { ok: !fs.existsSync(item.path) };
    }
    if (item.kind === 'key') {
      if (!isDeletableKey(item.path)) return { ok: false, error: 'Protected key' };
      if (!(await keyExists(item.path))) return { ok: true };
      await backupKey(item.path);
      const r = await run('reg.exe', ['delete', item.path, '/f']);
      if (r.code !== 0 && !(await keyExists(item.path))) return { ok: true };
      return { ok: r.code === 0, error: r.err.trim() };
    }
    if (item.kind === 'value') {
      await backupKey(item.path);
      const r = await run('reg.exe', ['delete', item.path, '/v', item.value, '/f']);
      return { ok: r.code === 0, error: r.err.trim() };
    }
  } catch (e) { return { ok: false, error: e.message }; }
  return { ok: false, error: 'Unknown item' };
}

module.exports = { scanLeftovers, deleteItem, isDeletableFolder, isDeletableKey, backupKey, backupDir, setApp };
