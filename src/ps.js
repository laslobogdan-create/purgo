// Small helpers for running PowerShell / reg.exe / cmd from the main process.
const { spawn, execFile } = require('child_process');

function runPS(script, { timeout = 120000 } = {}) {
  const full = "$ErrorActionPreference='SilentlyContinue';$ProgressPreference='SilentlyContinue';" +
    "[Console]::OutputEncoding=[Text.Encoding]::UTF8;\n" + script;
  const encoded = Buffer.from(full, 'utf16le').toString('base64');
  return new Promise((resolve, reject) => {
    const p = spawn('powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
      { windowsHide: true });
    const oc = [], ec = [];
    const timer = setTimeout(() => { try { p.kill(); } catch (e) {} reject(new Error('PowerShell timed out')); }, timeout);
    p.stdout.on('data', d => oc.push(d));
    p.stderr.on('data', d => ec.push(d));
    p.on('error', e => { clearTimeout(timer); reject(e); });
    p.on('close', () => { clearTimeout(timer); resolve({ out: Buffer.concat(oc).toString('utf8').trim(), err: Buffer.concat(ec).toString('utf8').trim() }); });
  });
}

async function runPSJson(script, opts) {
  const { out } = await runPS(script, opts);
  if (!out) return [];
  // PowerShell may print warnings before JSON — find the JSON start
  const start = out.search(/[\[{]/);
  if (start < 0) return [];
  try {
    const v = JSON.parse(out.slice(start));
    return v;
  } catch (e) {
    return [];
  }
}

function asArray(v) {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}

// Escape a value for a single-quoted PowerShell string literal
function psq(s) { return "'" + String(s == null ? '' : s).replace(/'/g, "''") + "'"; }

function run(file, args, { timeout = 60000 } = {}) {
  return new Promise(resolve => {
    execFile(file, args, { windowsHide: true, timeout, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
      (error, stdout, stderr) => resolve({ code: error ? (error.code || 1) : 0, out: stdout || '', err: stderr || '' }));
  });
}

module.exports = { runPS, runPSJson, asArray, psq, run };
