// Windows (Microsoft Store / UWP) apps and Startup entries.
const fs = require('fs');
const path = require('path');
const { runPSJson, runPS, run, psq, asArray } = require('./ps');
const { splitCommand, expandEnv } = require('./programs');
const { backupKey } = require('./leftovers');

// ---------------- Windows Apps ----------------
const APPS_SCRIPT = `
$names = @{}
try { Get-StartApps | ForEach-Object { $pfn = ($_.AppID -split '!')[0]; if (-not $names.ContainsKey($pfn)) { $names[$pfn] = $_.Name } } } catch {}
$list = Get-AppxPackage | Where-Object { -not $_.IsFramework -and -not $_.NonRemovable -and $_.SignatureKind -ne 'System' -and -not $_.IsResourcePackage } | ForEach-Object {
  $cn = ''; if ($_.Publisher -match 'CN=([^,]+)') { $cn = $Matches[1].Trim('"') }
  [pscustomobject]@{
    name = $_.Name; full = $_.PackageFullName; family = $_.PackageFamilyName; version = "$($_.Version)";
    publisher = $cn; location = $_.InstallLocation; display = $names[$_.PackageFamilyName]; signature = "$($_.SignatureKind)"
  }
}
ConvertTo-Json -InputObject @($list) -Depth 2 -Compress
`;

function prettify(name) {
  let n = name.replace(/^(Microsoft|Windows|Clipchamp|MicrosoftCorporationII|[0-9A-F]{4,}\.?)\./i, '');
  n = n.replace(/\./g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2');
  return n.trim();
}

function readManifest(location) {
  try {
    const xml = fs.readFileSync(path.join(location, 'AppxManifest.xml'), 'utf8');
    const props = xml.match(/<Properties>([\s\S]*?)<\/Properties>/);
    const dn = props && props[1].match(/<DisplayName>(.*?)<\/DisplayName>/);
    const logo = (props && props[1].match(/<Logo>(.*?)<\/Logo>/)) || xml.match(/Square44x44Logo="([^"]+)"/);
    return { displayName: dn ? dn[1] : null, logo: logo ? logo[1] : null };
  } catch (e) { return {}; }
}

// Asset "Assets\StoreLogo.png" is stored as StoreLogo.scale-100.png, etc.
function findLogo(location, rel) {
  if (!rel) return null;
  const full = path.join(location, rel);
  if (fs.existsSync(full)) return full;
  const dir = path.dirname(full), base = path.basename(full, path.extname(full)), ext = path.extname(full);
  try {
    const files = fs.readdirSync(dir).filter(f => f.toLowerCase().startsWith(base.toLowerCase() + '.') && f.toLowerCase().endsWith(ext.toLowerCase()));
    const pref = ['scale-200', 'scale-150', 'targetsize-48', 'scale-125', 'scale-100', 'targetsize-32'];
    for (const p of pref) { const f = files.find(x => x.toLowerCase().includes(p) && !x.includes('contrast')); if (f) return path.join(dir, f); }
    const any = files.find(x => !x.includes('contrast'));
    return any ? path.join(dir, any) : null;
  } catch (e) { return null; }
}

async function listApps(nativeImage) {
  const raw = asArray(await runPSJson(APPS_SCRIPT, { timeout: 180000 }));
  return raw.map(a => {
    const man = a.location ? readManifest(a.location) : {};
    let display = a.display || (man.displayName && !/^ms-resource:/i.test(man.displayName) ? man.displayName : null) || prettify(a.name);
    let icon = null;
    const logo = a.location ? findLogo(a.location, man.logo) : null;
    if (logo && nativeImage) {
      try { const img = nativeImage.createFromPath(logo); if (!img.isEmpty()) icon = img.resize({ width: 64, height: 64 }).toDataURL(); } catch (e) {}
    }
    let date = null;
    try { date = fs.statSync(a.location).birthtimeMs; } catch (e) {}
    return { id: a.full, name: display, pkg: a.name, full: a.full, version: a.version, publisher: a.publisher, location: a.location, icon, installDate: date, store: a.signature === 'Store' };
  }).sort((x, y) => x.name.localeCompare(y.name));
}

async function removeApp(full) {
  const { out, err } = await runPS(`try { Remove-AppxPackage -Package ${psq(full)} -ErrorAction Stop; 'OK' } catch { 'ERR:' + $_.Exception.Message }`, { timeout: 300000 });
  if (out.includes('OK') && !out.includes('ERR:')) return { ok: true };
  return { ok: false, error: (out.replace(/^[\s\S]*ERR:/, '') || err).trim() };
}

// ---------------- Startup ----------------
const SA = 'SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved';
const RUN_SOURCES = [
  { id: 'hkcu', key: 'HKEY_CURRENT_USER\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run', approved: 'HKEY_CURRENT_USER\\' + SA + '\\Run', scope: 'Current user' },
  { id: 'hklm', key: 'HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run', approved: 'HKEY_LOCAL_MACHINE\\' + SA + '\\Run', scope: 'All users' },
  { id: 'hklm32', key: 'HKEY_LOCAL_MACHINE\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Run', approved: 'HKEY_LOCAL_MACHINE\\' + SA + '\\Run32', scope: 'All users (32-bit)' },
];

