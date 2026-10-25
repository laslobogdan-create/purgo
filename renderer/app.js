/* Purgo renderer */
const api = window.purgo;
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const DAY = 86400000;

function fmtSize(b, parts) {
  if (!b) return parts ? ['—', ''] : '—';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0; let v = b;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  const n = v >= 100 || i === 0 ? Math.round(v).toString() : v.toFixed(v >= 10 ? 1 : 2);
  return parts ? [n, u[i]] : n + ' ' + u[i];
}
function relDate(t) {
  if (!t) return '—';
  const d = Math.floor((Date.now() - t) / DAY);
  if (d <= 0) return 'Today';
  if (d === 1) return 'Yesterday';
  if (d < 7) return d + ' days ago';
  if (d < 14) return '1 week ago';
  if (d < 60) return Math.floor(d / 7) + ' weeks ago';
  return new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}
function fullDate(t) { return t ? new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' }) : 'Unknown'; }
function hash(s) { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) | 0; return Math.abs(h); }
function avatar(name, src, cls = '') {
  if (src) return `<div class="ico ${cls}"><img src="${src}" alt=""></div>`;
  const h = hash(name) % 360;
  const letter = (String(name).match(/[A-Za-z0-9]/) || ['?'])[0].toUpperCase();
  return `<div class="ico letter ${cls}" style="background:linear-gradient(135deg,hsl(${h} 75% 58%),hsl(${(h + 40) % 360} 70% 45%))">${letter}</div>`;
}
function countUp(el, to, fmt = v => Math.round(v), ms = 900) {
  const from = Number(el.dataset.v || 0); el.dataset.v = to;
  const t0 = performance.now();
  const tick = t => {
    const k = Math.min(1, (t - t0) / ms); const e = 1 - Math.pow(1 - k, 3);
    el.innerHTML = fmt(from + (to - from) * e);
    if (k < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

// ---------------- toasts & dialogs ----------------
function toast(text, kind = 'ok') {
  const t = document.createElement('div');
  t.className = 'toast ' + kind;
  t.innerHTML = `<div class="ti">${icon(kind === 'ok' ? 'check' : kind === 'err' ? 'alert' : 'info')}</div><div>${esc(text)}</div>`;
  $('#toasts').appendChild(t);
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 400); }, 3800);
}

const modalRoot = $('#modal-root');
function openModal(html, cls = '') {
  modalRoot.innerHTML = `<div class="modal ${cls}">${html}</div>`;
  hydrateIcons(modalRoot);
  requestAnimationFrame(() => modalRoot.classList.add('show'));
  return modalRoot.firstElementChild;
}
function closeModal() {
  modalRoot.classList.remove('show');
  setTimeout(() => { if (!modalRoot.classList.contains('show')) modalRoot.innerHTML = ''; }, 400);
}

function confirmDialog({ title, text, ok = 'Continue', danger = true, iconName = 'alert' }) {
  return new Promise(resolve => {
    // stack over an existing modal if needed
    const layer = document.createElement('div');
    layer.className = 'modal-root';
    layer.style.zIndex = 150;
    layer.innerHTML = `<div class="modal small"><div class="confirm"><div class="ci ${danger ? '' : 'info'}">${icon(iconName)}</div><h3>${esc(title)}</h3><p>${text}</p>
      <div class="row-btns"><button class="btn ghost" data-r="0">Cancel</button><button class="btn ${danger ? 'danger' : 'primary'}" data-r="1">${esc(ok)}</button></div></div></div>`;
    document.body.appendChild(layer);
    requestAnimationFrame(() => layer.classList.add('show'));
    const done = v => { layer.classList.remove('show'); setTimeout(() => layer.remove(), 400); resolve(v); };
    layer.addEventListener('click', e => { const b = e.target.closest('[data-r]'); if (b) done(b.dataset.r === '1'); else if (e.target === layer) done(false); });
    layer.querySelector('[data-r="1"]').focus();
  });
}

// ---------------- navigation ----------------
let currentPage = null;
const loaded = {};
function go(page) {
  if (currentPage === page) return;
  currentPage = page;
  $$('.page').forEach(p => p.classList.toggle('active', p.id === page + '-page'));
  $$('#nav button').forEach(b => b.classList.toggle('active', b.dataset.page === page));
  const btn = $(`#nav button[data-page="${page}"]`);
  const pill = $('#nav-pill');
  pill.style.transform = `translateY(${btn.offsetTop}px)`;
  pill.style.height = btn.offsetHeight + 'px';
  closeDrawer();
  if (!loaded[page]) { loaded[page] = true; ({ programs: loadPrograms, apps: loadApps, startup: loadStartup, forced: renderForced })[page](); }
}
$('#nav').addEventListener('click', e => { const b = e.target.closest('button'); if (b) go(b.dataset.page); });

// ---------------- programs ----------------
const P = { list: [], q: '', filter: 'all', sort: 'name', dir: 1, selected: new Set(), icons: {}, collapsed: new Set(), focus: null };
let cleanedTotal = Number(localStorage.getItem('purgo.cleaned') || 0);

async function loadPrograms(keepSel) {
  const list = $('#plist');
  list.innerHTML = Array.from({ length: 10 }, (_, i) => `<div class="skel" style="animation-delay:${i * 80}ms;opacity:${1 - i * 0.08}"></div>`).join('');
  $('#refresh').classList.add('spin');
  try {
    P.list = await api.programs();
  } catch (e) { P.list = []; toast('Could not read installed programs: ' + e.message, 'err'); }
  $('#refresh').classList.remove('spin');
  if (!keepSel) P.selected.clear();
  else P.selected = new Set([...P.selected].filter(id => P.list.some(p => p.id === id)));
  renderPrograms(true);
  updateStats();
  loadIcons();
}

async function loadIcons() {
  const ids = P.list.map(p => p.id).filter(id => !(id in P.icons));
  for (let i = 0; i < ids.length; i += 12) {
    const chunk = ids.slice(i, i + 12);
    let res = {};
    try { res = await api.icons(chunk); } catch (e) {}
    for (const id of chunk) {
      P.icons[id] = res[id] || null;
      if (res[id]) {
        const el = $(`.row[data-id="${CSS.escape(id)}"] .ico`);
        if (el) el.outerHTML = avatar('', res[id]);
        if (D.id === id) { const d = $('#drawer .hero .ico'); if (d) d.outerHTML = avatar('', res[id], 'lg'); }
      }
    }
  }
}

function updateStats() {
  const total = P.list.reduce((a, p) => a + (p.size || 0), 0);
  const nw = P.list.filter(isNew).length;
  countUp($('#s-count'), P.list.length);
  countUp($('#s-size'), total, v => { const [n, u] = fmtSize(v, true); return `${n} <small>${u}</small>`; });
  countUp($('#s-new'), nw);
  countUp($('#s-clean'), cleanedTotal, v => { const [n, u] = fmtSize(v, true); return v ? `${n} <small>${u}</small>` : `0 <small>B</small>`; });
  $('#c-programs').textContent = P.list.length;
}

const isNew = p => p.installDate && Date.now() - p.installDate < 7 * DAY;

function filtered() {
  const q = P.q.trim().toLowerCase();
  let l = P.list.filter(p => {
    if (q && !(p.name.toLowerCase().includes(q) || (p.publisher || '').toLowerCase().includes(q))) return false;
    switch (P.filter) {
      case 'new': return isNew(p);
      case 'large': return p.size >= 500 * 1048576;
      case 'b32': return p.bits === 32;
      case 'user': return p.perUser;
    }
    return true;
  });
  const k = P.sort, d = P.dir;
  const cmp = {
    name: (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }),
    publisher: (a, b) => (a.publisher || '~').localeCompare(b.publisher || '~'),
    size: (a, b) => (a.size || 0) - (b.size || 0),
    date: (a, b) => (a.installDate || 0) - (b.installDate || 0),
    bits: (a, b) => a.bits - b.bits,
  }[k];
  l.sort((a, b) => cmp(a, b) * d || a.name.localeCompare(b.name));
  return l;
}

