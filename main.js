const { app, BrowserWindow, ipcMain, shell, dialog, nativeImage, clipboard } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

const DEMO = process.platform !== 'win32' || !!process.env.PURGO_DEMO;
const programsMod = require('./src/programs');
const leftovers = require('./src/leftovers');
const { Job } = require('./src/uninstall');
const appsMod = require('./src/apps');
const { run } = require('./src/ps');
const demo = DEMO ? require('./src/demo') : null;

leftovers.setApp(app);

let win;
let programs = [];
let startupItems = [];
let jobs = new Map();
let jobSeq = 1;

function createWindow() {
  win = new BrowserWindow({
    width: 1360, height: 860, minWidth: 1020, minHeight: 640,
    backgroundColor: '#0b0d1a',
    show: false,
    title: 'Purgo',
    icon: path.join(__dirname, 'build', 'icon.png'),
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#00000000', symbolColor: '#c9cbe6', height: 40 },
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: false },
  });
  win.removeMenu();
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.once('ready-to-show', () => win.show());
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
}

const single = app.requestSingleInstanceLock();
if (!single) app.quit();
else {
  app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
  app.whenReady().then(createWindow);
}
app.on('window-all-closed', () => app.quit());

function send(ch, data) { if (win && !win.isDestroyed()) win.webContents.send(ch, data); }

async function isAdmin() {
  if (DEMO) return true;
  const r = await run('net.exe', ['session']);
  return r.code === 0;
}

const iconCache = new Map();
async function iconFor(file, size = 'large') {
  if (!file) return null;
  const k = file.toLowerCase() + '|' + size;
  if (iconCache.has(k)) return iconCache.get(k);
  let url = null;
  try {
    if (fs.existsSync(file)) {
      if (/\.ico$/i.test(file)) { const img = nativeImage.createFromPath(file); if (!img.isEmpty()) url = img.resize({ width: 32, height: 32 }).toDataURL(); }
      if (!url) { const img = await app.getFileIcon(file, { size }); if (img && !img.isEmpty()) url = img.toDataURL(); }
    }
  } catch (e) {}
  iconCache.set(k, url);
  return url;
}

// ---------- Environment ----------
ipcMain.handle('env:info', async () => ({
  admin: await isAdmin(), demo: DEMO, version: app.getVersion(), platform: process.platform,
}));

ipcMain.handle('admin:relaunch', async () => {
  const exe = process.env.PORTABLE_EXECUTABLE_FILE || process.execPath;
  spawn('powershell.exe', ['-NoProfile', '-Command', `Start-Process -FilePath '${exe.replace(/'/g, "''")}' -Verb RunAs`], { detached: true, windowsHide: true });
  setTimeout(() => app.quit(), 600);
});

// ---------- Programs ----------
ipcMain.handle('programs:list', async () => {
  programs = DEMO ? demo.programs() : await programsMod.scanPrograms();
  // Fill in missing sizes in the background
  setTimeout(async () => {
    for (const p of programs) {
      if (p.size || !p.installLocation || DEMO) continue;
      try {
        const s = await programsMod.folderSize(p.installLocation);
        if (s) { p.size = s; send('program:size', { id: p.id, size: s }); }
      } catch (e) {}
    }
  }, 300);
  return programs;
});

ipcMain.handle('programs:icons', async (e, ids) => {
  const out = {};
  for (const id of ids) {
    const p = programs.find(x => x.id === id);
    if (!p) continue;
    out[id] = DEMO ? null : await iconFor(programsMod.iconSource(p));
  }
  return out;
});

function prog(id) { return programs.find(x => x.id === id); }

ipcMain.handle('programs:openFolder', (e, id) => {
  const p = prog(id);
  if (p && p.installLocation && fs.existsSync(p.installLocation)) { shell.openPath(p.installLocation); return true; }
  return false;
});