function startupFolders() {
  return [
    { dir: path.join(process.env.APPDATA || '', 'Microsoft\\Windows\\Start Menu\\Programs\\Startup'), approved: 'HKEY_CURRENT_USER\\' + SA + '\\StartupFolder', scope: 'Startup folder (you)' },
    { dir: path.join(process.env.ProgramData || '', 'Microsoft\\Windows\\Start Menu\\Programs\\StartUp'), approved: 'HKEY_LOCAL_MACHINE\\' + SA + '\\StartupFolder', scope: 'Startup folder (all users)' },
  ];
}

async function listStartup(getIcon) {
  const folders = startupFolders();
  const script = `
function OpenKey($full) {
  $i = $full.IndexOf('\\'); $h = $full.Substring(0,$i); $s = $full.Substring($i+1)
  $hive = if ($h -eq 'HKEY_LOCAL_MACHINE') { 'LocalMachine' } else { 'CurrentUser' }
  $view = if ([Environment]::Is64BitOperatingSystem) { 'Registry64' } else { 'Default' }
  return [Microsoft.Win32.RegistryKey]::OpenBaseKey($hive, $view).OpenSubKey($s)
}
$out = @()
$src = @(${RUN_SOURCES.map(s => `@{id=${psq(s.id)};key=${psq(s.key)};ap=${psq(s.approved)}}`).join(',')})
foreach ($s in $src) {
  $k = OpenKey $s.key; if (-not $k) { continue }
  $ap = OpenKey $s.ap
  foreach ($v in $k.GetValueNames()) {
    if (-not $v) { continue }
    $b = $null; if ($ap) { $b = $ap.GetValue($v) }
    $out += [pscustomobject]@{ src = $s.id; name = $v; command = "$($k.GetValue($v))"; state = $(if ($b -is [byte[]] -and $b.Length -gt 0) { [int]$b[0] } else { 2 }) }
  }
  $k.Close(); if ($ap) { $ap.Close() }
}
$fold = @(${folders.map(f => `@{dir=${psq(f.dir)};ap=${psq(f.approved)}}`).join(',')})
for ($i = 0; $i -lt $fold.Count; $i++) {
  $f = $fold[$i]
  if (-not (Test-Path -LiteralPath $f.dir)) { continue }
  $ap = OpenKey $f.ap
  Get-ChildItem -LiteralPath $f.dir -File | Where-Object { $_.Name -ne 'desktop.ini' } | ForEach-Object {
    $target = $_.FullName
    if ($_.Extension -eq '.lnk') { try { $target = (New-Object -ComObject WScript.Shell).CreateShortcut($_.FullName).TargetPath } catch {} }
    $b = $null; if ($ap) { $b = $ap.GetValue($_.Name) }
    $out += [pscustomobject]@{ src = "folder$i"; name = $_.Name; file = $_.FullName; command = $target; state = $(if ($b -is [byte[]] -and $b.Length -gt 0) { [int]$b[0] } else { 2 }) }
  }
  if ($ap) { $ap.Close() }
}
foreach ($o in $out) {
  $exe = $o.command
  if ($exe -match '^"([^"]+)"') { $exe = $Matches[1] } elseif ($exe -match '^(.+?\\.exe)') { $exe = $Matches[1] }
  $exe = [Environment]::ExpandEnvironmentVariables($exe)
  $o | Add-Member exe $exe
  $co = ''; $desc = ''
  if (Test-Path -LiteralPath $exe) { $vi = (Get-Item -LiteralPath $exe).VersionInfo; $co = $vi.CompanyName; $desc = $vi.FileDescription }
  $o | Add-Member company "$co"; $o | Add-Member description "$desc"
}
ConvertTo-Json -InputObject @($out) -Depth 2 -Compress
`;
  const raw = asArray(await runPSJson(script));
  const items = [];
  for (const r of raw) {
    let source, isFolder = r.src.startsWith('folder');
    if (isFolder) source = folders[Number(r.src.slice(6))];
    else source = RUN_SOURCES.find(s => s.id === r.src);
    if (!source) continue;
    const item = {
      id: r.src + '|' + r.name, name: (r.description && r.description.length < 60 ? r.description : r.name.replace(/\.lnk$/i, '')),
      entry: r.name, command: r.command, exe: r.exe, company: r.company || '', scope: source.scope,
      enabled: (Number(r.state) & 1) === 0, approvedKey: source.approved, runKey: source.key || null, file: r.file || null,
    };
    item.icon = getIcon ? await getIcon(r.exe) : null;
    items.push(item);
  }
  return items.sort((a, b) => a.name.localeCompare(b.name));
}

async function setStartupEnabled(item, enabled) {
  // Same mechanism Task Manager uses (StartupApproved)
  const data = (enabled ? '02' : '03') + '0'.repeat(22);
  const r = await run('reg.exe', ['add', item.approvedKey, '/v', item.entry, '/t', 'REG_BINARY', '/d', data, '/f']);
  return { ok: r.code === 0, error: r.err.trim() };
}

async function deleteStartup(item, shell) {
  if (item.file) {
    try { await shell.trashItem(item.file); return { ok: true }; } catch (e) { return { ok: false, error: e.message }; }
  }
  try { await backupKey(item.runKey); } catch (e) { return { ok: false, error: e.message }; }
  const r = await run('reg.exe', ['delete', item.runKey, '/v', item.entry, '/f']);
  await run('reg.exe', ['delete', item.approvedKey, '/v', item.entry, '/f']);
  return { ok: r.code === 0, error: r.err.trim() };
}

module.exports = { listApps, removeApp, listStartup, setStartupEnabled, deleteStartup };