function rowHtml(p, i, maxSize) {
  const sel = P.selected.has(p.id);
  const pct = p.size ? Math.max(3, Math.round(Math.sqrt(p.size / maxSize) * 100)) : 0;
  return `<div class="row ${sel ? 'selected' : ''} ${P.focus === p.id ? 'focused' : ''}" data-id="${esc(p.id)}" style="animation-delay:${Math.min(i, 18) * 22}ms">
    <div><span class="cb ${sel ? 'on' : ''}">${icon('check')}</span></div>
    <div class="nm">${avatar(p.name, P.icons[p.id])}<div class="t"><b><span class="nt">${esc(p.name)}</span>${isNew(p) ? '<span class="new">NEW</span>' : ''}</b><span>${esc(p.version ? 'v' + p.version : 'No version info')}</span></div></div>
    <div class="c">${esc(p.publisher || '—')}</div>
    <div class="sizecell"><span class="c">${fmtSize(p.size)}</span>${pct ? `<div class="bar"><i style="width:${pct}%"></i></div>` : ''}</div>
    <div class="c" title="${esc(fullDate(p.installDate))}">${relDate(p.installDate)}</div>
    <div><span class="badge ${p.bits === 64 ? 'b64' : 'b32'}">${p.bits}-bit</span></div>
    <div><button class="more" data-more>${icon('more')}</button></div>
  </div>`;
}

function renderPrograms(animate) {
  const l = filtered();
  const box = $('#plist');
  const maxSize = Math.max(1, ...P.list.map(p => p.size || 0));
  if (!l.length) {
    box.innerHTML = `<div class="empty"><div class="big">${icon(P.list.length ? 'search' : 'package')}</div><b>${P.list.length ? 'Nothing matches' : 'No programs found'}</b>${P.list.length ? 'Try a different search or filter.' : ''}</div>`;
  } else {
    const groups = P.sort === 'name' && P.filter === 'all' && !P.q
      ? [['new', 'New this week', l.filter(isNew)], ['other', 'All other programs', l.filter(p => !isNew(p))]]
      : [['all', 'Results', l]];
    let i = 0;
    box.innerHTML = groups.filter(g => g[2].length).map(([gid, title, items]) => {
      const col = P.collapsed.has(gid);
      return `<div class="group ${col ? 'collapsed' : ''}" data-g="${gid}">${icon('chev')}<span class="${gid === 'new' ? 'tag' : ''}">${title}</span><span class="n">${items.length}</span><span class="ln"></span></div>` +
        (col ? '' : items.map(p => rowHtml(p, animate ? i++ : 99, maxSize)).join(''));
    }).join('');
    if (!animate) $$('.row', box).forEach(r => r.style.animation = 'none');
  }
  updateHeader();
  updateActionBar();
}

function updateHeader() {
  $$('#phead > div[data-s]').forEach(h => {
    const on = h.dataset.s === P.sort;
    h.classList.toggle('sorted', on); h.classList.toggle('desc', on && P.dir < 0);
    const a = h.querySelector('.arr'); if (a) a.innerHTML = on ? icon('up') : '';
  });
  const vis = filtered();
  const n = vis.filter(p => P.selected.has(p.id)).length;
  const cb = $('#cb-all');
  cb.className = 'cb' + (n && n === vis.length ? ' on' : n ? ' part' : '');
  cb.innerHTML = icon('check');
}

function updateActionBar() {
  const n = P.selected.size;
  const bar = $('#actionbar');
  bar.classList.toggle('show', n > 0);
  if (n) {
    $('#ab-n').textContent = `${n} program${n > 1 ? 's' : ''} selected`;
    const sz = P.list.filter(p => P.selected.has(p.id)).reduce((a, p) => a + (p.size || 0), 0);
    $('#ab-s').textContent = sz ? `About ${fmtSize(sz)} will be freed` : 'Size unknown';
  }
}

function toggleSel(id) {
  P.selected.has(id) ? P.selected.delete(id) : P.selected.add(id);
  const row = $(`.row[data-id="${CSS.escape(id)}"]`);
  if (row) { row.classList.toggle('selected', P.selected.has(id)); row.querySelector('.cb').classList.toggle('on', P.selected.has(id)); }
  updateHeader(); updateActionBar();
}

$('#plist').addEventListener('click', e => {
  const g = e.target.closest('.group');
  if (g) { const id = g.dataset.g; P.collapsed.has(id) ? P.collapsed.delete(id) : P.collapsed.add(id); renderPrograms(false); return; }
  const row = e.target.closest('.row'); if (!row) return;
  const id = row.dataset.id;
  if (e.target.closest('[data-more]')) { const r = e.target.closest('[data-more]').getBoundingClientRect(); showMenu(id, r.left - 190, r.bottom + 4); return; }
  if (e.target.closest('.cb') || e.ctrlKey) { toggleSel(id); return; }
  setFocus(id);
  openDrawer(id);
});
$('#plist').addEventListener('dblclick', e => { const row = e.target.closest('.row'); if (row && !e.target.closest('.cb')) startUninstall([row.dataset.id]); });
$('#plist').addEventListener('contextmenu', e => {
  const row = e.target.closest('.row'); if (!row) return;
  e.preventDefault(); setFocus(row.dataset.id); showMenu(row.dataset.id, e.clientX, e.clientY);
});
function setFocus(id) {
  P.focus = id;
  $$('.row.focused').forEach(r => r.classList.remove('focused'));
  const r = $(`.row[data-id="${CSS.escape(id)}"]`); if (r) r.classList.add('focused');
}

$('#phead').addEventListener('click', e => {
  const h = e.target.closest('[data-s]'); if (!h) return;
  if (h.dataset.s === 'sel') {
    const vis = filtered(); const all = vis.every(p => P.selected.has(p.id));
    vis.forEach(p => all ? P.selected.delete(p.id) : P.selected.add(p.id));
    renderPrograms(false); return;
  }
  if (P.sort === h.dataset.s) P.dir *= -1; else { P.sort = h.dataset.s; P.dir = ['size', 'date'].includes(P.sort) ? -1 : 1; }
  renderPrograms(true);
});

let qTimer;
$('#q').addEventListener('input', e => { clearTimeout(qTimer); qTimer = setTimeout(() => { P.q = e.target.value; renderPrograms(true); }, 120); });

function moveChipPill(wrap) {
  const on = wrap.querySelector('button.on'); const pill = wrap.querySelector('.chip-pill');
  if (on && pill) { pill.style.left = on.offsetLeft + 'px'; pill.style.width = on.offsetWidth + 'px'; }
}
$('#filters').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  $$('#filters button').forEach(x => x.classList.toggle('on', x === b));
  moveChipPill($('#filters'));
  P.filter = b.dataset.f; renderPrograms(true);
});
$('#refresh').addEventListener('click', () => loadPrograms(true));
$('#ab-clear').addEventListener('click', () => { P.selected.clear(); renderPrograms(false); });
$('#ab-go').addEventListener('click', () => startUninstall([...P.selected]));

api.on('program:size', ({ id, size }) => {
  const p = P.list.find(x => x.id === id); if (!p) return;
  p.size = size;
  const row = $(`.row[data-id="${CSS.escape(id)}"] .sizecell .c`); if (row) row.textContent = fmtSize(size);
  clearTimeout(window._statT); window._statT = setTimeout(updateStats, 800);
});

