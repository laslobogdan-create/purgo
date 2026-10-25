// Reads installed programs from the Windows registry (all users + current user, 32 & 64-bit).
const fs = require('fs');
const path = require('path');
const { runPSJson, asArray } = require('./ps');

const SCAN_SCRIPT = `
$out = New-Object System.Collections.Generic.List[object]
$roots = @(
  @{H='LocalMachine';V='Registry64';B=64},
  @{H='LocalMachine';V='Registry32';B=32},
  @{H='CurrentUser';V='Registry64';B=64}
)
$is64 = [Environment]::Is64BitOperatingSystem
foreach ($r in $roots) {
  if (-not $is64 -and $r.V -eq 'Registry32' -and $r.H -eq 'LocalMachine') { continue }
  $base = [Microsoft.Win32.RegistryKey]::OpenBaseKey($r.H, $(if ($is64) { $r.V } else { 'Default' }))
  $u = $base.OpenSubKey('SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall')
  if (-not $u) { continue }
  foreach ($n in $u.GetSubKeyNames()) {
    $k = $u.OpenSubKey($n); if (-not $k) { continue }
    $o = [ordered]@{ key=$n; hive=$r.H; view=$r.V; bits=$(if ($is64) { $r.B } else { 32 }) }
    foreach ($v in 'DisplayName','DisplayVersion','Publisher','InstallLocation','UninstallString','QuietUninstallString',
                   'DisplayIcon','URLInfoAbout','HelpLink','Comments','InstallDate','EstimatedSize','SystemComponent',
                   'ParentKeyName','ReleaseType','InstallSource','WindowsInstaller') {
      $val = $k.GetValue($v); if ($val -ne $null) { $o[$v] = "$val" }
    }
    $out.Add([pscustomobject]$o); $k.Close()
  }
}
ConvertTo-Json -InputObject $out.ToArray() -Depth 2 -Compress
`;

function expandEnv(s) {
  if (!s) return s;
  return s.replace(/%([^%]+)%/g, (m, name) => {
    const key = Object.keys(process.env).find(k => k.toLowerCase() === name.toLowerCase());
    return key ? process.env[key] : m;
  });
}

function cleanPath(s) {
  if (!s || !String(s).trim()) return null;
  s = expandEnv(String(s).trim().replace(/^"+|"+$/g, '')).replace(/\\+$/, '');
  return s.length < 4 ? null : s;
}

// "C:\x\y.exe",0  →  C:\x\y.exe
function iconFileFromSpec(spec) {
  if (!spec) return null;
  let p = String(spec).trim();
  const m = p.match(/^(.*?),\s*-?\d+$/);
  if (m) p = m[1];
  p = expandEnv(p.trim().replace(/^"+|"+$/g, ''));
  return p;
}

function splitCommand(cmd) {
  if (!cmd || !cmd.trim()) return { file: null, args: '' };
  cmd = expandEnv(cmd.trim());
  if (cmd.startsWith('"')) {
    const end = cmd.indexOf('"', 1);
    if (end > 0) return { file: cmd.slice(1, end), args: cmd.slice(end + 1).trim() };
  }
  const idx = cmd.toLowerCase().indexOf('.exe');
  if (idx > 0) return { file: cmd.slice(0, idx + 4), args: cmd.slice(idx + 4).trim() };
  const sp = cmd.indexOf(' ');
  if (sp > 0) return { file: cmd.slice(0, sp), args: cmd.slice(sp + 1).trim() };
  return { file: cmd, args: '' };
}

function parseDate(s) {
  if (!s) return null;
  s = String(s).trim();
  let m = s.match(/^(\d{4})(\d{2})(\d{2})$/) || s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3]).getTime();
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return new Date(+m[3], +m[1] - 1, +m[2]).getTime();
  return null;
}

function coreName(name) {
  if (!name) return '';
  let n = name;
  n = n.replace(/\((x64|x86|64-bit|32-bit|64 bit|32 bit|remove only|current user|all users)\)/ig, '');
  n = n.replace(/\b(x64|x86|64-bit|32-bit)\b/ig, '');
  n = n.replace(/\s+-\s+[a-z]{2}(-[a-z]{2})?\s*$/i, '');
  n = n.replace(/\bv?\d+(\.\d+)+\S*/ig, '');
  n = n.replace(/\(\s*\)/g, '').replace(/\s+-\s*$/, '').replace(/\s{2,}/g, ' ').replace(/^[\s\-_.]+|[\s\-_.]+$/g, '');
  return n.length >= 2 ? n : name.trim();
}

