// Dev-only: drives the UI in demo mode and saves screenshots.
process.env.PURGO_DEMO = '1';
process.env.PURGO_DEMO_SPEED = process.env.PURGO_DEMO_SPEED || '1';
const { app, BrowserWindow } = require('electron');
const path = require('path');
app.commandLine.appendSwitch('force-device-scale-factor', '1');
require('../main.js');
const out = process.argv.find(a => a.startsWith('--out=')).slice(6);
const steps = JSON.parse(require('fs').readFileSync(process.argv.find(a => a.startsWith('--steps=')).slice(8), 'utf8'));
const wait = ms => new Promise(r => setTimeout(r, ms));
app.whenReady().then(async () => {
  await wait(1500);
  const win = BrowserWindow.getAllWindows()[0];
  win.setSize(1440, 900);
  win.webContents.on('console-message', (e, l, m) => console.log('[renderer]', m));
  for (const s of steps) {
    if (s.js) { try { await win.webContents.executeJavaScript(s.js); } catch (e) { console.log('JS ERR', s.js, e.message); } }
    if (s.wait) await wait(s.wait);
    if (s.shot) { const img = await win.webContents.capturePage(); require('fs').writeFileSync(path.join(out, s.shot + '.png'), img.toPNG()); console.log('shot', s.shot); }
  }
  app.exit(0);
});