// ---------------- context menu ----------------
let menuEl = null;
function closeMenu() { if (menuEl) { menuEl.remove(); menuEl = null; } }
function showMenu(id, x, y) {
  closeMenu();
  const p = P.list.find(q => q.id === id); if (!p) return;
  menuEl = document.createElement('div');
  menuEl.className = 'menu';
  menuEl.innerHTML = `
    <button data-a="uninstall">${icon('trash')}Uninstall</button>
    <button data-a="forced">${icon('zap')}Forced uninstall</button>
    <hr>
    <button data-a="folder" ${p.installLocation ? '' : 'disabled style="opacity:.4"'}>${icon('folder')}Open install folder</button>
    <button data-a="reg">${icon('db')}Open in Registry Editor</button>
    <button data-a="search">${icon('globe')}Search online</button>
    <button data-a="copy">${icon('copy')}Copy name</button>
    <hr>
    <button data-a="entry" class="red">${icon('x')}Remove entry from list</button>`;
  document.body.appendChild(menuEl);
  const r = menuEl.getBoundingClientRect();
  menuEl.style.left = Math.min(x, innerWidth - r.width - 10) + 'px';
  menuEl.style.top = Math.min(y, innerHeight - r.height - 10) + 'px';
  menuEl.addEventListener('click', e => { const b = e.target.closest('[data-a]'); if (b) { closeMenu(); action(b.dataset.a, id); } });
}
document.addEventListener('mousedown', e => { if (menuEl && !menuEl.contains(e.target)) closeMenu(); });

async function action(a, id) {
  const p = P.list.find(q => q.id === id); if (!p) return;
  switch (a) {
    case 'uninstall': startUninstall([id]); break;
    case 'forced': go('forced'); setForcedProgram(p); break;
    case 'folder': if (!await api.openFolder(id)) toast('The install folder no longer exists', 'err'); break;
    case 'reg': await api.openRegistry(id); break;
    case 'search': api.searchOnline(id); break;
    case 'web': api.openWebsite(id); break;
    case 'copy': await api.copy(p.name); toast('Copied to clipboard'); break;
    case 'copycmd': await api.copy(p.uninstallString); toast('Uninstall command copied'); break;
    case 'entry': {
      const ok = await confirmDialog({ title: 'Remove this entry?', text: `This only deletes <b>${esc(p.name)}</b>'s entry from the installed programs list (a backup of the registry key is saved). Use it for broken entries that can't be uninstalled.`, ok: 'Remove entry' });
      if (!ok) return;
      const r = await api.removeEntry(id);
      if (r && r.ok) { closeDrawer(); removeRows([id]); toast('Entry removed'); } else toast('Could not remove the entry', 'err');
    }
  }
}

function removeRows(ids) {
  ids.forEach(id => { const r = $(`.row[data-id="${CSS.escape(id)}"]`); if (r) r.classList.add('removing'); P.selected.delete(id); });
  setTimeout(() => { P.list = P.list.filter(p => !ids.includes(p.id)); renderPrograms(false); updateStats(); }, 600);
}

// ---------------- drawer ----------------
const D = { id: null };
function openDrawer(id) {
  const p = P.list.find(q => q.id === id); if (!p) return;
  D.id = id;
  const h = hash(p.name) % 360;
  const dr = $('#drawer');
  dr.innerHTML = `
    <div class="hero" style="--hue: radial-gradient(circle, hsla(${h},80%,60%,.55), transparent 70%)">
      <button class="btn ghost icon sm close" data-x>${icon('x')}</button>
      ${avatar(p.name, P.icons[p.id], 'lg')}
      <h2>${esc(p.name)}</h2>
      <div class="pub">${esc(p.publisher || 'Unknown publisher')}</div>
      <div class="tags">
        <span class="badge ${p.bits === 64 ? 'b64' : 'b32'}">${p.bits}-bit</span>
        ${p.isMsi ? '<span class="badge">Windows Installer</span>' : ''}
        ${p.perUser ? '<span class="badge">Current user only</span>' : '<span class="badge">All users</span>'}
        ${isNew(p) ? '<span class="badge" style="border-color:rgba(139,92,246,.5);color:#c9b8ff">New</span>' : ''}
      </div>
    </div>
    <div class="body">
      <div class="actions">
        <button class="btn primary" data-a="uninstall">${icon('trash')}Uninstall</button>
        <button class="btn" data-a="forced">${icon('zap')}Forced</button>
        <button class="btn" data-a="folder" ${p.installLocation ? '' : 'disabled'}>${icon('folder')}Folder</button>
      </div>
      <div class="kv">
        <div>Version</div><div>${esc(p.version || '—')}</div>
        <div>Size</div><div>${fmtSize(p.size)}</div>
        <div>Installed</div><div>${fullDate(p.installDate)}</div>
        <div>Location</div><div class="mono">${esc(p.installLocation || '—')}</div>
        <div>Uninstaller</div><div class="mono">${esc(p.uninstallString || '—')}</div>
        <div>Registry</div><div class="mono">${esc(p.regPath || '—')}</div>
        ${p.comments ? `<div>Comment</div><div>${esc(p.comments)}</div>` : ''}
      </div>
      <div class="section-t">More</div>
      <div class="links">
        ${p.website ? `<button data-a="web">${icon('link')}Open website</button>` : ''}
        <button data-a="search">${icon('globe')}Search online</button>
        <button data-a="reg">${icon('db')}Open in Registry Editor</button>
        <button data-a="copycmd">${icon('copy')}Copy uninstall command</button>
        <button data-a="entry" class="red">${icon('x')}Remove entry from list</button>
      </div>
    </div>`;
  dr.classList.add('show'); $('#scrim').classList.add('show');
}
function closeDrawer() { $('#drawer').classList.remove('show'); $('#scrim').classList.remove('show'); D.id = null; }
$('#scrim').addEventListener('click', closeDrawer);
$('#drawer').addEventListener('click', e => {
  if (e.target.closest('[data-x]')) return closeDrawer();
  const b = e.target.closest('[data-a]'); if (b && D.id) action(b.dataset.a, D.id);
});

// ---------------- uninstall wizard ----------------
let J = null; // active job state
api.on('job:event', ev => { if (J && ev.jobId === J.id) onJobEvent(ev); });

const STEP_DEF = {
  restore: { t: 'Restore point', d: 'A safety net in case anything goes wrong', i: 'shield' },
  uninstall: { t: 'Run uninstaller', d: 'The program\'s own uninstaller does its job', i: 'play' },
  scan: { t: 'Scan for leftovers', d: 'Files, folders and registry entries left behind', i: 'radar' },
  review: { t: 'Review', d: 'You choose what gets removed', i: 'hand' },
  clean: { t: 'Clean up', d: 'Leftovers go to the Recycle Bin, registry is backed up', i: 'broom' },
};

function opts() {
  try { return JSON.parse(localStorage.getItem('purgo.opts')) || { restorePoint: true, scanMode: 'moderate' }; } catch (e) { return { restorePoint: true, scanMode: 'moderate' }; }
}
function saveOpts(o) { localStorage.setItem('purgo.opts', JSON.stringify(o)); }

function startUninstall(ids) {
  closeDrawer();
  const progs = ids.map(id => P.list.find(p => p.id === id)).filter(Boolean);
  if (!progs.length) return;
  if (progs.length === 1) openSingle(progs[0], 'single');
  else openBatch(progs);
}

function stepsHtml(keys) {
  return keys.map(k => `<div class="step" data-step="${k}"><div class="dot">${icon(STEP_DEF[k].i)}</div><div class="lbl"><b>${STEP_DEF[k].t}</b><span>${STEP_DEF[k].d}</span></div></div>`).join('');
}