function registryPath(p) {
  const root = p.hive === 'LocalMachine' ? 'HKEY_LOCAL_MACHINE' : 'HKEY_CURRENT_USER';
  const sw = (p.hive === 'LocalMachine' && p.view === 'Registry32' && p.bits === 32)
    ? 'SOFTWARE\\WOW6432Node' : 'SOFTWARE';
  return `${root}\\${sw}\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\${p.key}`;
}

function isShared(dir) {
  const d = dir.toLowerCase();
  return /\\windows(\\|$)/.test(d) || d.includes('\\installer') || d.includes('package cache') ||
    d.includes('\\temp') || d.includes('common files') || d.includes('\\system32');
}

async function scanPrograms() {
  const raw = asArray(await runPSJson(SCAN_SCRIPT));
  const list = [];
  for (const r of raw) {
    const name = (r.DisplayName || '').trim();
    if (!name) continue;
    if (r.SystemComponent === '1') continue;
    if (r.ParentKeyName) continue;
    if (r.ReleaseType && /update|hotfix/i.test(r.ReleaseType)) continue;
    if (!r.UninstallString) continue;

    const p = {
      key: r.key, hive: r.hive, view: r.view, bits: r.bits,
      name,
      version: r.DisplayVersion || '',
      publisher: (r.Publisher || '').trim(),
      installLocation: cleanPath(r.InstallLocation),
      uninstallString: r.UninstallString,
      quietUninstallString: r.QuietUninstallString || null,
      displayIcon: r.DisplayIcon || null,
      website: r.URLInfoAbout || r.HelpLink || '',
      comments: r.Comments || '',
      size: r.EstimatedSize ? Number(r.EstimatedSize) * 1024 : 0,
      installDate: parseDate(r.InstallDate),
      perUser: r.hive === 'CurrentUser',
    };
    p.isMsi = r.WindowsInstaller === '1' || /msiexec/i.test(p.uninstallString);
    p.regPath = registryPath(p);

    if (!p.installLocation) {
      const guess = [iconFileFromSpec(p.displayIcon), splitCommand(p.uninstallString).file]
        .filter(Boolean)
        .map(f => { try { return fs.existsSync(f) ? path.dirname(f) : null; } catch (e) { return null; } })
        .find(d => d && !isShared(d) && d.split('\\').length >= 3);
      if (guess) { p.installLocation = guess; p.locationGuessed = true; }
    }
    if (!p.installDate && p.installLocation) {
      try { p.installDate = fs.statSync(p.installLocation).birthtimeMs; } catch (e) {}
    }
    list.push(p);
  }

  // de-duplicate (same name + version from multiple hives)
  const seen = new Set();
  const out = [];
  for (const p of list) {
    const k = (p.name + '|' + p.version).toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    p.id = Buffer.from(p.regPath).toString('base64');
    out.push(p);
  }
  out.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
  return out;
}

// Folder size with a cap so huge folders don't hang the app
async function folderSize(dir, limit = 40000) {
  let total = 0, count = 0;
  const stack = [dir];
  while (stack.length && count < limit) {
    const d = stack.pop();
    let entries;
    try { entries = await fs.promises.readdir(d, { withFileTypes: true }); } catch (e) { continue; }
    for (const e of entries) {
      if (++count > limit) break;
      const full = path.join(d, e.name);
      if (e.isDirectory()) { if (!e.isSymbolicLink()) stack.push(full); }
      else {
        try { total += (await fs.promises.stat(full)).size; } catch (er) {}
      }
    }
  }
  return total;
}

// Best file to take an icon from
function iconSource(p) {
  const cands = [];
  const di = iconFileFromSpec(p.displayIcon);
  if (di) cands.push(di);
  const u = splitCommand(p.uninstallString).file;
  if (u && !/msiexec/i.test(u)) cands.push(u);
  for (const c of cands) {
    try { if (fs.existsSync(c)) return c; } catch (e) {}
  }
  if (p.installLocation) {
    try {
      const exes = fs.readdirSync(p.installLocation).filter(f => /\.exe$/i.test(f) && !/unins|uninst|setup|update|crash|helper/i.test(f));
      if (exes.length) return path.join(p.installLocation, exes[0]);
    } catch (e) {}
  }
  return null;
}

module.exports = { scanPrograms, folderSize, iconSource, splitCommand, coreName, expandEnv, cleanPath };
