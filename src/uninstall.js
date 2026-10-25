// Orchestrates an uninstall job and streams step-by-step progress to the UI.
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { runPS, runPSJson, run, psq, asArray } = require('./ps');
const { splitCommand } = require('./programs');
const { scanLeftovers, deleteItem } = require('./leftovers');

const sleep = ms => new Promise(r => setTimeout(r, ms));

class Job {
  constructor({ id, type, programs, options, send, shell }) {
    Object.assign(this, { id, type, programs, options: options || {}, send, shell });
    this.cancelled = false;
    this.skipWait = false;
    this.waiters = {};
  }

  emit(ev) { this.send({ jobId: this.id, ...ev }); }
  log(text, level = 'info', index) { this.emit({ type: 'log', text, level, index }); }
  step(step, status, extra = {}) { this.emit({ type: 'step', step, status, ...extra }); }

  // Wait for the UI to answer something (confirm leftovers, yes/no question)
  ask(kind, payload) {
    return new Promise(resolve => {
      this.waiters[kind] = resolve;
      this.emit({ type: 'ask', kind, ...payload });
    });
  }
  answer(kind, value) { const w = this.waiters[kind]; if (w) { delete this.waiters[kind]; w(value); } }
  cancel() { this.cancelled = true; this.skipWait = true; Object.keys(this.waiters).forEach(k => this.answer(k, null)); }

  async run() {
    const t0 = Date.now();
    const summary = { programs: this.programs.length, uninstalled: 0, programBytes: 0, leftoversRemoved: 0, leftoversFound: 0, failed: 0, bytes: 0 };
    try {
      // 1. Restore point
      if (this.options.restorePoint && this.type !== 'forced') {
        this.step('restore', 'active');
        this.log('Creating a System Restore point (this can take up to a minute)…');
        const r = await createRestorePoint(this.programs.length === 1 ? `Purgo: before uninstalling ${this.programs[0].name}` : `Purgo: before uninstalling ${this.programs.length} programs`);
        if (r.ok) { this.log('Restore point created', 'ok'); this.step('restore', 'done'); }
        else { this.log('Restore point skipped: ' + r.message, 'warn'); this.step('restore', 'skipped', { message: r.message }); }
      } else this.step('restore', 'skipped');

      for (let i = 0; i < this.programs.length && !this.cancelled; i++) {
        const p = this.programs[i];
        this.skipWait = false;
        this.emit({ type: 'program', index: i, status: 'running' });
        this.log(p.name, 'title', i);
        let stillInstalled = false;

        // 2. Uninstaller
        if (this.type !== 'forced' || p.runUninstaller) {
          this.step('uninstall', 'active', { index: i });
          const quiet = this.type === 'batch';
          this.log(quiet && (p.isMsi || p.quietUninstallString) ? 'Running the uninstaller silently…' : 'Launching the program\'s own uninstaller — follow its window if one appears…', 'info', i);
          const r = await this.runUninstaller(p, quiet, i);
          if (this.cancelled) break;
          stillInstalled = p.regPath ? await keyExists(p.regPath) : false;
          if (r.error) {
            this.log('Could not start the uninstaller: ' + r.error, 'err', i);
          } else if (stillInstalled) {
            this.log('The uninstaller finished, but the program still appears as installed (it may have been cancelled).', 'warn', i);
          } else {
            this.log('Uninstaller finished', 'ok', i);
            summary.uninstalled++;
            summary.programBytes += p.size || 0;
          }
          this.step('uninstall', stillInstalled || r.error ? 'warn' : 'done', { index: i });
          if ((stillInstalled || r.error) && this.type === 'single') {
            const go = await this.ask('continue', {
              title: 'Program still installed',
              message: `${p.name} still appears to be installed. Do you want to scan for leftovers anyway? Nothing will be selected automatically.`,
            });
            if (!go) { this.step('scan', 'skipped'); this.step('clean', 'skipped'); this.emit({ type: 'program', index: i, status: 'warn' }); continue; }
          } else if ((stillInstalled || r.error) && this.type === 'batch') {
            this.log('Skipping leftover cleanup so nothing from an installed program gets removed.', 'warn', i);
            summary.failed++;
            this.emit({ type: 'program', index: i, status: 'warn' });
            continue;
          }
        } else this.step('uninstall', 'skipped');

        // 3. Scan
        this.step('scan', 'active', { index: i });
        const mode = this.options.scanMode || (this.type === 'forced' ? 'advanced' : 'moderate');
        this.log(`Scanning for leftovers (${mode} mode)…`, 'info', i);
        await sleep(400);
        let items = [];
        try { items = await scanLeftovers(p, mode); } catch (e) { this.log('Scan error: ' + e.message, 'err', i); }
        if (stillInstalled) items.forEach(it => it.recommended = false);
        await computeSizes(items);
        summary.leftoversFound += items.length;
        const files = items.filter(x => x.kind === 'folder' || x.kind === 'file').length;
        this.log(`${items.length} leftover(s) found — ${files} on disk, ${items.length - files} in the registry`, items.length ? 'ok' : 'info', i);
        this.step('scan', 'done', { index: i, count: items.length });

        // 4. Review
        let selected;
        if (!items.length) selected = [];
        else if (this.type === 'batch') selected = items.filter(x => x.recommended);
        else {
          this.step('review', 'active', { index: i });
          const ids = await this.ask('leftovers', { items, program: p.name });
          if (this.cancelled || !ids) break;
          selected = items.filter(x => ids.includes(x.id));
          this.step('review', 'done', { index: i });
        }

        // 5. Clean
        if (selected.length) {
          this.step('clean', 'active', { index: i, total: selected.length });
          this.log(`Deleting ${selected.length} leftover(s)…`, 'info', i);
          let n = 0;
          for (const it of selected) {
            const r = await deleteItem(it, this.shell);
            n++;
            if (r.ok) { summary.leftoversRemoved++; summary.bytes += it.size || 0; }
            this.emit({ type: 'deleted', index: i, id: it.id, ok: r.ok, done: n, total: selected.length, path: it.path, value: it.value, kind: it.kind });
            if (!r.ok) this.log(`Could not remove ${it.path}${it.value ? ' → ' + it.value : ''}${r.error ? ' (' + r.error + ')' : ''}`, 'warn', i);
            await sleep(60);
          }
          this.log(`${selected.length} leftover(s) processed`, 'ok', i);
          this.step('clean', 'done', { index: i });
        } else this.step('clean', 'skipped', { index: i });
        this.emit({ type: 'program', index: i, status: 'done', found: items.length });
      }
    } catch (e) {
      this.log('Unexpected error: ' + e.message, 'err');
    }
    summary.seconds = Math.round((Date.now() - t0) / 1000);
    summary.cancelled = this.cancelled;
    this.step('done', 'done');
    this.emit({ type: 'finished', summary });
  }