function optionsHtml(type) {
  const o = opts();
  const modes = [
    ['safe', 'Safe', 'Only obvious leftovers: install folder, settings and shortcuts.'],
    ['moderate', 'Moderate', 'Recommended. Also checks publisher folders and related entries.'],
    ['advanced', 'Advanced', 'Deepest scan. Shows more possible matches — review carefully.'],
  ];
  return `<div class="stage-inner">
    ${type !== 'forced' ? `<div class="opt-card"><div class="oi">${icon('shield')}</div><div class="ot"><b>Create a restore point first</b><span>Lets you roll Windows back if something important gets removed. Takes up to a minute.</span></div><div class="switch ${o.restorePoint ? 'on' : ''}" data-sw="restorePoint"></div></div>` : ''}
    <div class="section-t" style="margin-top:8px">Leftover scan</div>
    <div class="modes">${modes.map(([k, t, d]) => `<div class="mode ${(type === 'forced' ? 'advanced' : o.scanMode) === k ? 'on' : ''}" data-mode="${k}"><span class="rad"></span><b>${t}</b><span>${d}</span></div>`).join('')}</div>
    <p class="lead" style="margin-top:20px;font-size:12.5px;color:var(--muted)">${icon('info')} Files go to the <b>Recycle Bin</b> and every registry key is exported to a backup before it's deleted.</p>
  </div>`;
}

function bindOptions(root) {
  root.addEventListener('click', e => {
    const sw = e.target.closest('[data-sw]');
    if (sw) { sw.classList.toggle('on'); const o = opts(); o[sw.dataset.sw] = sw.classList.contains('on'); saveOpts(o); }
    const m = e.target.closest('[data-mode]');
    if (m) { $$('[data-mode]', root).forEach(x => x.classList.toggle('on', x === m)); }
  });
}
function readOptions(root) {
  const sw = $('[data-sw="restorePoint"]', root);
  const mode = ($('[data-mode].on', root) || {}).dataset;
  const o = { restorePoint: sw ? sw.classList.contains('on') : false, scanMode: mode ? mode.mode : 'moderate' };
  const s = opts(); s.restorePoint = sw ? o.restorePoint : s.restorePoint; if (mode) s.scanMode = o.scanMode; saveOpts(s);
  return o;
}

// ---- single / forced ----
function openSingle(p, type, forced) {
  const keys = ['restore', 'uninstall', 'scan', 'review', 'clean'];
  const m = openModal(`
    <div class="mh">${avatar(p.name, P.icons[p.id])}<div style="flex:1;min-width:0"><h3>${type === 'forced' ? 'Forced uninstall' : 'Uninstall'} ${esc(p.name)}</h3><p id="mh-sub">${esc(p.publisher || '')}${p.version ? ' · v' + esc(p.version) : ''}</p></div><div class="top-progress" id="tp" style="width:0"></div></div>
    <div class="mb"><div class="steps" id="steps">${stepsHtml(keys)}</div><div class="stage" id="stage">${optionsHtml(type)}</div></div>
    <div class="mf"><div class="grow" id="mf-note">${type === 'forced' ? 'Purgo will search for every trace it can find.' : 'Nothing is removed until you review it.'}</div>
      <button class="btn ghost" data-act="cancel">Cancel</button>
      <button class="btn primary" data-act="start">${icon(type === 'forced' ? 'radar' : 'play')}${type === 'forced' ? 'Start scan' : 'Start uninstall'}</button></div>`);
  if (type === 'forced') { setStep('restore', 'skipped', m); if (!forced.runUninstaller) setStep('uninstall', 'skipped', m); }
  bindOptions($('#stage', m));
  J = { id: null, type, prog: p, forced, modal: m, keys, logs: [], waiting: false, freed: 0 };
  m.addEventListener('click', onModalClick);
}

function setStep(k, status, m = J && J.modal) {
  const el = m && $(`.step[data-step="${k}"]`, m); if (!el) return;
  el.classList.remove('active', 'done', 'skipped', 'warn');
  if (status) el.classList.add(status === 'skipped' ? 'skipped' : status);
  if (status === 'done') el.querySelector('.dot').innerHTML = icon('check');
  if (status === 'warn') el.querySelector('.dot').innerHTML = icon('alert');
  if (status === 'skipped') el.querySelector('.dot').innerHTML = icon('minus');
  // header progress
  if (J && J.keys) {
    const doneN = J.keys.filter(x => { const s = $(`.step[data-step="${x}"]`, m); return s && /done|skipped|warn/.test(s.className); }).length;
    const tp = $('#tp', m); if (tp) tp.style.width = (doneN / J.keys.length * 100) + '%';
  }
}

async function onModalClick(e) {
  const b = e.target.closest('[data-act]'); if (!b) return;
  const a = b.dataset.act;
  if (a === 'cancel') {
    if (J && J.id && !J.finished) {
      if (!await confirmDialog({ title: 'Stop the uninstall?', text: 'Purgo will stop after the current step. Anything already removed stays removed.', ok: 'Stop' })) return;
      api.cancelJob(J.id);
      return;
    }
    closeModal(); J = null; return;
  }
  if (a === 'close') { const changed = J && J.finished; closeModal(); J = null; if (changed) afterJob(); return; }
  if (a === 'start') return beginJob();
  if (a === 'skipwait') { api.skipWait(J.id); b.disabled = true; b.textContent = 'Continuing…'; return; }
  if (a === 'delete-sel') return confirmLeftovers(true);
  if (a === 'skip-lo') return confirmLeftovers(false);
}

async function beginJob() {
  const m = J.modal;
  const o = readOptions($('#stage', m));
  const footer = $('.mf', m);
  footer.innerHTML = `<div class="grow" id="mf-note">Working — you can keep this window open.</div><button class="btn ghost" data-act="cancel">Stop</button>`;
  if (J.type === 'batch') {
    $('#stage', m).innerHTML = batchStageHtml();
  } else {
    $('#stage', m).innerHTML = runStageHtml(J.prog);
  }
  const payload = J.type === 'forced'
    ? { type: 'forced', forced: J.forced, options: { scanMode: o.scanMode } }
    : { type: J.type, ids: J.type === 'batch' ? J.progs.map(p => p.id) : [J.prog.id], options: o };
  const r = await api.startJob(payload);
  J.id = r.id;
}

function runStageHtml(p) {
  const parts = Array.from({ length: 12 }, (_, i) => {
    const a = (i / 12) * Math.PI * 2, d = 110 + (i % 3) * 20;
    return `<i style="--x:${Math.round(Math.cos(a) * d)}px;--y:${Math.round(Math.sin(a) * d * .6)}px;animation-delay:${i * 150}ms;background:${['#8fa7ff', '#b49bff', '#e19bff'][i % 3]}"></i>`;
  }).join('');
  return `<div class="stage-inner">
    <div class="visual"><div class="particles" id="parts" style="opacity:0;transition:opacity .5s">${parts}</div>
      <div class="orbit" id="orbit"><div class="orb-r"></div><div class="orb-r"></div><div class="orb-r"></div><div class="sweep"></div><span class="sat"></span><span class="sat b"></span><span class="sat c"></span><div class="core">${avatar(p.name, P.icons[p.id])}</div></div></div>
    <div class="now"><b id="now-t"><span class="dots">Getting ready</span></b><span id="now-s">&nbsp;</span></div>
    <div id="wait"></div>
    <div class="log" id="log"></div>
  </div>`;
}

const NOW = {
  restore: ['Creating a restore point', 'Windows is saving a snapshot of your system'],
  uninstall: ['Running the uninstaller', 'Follow the uninstaller window if one appears'],
  scan: ['Scanning for leftovers', 'Looking through folders, shortcuts and the registry'],
  clean: ['Removing leftovers', 'Sending files to the Recycle Bin and backing up registry keys'],
};

function setNow(k) {
  const m = J.modal; const t = $('#now-t', m); if (!t || !NOW[k]) return;
  t.innerHTML = `<span class="dots">${NOW[k][0]}</span>`;
  $('#now-s', m).textContent = NOW[k][1];
  const parts = $('#parts', m); if (parts) parts.style.opacity = (k === 'scan' || k === 'clean') ? 1 : 0;
}