ipcMain.handle('programs:openRegistry', async (e, id) => {
  const p = prog(id); if (!p || DEMO) return false;
  await run('reg.exe', ['add', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Applets\\Regedit', '/v', 'LastKey', '/t', 'REG_SZ', '/d', 'Computer\\' + p.regPath, '/f']);
  spawn('regedit.exe', ['-m'], { detached: true, shell: true });
  return true;
});

ipcMain.handle('programs:search', (e, id) => {
  const p = prog(id); if (!p) return;
  shell.openExternal('https://www.google.com/search?q=' + encodeURIComponent(p.name + ' ' + (p.publisher || '')));
});

ipcMain.handle('programs:website', (e, id) => {
  const p = prog(id); if (!p || !p.website) return;
  let u = p.website; if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
  shell.openExternal(u);
});

ipcMain.handle('programs:copy', (e, text) => { clipboard.writeText(String(text || '')); return true; });

ipcMain.handle('programs:removeEntry', async (e, id) => {
  const p = prog(id); if (!p) return { ok: false };
  if (DEMO) { programs = programs.filter(x => x.id !== id); return { ok: true }; }
  const r = await leftovers.deleteItem({ kind: 'key', path: p.regPath }, shell);
  if (r.ok) programs = programs.filter(x => x.id !== id);
  return r;
});

// ---------- Uninstall jobs ----------
ipcMain.handle('job:start', async (e, { type, ids, options, forced }) => {
  let list;
  if (type === 'forced') {
    const base = forced.id ? prog(forced.id) : null;
    const p = Object.assign({}, base || {}, {
      name: forced.name || (base && base.name) || '',
      installLocation: forced.folder || (base && base.installLocation) || null,
      publisher: forced.publisher || (base && base.publisher) || '',
      runUninstaller: !!(base && forced.runUninstaller),
    });
    if (!p.name && p.installLocation) p.name = path.basename(p.installLocation);
    if (!p.regPath) p.regPath = null;
    list = [p];
  } else {
    list = ids.map(prog).filter(Boolean).map(p => Object.assign({}, p));
  }
  // Let the scanner know about every *other* installed program so shared folders/names are never pre-selected
  const ids2 = new Set(type === 'forced' ? [forced.id] : ids);
  for (const p of list) {
    const others = programs.filter(o => !ids2.has(o.id) && o.id !== p.id);
    p.otherLocations = others.filter(o => o.installLocation).map(o => o.installLocation);
    p.otherNames = others.map(o => programsMod.coreName(o.name));
  }
  const id = jobSeq++;
  const JobClass = DEMO ? demo.DemoJob : Job;
  const job = new JobClass({ id, type, programs: list, options, shell, send: ev => send('job:event', ev) });
  jobs.set(id, job);
  setTimeout(() => job.run().finally(() => {
    // refresh the program list afterwards
    setTimeout(() => jobs.delete(id), 60000);
  }), 50);
  return { id, programs: list.map(p => ({ id: p.id, name: p.name, publisher: p.publisher, version: p.version })) };
});

ipcMain.handle('job:answer', (e, { jobId, kind, value }) => { const j = jobs.get(jobId); if (j) j.answer(kind, value); });
ipcMain.handle('job:skipWait', (e, jobId) => { const j = jobs.get(jobId); if (j) j.skipWait = true; });
ipcMain.handle('job:cancel', (e, jobId) => { const j = jobs.get(jobId); if (j) j.cancel(); });

ipcMain.handle('forced:browse', async () => {
  const r = await dialog.showOpenDialog(win, { title: 'Choose the program folder', properties: ['openDirectory'] });
  return r.canceled ? null : r.filePaths[0];
});

ipcMain.handle('backups:open', () => { shell.openPath(leftovers.backupDir()); });

// ---------- Windows apps ----------
ipcMain.handle('apps:list', async () => DEMO ? demo.apps() : appsMod.listApps(nativeImage));
ipcMain.handle('apps:remove', async (e, full) => {
  if (DEMO) { await new Promise(r => setTimeout(r, 1800)); return { ok: true }; }
  return appsMod.removeApp(full);
});

// ---------- Startup ----------
ipcMain.handle('startup:list', async () => {
  startupItems = DEMO ? demo.startup() : await appsMod.listStartup(f => iconFor(f, 'normal'));
  return startupItems;
});
ipcMain.handle('startup:toggle', async (e, { id, enabled }) => {
  const it = startupItems.find(x => x.id === id); if (!it) return { ok: false };
  if (DEMO) { it.enabled = enabled; return { ok: true }; }
  const r = await appsMod.setStartupEnabled(it, enabled);
  if (r.ok) it.enabled = enabled;
  return r;
});
ipcMain.handle('startup:delete', async (e, id) => {
  const it = startupItems.find(x => x.id === id); if (!it) return { ok: false };
  if (DEMO) return { ok: true };
  return appsMod.deleteStartup(it, shell);
});
ipcMain.handle('startup:open', (e, id) => {
  const it = startupItems.find(x => x.id === id);
  if (it && it.exe && fs.existsSync(it.exe)) shell.showItemInFolder(it.exe);
});

// ---------- Window ----------
ipcMain.handle('win:theme', (e, color) => { try { win.setTitleBarOverlay({ color: '#00000000', symbolColor: color || '#c9cbe6', height: 40 }); } catch (er) {} });

// Screenshot helper for the build pipeline (demo only)
ipcMain.handle('dev:capture', async (e, file) => {
  if (!DEMO) return;
  const img = await win.webContents.capturePage();
  fs.writeFileSync(file, img.toPNG());
  return true;
});