  async runUninstaller(p, quiet, index) {
    let cmd;
    const guid = (p.uninstallString.match(/\{[0-9A-F-]{36}\}/i) || [])[0] || (p.isMsi && /^\{[0-9A-F-]{36}\}$/i.test(p.key) ? p.key : null);
    if (p.isMsi && guid) cmd = `msiexec.exe /x ${guid}` + (quiet ? ' /passive /norestart' : '');
    else if (quiet && p.quietUninstallString) cmd = normalize(p.quietUninstallString);
    else cmd = normalize(p.uninstallString);
    if (!cmd) return { error: 'No uninstall command' };
    this.log('› ' + cmd, 'cmd', index);

    const started = Date.now();
    let child;
    try {
      child = spawn(cmd, { shell: true, windowsHide: false, detached: false });
    } catch (e) { return { error: e.message }; }
    let exited = false, spawnError = null;
    child.on('exit', () => { exited = true; });
    child.on('error', e => { exited = true; spawnError = e.message; });

    // track by pid+creation time so a recycled PID never counts as "still running"
    const tracked = new Map([[child.pid, null]]);
    const isTracked = x => tracked.has(x.id) && (tracked.get(x.id) == null || tracked.get(x.id) === x.created);
    const IGNORE = /\\(explorer|conhost|chrome|msedge|firefox|brave|opera|iexplore|steam|steamwebhelper|searchapp|runtimebroker|werfault)\.exe$/i;
    let tempDir = (process.env.TEMP || '').toLowerCase();
    try { tempDir = fs.realpathSync.native(os.tmpdir()).toLowerCase(); } catch (e) {}
    const loc = (p.installLocation || '').toLowerCase();
    let lastAlive = Date.now();
    this.emit({ type: 'waiting', index, waiting: true });

    while (!this.skipWait) {
      await sleep(1200);
      const procs = await processSnapshot();
      if (!procs) { if (exited) break; else continue; }
      // pin the creation time of the root once we see it
      for (const x of procs) if (tracked.has(x.id) && tracked.get(x.id) == null) tracked.set(x.id, x.created);
      // add descendants
      let added = true;
      while (added) {
        added = false;
        for (const x of procs) {
          if (!tracked.has(x.id) && tracked.has(x.parent) && x.created >= started - 2000 && !IGNORE.test(x.path || '')) { tracked.set(x.id, x.created); added = true; }
        }
      }
      // uninstallers that copy themselves to %TEMP% or run from the program folder (e.g. NSIS Au_.exe)
      for (const x of procs) {
        const exe = (x.path || '').toLowerCase();
        if (!tracked.has(x.id) && x.created >= started - 1000 && exe && !IGNORE.test(exe) &&
          ((tempDir && exe.startsWith(tempDir) && /(au_|un_|uninst|unins|setup|~|_iu)/i.test(path.basename(exe))) ||
           /\\(is-[^\\]+\.tmp|~nsu[^\\]*\.tmp)\\/i.test(exe) ||
           (loc && exe.startsWith(loc + '\\'))))
          tracked.set(x.id, x.created);
      }
      const anyAlive = procs.some(isTracked);
      if (anyAlive) lastAlive = Date.now();
      // done when nothing we track is alive for ~2.5s
      if (!anyAlive && exited && Date.now() - lastAlive > 2400) break;
      if (!anyAlive && !exited && Date.now() - started > 15000) break;
      if (Date.now() - started > 3 * 3600e3) break; // hard cap
    }
    this.emit({ type: 'waiting', index, waiting: false });
    return { error: spawnError };
  }
}