function logLine(ev) {
  const box = $('#log', J.modal); if (!box) return;
  const ic = { info: 'arrow', ok: 'check', warn: 'alert', err: 'x', title: 'package', cmd: '' }[ev.level] || 'arrow';
  const d = document.createElement('div');
  d.className = 'ln ' + ev.level;
  const tm = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  d.innerHTML = ev.level === 'cmd' ? esc(ev.text) : `<span class="li">${icon(ic)}</span><span>${esc(ev.text)}</span><time>${tm}</time>`;
  box.appendChild(d);
  box.scrollTo({ top: box.scrollHeight, behavior: 'smooth' });
}

function onJobEvent(ev) {
  const m = J.modal;
  switch (ev.type) {
    case 'log': logLine(ev); break;
    case 'step':
      if (J.type === 'batch') { batchStep(ev); break; }
      if (ev.step === 'done') break;
      if (ev.step === 'scan' && ev.status === 'done' && ev.count === 0) {
        J.noLeft = true;
        [['review', 'Nothing to review'], ['clean', 'Already clean — nothing left behind']].forEach(([k, t]) => {
          setStep(k, 'done'); const sp = $(`.step[data-step="${k}"] .lbl span`, m); if (sp) sp.textContent = t;
        });
      }
      if (J.noLeft && (ev.step === 'review' || ev.step === 'clean')) break;
      setStep(ev.step, ev.status === 'active' ? 'active' : ev.status);
      if (ev.status === 'active') setNow(ev.step);
      if (ev.step === 'scan' && ev.status === 'done') { const o = $('#orbit', m); if (o) o.classList.add('idle'); }
      if (ev.step === 'clean' && ev.status === 'active' && !$('#lo-list', m)) { /* nothing to review (batch) */ }
      break;
    case 'waiting': {
      J.waiting = ev.waiting;
      const w = $('#wait', m); if (!w) break;
      if (ev.waiting) {
        w.innerHTML = `<div class="wait-card"><span class="pulse"></span><div class="t"><b>Waiting for the uninstaller to finish</b>If it's done but Purgo is still waiting, you can continue manually.</div><button class="btn sm" data-act="skipwait">It's finished</button></div>`;
      } else w.innerHTML = '';
      break;
    }
    case 'ask':
      if (ev.kind === 'leftovers') showLeftovers(ev);
      if (ev.kind === 'continue') confirmDialog({ title: ev.title, text: esc(ev.message), ok: 'Scan anyway', danger: false, iconName: 'alert' }).then(v => api.answer({ jobId: J.id, kind: 'continue', value: v }));
      break;
    case 'deleted': onDeleted(ev); break;
    case 'program': if (J.type === 'batch') batchProgram(ev); break;
    case 'finished': finish(ev.summary); break;
  }
}

// ---- leftovers review ----
const KIND_ICON = { folder: 'folder', file: 'file', key: 'key', value: 'key' };
function showLeftovers(ev) {
  const m = J.modal;
  J.items = ev.items;
  const disk = ev.items.filter(i => i.kind === 'folder' || i.kind === 'file');
  const reg = ev.items.filter(i => i.kind === 'key' || i.kind === 'value');
  const sec = (title, list, off) => list.length ? `<div class="lo-sec">${title}<span class="ln"></span></div>` + list.map((it, n) => `
    <div class="lo" data-lo="${it.id}" style="animation-delay:${(off + n) * 40}ms">
      <span class="cb ${it.recommended ? 'on' : ''}">${icon('check')}</span>
      <div class="k ${it.kind}">${icon(KIND_ICON[it.kind])}</div>
      <div class="p"><b title="${esc(it.path)}">&lrm;${esc(it.path)}${it.value ? ' → ' + esc(it.value) : ''}&lrm;</b><span class="${it.recommended ? 'rec' : ''}">${esc(it.reason)}${it.files ? ' · ' + it.files + ' items' : ''}</span></div>
      <div class="sz">${it.size ? fmtSize(it.size) : ''}</div>
    </div>`).join('') : '';
  $('#stage', m).innerHTML = `<div class="stage-inner">
    <div class="lo-head"><div style="flex:1"><div class="big" id="lo-big"></div><div class="sub">Recommended items are pre-selected. Uncheck anything you want to keep.</div></div>
      <button class="btn sm" id="lo-all">Select all</button><button class="btn sm ghost" id="lo-none">None</button></div>
    <div class="lo-list" id="lo-list">${sec('Files & folders', disk, 0)}${sec('Registry', reg, disk.length)}</div>
  </div>`;
  $('.mf', m).innerHTML = `<div class="grow" id="lo-sum"></div><button class="btn ghost" data-act="skip-lo">Keep everything</button><button class="btn danger" data-act="delete-sel">${icon('trash')}Delete selected</button>`;
  const list = $('#lo-list', m);
  list.addEventListener('click', e => { const r = e.target.closest('.lo'); if (r) { r.querySelector('.cb').classList.toggle('on'); loSummary(); } });
  $('#lo-all', m).onclick = () => { $$('.lo .cb', m).forEach(c => c.classList.add('on')); loSummary(); };
  $('#lo-none', m).onclick = () => { $$('.lo .cb', m).forEach(c => c.classList.remove('on')); loSummary(); };
  loSummary(true);
}
function loSummary(first) {
  const m = J.modal;
  const sel = $$('.lo', m).filter(r => r.querySelector('.cb.on')).map(r => J.items.find(i => i.id == r.dataset.lo));
  const total = J.items.reduce((a, i) => a + (i.size || 0), 0);
  const big = $('#lo-big', m);
  if (first) big.innerHTML = `${J.items.length} leftover${J.items.length === 1 ? '' : 's'} found${total ? ` · <span style="background:var(--grad);-webkit-background-clip:text;color:transparent">${fmtSize(total)}</span>` : ''}`;
  const ss = sel.reduce((a, i) => a + (i.size || 0), 0);
  $('#lo-sum', m).textContent = `${sel.length} of ${J.items.length} selected${ss ? ' · ' + fmtSize(ss) : ''}`;
  const del = $('[data-act="delete-sel"]', m); if (del) del.disabled = !sel.length;
}
async function confirmLeftovers(del) {
  const m = J.modal;
  const ids = del ? $$('.lo', m).filter(r => r.querySelector('.cb.on')).map(r => Number(r.dataset.lo)) : [];
  if (del) {
    const hasUnrec = ids.some(id => !J.items.find(i => i.id === id).recommended);
    if (hasUnrec && !await confirmDialog({ title: 'Delete non-recommended items?', text: 'Some selected items weren\'t pre-selected because they might belong to other programs or contain your files. Continue only if you\'re sure.', ok: 'Delete anyway' })) return;
  }
  J.deleteIds = new Set(ids);
  // turn review into a cleaning view
  $$('.lo', m).forEach(r => { if (!J.deleteIds.has(Number(r.dataset.lo))) r.classList.add('gone'); r.style.pointerEvents = 'none'; });
  const head = $('.lo-head', m);
  head.innerHTML = `<div style="flex:1"><div class="big">${ids.length ? 'Cleaning up' : 'Keeping everything'}</div><div class="sub" id="cl-sub">${ids.length ? 'Removing the selected leftovers…' : ''}</div><div class="bigbar"><i id="cl-bar" style="width:0"></i></div></div>`;
  $('.mf', m).innerHTML = `<div class="grow"></div><button class="btn ghost" disabled>Working…</button>`;
  api.answer({ jobId: J.id, kind: 'leftovers', value: ids });
}
function onDeleted(ev) {
  const m = J.modal;
  if (J.type === 'batch') { batchDeleted(ev); return; }
  const r = $(`.lo[data-lo="${ev.id}"]`, m);
  if (r) {
    r.classList.add('deleting');
    r.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    setTimeout(() => { r.classList.add('gone'); if (!ev.ok) { r.classList.remove('gone'); r.style.opacity = .5; } }, 180);
  }
  const it = J.items && J.items.find(i => i.id === ev.id);
  if (ev.ok && it) J.freed += it.size || 0;
  const bar = $('#cl-bar', m); if (bar) bar.style.width = (ev.done / ev.total * 100) + '%';
  const sub = $('#cl-sub', m); if (sub) sub.textContent = `${ev.done} of ${ev.total} removed${J.freed ? ' · ' + fmtSize(J.freed) + ' freed' : ''}`;
}

