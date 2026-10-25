const { contextBridge, ipcRenderer } = require('electron');

const inv = (ch) => (...a) => ipcRenderer.invoke(ch, ...a);

contextBridge.exposeInMainWorld('purgo', {
  env: inv('env:info'),
  relaunchAdmin: inv('admin:relaunch'),
  programs: inv('programs:list'),
  icons: inv('programs:icons'),
  openFolder: inv('programs:openFolder'),
  openRegistry: inv('programs:openRegistry'),
  searchOnline: inv('programs:search'),
  openWebsite: inv('programs:website'),
  copy: inv('programs:copy'),
  removeEntry: inv('programs:removeEntry'),
  startJob: inv('job:start'),
  answer: inv('job:answer'),
  skipWait: inv('job:skipWait'),
  cancelJob: inv('job:cancel'),
  browseFolder: inv('forced:browse'),
  openBackups: inv('backups:open'),
  apps: inv('apps:list'),
  removeApp: inv('apps:remove'),
  startup: inv('startup:list'),
  toggleStartup: inv('startup:toggle'),
  deleteStartup: inv('startup:delete'),
  openStartup: inv('startup:open'),
  capture: inv('dev:capture'),
  on: (ch, fn) => {
    const allowed = ['job:event', 'program:size'];
    if (!allowed.includes(ch)) return;
    ipcRenderer.on(ch, (e, d) => fn(d));
  },
});