function normalize(cmd) {
  const { file, args } = splitCommand(cmd);
  if (!file) return null;
  if (/msiexec/i.test(file)) return `msiexec.exe ${args.replace(/\/I(\{)/i, '/X$1')}`;
  return `"${file}"${args ? ' ' + args : ''}`;
}

async function processSnapshot() {
  const r = await runPSJson(`Get-CimInstance Win32_Process -Property ProcessId,ParentProcessId,CreationDate,ExecutablePath | ForEach-Object { [pscustomobject]@{ i = $_.ProcessId; p = $_.ParentProcessId; c = $(if ($_.CreationDate) { ([DateTimeOffset]$_.CreationDate).ToUnixTimeMilliseconds() } else { 0 }); e = $_.ExecutablePath } } | ConvertTo-Json -Compress`, { timeout: 20000 }).catch(() => null);
  if (!r) return null;
  return asArray(r).map(x => ({ id: x.i, parent: x.p, created: x.c, path: x.e }));
}

async function keyExists(key) {
  const r = await run('reg.exe', ['query', key]);
  return r.code === 0;
}

async function createRestorePoint(description) {
  const { out } = await runPS(`try { Enable-ComputerRestore -Drive "$env:SystemDrive\\" -ErrorAction SilentlyContinue; Checkpoint-Computer -Description ${psq(description.slice(0, 60))} -RestorePointType APPLICATION_UNINSTALL -ErrorAction Stop -WarningVariable w -WarningAction SilentlyContinue; if ($w) { 'WARN:' + ($w -join ' ') } else { 'OK' } } catch { 'ERR:' + $_.Exception.Message }`, { timeout: 240000 })
    .catch(e => ({ out: 'ERR:' + e.message }));
  if (/^OK/m.test(out)) return { ok: true };
  if (/WARN:/.test(out)) return { ok: false, message: 'Windows only allows one restore point every 24 hours — a recent one already exists.' };
  return { ok: false, message: (out.split('ERR:')[1] || 'System Restore is not available').trim() };
}

async function computeSizes(items) {
  for (const it of items) {
    if (it.kind !== 'folder') continue;
    let total = 0, count = 0;
    const stack = [it.path];
    while (stack.length && count < 20000) {
      const d = stack.pop();
      let entries;
      try { entries = await fs.promises.readdir(d, { withFileTypes: true }); } catch (e) { continue; }
      for (const e of entries) {
        count++;
        const f = path.join(d, e.name);
        if (e.isDirectory()) stack.push(f);
        else { try { total += (await fs.promises.stat(f)).size; } catch (er) {} }
      }
    }
    it.size = total;
    it.files = count;
  }
}

module.exports = { Job };