// ---- finish ----
function finish(s) {
  J.finished = true;
  const m = J.modal;
  const freed = (s.bytes || 0) + (s.programBytes || 0);
  cleanedTotal += freed;
  localStorage.setItem('purgo.cleaned', cleanedTotal);
  const ok = !s.cancelled && !s.failed;
  const title = s.cancelled ? 'Stopped' : J.type === 'forced' ? 'Traces removed' : J.type === 'batch'
    ? `${s.uninstalled} of ${s.programs} programs uninstalled` : (s.uninstalled ? 'Uninstalled successfully' : 'Finished with warnings');
  const good = ok && (J.type === 'forced' || s.uninstalled === s.programs);
  if (J.type !== 'batch') J.keys.forEach(k => {
    const st = $(`.step[data-step="${k}"]`, m); if (!st) return;
    if (st.classList.contains('active')) setStep(k, s.cancelled ? 'skipped' : 'done');
    else if (!/done|skipped|warn/.test(st.className)) setStep(k, 'skipped');
  });
  const stage = $('#stage', m);
  stage.innerHTML = `<div class="stage-inner"><div class="done-wrap"><canvas id="confetti"></canvas>
    <div class="check-big ${good ? '' : 'warn'}">${icon(good ? 'check' : 'alert')}</div>
    <h2>${esc(title)}</h2>
    <p>${s.cancelled ? 'The job was stopped.' : !good ? 'Some steps need your attention — see the log for details.'
      : (s.leftoversFound === 0 ? 'The uninstaller removed everything cleanly — no leftovers were found.' : 'Your PC is a little cleaner now.')}</p>
    <div class="done-stats">
      <div><b id="ds-1">0</b><span>leftovers removed</span></div>
      <div><b id="ds-2">0 B</b><span>${(s.programBytes || 0) && !(s.bytes) ? 'freed by the uninstaller' : 'space freed'}</span></div>
      <div><b>${s.seconds || 0}s</b><span>time taken</span></div>
    </div></div></div>`;
  const note = s.leftoversFound === 0 ? 'Purgo double-checked folders, shortcuts and the registry.'
    : `${s.leftoversRemoved} of ${s.leftoversFound} leftovers removed · registry backups are in ProgramData\\Purgo\\Backups`;
  $('.mf', m).innerHTML = `<div class="grow">${note}</div><button class="btn primary" data-act="close">${icon('check')}Done</button>`;
  setTimeout(() => { countUp($('#ds-1', m), s.leftoversRemoved || 0); countUp($('#ds-2', m), freed, v => v >= 1 ? fmtSize(v) : '0 B'); }, 600);
  if (good) setTimeout(() => confetti($('#confetti', m)), 350);
  if (J.type === 'batch') { $('#b-title', m).textContent = 'All done'; $('#b-sub', m).textContent = `${s.programs} program${s.programs > 1 ? 's' : ''} processed`; const r = $('#ring-fg', m); if (r) r.style.strokeDashoffset = 0; const rb = $('#ring-b', m); if (rb) rb.textContent = '100%'; }
}

function afterJob() {
  loadPrograms(true);
  if (loaded.startup) loadStartup();
}

function confetti(canvas) {
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const W = canvas.width = canvas.offsetWidth * devicePixelRatio, H = canvas.height = canvas.offsetHeight * devicePixelRatio;
  const colors = ['#4f7cff', '#7c5cff', '#b45cff', '#34d399', '#ffd166', '#ff7ab6'];
  const ps = Array.from({ length: 140 }, () => {
    const a = Math.random() * Math.PI * 2, v = (4 + Math.random() * 9) * devicePixelRatio;
    return { x: W / 2, y: H * 0.36, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 5 * devicePixelRatio, r: (3 + Math.random() * 4) * devicePixelRatio, c: colors[(Math.random() * colors.length) | 0], rot: Math.random() * 6, vr: (Math.random() - .5) * .4, life: 1 };
  });
  const tick = () => {
    ctx.clearRect(0, 0, W, H);
    let alive = false;
    for (const p of ps) {
      p.vy += .25 * devicePixelRatio; p.vx *= .985; p.vy *= .985; p.x += p.vx; p.y += p.vy; p.rot += p.vr; p.life -= .009;
      if (p.life <= 0) continue; alive = true;
      ctx.save(); ctx.globalAlpha = Math.min(1, p.life * 1.5); ctx.translate(p.x, p.y); ctx.rotate(p.rot); ctx.fillStyle = p.c;
      ctx.fillRect(-p.r, -p.r / 2, p.r * 2, p.r); ctx.restore();
    }
    if (alive && canvas.isConnected) requestAnimationFrame(tick);
  };
  tick();
}

// ---- batch ----
function openBatch(progs) {
  const m = openModal(`
    <div class="mh">
      <div class="ring"><svg viewBox="0 0 54 54"><circle class="bg" cx="27" cy="27" r="23"/><circle class="fg" id="ring-fg" cx="27" cy="27" r="23" stroke-dasharray="144.5" stroke-dashoffset="144.5"/></svg><b id="ring-b">0%</b></div>
      <div style="flex:1"><h3 id="b-title">Uninstall ${progs.length} programs</h3><p id="b-sub">One after another — leftovers are cleaned automatically.</p></div>
    </div>
    <div class="mb"><div class="queue" id="queue">${progs.map((p, i) => `<div class="q waiting" data-q="${i}" style="animation-delay:${i * 50}ms">${avatar(p.name, P.icons[p.id])}<div class="nmq">${esc(p.name)}<small>${esc(p.publisher || ' ')}</small></div><span class="st"></span></div>`).join('')}</div>
      <div class="stage" id="stage">${optionsHtml('batch')}</div></div>
    <div class="mf"><div class="grow">Silent uninstall is used when a program supports it. Only recommended leftovers are removed.</div>
      <button class="btn ghost" data-act="cancel">Cancel</button><button class="btn primary" data-act="start">${icon('play')}Uninstall ${progs.length} programs</button></div>`);
  bindOptions($('#stage', m));
  J = { id: null, type: 'batch', progs, modal: m, done: 0, freed: 0 };
  m.addEventListener('click', onModalClick);
}

function batchStageHtml() {
  return `<div class="stage-inner">
    <div class="cur" id="cur"><div class="cur-ico" id="cur-ico">${avatar('Purgo', null)}</div><div class="ct" id="cur-t"><b>Getting ready</b><span class="dots">Preparing</span></div></div>
    <div class="pills" id="pills">
      <span class="pill" data-p="restore">${icon('shield')}Restore point</span>
      <span class="pill" data-p="uninstall">${icon('refresh')}Uninstall</span>
      <span class="pill" data-p="scan">${icon('refresh')}Scan leftovers</span>
      <span class="pill" data-p="clean">${icon('refresh')}Clean up</span>
    </div>
    <div id="wait"></div>
    <div class="log" id="log"></div>
  </div>`;
}
function batchStep(ev) {
  const m = J.modal;
  const pill = $(`.pill[data-p="${ev.step}"]`, m); if (!pill) return;
  pill.classList.remove('active', 'done');
  if (ev.status === 'active') {
    if (ev.step !== 'restore') $$('.pill', m).forEach(p => { if (p.dataset.p !== 'restore' && p !== pill && !p.classList.contains('done')) p.classList.remove('active'); });
    if (ev.step === 'uninstall') $$('.pill', m).forEach(p => { if (p.dataset.p !== 'restore') { p.classList.remove('done'); p.innerHTML = icon('refresh') + p.textContent; } });
    pill.classList.add('active');
    const sub = $('#cur-t span', m); if (sub && NOW[ev.step]) { sub.className = 'dots'; sub.textContent = NOW[ev.step][0]; }
  } else if (ev.status === 'done' || ev.status === 'skipped' || ev.status === 'warn') {
    pill.classList.add('done'); pill.style.opacity = ev.status === 'skipped' && ev.step === 'restore' ? .45 : ''; pill.innerHTML = icon(ev.status === 'warn' ? 'alert' : 'check') + pill.textContent;
  }
}
function batchProgram(ev) {
  const m = J.modal; const q = $(`.q[data-q="${ev.index}"]`, m); if (!q) return;
  q.className = 'q ' + ev.status;
  q.querySelector('.st').innerHTML = ev.status === 'done' ? icon('check') : ev.status === 'warn' ? icon('alert') : '';
  if (ev.status === 'running') {
    q.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    $('#b-title', m).textContent = `Uninstalling program ${ev.index + 1} of ${J.progs.length}`;
    $('#b-sub', m).textContent = J.progs[ev.index].name;
    const cp = J.progs[ev.index];
    const ci = $('#cur-ico', m); if (ci) ci.innerHTML = avatar(cp.name, P.icons[cp.id]);
    const ct = $('#cur-t', m); if (ct) { ct.outerHTML = `<div class="ct" id="cur-t"><b>${esc(cp.name)}</b><span class="dots">Starting</span></div>`; }
  } else {
    J.done++;
    const pct = J.done / J.progs.length;
    $('#ring-fg', m).style.strokeDashoffset = 144.5 * (1 - pct);
    $('#ring-b', m).textContent = Math.round(pct * 100) + '%';
  }
}
function batchDeleted(ev) { /* log already shows details; keep UI calm */ }

// ---------------- Windows Apps ----------------
let APPS = [];
async function loadApps() {
  const g = $('#agrid');
  g.innerHTML = Array.from({ length: 12 }, (_, i) => `<div class="skel" style="height:150px;border-radius:18px;animation-delay:${i * 60}ms"></div>`).join('');
  $('#refresh-apps').classList.add('spin');
  try { APPS = await api.apps(); } catch (e) { APPS = []; }
  $('#refresh-apps').classList.remove('spin');
  $('#c-apps').textContent = APPS.length;
  renderApps();
}
function renderApps() {
  const q = $('#qa').value.trim().toLowerCase();
  const l = APPS.filter(a => !q || a.name.toLowerCase().includes(q) || (a.publisher || '').toLowerCase().includes(q));
  $('#agrid').innerHTML = l.length ? l.map((a, i) => `<div class="card" data-app="${esc(a.id)}" style="animation-delay:${Math.min(i, 24) * 30}ms">
    ${avatar(a.name, a.icon)}<h4>${esc(a.name)}</h4><div class="meta">${esc(a.publisher || '—')}</div>
    <div class="foot"><span class="ver">v${esc(a.version)}</span><button class="btn sm danger rm" data-rm>${icon('trash')}Remove</button></div></div>`).join('')
    : `<div class="empty" style="grid-column:1/-1"><div class="big">${icon('grid')}</div><b>No apps found</b></div>`;
}
$('#qa').addEventListener('input', renderApps);
$('#refresh-apps').addEventListener('click', loadApps);
$('#agrid').addEventListener('click', async e => {
  if (!e.target.closest('[data-rm]')) return;
  const card = e.target.closest('.card'); const a = APPS.find(x => x.id === card.dataset.app);
  if (!await confirmDialog({ title: `Remove ${a.name}?`, text: 'The app and its data will be removed for your account. You can reinstall it later from the Microsoft Store.', ok: 'Remove app' })) return;
  card.classList.add('busy');
  const r = await api.removeApp(a.full);
  card.classList.remove('busy');
  if (r.ok) { card.classList.add('gone'); setTimeout(() => { APPS = APPS.filter(x => x !== a); $('#c-apps').textContent = APPS.length; renderApps(); }, 600); toast(`${a.name} removed`); }
  else toast(`Couldn't remove ${a.name}: ${r.error || 'unknown error'}`, 'err');
});

// ---------------- Startup ----------------
let ST = [];
async function loadStartup() {
  const l = $('#slist');
  l.innerHTML = Array.from({ length: 6 }, (_, i) => `<div class="skel" style="animation-delay:${i * 80}ms"></div>`).join('');
  $('#refresh-startup').classList.add('spin');
  try { ST = await api.startup(); } catch (e) { ST = []; }
  $('#refresh-startup').classList.remove('spin');
  renderStartup();
}
function renderStartup() {
  const on = ST.filter(s => s.enabled).length;
  $('#c-startup').textContent = on;
  $('#st-sub').textContent = `${on} enabled · ${ST.length - on} disabled — fewer startup apps means Windows boots faster.`;
  $('#slist').innerHTML = ST.length ? ST.map((s, i) => `<div class="row st ${s.enabled ? '' : 'off'}" data-st="${esc(s.id)}" style="animation-delay:${i * 30}ms">
    <div class="nm">${avatar(s.name, s.icon)}<div class="t"><b>${esc(s.name)}</b><span class="cmd" title="${esc(s.command)}">${esc(s.command)}</span></div></div>
    <div class="c">${esc(s.company || '—')}</div>
    <div class="c">${esc(s.scope)}</div>
    <div><span class="state ${s.enabled ? '' : 'off'}">${s.enabled ? 'Enabled' : 'Disabled'}</span></div>
    <div style="display:flex;gap:6px;align-items:center"><div class="switch ${s.enabled ? 'on' : ''}" data-tg></div><button class="more" data-stm>${icon('more')}</button></div>
  </div>`).join('') : `<div class="empty"><div class="big">${icon('rocket')}</div><b>Nothing starts with Windows</b>Your startup is already clean.</div>`;
}
$('#slist').addEventListener('click', async e => {
  const row = e.target.closest('.row'); if (!row) return;
  const s = ST.find(x => x.id === row.dataset.st);
  const tg = e.target.closest('[data-tg]');
  if (tg) {
    const en = !s.enabled; tg.classList.toggle('on', en); tg.classList.add('busy');
    const r = await api.toggleStartup({ id: s.id, enabled: en });
    tg.classList.remove('busy');
    if (r.ok) { s.enabled = en; row.classList.toggle('off', !en); const st = row.querySelector('.state'); st.className = 'state ' + (en ? '' : 'off'); st.textContent = en ? 'Enabled' : 'Disabled'; renderStartupCounts(); }
    else { tg.classList.toggle('on', !en); toast('Could not change this entry', 'err'); }
  }
  if (e.target.closest('[data-stm]')) {
    const r = e.target.closest('[data-stm]').getBoundingClientRect();
    closeMenu();
    menuEl = document.createElement('div'); menuEl.className = 'menu';
    menuEl.innerHTML = `<button data-sa="open">${icon('folder')}Show file location</button><button data-sa="copy">${icon('copy')}Copy command</button><hr><button data-sa="del" class="red">${icon('trash')}Delete entry</button>`;
    document.body.appendChild(menuEl);
    menuEl.style.left = (r.left - 190) + 'px'; menuEl.style.top = (r.bottom + 4) + 'px';
    menuEl.onclick = async ev => {
      const b = ev.target.closest('[data-sa]'); if (!b) return; closeMenu();
      if (b.dataset.sa === 'open') api.openStartup(s.id);
      if (b.dataset.sa === 'copy') { await api.copy(s.command); toast('Command copied'); }
      if (b.dataset.sa === 'del') {
        if (!await confirmDialog({ title: `Delete "${s.name}" from startup?`, text: 'The entry is removed permanently (a registry backup is kept). Disabling is usually enough.', ok: 'Delete' })) return;
        const res = await api.deleteStartup(s.id);
        if (res.ok) { row.classList.add('removing'); setTimeout(() => { ST = ST.filter(x => x !== s); renderStartup(); }, 600); toast('Startup entry deleted'); }
        else toast('Could not delete the entry', 'err');
      }
    };
  }
});
function renderStartupCounts() { const on = ST.filter(s => s.enabled).length; $('#c-startup').textContent = on; $('#st-sub').textContent = `${on} enabled · ${ST.length - on} disabled — fewer startup apps means Windows boots faster.`; }
$('#refresh-startup').addEventListener('click', loadStartup);

// ---------------- Forced uninstall ----------------
const F = { prog: null, folder: null };
function renderForced() {
  const box = $('#forced');
  box.innerHTML = `
    <div class="big-card">
      <div id="f-chosen"></div>
      <div class="field"><label>Program name</label><div class="inp"><input id="f-name" placeholder="e.g. BlueStacks, Rockstar Games Launcher…" autocomplete="off" spellcheck="false"><div id="f-sug"></div></div></div>
      <div class="field"><label>Install folder (optional)</label><div class="inp"><input id="f-folder" placeholder="C:\\Program Files\\…" spellcheck="false"><button class="btn" id="f-browse" style="height:46px">${icon('folder')}Browse</button></div></div>
      <label class="checkline" id="f-run" style="display:none"><span class="cb on">${icon('check')}</span>Run the program's uninstaller first</label>
      <button class="btn primary" id="f-go" style="height:48px;padding:0 26px">${icon('radar')}Scan for traces</button>
    </div>
    <div class="tips">
      <div class="tip" style="animation-delay:.1s">${icon('zap')}<b>Half-removed apps</b><span>Clean what a crashed or cancelled uninstaller left behind.</span></div>
      <div class="tip" style="animation-delay:.18s">${icon('radar')}<b>Deep scan</b><span>Searches folders, shortcuts, registry keys, startup entries and services.</span></div>
      <div class="tip" style="animation-delay:.26s">${icon('shield')}<b>Always reversible</b><span>Files go to the Recycle Bin and registry keys are backed up first.</span></div>
    </div>`;
  const name = $('#f-name'), sug = $('#f-sug');
  let hl = -1;
  const showSug = () => {
    const q = name.value.trim().toLowerCase();
    const l = q ? P.list.filter(p => p.name.toLowerCase().includes(q)).slice(0, 7) : [];
    hl = -1;
    sug.innerHTML = l.length ? `<div class="suggest">${l.map(p => `<button data-pid="${esc(p.id)}">${avatar(p.name, P.icons[p.id])}<div>${esc(p.name)}<small>${esc(p.publisher || '')}</small></div></button>`).join('')}</div>` : '';
  };
  name.addEventListener('input', () => { if (F.prog && name.value !== F.prog.name) setForcedProgram(null, true); showSug(); });
  name.addEventListener('keydown', e => {
    const bs = $$('.suggest button', sug); if (!bs.length) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); hl = (hl + (e.key === 'ArrowDown' ? 1 : -1) + bs.length) % bs.length; bs.forEach((b, i) => b.classList.toggle('hl', i === hl)); }
    if (e.key === 'Enter' && hl >= 0) { e.preventDefault(); bs[hl].click(); }
    if (e.key === 'Escape') sug.innerHTML = '';
  });
  name.addEventListener('blur', () => setTimeout(() => sug.innerHTML = '', 150));
  sug.addEventListener('mousedown', e => { const b = e.target.closest('[data-pid]'); if (b) { e.preventDefault(); setForcedProgram(P.list.find(p => p.id === b.dataset.pid)); sug.innerHTML = ''; } });
  $('#f-browse').onclick = async () => { const f = await api.browseFolder(); if (f) { $('#f-folder').value = f; if (!name.value) name.value = f.split('\\').pop(); } };
  $('#f-run').onclick = () => $('#f-run .cb').classList.toggle('on');
  $('#f-go').onclick = () => {
    const n = name.value.trim(), folder = $('#f-folder').value.trim();
    if (!n && !folder) { name.focus(); name.animate([{ transform: 'translateX(0)' }, { transform: 'translateX(-8px)' }, { transform: 'translateX(8px)' }, { transform: 'translateX(0)' }], { duration: 300 }); return; }
    if (n.length < 3 && !folder) { toast('Type at least 3 characters so the scan stays accurate', 'info'); return; }
    const p = F.prog || { name: n || folder.split('\\').pop(), publisher: '' };
    openSingle(p, 'forced', { id: F.prog ? F.prog.id : null, name: n, folder: folder || null, runUninstaller: !!(F.prog && $('#f-run .cb').classList.contains('on')) });
  };
  if (F.pending) { setForcedProgram(F.pending); F.pending = null; }
}
function setForcedProgram(p, keepText) {
  if (!$('#f-name')) { F.pending = p; return; }
  F.prog = p;
  $('#f-run').style.display = p ? 'flex' : 'none';
  $('#f-chosen').innerHTML = p ? `<div class="chosen">${avatar(p.name, P.icons[p.id])}<div class="t"><b>${esc(p.name)}</b><small>${esc(p.publisher || '')}${p.installLocation ? ' · ' + esc(p.installLocation) : ''}</small></div><button class="btn ghost sm icon" id="f-clear">${icon('x')}</button></div>` : '';
  if (p) { $('#f-name').value = p.name; if (p.installLocation) $('#f-folder').value = p.installLocation; $('#f-clear').onclick = () => { setForcedProgram(null); $('#f-name').value = ''; $('#f-folder').value = ''; }; }
}

// ---------------- global ----------------
document.addEventListener('keydown', e => {
  if (e.ctrlKey && e.key.toLowerCase() === 'f') { e.preventDefault(); const inp = currentPage === 'apps' ? $('#qa') : $('#q'); go(currentPage === 'apps' ? 'apps' : 'programs'); inp.focus(); inp.select(); }
  if (e.key === 'Escape') { if (menuEl) closeMenu(); else if ($('#drawer').classList.contains('show')) closeDrawer(); }
  if (e.key === 'Delete' && currentPage === 'programs' && document.activeElement.tagName !== 'INPUT' && !modalRoot.classList.contains('show')) {
    if (P.selected.size) startUninstall([...P.selected]); else if (P.focus) startUninstall([P.focus]);
  }
});
$('#open-backups').addEventListener('click', () => api.openBackups());
window.addEventListener('resize', () => { moveChipPill($('#filters')); const b = $('#nav button.active'); if (b) $('#nav-pill').style.transform = `translateY(${b.offsetTop}px)`; });

(async function init() {
  $('#logo').innerHTML = icon('logo');
  hydrateIcons();
  go('programs');
  requestAnimationFrame(() => moveChipPill($('#filters')));
  const env = await api.env();
  const card = $('#admin-card');
  if (env.admin) { $('#admin-text').textContent = 'Running as administrator'; }
  else {
    card.classList.add('bad'); $('#admin-text').textContent = 'Limited permissions';
    $('#admin-banner').innerHTML = `<div class="banner">${icon('alert')}<div class="t"><b>Purgo isn't running as administrator.</b> Some programs and leftovers can't be removed without admin rights.</div><button class="btn sm" id="relaunch">Restart as admin</button></div>`;
    $('#relaunch').onclick = () => api.relaunchAdmin();
  }
  // Preload the other pages' counts quietly
  setTimeout(() => { if (!loaded.startup) { loaded.startup = true; loadStartup(); } }, 2500);
  setTimeout(() => { if (!loaded.apps) { loaded.apps = true; loadApps(); } }, 4500);
})();
