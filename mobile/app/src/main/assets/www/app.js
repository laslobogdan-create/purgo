/* Purgo for Android — UI */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const DAY = 864e5;

function fmt(b, parts) {
  if (!b || b < 0) return parts ? ['0', 'B'] : '0 B';
  const u = ['B', 'KB', 'MB', 'GB', 'TB']; let i = 0, v = b;
  while (v >= 1000 && i < u.length - 1) { v /= 1024; i++; }
  const n = v >= 100 || i === 0 ? Math.round(v).toString() : v.toFixed(v >= 10 ? 1 : 2);
  return parts ? [n, u[i]] : n + ' ' + u[i];
}
function ago(t) {
  if (!t) return '';
  const d = Math.floor((Date.now() - t) / DAY);
  if (d <= 0) return 'today'; if (d === 1) return 'yesterday';
  if (d < 30) return d + ' days ago'; if (d < 60) return '1 month ago';
  if (d < 365) return Math.floor(d / 30) + ' months ago';
  return Math.floor(d / 365) === 1 ? '1 year ago' : Math.floor(d / 365) + ' years ago';
}
function date(t) { return t ? new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : ''; }
function folderOf(p) { const r = Demo.ROOT; const d = p.slice(0, p.lastIndexOf('/')); return d.startsWith(ROOT()) ? (d.slice(ROOT().length) || '/') : d; }
function ROOT() { return S.root || '/storage/emulated/0'; }
function hash(s) { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) | 0; return Math.abs(h); }
function countUp(el, to, f = v => Math.round(v), ms = 1000) {
  const from = Number(el.dataset.v || 0); el.dataset.v = to; const t0 = performance.now();
  const tick = t => { const k = Math.min(1, (t - t0) / ms), e = 1 - Math.pow(1 - k, 3); el.innerHTML = f(from + (to - from) * e); if (k < 1) requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
}
const TYPE_ICON = { image: 'image', video: 'video', audio: 'audio', doc: 'doc', apk: 'apk', archive: 'archive', folder: 'folder', other: 'file' };
const TYPE_HUE = { image: 'hue-blue', video: 'hue-pink', audio: 'hue-amber', doc: 'hue-cyan', apk: 'hue-green', archive: 'hue-violet', folder: 'hue-amber', other: 'hue-violet' };
const CAT_COLORS = { image: '#4f7cff', video: '#b45cff', audio: '#fbbf24', doc: '#38bdf8', apps: '#34d399', other: '#6b6f99' };

const S = { env: null, root: null, scan: null, results: {}, freed: Number(localStorage.getItem('purgo.freed') || 0) };

// ======================================================================== toasts / sheets
function toast(text, iconName = 'check') {
  const t = document.createElement('div'); t.className = 'toast';
  t.innerHTML = icon(iconName) + `<span>${esc(text)}</span>`;
  $('#toasts').appendChild(t);
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 350); }, 2600);
}
N.on('toast', d => toast(d.text, 'info'));

let sheetStack = [];
function sheet(html, { locked = false, onClose } = {}) {
  const root = document.createElement('div'); root.className = 'sheet-root';
  root.innerHTML = `<div class="sheet"><div class="grab"></div>${html}</div>`;
  document.body.appendChild(root);
  requestAnimationFrame(() => root.classList.add('show'));
  const api = {
    el: root.firstElementChild, locked,
    set(h) { api.el.innerHTML = `<div class="grab"></div>` + h; },
    close() {
      if (!root.isConnected) return;
      root.classList.remove('show'); sheetStack = sheetStack.filter(s => s !== api);
      setTimeout(() => root.remove(), 450); onClose && onClose();
    },
  };
  root.addEventListener('click', e => { if (e.target === root && !api.locked) api.close(); });
  sheetStack.push(api);
  return api;
}
function confirmSheet({ title, text, ok = 'Continue', danger = true, iconName = 'trash', extra = '' }) {
  return new Promise(res => {
    let decided = false;
    const s = sheet(`<div class="si ${danger ? 'hue-red' : 'hue-violet'}">${icon(iconName)}</div><h3>${esc(title)}</h3><p>${text}</p>${extra}
      <div class="acts"><button class="btn" data-r="0">Cancel</button><button class="btn ${danger ? 'danger' : 'primary'}" data-r="1">${esc(ok)}</button></div>`,
      { onClose: () => { if (!decided) res(null); } });
    s.el.addEventListener('click', e => {
      const sw = e.target.closest('.switch'); if (sw) { sw.classList.toggle('on'); return; }
      const b = e.target.closest('[data-r]'); if (!b) return;
      decided = true; const sws = {}; $$('.switch[data-k]', s.el).forEach(x => sws[x.dataset.k] = x.classList.contains('on'));
      s.close(); res(b.dataset.r === '1' ? sws : null);
    });
  });
}
function menuSheet(title, options, current) {
  return new Promise(res => {
    const s = sheet(`<h3>${esc(title)}</h3><div>${options.map(o => `<div class="menu-item ${o.id === current ? 'on' : ''}" data-id="${o.id}">${o.icon ? icon(o.icon) : ''}${esc(o.label)}</div>`).join('')}</div>`, { onClose: () => res(null) });
    s.el.addEventListener('click', e => { const m = e.target.closest('[data-id]'); if (m) { res(m.dataset.id); s.close(); } });
  });
}

// ======================================================================== confetti
function confetti(canvas) {
  if (!canvas) return; const dpr = devicePixelRatio || 1;
  const W = canvas.width = canvas.offsetWidth * dpr, H = canvas.height = canvas.offsetHeight * dpr, ctx = canvas.getContext('2d');
  const colors = ['#4f7cff', '#7c5cff', '#b45cff', '#34d399', '#ffd166', '#ff7ab6'];
  const ps = Array.from({ length: 120 }, () => { const a = Math.random() * Math.PI * 2, v = (3 + Math.random() * 8) * dpr; return { x: W / 2, y: H * .3, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 5 * dpr, r: (2.5 + Math.random() * 3.5) * dpr, c: colors[Math.random() * 6 | 0], rot: Math.random() * 6, vr: (Math.random() - .5) * .4, life: 1 }; });
  const tick = () => { ctx.clearRect(0, 0, W, H); let alive = false;
    for (const p of ps) { p.vy += .22 * dpr; p.vx *= .985; p.vy *= .985; p.x += p.vx; p.y += p.vy; p.rot += p.vr; p.life -= .01; if (p.life <= 0) continue; alive = true;
      ctx.save(); ctx.globalAlpha = Math.min(1, p.life * 1.5); ctx.translate(p.x, p.y); ctx.rotate(p.rot); ctx.fillStyle = p.c; ctx.fillRect(-p.r, -p.r / 2, p.r * 2, p.r); ctx.restore(); }
    if (alive && canvas.isConnected) requestAnimationFrame(tick); };
  tick();
}

// ======================================================================== progress ring (shared)
function progressHtml(title, sub = '') {
  const parts = Array.from({ length: 12 }, (_, i) => { const a = i / 12 * Math.PI * 2, d = 120 + (i % 3) * 18; return `<i style="--x:${Math.round(Math.cos(a) * d)}px;--y:${Math.round(Math.sin(a) * d * .7)}px;animation-delay:${i * 130}ms;background:${['#8fa7ff', '#b49bff', '#e19bff'][i % 3]}"></i>`; }).join('');
  return `<div class="prog" style="position:relative"><div class="particles">${parts}</div>
    <div class="pring"><svg viewBox="0 0 150 150"><circle class="bg" cx="75" cy="75" r="64"/><circle class="fg" cx="75" cy="75" r="64" stroke-dasharray="402" stroke-dashoffset="402"/></svg><div class="c"><span class="pv">0<small>%</small></span></div></div>
    <div class="ptitle">${esc(title)}</div><div class="psub">${esc(sub)}</div></div>`;
}
function setProgress(root, frac, sub) {
  const fg = $('.pring .fg', root); if (fg) fg.style.strokeDashoffset = 402 * (1 - Math.max(0, Math.min(1, frac)));
  const pv = $('.pv', root); if (pv) pv.innerHTML = Math.round(frac * 100) + '<small>%</small>';
  if (sub != null) { const ps = $('.psub', root); if (ps) ps.textContent = sub; }
}
function doneHtml({ title, freed, text, warn, cap }) {
  return `<div class="donebox"><canvas></canvas><div class="check-big ${warn ? 'warn' : ''}">${icon(warn ? 'alert' : 'check')}</div>
    <h3>${esc(title)}</h3>${freed != null ? `<div class="freed" data-v="0">0 B</div>${cap ? `<div class="cap">${esc(cap)}</div>` : ''}` : ''}<p>${text || ''}</p>
    <div class="acts"><button class="btn primary block" data-close>${icon('check')}Done</button></div></div>`;
}
function showDone(s, opts) {
  s.locked = false;
  s.set(doneHtml(opts));
  const fr = $('.freed', s.el); if (fr) setTimeout(() => countUp(fr, opts.freed, v => fmt(v), 1100), 400);
  if (!opts.warn) setTimeout(() => confetti($('canvas', s.el)), 250);
  $('[data-close]', s.el).onclick = () => s.close();
}
function addFreed(b) { S.freed += b || 0; localStorage.setItem('purgo.freed', S.freed); updateDrawerStats(); }

// ======================================================================== delete flow
async function deleteFlow(items, { onDone, permanentDefault = false, label = 'item' } = {}) {
  if (!items.length) return;
  const bytes = items.reduce((a, b) => a + (b.s || 0), 0);
  const useBin = S.env.bin && !permanentDefault;
  const n = items.length, word = n === 1 ? label : label + 's';
  const r = await confirmSheet({
    title: `Delete ${n} ${word}?`,
    text: `${fmt(bytes)} will be freed. ${useBin ? 'Items go to <b>Purgo Bin</b> — you can restore them for 30 days.' : 'This can\'t be undone.'}`,
    ok: 'Delete', extra: useBin ? `<div class="optrow"><div class="t"><b>Delete permanently</b><span>Skip Purgo Bin and free the space right away</span></div><div class="switch" data-k="perm"></div></div>` : '',
  });
  if (!r) return;
  const toBin = useBin && !r.perm;
  const s = sheet(progressHtml('Cleaning up', 'Starting…'), { locked: true });
  const rows = new Map(); items.forEach(it => { const el = document.querySelector(`[data-p="${CSS.escape(it.p)}"]`); if (el) rows.set(it.p, el); });
  try {
    const res = await N.call('delete', { paths: items.map(i => i.p), bin: toBin }, pr => {
      setProgress(s.el, pr.done / pr.total, pr.path ? pr.path.split('/').pop() : '');
      const el = rows.get(pr.path); if (el && pr.ok) el.classList.add(el.classList.contains('gi') ? 'gone' : 'gone');
    });
    setProgress(s.el, 1);
    await sleep(350);
    addFreed(toBin ? 0 : res.bytes);
    if (toBin) S.binDirty = true;
    showDone(s, { title: res.failed ? `${res.ok} removed, ${res.failed} failed` : (toBin ? 'Moved to Purgo Bin' : 'All clean!'), freed: res.bytes, warn: !!res.failed,
      cap: toBin ? 'moved to the bin' : 'freed',
      text: toBin ? 'Changed your mind? Restore them within 30 days. Empty Purgo Bin to get the space back right away.' : 'The space is free again.' });
    invalidate();
    onDone && onDone(res, new Set(items.map(i => i.p)));
    refreshEnv();
  } catch (e) {
    s.locked = false; s.set(`<h3>Something went wrong</h3><p>${esc(e.error || e)}</p><div class="acts"><button class="btn block" data-x>Close</button></div>`);
    $('[data-x]', s.el).onclick = () => s.close();
  }
}
function invalidate() { S.results = {}; }

// ======================================================================== selection
const Sel = {
  map: new Map(), ctx: null,
  get size() { return this.map.size; },
  bytes() { let b = 0; this.map.forEach(v => b += v.s || v.total || 0); return b; },
  has(k) { return this.map.has(k); },
  set(k, v, on) { if (on) this.map.set(k, v); else this.map.delete(k); },
  toggle(k, v) { this.set(k, v, !this.map.has(k)); this.changed(); return this.map.has(k); },
  clear(silent) { this.map.clear(); if (!silent) this.changed(); },
  items() { return [...this.map.values()]; },
  changed() {
    const n = this.size, bar = $('#selbar'), ctx = this.ctx;
    bar.classList.toggle('show', n > 0 && !!ctx);
    if (n && ctx) {
      $('#sel-n').textContent = ctx.countLabel ? ctx.countLabel(n) : `${n} selected`;
      $('#sel-s').textContent = ctx.sizeLabel ? ctx.sizeLabel(this.bytes()) : `${fmt(this.bytes())}`;
      $('#sel-go').innerHTML = icon(ctx.icon || 'trash') + esc(ctx.label || 'Delete');
      $('#sel-go').className = 'btn ' + (ctx.danger === false ? 'primary' : 'danger');
      $('#sel-alt').style.display = ctx.alt ? '' : 'none';
      if (ctx.alt) $('#sel-alt').innerHTML = icon(ctx.alt.icon || 'trash');
    }
    if (ctx && ctx.onChange) ctx.onChange();
    renderTopbar();
  },
};
$('#sel-go').onclick = () => Sel.ctx && Sel.ctx.run(Sel.items());
$('#sel-alt').onclick = () => Sel.ctx && Sel.ctx.alt && Sel.ctx.alt.run(Sel.items());

function cbHtml(on) { return `<span class="cb ${on ? 'on' : ''}">${icon('check')}</span>`; }

// ======================================================================== chunked list rendering
function chunked(container, items, render, size = 60) {
  let i = 0;
  const more = () => {
    const frag = document.createElement('div');
    frag.innerHTML = items.slice(i, i + size).map((it, k) => render(it, i + k)).join('');
    while (frag.firstChild) container.insertBefore(frag.firstChild, sentinel);
    i += size;
    if (i >= items.length) { io.disconnect(); sentinel.remove(); }
  };
  const sentinel = document.createElement('div'); sentinel.style.height = '1px';
  container.appendChild(sentinel);
  const io = new IntersectionObserver(es => { if (es.some(e => e.isIntersecting)) more(); }, { rootMargin: '600px' });
  more(); if (i < items.length) io.observe(sentinel);
}

function thumbHtml(it, cls = 'th') {
  const t = it.t || 'other';
  const src = ['image', 'video', 'audio', 'apk'].includes(t) ? N.thumb(it.p, 160) : null;
  const fallback = `<span class="${TYPE_HUE[t] || ''}" style="width:100%;height:100%;display:grid;place-items:center">${icon(TYPE_ICON[t] || 'file')}</span>`;
  return `<div class="${cls}">${src ? `<img loading="lazy" src="${src}" onerror="this.outerHTML=this.dataset.f" data-f='${fallback.replace(/'/g, '&#39;')}'>` : fallback}${t === 'video' ? `<span class="play">${icon('play')}</span>` : ''}</div>`;
}

function fileRow(it, { max = 0, sub, i = 0, showWhy } = {}) {
  const on = Sel.has(it.p);
  const pct = max ? Math.max(2, Math.round(Math.sqrt(it.s / max) * 100)) : 0;
  const line = sub ? sub(it) : (it.t === 'folder' ? `${it.c != null ? it.c + ' files · ' : ''}${esc(folderOf(it.p))}` : `${esc(folderOf(it.p))} · ${ago(it.m)}`);
  return `<div class="row ${on ? 'sel' : ''}" data-p="${esc(it.p)}" style="animation-delay:${Math.min(i, 14) * 25}ms">
    <div class="cbhit">${cbHtml(on)}</div>${thumbHtml(it)}
    <div class="tx"><b>${esc(it.n)}</b><span ${showWhy ? 'class="why"' : ''}>${showWhy && it.why ? esc(it.why) : line}</span>${pct ? `<div class="szbar"><i style="width:${pct}%"></i></div>` : ''}</div>
    <div class="sz">${fmt(it.s)}${it.keep ? '<small><span class="badge keep">KEEP</span></small>' : ''}</div></div>`;
}

function gridItem(it, i = 0) {
  const on = Sel.has(it.p);
  return `<div class="gi ${on ? 'sel' : ''}" data-p="${esc(it.p)}" style="animation-delay:${Math.min(i, 24) * 18}ms">
    <img loading="lazy" src="${N.thumb(it.p, 256)}" onerror="this.remove()"><span class="ph"></span>
    ${it.t === 'video' ? `<span class="dur">${icon('play')}${fmt(it.s)}</span>` : ''}
    ${it.keep ? '<span class="tag badge best">BEST</span>' : ''}
    ${cbHtml(on)}</div>`;
}

/** Wires tap/long-press selection on rows/grid items inside `root`. lookup(p) returns the item. */
function wireSelectable(root, lookup, { viewerList } = {}) {
  let pressT = null, pressed = null, longFired = false;
  const toggle = el => {
    const it = lookup(el.dataset.p); if (!it) return;
    const on = Sel.toggle(it.p, it);
    el.classList.toggle('sel', on); const cb = $('.cb', el); if (cb) cb.classList.toggle('on', on);
  };
  root.addEventListener('touchstart', e => {
    const el = e.target.closest('[data-p]'); if (!el || e.target.closest('.cbhit,.cb')) return;
    pressed = el; longFired = false;
    pressT = setTimeout(() => { longFired = true; if (navigator.vibrate) navigator.vibrate(12); toggle(el); }, 420);
  }, { passive: true });
  const cancel = () => clearTimeout(pressT);
  root.addEventListener('touchmove', cancel, { passive: true });
  root.addEventListener('touchend', cancel);
  root.addEventListener('contextmenu', e => e.preventDefault());
  root.addEventListener('click', e => {
    const el = e.target.closest('[data-p]'); if (!el) return;
    if (longFired && el === pressed) { longFired = false; return; }
    if (e.target.closest('.cbhit,.cb') || Sel.size > 0) { toggle(el); return; }
    const it = lookup(el.dataset.p);
    if (it && it.t === 'folder') { if (Router.cur().name !== 'storage') toggle(el); return; }
    if (it && viewerList) Viewer.open(viewerList(), it.p);
  });
}

// ======================================================================== viewer
const Viewer = {
  list: [], i: 0,
  open(list, p) {
    this.list = list.filter(x => x.t !== 'folder'); this.i = Math.max(0, this.list.findIndex(x => x.p === p));
    if (!this.list.length) return;
    const v = document.createElement('div'); v.className = 'viewer'; v.id = 'viewer';
    v.innerHTML = `<div class="vtop"><button class="ib" data-v="close">${icon('back')}</button><div class="vt"><b></b><span></span></div><button class="ib" data-v="sel"></button></div>
      <div class="vstage"></div><div class="vbot"><div class="vpath"></div><div class="vacts">
      <button data-v="share">${icon('share')}Share</button><button data-v="open">${icon('open')}Open with</button><button data-v="del" class="red">${icon('trash')}Delete</button></div></div>`;
    document.body.appendChild(v);
    requestAnimationFrame(() => v.classList.add('show'));
    v.addEventListener('click', e => {
      const b = e.target.closest('[data-v]'); if (!b) return;
      const it = this.list[this.i];
      if (b.dataset.v === 'close') this.close();
      if (b.dataset.v === 'share') N.call('share', { paths: [it.p] });
      if (b.dataset.v === 'open') N.call('open', { path: it.p });
      if (b.dataset.v === 'sel') { Sel.toggle(it.p, it); this.render(); const el = document.querySelector(`[data-p="${CSS.escape(it.p)}"]`); if (el) { el.classList.toggle('sel', Sel.has(it.p)); const cb = $('.cb', el); if (cb) cb.classList.toggle('on', Sel.has(it.p)); } }
      if (b.dataset.v === 'del') { const page = Router.cur(); this.close(); deleteFlow([it], { onDone: () => page.refresh && page.refresh() }); }
    });
    let x0 = null, y0 = 0;
    const st = $('.vstage', v);
    st.addEventListener('touchstart', e => { x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; }, { passive: true });
    st.addEventListener('touchend', e => {
      if (x0 == null) return; const dx = e.changedTouches[0].clientX - x0, dy = e.changedTouches[0].clientY - y0; x0 = null;
      if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy)) this.go(dx < 0 ? 1 : -1);
      else if (dy > 120) this.close();
    });
    this.render();
  },
  go(d) { const n = this.i + d; if (n < 0 || n >= this.list.length) return; this.i = n; this.render(d); },
  render(dir) {
    const v = $('#viewer'); if (!v) return; const it = this.list[this.i];
    $('.vt b', v).textContent = it.n; $('.vt span', v).textContent = `${fmt(it.s)} · ${date(it.m)}  ·  ${this.i + 1}/${this.list.length}`;
    $('.vpath', v).textContent = '‎' + it.p;
    $('[data-v="sel"]', v).innerHTML = Sel.ctx ? cbHtml(Sel.has(it.p)) : '';
    const st = $('.vstage', v);
    let h;
    if (it.t === 'image') h = `<img src="${N.file(it.p)}" onerror="this.src='${N.thumb(it.p, 512)}'">`;
    else if (it.t === 'video') h = `<video src="${N.file(it.p)}" controls autoplay playsinline poster="${N.thumb(it.p, 512) || ''}"></video>`;
    else if (it.t === 'audio') h = `<div class="other"><div class="big">${icon('audio')}</div><b>${esc(it.n)}</b><audio src="${N.file(it.p)}" controls autoplay></audio></div>`;
    else h = `<div class="other"><div class="big">${icon(TYPE_ICON[it.t] || 'file')}</div><b>${esc(it.n)}</b><p style="color:var(--muted)">No preview for this kind of file.</p><button class="btn primary" data-v="open">${icon('open')}Open with…</button></div>`;
    st.innerHTML = h;
    const m = st.firstElementChild; if (m && dir) m.animate([{ transform: `translateX(${dir * 60}px)`, opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 280, easing: 'cubic-bezier(.2,.8,.2,1)' });
  },
  close() { const v = $('#viewer'); if (!v) return; $$('video,audio', v).forEach(m => m.pause()); v.classList.remove('show'); setTimeout(() => v.remove(), 300); },
};

// ======================================================================== router
const PAGES = {};
const Router = {
  stack: [],
  cur() { return this.stack[this.stack.length - 1] || {}; },
  go(name, params = {}, { push = false } = {}) {
    Viewer.close();
    Sel.clear(true); Sel.ctx = null; Sel.changed();
    const prev = this.cur();
    const entry = { name, params, el: null };
    if (push) this.stack.push(entry); else this.stack = [entry];
    this.mount(entry, push ? 'enter' : 'enter', prev);
    $$('#nav button').forEach(b => b.classList.toggle('on', b.dataset.go === (push ? this.stack[0].name : name)));
    closeDrawer();
  },
  back() {
    if (this.stack.length < 2) return false;
    Sel.clear(true); Sel.ctx = null; Sel.changed();
    const prev = this.stack.pop();
    const entry = this.cur();
    this.mount(entry, 'enter-back', prev);
    return true;
  },
  popTo(i) {
    if (i >= this.stack.length - 1) return;
    Sel.clear(true); Sel.ctx = null; Sel.changed();
    const prev = this.cur();
    this.stack = this.stack.slice(0, i + 1);
    this.mount(this.cur(), 'enter-back', prev);
  },
  mount(entry, anim, prev) {
    const view = $('#view');
    if (prev && prev.el && prev.el !== entry.el) { const old = prev.el; old.classList.add('leave'); setTimeout(() => old.remove(), 300); }
    const def = PAGES[entry.name];
    const make = cls => {
      const el = document.createElement('div'); el.className = 'page ' + cls;
      el.addEventListener('scroll', () => $('#topbar').classList.toggle('scrolled', el.scrollTop > 4), { passive: true });
      return el;
    };
    const run = el => {
      entry.el = el; entry.actions = [];
      if (Router.cur() === entry) renderTopbar();
      Promise.resolve().then(() => def.render(el, entry.params, entry)).catch(err => {
        if (!el.isConnected) return;
        const msg = (err && (err.error || err.message)) || String(err);
        el.innerHTML = `<div class="empty"><div class="big">${icon('alert')}</div><b>Couldn't load this</b>${esc(msg)}<div style="margin-top:18px"><button class="btn primary" data-retry>${icon('restore')}Try again</button></div></div>`;
        $('[data-retry]', el).onclick = () => entry.refresh();
        if (/permission/i.test(msg)) N.call('requestAllFiles');
      }).finally(() => { if (Router.cur() === entry) renderTopbar(); });
    };
    entry.title = def.title; entry.sub = '';
    entry.refresh = () => {
      Sel.clear(true); Sel.ctx = null; Sel.changed();
      const fresh = make(''); const old = entry.el;
      if (old && old.isConnected) old.replaceWith(fresh); else view.appendChild(fresh);
      run(fresh);
    };
    const el = make(anim); view.appendChild(el);
    run(el);
  },
};
function setTitle(entry, title, sub) { entry.title = title; entry.sub = sub || ''; if (Router.cur() === entry) renderTopbar(); }

function renderTopbar() {
  const tb = $('#topbar'), e = Router.cur();
  if (!e.name) return;
  if (Sel.size > 0 && Sel.ctx) {
    tb.classList.add('sel');
    tb.innerHTML = `<button class="ib" data-t="clear">${icon('x')}</button><h1>${Sel.size} selected<span class="sub">${fmt(Sel.bytes())}</span></h1>
      ${Sel.ctx.all ? `<button class="ib" data-t="all">${icon('selectall')}</button>` : ''}`;
  } else {
    tb.classList.remove('sel');
    const left = Router.stack.length > 1 ? `<button class="ib" data-t="back">${icon('back')}</button>` : `<button class="ib" data-t="menu">${icon('menu')}</button>`;
    tb.innerHTML = `${left}<h1>${esc(e.title)}${e.sub ? `<span class="sub">${esc(e.sub)}</span>` : ''}</h1>` +
      (e.actions || []).map((a, i) => `<button class="ib" data-a="${i}">${icon(a.icon)}</button>`).join('');
  }
}
$('#topbar').addEventListener('click', e => {
  const t = e.target.closest('[data-t]'), a = e.target.closest('[data-a]');
  if (t) {
    if (t.dataset.t === 'menu') openDrawer();
    if (t.dataset.t === 'back') Router.back();
    if (t.dataset.t === 'clear') { Sel.clear(); refreshSelVisuals(); }
    if (t.dataset.t === 'all' && Sel.ctx && Sel.ctx.all) { Sel.ctx.all(); refreshSelVisuals(); }
  }
  if (a) { const act = Router.cur().actions[+a.dataset.a]; if (act) act.run(); }
});
function refreshSelVisuals() {
  $$('[data-p]', Router.cur().el).forEach(el => { const on = Sel.has(el.dataset.p); el.classList.toggle('sel', on); const cb = $('.cb', el); if (cb) cb.classList.toggle('on', on); });
  const ctx = Sel.ctx; if (ctx && ctx.onChange) ctx.onChange();
}
function selectAllOf(items) {
  return () => { const all = items().every(i => Sel.has(i.p)); items().forEach(i => Sel.set(i.p, i, !all)); Sel.changed(); };
}

window.onNativeBack = () => {
  if ($('#viewer')) { Viewer.close(); return true; }
  const s = sheetStack[sheetStack.length - 1]; if (s) { if (!s.locked) s.close(); return true; }
  if ($('#drawer').classList.contains('show')) { closeDrawer(); return true; }
  if (Sel.size) { Sel.clear(); refreshSelVisuals(); return true; }
  if (Router.back()) return true;
  if (Router.cur().name !== 'home') { Router.go('home'); return true; }
  return false;
};

// ======================================================================== drawer
const NAV = [
  ['home', 'Dashboard', 'home', 'Overview'],
  ['junk', 'Junk files', 'broom', 'Clean'],
  ['large', 'Large files', 'big'],
  ['duplicates', 'Duplicates', 'copy'],
  ['photos', 'Smart photos', 'sparkle'],
  ['chat', 'WhatsApp & Telegram', 'chat'],
  ['apps', 'Apps', 'apps', 'Apps & storage'],
  ['cache', 'App cache', 'zap'],
  ['storage', 'Storage explorer', 'folder'],
  ['bin', 'Purgo Bin', 'bin', 'More'],
  ['settings', 'Settings', 'settings'],
];
function buildNav() {
  $('#nav').innerHTML = NAV.map(([id, label, ic, sec]) => (sec ? `<div class="nav-label">${sec}</div>` : '') + `<button data-go="${id}">${icon(ic)}${label}<span class="cnt" id="cnt-${id}" style="display:none"></span></button>`).join('');
  $('#nav').addEventListener('click', e => { const b = e.target.closest('[data-go]'); if (b) Router.go(b.dataset.go); });
}
function openDrawer() { updateDrawerStats(); $('#drawer').classList.add('show'); $('#scrim').classList.add('show'); }
function closeDrawer() { $('#drawer').classList.remove('show'); $('#scrim').classList.remove('show'); }
$('#scrim').onclick = closeDrawer;
function updateDrawerStats() {
  if (!S.env) return;
  const used = S.env.total - S.env.free;
  $('#m-used').textContent = fmt(used); $('#m-total').textContent = fmt(S.env.total);
  $('#m-bar').style.width = (used / S.env.total * 100) + '%';
  $('#freed-total').textContent = S.freed ? 'Freed ' + fmt(S.freed) : '';
}
function setCount(id, v) { const c = $('#cnt-' + id); if (!c) return; c.style.display = v ? '' : 'none'; c.textContent = v || ''; }
// edge swipe to open drawer
(() => { let x0 = null, y0 = 0; document.addEventListener('touchstart', e => { const t = e.touches[0]; if (t.clientX < 22 && Router.stack.length === 1 && !$('#viewer')) { x0 = t.clientX; y0 = t.clientY; } }, { passive: true });
  document.addEventListener('touchend', e => { if (x0 == null) return; const t = e.changedTouches[0]; if (t.clientX - x0 > 60 && Math.abs(t.clientY - y0) < 80) openDrawer(); x0 = null; }); })();

async function refreshEnv() { try { S.env = await N.call('env'); applyInsets(S.env.insets); updateDrawerStats(); } catch (e) {} }
function applyInsets(i) { if (!i) return; document.documentElement.style.setProperty('--sat', Math.max(i.top, 0) + 'px'); document.documentElement.style.setProperty('--sab', Math.max(i.bottom, 8) + 'px'); }
N.on('insets', applyInsets);

/** Runs a native call with a big animated progress view inside `el`. */
async function withProgress(el, title, method, args, sub = '') {
  el.innerHTML = `<div style="padding-top:8vh">${progressHtml(title, sub)}</div><div style="text-align:center;margin-top:18px"><button class="btn ghost sm" data-cancel>Cancel</button></div>`;
  let cid = null;
  const btn = $('[data-cancel]', el);
  const p = N.call(method, args, pr => {
    const frac = pr.pct != null ? pr.pct : (pr.total ? pr.done / pr.total : 0);
    if (pr.files != null) setProgress(el, Math.min(.98, (pr.bytes || 0) / Math.max(1, (S.env.total - S.env.free))), `${pr.files.toLocaleString()} files · ${pr.dir ? pr.dir.replace(ROOT(), '') || '/' : ''}`);
    else setProgress(el, frac, pr.stage ? (pr.stage + (pr.total ? ` · ${pr.done}/${pr.total}` : '')) : '');
    const t = $('.ptitle', el); if (t && pr.stage) t.textContent = pr.stage;
  });
  btn.onclick = () => { Router.back() || Router.go('home'); };
  return p;
}
async function ensureIndex(el) {
  if (S.scan) return S.scan;
  S.scan = await withProgress(el, 'Scanning storage', 'scan', { reuse: true });
  S.root = S.root || Demo.ROOT;
  return S.scan;
}

// ======================================================================== PAGE: dashboard
PAGES.home = {
  title: 'Purgo',
  render(el, p, entry) {
    entry.actions = [{ icon: 'settings', run: () => Router.go('settings') }];
    setTitle(entry, 'Purgo', S.env ? S.env.device : '');
    const used = S.env.total - S.env.free, pct = used / S.env.total;
    el.innerHTML = `
      <div class="ringwrap"><div class="ring" id="ring"><div class="glow"></div><div class="orbit"></div>
        <svg viewBox="0 0 236 236"><defs><linearGradient id="rgrad" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#4f7cff"/><stop offset=".5" stop-color="#7c5cff"/><stop offset="1" stop-color="#c66bff"/></linearGradient></defs>
        <circle class="track" cx="118" cy="118" r="100"/><g id="segs"><circle class="seg" cx="118" cy="118" r="100" stroke="url(#rgrad)" stroke-dasharray="0 629"/></g></svg>
        <div class="mid"><div class="pct" id="d-pct">0<small>%</small></div><div class="lbl"><b>${fmt(used)}</b> of ${fmt(S.env.total)} used</div><div class="lbl" style="margin-top:2px">${fmt(S.env.free)} free</div></div></div></div>
      <div class="legend" id="legend"></div>
      <div class="scanbox" id="scanbox"></div>
      <div class="sec">Tools<span class="ln"></span></div>
      <div class="tiles" id="tiles"></div>`;
    countUp($('#d-pct'), pct * 100, v => Math.round(v) + '<small>%</small>');
    setTimeout(() => { const c = $('#segs circle'); if (c) c.setAttribute('stroke-dasharray', `${629 * pct} 629`); }, 60);
    const tiles = [['junk', 'Junk files', 'broom', 'hue-violet'], ['large', 'Large files', 'big', 'hue-blue'], ['duplicates', 'Duplicates', 'copy', 'hue-pink'], ['photos', 'Smart photos', 'sparkle', 'hue-cyan'], ['chat', 'Chat media', 'chat', 'hue-teal'], ['apps', 'Apps', 'apps', 'hue-green'], ['cache', 'App cache', 'zap', 'hue-amber'], ['storage', 'Explorer', 'folder', 'hue-violet'], ['bin', 'Purgo Bin', 'bin', 'hue-red']];
    $('#tiles').innerHTML = tiles.map(([id, l, ic, h], i) => `<button class="tile" data-go="${id}" style="animation-delay:${i * 40}ms"><span class="ti ${h}">${icon(ic)}</span>${l}</button>`).join('');
    $('#tiles').onclick = e => { const b = e.target.closest('[data-go]'); if (b) Router.go(b.dataset.go); };
    if (S.scan) { this.drawSegments(); this.renderFound(); } else this.renderIdle();
  },
  renderIdle() {
    $('#scanbox').innerHTML = `<button class="btn primary wide shine" id="smart">${icon('radar')}Smart scan</button>
      <div class="now">Finds junk, duplicates, big files and more</div>`;
    $('#smart').onclick = () => this.smartScan();
  },
  drawSegments() {
    const c = S.scan.categories, tot = S.env.total, used = S.env.total - S.env.free;
    const apps = S.results.apps ? S.results.apps.totalApp + S.results.apps.totalData : 0;
    const parts = [['image', c.image.bytes], ['video', c.video.bytes], ['audio', c.audio.bytes], ['doc', c.doc.bytes + c.archive.bytes], ['apps', apps + c.apk.bytes]];
    const known = parts.reduce((a, b) => a + b[1], 0); parts.push(['other', Math.max(0, used - known)]);
    let off = 0; const C = 629;
    $('#segs').innerHTML = parts.map(([k, b]) => { const len = C * b / tot; const s = `<circle class="seg" cx="118" cy="118" r="100" stroke="${CAT_COLORS[k]}" stroke-dasharray="0 ${C}" stroke-dashoffset="${-off}" data-len="${Math.max(0, len - 3)}"/>`; off += len; return s; }).join('');
    requestAnimationFrame(() => $$('#segs circle').forEach((c, i) => setTimeout(() => c.setAttribute('stroke-dasharray', `${c.dataset.len} ${C}`), i * 90)));
    const names = { image: 'Photos', video: 'Videos', audio: 'Audio', doc: 'Documents', apps: 'Apps & APKs', other: 'System & other' };
    $('#legend').innerHTML = parts.map(([k, b], i) => `<div style="animation-delay:${i * 50}ms"><i style="background:${CAT_COLORS[k]}"></i>${names[k]}<b>${fmt(b)}</b></div>`).join('');
  },
  async smartScan() {
    const box = $('#scanbox'); const ring = $('#ring'); ring.classList.add('scanning');
    box.innerHTML = `<div class="btn wide" style="pointer-events:none"><span class="spin" style="width:18px;height:18px;border-radius:50%;border:2px solid rgba(255,255,255,.15);border-top-color:#a48bff;animation:spin .8s linear infinite"></span>Scanning your phone…</div><div class="now" id="now">Starting</div>`;
    try {
      S.scan = await N.call('scan', {}, pr => { const n = $('#now'); if (n) n.textContent = `${(pr.files || 0).toLocaleString()} files · ${(pr.dir || '').replace(ROOT(), '') || '/'}`; });
    } catch (e) { ring.classList.remove('scanning'); this.renderIdle(); toast('Scan failed: ' + (e.error || e), 'alert'); return; }
    ring.classList.remove('scanning');
    this.drawSegments();
    this.renderFound(true);
  },
  async renderFound(run) {
    const box = $('#scanbox'); if (!box) return;
    const cards = [
      ['junk', 'Junk files', 'Temp files, caches, leftovers', 'broom', 'hue-violet'],
      ['duplicates', 'Duplicate files', 'Exact copies of the same file', 'copy', 'hue-pink'],
      ['large', 'Large files', 'Files bigger than 100 MB', 'big', 'hue-blue'],
      ['chat', 'Chat media', 'WhatsApp & Telegram downloads', 'chat', 'hue-teal'],
      ['photos', 'Similar & blurry photos', 'Look-alike shots, blurry & dark ones', 'sparkle', 'hue-cyan'],
    ];
    box.innerHTML = `<div class="card" style="text-align:center;margin-bottom:12px;padding:18px"><div style="color:var(--muted);font-size:13px">You can free up to</div><div id="total-free" style="font-size:38px;font-weight:800;letter-spacing:-.04em;background:var(--grad);-webkit-background-clip:text;color:transparent" data-v="0">…</div></div>
      <div class="found">${cards.map(([id, t, d, ic, h], i) => `<div class="fcard" data-go="${id}" style="animation-delay:${i * 70}ms"><div class="fi ${h}">${icon(ic)}</div><div class="ft"><b>${t}</b><span id="fd-${id}">${d}</span></div><div class="fs" id="fs-${id}"><span class="spin"></span></div></div>`).join('')}</div>
      <button class="btn ghost wide" id="rescan" style="margin-top:6px">${icon('radar')}Scan again</button>`;
    box.onclick = e => { const c = e.target.closest('[data-go]'); if (c) Router.go(c.dataset.go); };
    $('#rescan').onclick = () => { S.scan = null; invalidate(); this.smartScan(); };
    let total = 0;
    const set = (id, bytes, sub) => {
      const fs = $('#fs-' + id); if (!fs) return;
      fs.innerHTML = `${fmt(bytes)}<small>${sub || ''}</small>`; fs.animate([{ opacity: 0, transform: 'scale(.8)' }, { opacity: 1, transform: 'none' }], { duration: 400, easing: 'cubic-bezier(.34,1.56,.64,1)' });
      total += bytes; const t = $('#total-free'); if (t) countUp(t, total, v => fmt(v), 700);
    };
    const get = async (k, m, a, pr) => S.results[k] || (S.results[k] = await N.call(m, a || {}, pr));
    try { const j = await get('junk', 'junk'); const b = j.categories.reduce((s, c) => s + c.items.filter(i => i.rec).reduce((x, i) => x + i.s, 0), 0); set('junk', b, 'recommended'); setCount('junk', j.categories.reduce((s, c) => s + c.items.length, 0)); } catch (e) { set('junk', 0); }
    try { const l = await get('large100', 'large', { min: 100e6 }); set('large', 0, `${l.count} files · ${fmt(l.bytes)}`); $('#fs-large').innerHTML = `${l.count}<small>files · ${fmt(l.bytes)}</small>`; } catch (e) {}
    try { const c = await get('chat', 'chat'); const b = c.apps.reduce((s, a) => s + a.bytes, 0); $('#fs-chat').innerHTML = `${fmt(b)}<small>to review</small>`; } catch (e) {}
    try { const d = await get('dups', 'duplicates', {}, pr => { const fd = $('#fd-duplicates'); if (fd) fd.textContent = `${pr.stage || 'Comparing'} · ${Math.round((pr.pct || 0) * 100)}%`; }); set('duplicates', d.wasted, `${d.groups.length} groups`); $('#fd-duplicates').textContent = 'Exact copies of the same file'; setCount('duplicates', d.groups.length); } catch (e) {}
    try { const ph = await get('photos', 'photos', {}, pr => { const fd = $('#fd-photos'); if (fd) fd.textContent = `Looking at photos · ${pr.done || 0}/${pr.total || '…'}`; });
      set('photos', ph.similar.bytes, `${ph.similar.groups.length} similar groups`); $('#fd-photos').textContent = `${ph.blurry.items.length} blurry · ${ph.dark.items.length} dark · ${ph.screenshots.items.length} screenshots`; } catch (e) {}
  },
};

// ======================================================================== PAGE: junk
PAGES.junk = {
  title: 'Junk files',
  async render(el, p, entry) {
    await ensureIndex(el);
    el.innerHTML = skeleton(6);
    const data = S.results.junk || (S.results.junk = await N.call('junk'));
    const cats = data.categories.filter(c => c.items.length);
    const total = cats.reduce((s, c) => s + c.bytes, 0);
    const lookup = new Map(); cats.forEach(c => c.items.forEach(i => lookup.set(i.p, i)));
    cats.forEach(c => c.items.forEach(i => { if (i.rec) Sel.set(i.p, i, true); }));
    const HUE = { temp: 'hue-violet', thumbs: 'hue-blue', apks: 'hue-green', residual: 'hue-red', empty: 'hue-amber', trashed: 'hue-pink', olddl: 'hue-cyan' };
    const ICN = { temp: 'file', thumbs: 'image', apks: 'apk', residual: 'archive', empty: 'folder', trashed: 'trash', olddl: 'clock' };
    setTitle(entry, 'Junk files', `${fmt(total)} found`);
    if (!cats.length) { el.innerHTML = emptyHtml('broom', 'Nothing to clean', 'Your phone has no junk files right now.'); return; }
    el.innerHTML = `<div class="banner"><div class="bi">${icon('shield')}</div><div class="t"><b>Recommended items are pre-selected</b>Tap a category to see what's inside.</div></div>` +
      cats.map((c, i) => `<div class="jcat" data-cat="${c.id}" style="animation-delay:${i * 50}ms"><div class="jhead"><div class="cbhit" data-catcb>${cbHtml(false)}</div><div class="fi ${HUE[c.id] || ''}">${icon(ICN[c.id] || 'file')}</div>
        <div class="ft"><b>${esc(c.title)}</b><span>${c.items.length} items · ${esc(c.desc)}</span></div><div class="fs">${fmt(c.bytes)}</div><span class="chev">${icon('chev')}</span></div><div class="jbody list"></div></div>`).join('');
    const catState = () => cats.forEach(c => {
      const n = c.items.filter(i => Sel.has(i.p)).length, cb = $(`[data-cat="${c.id}"] [data-catcb] .cb`, el);
      if (cb) cb.className = 'cb' + (n === c.items.length ? ' on' : n ? ' part' : '');
    });
    el.addEventListener('click', e => {
      const ccb = e.target.closest('[data-catcb]');
      const head = e.target.closest('.jhead');
      if (ccb) { const c = cats.find(x => x.id === ccb.closest('.jcat').dataset.cat); const all = c.items.every(i => Sel.has(i.p)); c.items.forEach(i => Sel.set(i.p, i, !all)); Sel.changed(); refreshSelVisuals(); return; }
      if (head) {
        const jc = head.closest('.jcat'); jc.classList.toggle('open');
        const body = $('.jbody', jc); if (!body.dataset.done) { body.dataset.done = 1; const c = cats.find(x => x.id === jc.dataset.cat); chunked(body, c.items, (it, k) => fileRow(it, { i: k, showWhy: true })); }
      }
    });
    wireSelectable(el, p => lookup.get(p), { viewerList: () => [...lookup.values()] });
    if (Router.cur() === entry) Sel.ctx = { label: 'Clean', icon: 'broom', onChange: catState, all: selectAllOf(() => [...lookup.values()]),
      run: items => deleteFlow(items, { label: 'item', onDone: () => { S.results.junk = null; entry.refresh(); } }) };
    Sel.changed(); catState();
  },
};

function skeleton(n, h = 64) { return Array.from({ length: n }, (_, i) => `<div class="skel" style="height:${h}px;margin-bottom:8px;animation-delay:${i * 70}ms"></div>`).join(''); }
function emptyHtml(ic, t, d) { return `<div class="empty"><div class="big">${icon(ic)}</div><b>${esc(t)}</b>${esc(d)}</div>`; }

// ======================================================================== PAGE: large files
PAGES.large = {
  title: 'Large files',
  state: { type: 'all', min: 50e6, sort: 'size' },
  async render(el, p, entry) {
    await ensureIndex(el);
    const st = this.state;
    entry.actions = [{ icon: 'sort', run: async () => { const v = await menuSheet('Sort by', [{ id: 'size', label: 'Size (largest first)' }, { id: 'new', label: 'Newest first' }, { id: 'old', label: 'Oldest first' }, { id: 'name', label: 'Name' }], st.sort); if (v) { st.sort = v; entry.refresh(); } } }];
    const types = [['all', 'All'], ['video', 'Videos'], ['image', 'Photos'], ['audio', 'Audio'], ['doc', 'Documents'], ['archive', 'Archives'], ['apk', 'APKs'], ['other', 'Other']];
    const mins = [[10e6, '10 MB+'], [50e6, '50 MB+'], [100e6, '100 MB+'], [500e6, '500 MB+'], [1e9, '1 GB+']];
    el.innerHTML = `<div class="chips" id="types">${types.map(([k, l]) => `<button class="chip ${st.type === k ? 'on' : ''}" data-k="${k}">${l}</button>`).join('')}</div>
      <div class="chips" id="mins">${mins.map(([k, l]) => `<button class="chip ${st.min === k ? 'on' : ''}" data-k="${k}">${l}</button>`).join('')}</div><div class="list" id="ll">${skeleton(8)}</div>`;
    $('#types', el).onclick = e => { const b = e.target.closest('[data-k]'); if (b) { st.type = b.dataset.k; entry.refresh(); } };
    $('#mins', el).onclick = e => { const b = e.target.closest('[data-k]'); if (b) { st.min = +b.dataset.k; entry.refresh(); } };
    const res = await N.call('large', { min: st.min, type: st.type });
    let items = res.items;
    if (st.sort === 'new') items.sort((a, b) => b.m - a.m); else if (st.sort === 'old') items.sort((a, b) => a.m - b.m); else if (st.sort === 'name') items.sort((a, b) => a.n.localeCompare(b.n));
    setTitle(entry, 'Large files', `${res.count} files · ${fmt(res.bytes)}`);
    const ll = $('#ll', el); ll.innerHTML = '';
    if (!items.length) { ll.innerHTML = emptyHtml('big', 'No large files', 'Nothing matches this filter.'); return; }
    const max = Math.max(...items.map(i => i.s)); const map = new Map(items.map(i => [i.p, i]));
    chunked(ll, items, (it, i) => fileRow(it, { max, i }));
    wireSelectable(ll, p => map.get(p), { viewerList: () => items });
    if (Router.cur() === entry) Sel.ctx = { label: 'Delete', all: selectAllOf(() => items), run: sel => deleteFlow(sel, { label: 'file', onDone: () => entry.refresh() }) };
  },
};

// ======================================================================== PAGE: duplicates
PAGES.duplicates = {
  title: 'Duplicates',
  async render(el, p, entry) {
    await ensureIndex(el);
    const d = S.results.dups || (S.results.dups = await withProgress(el, 'Finding duplicates', 'duplicates', {}));
    setTitle(entry, 'Duplicates', `${d.groups.length} groups · ${fmt(d.wasted)} wasted`);
    if (!d.groups.length) { el.innerHTML = emptyHtml('copy', 'No duplicates', 'Every file on your phone is unique.'); return; }
    const all = []; d.groups.forEach(g => g.items.forEach(i => { all.push(i); if (i.rec) Sel.set(i.p, i, true); }));
    const map = new Map(all.map(i => [i.p, i]));
    el.innerHTML = `<div class="banner"><div class="bi">${icon('sparkle')}</div><div class="t"><b>One copy of each file is kept</b>Purgo keeps the original (camera folder first) and selects the extra copies.</div></div><div id="groups"></div>`;
    chunked($('#groups', el), d.groups, (g, gi) => `<div class="group-card"><div class="group-head">${icon(TYPE_ICON[g.t] || 'file')}<b>${g.count} copies</b><span>${fmt(g.size)} each</span><span class="sp"></span><span style="color:#c9b8ff">${fmt(g.size * (g.count - 1))} extra</span></div>
      <div class="card" style="padding:4px"><div class="list">${g.items.map((it, i) => fileRow(it, { i, sub: x => `${esc(folderOf(x.p))}` })).join('')}</div></div></div>`, 20);
    wireSelectable(el, p => map.get(p), { viewerList: () => all });
    if (Router.cur() === entry) Sel.ctx = { label: 'Delete copies', all: selectAllOf(() => all.filter(i => !i.keep)),
      run: sel => {
        const lone = d.groups.filter(g => g.items.every(i => Sel.has(i.p)));
        const go = () => deleteFlow(sel, { label: 'copy', onDone: () => { S.results.dups = null; entry.refresh(); } });
        if (lone.length) confirmSheet({ title: 'Every copy selected', text: `In ${lone.length} group${lone.length > 1 ? 's' : ''} you selected <b>all copies</b>, so that file would disappear completely. Continue?`, ok: 'Continue', iconName: 'alert' }).then(r => r && go());
        else go();
      } };
    Sel.changed();
  },
};

// ======================================================================== PAGE: smart photos
PAGES.photos = {
  title: 'Smart photos',
  tab: 'similar',
  async render(el, p, entry) {
    await ensureIndex(el);
    let data = S.results.photos;
    if (!data) {
      el.innerHTML = `<div style="padding-top:5vh"><div class="pring" style="width:200px;height:200px;margin:0 auto;border-radius:50%;overflow:hidden;position:relative">
        <img id="ph-cur" style="position:absolute;inset:18px;width:164px;height:164px;object-fit:cover;border-radius:50%;opacity:.9;transition:opacity .2s">
        <svg viewBox="0 0 150 150" style="position:absolute;inset:0"><circle class="bg" cx="75" cy="75" r="68"/><circle class="fg" cx="75" cy="75" r="68" stroke-dasharray="428" stroke-dashoffset="428" style="stroke-width:7"/></svg></div>
        <div class="prog"><div class="ptitle">Looking at your photos</div><div class="psub" id="ph-sub">Finding look-alike shots, blurry and dark photos</div></div>
        <p style="text-align:center;color:var(--faint);font-size:12.5px;margin:24px 20px">Everything is analysed on your phone. The first scan takes a little while; next time it's much faster.</p></div>`;
      data = S.results.photos = await N.call('photos', {}, pr => {
        const fg = $('.fg', el); if (fg) fg.style.strokeDashoffset = 428 * (1 - (pr.pct || 0));
        const sub = $('#ph-sub', el); if (sub) sub.textContent = `${pr.done || 0} of ${pr.total || '…'} photos`;
        const img = $('#ph-cur', el); if (img && pr.current && Math.random() < .35) img.src = N.thumb(pr.current, 256);
      });
    }
    const tabs = [['similar', 'Similar', data.similar.groups.length], ['blurry', 'Blurry', data.blurry.items.length], ['dark', 'Dark', data.dark.items.length], ['screenshots', 'Screens', data.screenshots.items.length]];
    el.innerHTML = `<div class="tabs" id="tabs"><span class="pill"></span>${tabs.map(([k, l, n]) => `<button data-k="${k}" class="${this.tab === k ? 'on' : ''}">${l}<small>${n}</small></button>`).join('')}</div><div id="ptab"></div>`;
    const movePill = () => { const on = $('#tabs button.on', el), pill = $('#tabs .pill', el); if (on) { pill.style.left = on.offsetLeft + 'px'; pill.style.width = on.offsetWidth + 'px'; } };
    requestAnimationFrame(movePill);
    $('#tabs', el).onclick = e => { const b = e.target.closest('[data-k]'); if (!b) return; this.tab = b.dataset.k; $$('#tabs button', el).forEach(x => x.classList.toggle('on', x === b)); movePill(); Sel.clear(true); this.renderTab(el, data, entry); };
    this.renderTab(el, data, entry);
  },
  renderTab(el, data, entry) {
    const prevBox = $('#ptab', el); const box = prevBox.cloneNode(false); prevBox.replaceWith(box); const t = this.tab;
    let all = [], html = '';
    if (t === 'similar') {
      const groups = data.similar.groups;
      setTitle(entry, 'Smart photos', `${groups.length} groups of similar shots`);
      if (!groups.length) { box.innerHTML = emptyHtml('sparkle', 'No similar shots', 'No bursts or look-alike photos found.'); }
      else {
        groups.forEach(g => g.items.forEach(i => { all.push(i); if (i.rec) Sel.set(i.p, i, true); }));
        box.innerHTML = `<div class="banner"><div class="bi">${icon('sparkle')}</div><div class="t"><b>The sharpest shot is kept</b>The others in each group are selected for you.</div></div><div id="gl"></div>`;
        chunked($('#gl', box), groups, (g, gi) => `<div class="group-card"><div class="group-head"><b>${g.count} similar photos</b><span>${date(g.items[0].m)}</span></div><div class="grid">${g.items.map((it, i) => gridItem(it, i)).join('')}</div></div>`, 12);
      }
    } else {
      const d = data[t]; all = d.items;
      const info = { blurry: ['Blurry photos', 'Photos that look out of focus or shaken.', 'blur'], dark: ['Very dark photos', 'Probably taken by accident in a pocket or a dark room.', 'moon'], screenshots: ['Screenshots', 'Older than 30 days are pre-selected.', 'phone'] }[t];
      setTitle(entry, 'Smart photos', `${all.length} ${info[0].toLowerCase()} · ${fmt(d.bytes)}`);
      all.forEach(i => { if (i.rec) Sel.set(i.p, i, true); });
      box.innerHTML = all.length ? `<div class="banner"><div class="bi">${icon(info[2])}</div><div class="t"><b>${info[0]}</b>${info[1]}</div></div><div class="grid" id="gg"></div>` : emptyHtml(info[2], 'Nothing here', 'No ' + info[0].toLowerCase() + ' found.');
      if (all.length) chunked($('#gg', box), all, gridItem, 60);
    }
    const map = new Map(all.map(i => [i.p, i]));
    wireSelectable(box, p => map.get(p), { viewerList: () => all });
    if (Router.cur() === entry) Sel.ctx = { label: 'Delete', all: selectAllOf(() => all), run: sel => deleteFlow(sel, { label: 'photo', onDone: () => { S.results.photos = null; entry.refresh(); } }) };
    Sel.changed();
  },
};

// ======================================================================== PAGE: chat media
PAGES.chat = {
  title: 'WhatsApp & Telegram',
  async render(el, p, entry) {
    await ensureIndex(el);
    el.innerHTML = skeleton(5, 90);
    const data = S.results.chat || (S.results.chat = await N.call('chat'));
    const total = data.apps.reduce((s, a) => s + a.bytes, 0);
    setTitle(entry, 'Chat media', `${fmt(total)} of photos, videos & files`);
    if (!data.apps.length) { el.innerHTML = emptyHtml('chat', 'No chat media found', 'WhatsApp and Telegram media will show up here.'); return; }
    const KI = { image: ['image', 'hue-blue'], video: ['video', 'hue-pink'], audio: ['audio', 'hue-amber'], doc: ['doc', 'hue-cyan'], other: ['file', 'hue-violet'] };
    el.innerHTML = data.apps.map((a, ai) => `<div class="card" style="margin-bottom:14px;padding:6px;animation:fadeUp .5s var(--ease) ${ai * 80}ms both">
      <div style="display:flex;align-items:center;gap:12px;padding:12px 10px 10px"><div class="app-ico" style="background:${a.id === 'telegram' ? 'linear-gradient(135deg,#37aee2,#1e96c8)' : 'linear-gradient(135deg,#25d366,#128c7e)'}">${icon(a.id === 'telegram' ? 'tg' : 'wa')}</div>
      <div style="flex:1"><b style="font-size:16px">${esc(a.name)}</b><div style="color:var(--muted);font-size:12.5px">${a.count.toLocaleString()} files</div></div><b style="font-size:17px">${fmt(a.bytes)}</b></div>
      <div class="bar" style="margin:0 10px 10px;display:flex;gap:2px;background:none">${a.cats.map(c => `<i style="width:${c.bytes / a.bytes * 100}%;background:var(--grad);opacity:${.35 + .65 * c.bytes / a.cats[0].bytes};border-radius:3px"></i>`).join('')}</div>
      ${a.cats.map(c => `<div class="row" data-dir="${esc(c.path)}" data-title="${esc(a.name + ' ' + c.title)}" data-kind="${c.kind}"><div class="th ${KI[c.kind][1]}">${icon(KI[c.kind][0])}</div><div class="tx"><b>${esc(c.title)}</b><span>${c.count.toLocaleString()} files</span></div><div class="sz">${fmt(c.bytes)}</div>${icon('right')}</div>`).join('')}</div>`).join('');
    el.onclick = e => { const r = e.target.closest('[data-dir]'); if (r) Router.go('chatcat', { dir: r.dataset.dir, title: r.dataset.title, kind: r.dataset.kind }, { push: true }); };
  },
};
PAGES.chatcat = {
  title: '',
  filter: 'all',
  async render(el, p, entry) {
    setTitle(entry, p.title);
    el.innerHTML = skeleton(8);
    const res = await N.call('chatFiles', { dir: p.dir });
    const filters = [['all', 'All'], ['received', 'Received'], ['sent', 'Sent'], ['old', 'Older than 6 months']];
    const apply = () => res.items.filter(i => this.filter === 'all' || (this.filter === 'sent' ? i.sent : this.filter === 'received' ? !i.sent : i.old));
    const draw = () => {
      const items = apply(); const bytes = items.reduce((s, i) => s + i.s, 0);
      setTitle(entry, p.title, `${items.length} files · ${fmt(bytes)}`);
      const grid = p.kind === 'image' || p.kind === 'video';
      el.innerHTML = `<div class="chips">${filters.map(([k, l]) => `<button class="chip ${this.filter === k ? 'on' : ''}" data-f="${k}">${l}</button>`).join('')}</div><div id="cc" class="${grid ? 'grid' : 'list'}"></div>`;
      $$('[data-f]', el).forEach(b => b.onclick = () => { this.filter = b.dataset.f; Sel.clear(); draw(); });
      if (!items.length) { $('#cc', el).outerHTML = emptyHtml('chat', 'Nothing here', 'No files match this filter.'); return; }
      const max = Math.max(...items.map(i => i.s)); const map = new Map(items.map(i => [i.p, i]));
      chunked($('#cc', el), items, grid ? gridItem : (it, i) => fileRow(it, { max, i, sub: x => `${x.sent ? 'Sent' : 'Received'} · ${ago(x.m)}` }), grid ? 60 : 50);
      wireSelectable($('#cc', el), q => map.get(q), { viewerList: () => items });
      if (Router.cur() === entry) Sel.ctx = { label: 'Delete', all: selectAllOf(() => items), run: sel => deleteFlow(sel, { label: 'file', onDone: () => { S.results.chat = null; entry.refresh(); } }) };
    };
    draw();
  },
};

// ======================================================================== PAGE: apps
PAGES.apps = {
  title: 'Apps',
  sort: 'size', unused: false,
  async render(el, p, entry) {
    el.innerHTML = skeleton(8);
    entry.actions = [{ icon: 'sort', run: async () => { const v = await menuSheet('Sort apps by', [{ id: 'size', label: 'Size' }, { id: 'used', label: 'Least recently used' }, { id: 'cache', label: 'Cache size' }, { id: 'name', label: 'Name' }, { id: 'installed', label: 'Recently installed' }], this.sort); if (v) { this.sort = v; entry.refresh(); } } }];
    const data = S.results.apps || (S.results.apps = await N.call('apps'));
    let apps = data.apps.slice();
    const unusedCount = apps.filter(a => a.lastUsed && Date.now() - a.lastUsed > 30 * DAY).length;
    if (this.unused) apps = apps.filter(a => a.lastUsed && Date.now() - a.lastUsed > 30 * DAY);
    const sorters = { size: (a, b) => (b.total || 0) - (a.total || 0), used: (a, b) => (a.lastUsed || 0) - (b.lastUsed || 0), cache: (a, b) => (b.cache || 0) - (a.cache || 0), name: (a, b) => a.name.localeCompare(b.name), installed: (a, b) => (b.installed || 0) - (a.installed || 0) };
    apps.sort(sorters[this.sort]);
    setTitle(entry, 'Apps', `${data.apps.length} apps${data.usage ? ' · ' + fmt(data.totalApp + data.totalData) : ''}`);
    setCount('apps', data.apps.length);
    const max = Math.max(1, ...apps.map(a => a.total || 0));
    el.innerHTML = (data.usage ? '' : `<div class="banner warn"><div class="bi">${icon('key')}</div><div class="t"><b>See app sizes and usage</b>Allow "Usage access" so Purgo can show how big each app is and when you last used it.</div><button class="btn sm" id="grant">Allow</button></div>`) +
      `<div class="chips"><button class="chip ${!this.unused ? 'on' : ''}" data-u="0">All apps</button><button class="chip ${this.unused ? 'on' : ''}" data-u="1">Not used in 30 days${unusedCount ? ' · ' + unusedCount : ''}</button></div><div class="list" id="al"></div>`;
    const g = $('#grant', el); if (g) g.onclick = usageHelp;
    $$('[data-u]', el).forEach(b => b.onclick = () => { this.unused = b.dataset.u === '1'; entry.refresh(); });
    const items = apps.map(a => Object.assign(a, { p: 'pkg:' + a.pkg, s: a.total || 0 }));
    const map = new Map(items.map(i => [i.p, i]));
    chunked($('#al', el), items, (a, i) => {
      const unused = a.lastUsed && Date.now() - a.lastUsed > 30 * DAY;
      const pct = a.total ? Math.max(2, Math.round(Math.sqrt(a.total / max) * 100)) : 0;
      return `<div class="row ${Sel.has(a.p) ? 'sel' : ''}" data-p="${esc(a.p)}" style="animation-delay:${Math.min(i, 14) * 25}ms"><div class="cbhit">${cbHtml(Sel.has(a.p))}</div>${appIcon(a)}
        <div class="tx"><b>${esc(a.name)}</b><span class="${unused ? 'unused' : ''}">${a.lastUsed ? 'Used ' + ago(a.lastUsed) : (data.usage ? 'Never used' : 'v' + esc(a.version || ''))}${a.cache ? ' · cache ' + fmt(a.cache) : ''}</span>${pct ? `<div class="szbar"><i style="width:${pct}%"></i></div>` : ''}</div>
        <div class="sz">${a.total ? fmt(a.total) : ''}</div></div>`;
    });
    const list = $('#al', el);
    list.addEventListener('click', e => {
      const r = e.target.closest('[data-p]'); if (!r) return;
      if (e.target.closest('.cbhit') || Sel.size) { const a = map.get(r.dataset.p); const on = Sel.toggle(a.p, a); r.classList.toggle('sel', on); $('.cb', r).classList.toggle('on', on); return; }
      appSheet(map.get(r.dataset.p), entry);
    });
    if (Router.cur() === entry) Sel.ctx = { label: 'Uninstall', icon: 'trash', countLabel: n => `${n} app${n > 1 ? 's' : ''}`, all: selectAllOf(() => items), run: sel => uninstallFlow(sel, entry) };
  },
};
function appIcon(a, cls = 'app-ico') {
  const src = N.icon(a.pkg);
  if (src) return `<div class="${cls}"><img src="${src}" loading="lazy"></div>`;
  const h = hash(a.pkg) % 360;
  return `<div class="${cls} letter" style="background:linear-gradient(135deg,hsl(${h} 75% 58%),hsl(${(h + 40) % 360} 70% 45%))">${esc(a.name[0] || '?')}</div>`;
}
function appSheet(a, entry) {
  const tot = Math.max(1, (a.app || 0) + (a.data || 0) + (a.cache || 0));
  const seg = (v, c) => `<i style="width:${v / tot * 100}%;background:${c};height:100%;display:block"></i>`;
  const s = sheet(`<div style="display:flex;gap:14px;align-items:center;margin-bottom:16px">${appIcon(a)}<div><h3 style="margin:0">${esc(a.name)}</h3><div style="color:var(--muted);font-size:12.5px">${esc(a.pkg)} · v${esc(a.version || '')}</div></div></div>
    ${a.total ? `<div class="bar" style="height:12px;display:flex">${seg(a.app, '#4f7cff')}${seg(a.data, '#b45cff')}${seg(a.cache, '#fbbf24')}</div>
    <div class="legend" style="grid-template-columns:1fr 1fr 1fr;margin-top:10px"><div><i style="background:#4f7cff"></i>App<b>${fmt(a.app)}</b></div><div><i style="background:#b45cff"></i>Data<b>${fmt(a.data)}</b></div><div><i style="background:#fbbf24"></i>Cache<b>${fmt(a.cache)}</b></div></div>` : ''}
    <div style="margin-top:14px;color:var(--text-2);font-size:13.5px;line-height:1.8">Installed ${date(a.installed)}<br>${a.lastUsed ? 'Last used ' + ago(a.lastUsed) : ''}</div>
    <div class="acts"><button class="btn" data-a="settings">${icon('zap')}Clear cache</button><button class="btn danger" data-a="un">${icon('trash')}Uninstall</button></div>`);
  s.el.onclick = e => { const b = e.target.closest('[data-a]'); if (!b) return; s.close(); if (b.dataset.a === 'settings') N.call('appSettings', { pkg: a.pkg }); else uninstallFlow([a], entry); };
}
function uninstallFlow(apps, entry) {
  const s = sheet(`<h3>Uninstalling ${apps.length} app${apps.length > 1 ? 's' : ''}</h3><p>Android asks you to confirm each one — just tap <b>OK</b> in every window.</p>
    <div class="uninstall-list">${apps.map(a => `<div class="uq wait" data-pkg="${esc(a.pkg)}">${appIcon(a)}<span class="n">${esc(a.name)}</span><span class="st"></span></div>`).join('')}</div>
    <div class="acts"><button class="btn block" data-x disabled>Working…</button></div>`, { locked: true });
  let ok = 0, freed = 0;
  const offStart = d => { const r = $(`[data-pkg="${CSS.escape(d.pkg)}"]`, s.el); if (r) { r.className = 'uq run'; r.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } };
  const offOne = d => { const r = $(`[data-pkg="${CSS.escape(d.pkg)}"]`, s.el); if (r) { r.className = 'uq ' + (d.ok ? 'ok' : 'fail'); $('.st', r).innerHTML = icon(d.ok ? 'check' : 'x'); } if (d.ok) { ok++; const a = apps.find(x => x.pkg === d.pkg); freed += a ? a.total || 0 : 0; } };
  const offDone = () => {
    handlers.length = 0;
    addFreed(freed); S.results.apps = null; invalidate();
    showDone(s, { title: ok === apps.length ? 'Apps removed' : `${ok} of ${apps.length} removed`, freed: freed || null, cap: 'freed', warn: ok < apps.length, text: ok < apps.length ? 'Some apps were kept — you can try again any time.' : 'Your phone has more room now.' });
    const cl = s.close; s.close = () => { cl(); entry.refresh(); refreshEnv(); };
  };
  const handlers = [['uninstallStart', offStart], ['uninstall', offOne], ['uninstallDone', offDone]];
  UH.set(handlers);
  N.call('uninstall', { pkgs: apps.map(a => a.pkg) });
}
const UH = { h: [], set(h) { this.h = h; } };
N.on('uninstallStart', d => UH.h.forEach(([n, f]) => n === 'uninstallStart' && f(d)));
N.on('uninstall', d => UH.h.forEach(([n, f]) => n === 'uninstall' && f(d)));
N.on('uninstallDone', d => UH.h.slice().forEach(([n, f]) => n === 'uninstallDone' && f(d)));

// ======================================================================== PAGE: cache
PAGES.cache = {
  title: 'App cache',
  async render(el, p, entry) {
    el.innerHTML = skeleton(6);
    const data = S.results.apps || (S.results.apps = await N.call('apps'));
    if (!data.usage) { el.innerHTML = `<div class="banner warn"><div class="bi">${icon('key')}</div><div class="t"><b>Usage access needed</b>Android only shows app cache sizes to apps you allow.</div></div><button class="btn primary wide" id="grant">${icon('key')}Allow usage access</button>`; $('#grant').onclick = usageHelp; return; }
    const apps = data.apps.filter(a => a.cache > 0).sort((a, b) => b.cache - a.cache);
    setTitle(entry, 'App cache', `${fmt(data.totalCache)} across ${apps.length} apps`);
    const max = Math.max(1, ...apps.map(a => a.cache));
    el.innerHTML = `<div class="card" style="text-align:center;padding:24px 16px 18px"><div style="color:var(--muted);font-size:13px">Cache used by your apps</div>
      <div id="cache-total" style="font-size:44px;font-weight:800;letter-spacing:-.04em;background:var(--grad);-webkit-background-clip:text;color:transparent;margin:6px 0 14px" data-v="0">0 B</div>
      ${S.env.canClearAllCache ? `<button class="btn primary wide shine" id="clearall">${icon('zap')}Clean all app caches</button><div style="color:var(--faint);font-size:12px;margin-top:10px;line-height:1.5">Android asks you to confirm. Clears the cache files apps keep on shared storage — apps rebuild them when needed.</div>` : `<div style="color:var(--muted);font-size:12.5px">Your Android version only lets you clear cache per app.</div>`}</div>
      <div class="sec">Biggest caches<span class="ln"></span></div><div class="list" id="cl"></div>
      <p style="color:var(--faint);font-size:12px;line-height:1.5;margin:14px 6px">Tap an app to open its Android settings page, then tap <b>Storage → Clear cache</b>. Android doesn't allow any app to clear another app's internal cache by itself.</p>`;
    countUp($('#cache-total', el), data.totalCache, v => fmt(v), 1200);
    const ca = $('#clearall', el); if (ca) ca.onclick = () => clearAllCaches(entry);
    $('#cl', el).innerHTML = apps.slice(0, 80).map((a, i) => `<div class="row" data-pkg="${esc(a.pkg)}" style="animation-delay:${Math.min(i, 14) * 25}ms">${appIcon(a)}<div class="tx"><b>${esc(a.name)}</b><div class="szbar"><i style="width:${Math.max(3, a.cache / max * 100)}%"></i></div></div><div class="sz">${fmt(a.cache)}</div><button class="btn sm" style="margin-left:4px">Clear</button></div>`).join('');
    $('#cl', el).onclick = e => { const r = e.target.closest('[data-pkg]'); if (r) N.call('appSettings', { pkg: r.dataset.pkg }); };
  },
};
function clearAllCaches(entry) {
  const s = sheet(progressHtml('Cleaning app caches', 'Confirm in the Android window'), { locked: true });
  let f = 0; const t = setInterval(() => { f = Math.min(.92, f + .04); setProgress(s.el, f); }, 140);
  CC.fn = d => {
    clearInterval(t); setProgress(s.el, 1);
    if (!d.ok) { s.locked = false; s.set(`<h3>Nothing was cleared</h3><p>The request was cancelled.</p><div class="acts"><button class="btn block" data-x>Close</button></div>`); $('[data-x]', s.el).onclick = () => s.close(); return; }
    addFreed(d.freed > 0 ? d.freed : 0); S.results.apps = null;
    showDone(s, { title: 'Caches cleaned', freed: d.freed > 0 ? d.freed : null, cap: 'freed', text: 'Apps will rebuild what they need the next time you open them.' });
    const cl = s.close; s.close = () => { cl(); entry.refresh(); refreshEnv(); };
  };
  N.call('clearAllCache').then(r => { if (!r.supported) { clearInterval(t); s.locked = false; s.set(`<h3>Not supported</h3><p>This needs Android 11 or newer.</p><div class="acts"><button class="btn block" data-x>Close</button></div>`); $('[data-x]', s.el).onclick = () => s.close(); } });
}
const CC = { fn: null };
N.on('cacheCleared', d => CC.fn && CC.fn(d));

// ======================================================================== PAGE: storage explorer
PAGES.storage = {
  title: 'Storage explorer',
  async render(el, p, entry) {
    await ensureIndex(el);
    el.innerHTML = skeleton(8);
    const res = await N.call('browse', { path: p.path || ROOT() });
    S.root = res.root;
    const rel = res.path.slice(res.root.length).split('/').filter(Boolean);
    setTitle(entry, rel.length ? rel[rel.length - 1] : 'Internal storage', `${fmt(res.bytes)} · ${res.items.length} items`);
    const crumbs = [['Storage', res.root]].concat(rel.map((r, i) => [r, res.root + '/' + rel.slice(0, i + 1).join('/')]));
    el.innerHTML = `<div class="crumbs">${crumbs.map(([n, pth], i) => (i ? icon('right') : '') + `<button data-path="${esc(pth)}">${esc(n)}</button>`).join('')}</div><div class="list" id="sl"></div>`;
    $('.crumbs', el).onclick = e => {
      const b = e.target.closest('[data-path]'); if (!b || b.dataset.path === res.path) return;
      const idx = Router.stack.findIndex(s => s.name === 'storage' && (s.params.path || res.root) === b.dataset.path);
      if (idx >= 0) Router.popTo(idx); else Router.go('storage', { path: b.dataset.path }, { push: true });
    };
    requestAnimationFrame(() => { const c = $('.crumbs', el); c.scrollLeft = c.scrollWidth; });
    if (!res.items.length) { $('#sl', el).outerHTML = emptyHtml('folder', 'Empty folder', 'There is nothing inside.'); return; }
    const max = Math.max(1, ...res.items.map(i => i.s)); const map = new Map(res.items.map(i => [i.p, i]));
    chunked($('#sl', el), res.items, (it, i) => fileRow(it, { max, i, sub: x => x.t === 'folder' ? `${(x.c || 0).toLocaleString()} files` : `${ago(x.m)}` }));
    const list = $('#sl', el);
    wireSelectable(list, q => map.get(q), { viewerList: () => res.items });
    list.addEventListener('click', e => {
      const r = e.target.closest('[data-p]'); if (!r || e.target.closest('.cbhit') || Sel.size) return;
      const it = map.get(r.dataset.p); if (it && it.t === 'folder' && !it.locked) Router.go('storage', { path: it.p }, { push: true });
    }, true);
    if (Router.cur() === entry) Sel.ctx = { label: 'Delete', all: selectAllOf(() => res.items), run: sel => deleteFlow(sel, { label: 'item', onDone: () => { S.results = {}; entry.refresh(); } }) };
  },
};

// ======================================================================== PAGE: bin
PAGES.bin = {
  title: 'Purgo Bin',
  async render(el, p, entry) {
    el.innerHTML = skeleton(6);
    const res = await N.call('bin');
    setTitle(entry, 'Purgo Bin', `${res.items.length} items · ${fmt(res.bytes)}`);
    setCount('bin', res.items.length);
    entry.actions = res.items.length ? [{ icon: 'trash', run: async () => {
      if (!await confirmSheet({ title: 'Empty Purgo Bin?', text: `${res.items.length} items (${fmt(res.bytes)}) will be deleted forever.`, ok: 'Empty bin' })) return;
      const s = sheet(progressHtml('Emptying bin', ''), { locked: true }); setProgress(s.el, .6);
      const r = await N.call('emptyBin', {}); setProgress(s.el, 1); await sleep(300);
      addFreed(r.bytes); showDone(s, { title: 'Bin emptied', freed: r.bytes, cap: 'freed', text: 'The space is free again.' }); entry.refresh(); refreshEnv();
    } }] : [];
    renderTopbar();
    if (!res.items.length) { el.innerHTML = emptyHtml('bin', 'Purgo Bin is empty', 'Things you delete with Purgo wait here for 30 days, so you can change your mind.'); return; }
    const items = res.items; const map = new Map(items.map(i => [i.p, i]));
    el.innerHTML = `<div class="banner"><div class="bi">${icon('restore')}</div><div class="t"><b>Kept for 30 days</b>Select items to restore them, or empty the bin to free the space.</div></div><div class="list" id="bl"></div>`;
    chunked($('#bl', el), items, (it, i) => fileRow(it, { i, sub: x => `From ${esc(folderOf(x.orig))} · ${Math.max(0, Math.ceil((x.expires - Date.now()) / DAY))} days left` }));
    wireSelectable($('#bl', el), q => map.get(q), { viewerList: () => items });
    if (Router.cur() === entry) Sel.ctx = { label: 'Restore', icon: 'restore', danger: false, all: selectAllOf(() => items),
      alt: { icon: 'trash', run: async sel => {
        if (!await confirmSheet({ title: `Delete ${sel.length} forever?`, text: 'This can\'t be undone.', ok: 'Delete forever' })) return;
        const r = await N.call('emptyBin', { ids: sel.map(i => i.id) }); addFreed(r.bytes); toast(`${fmt(r.bytes)} freed`); entry.refresh(); refreshEnv();
      } },
      run: async sel => {
        const s = sheet(progressHtml('Restoring', ''), { locked: true }); setProgress(s.el, .5);
        const r = await N.call('restore', { ids: sel.map(i => i.id) }); setProgress(s.el, 1); await sleep(250);
        invalidate(); S.scan = S.scan; showDone(s, { title: `${r.ok} item${r.ok === 1 ? '' : 's'} restored`, text: 'They\'re back where they were.', warn: !!r.failed });
        entry.refresh();
      } };
  },
};

// ======================================================================== PAGE: settings
PAGES.settings = {
  title: 'Settings',
  async render(el, p, entry) {
    await refreshEnv();
    const e = S.env;
    el.innerHTML = `<div class="sec" style="margin-top:6px">Deleting<span class="ln"></span></div>
      <div class="card" style="padding:4px 14px"><div class="optrow"><div class="t"><b>Use Purgo Bin</b><span>Keep deleted items for 30 days so you can restore them</span></div><div class="switch ${e.bin ? 'on' : ''}" id="sw-bin"></div></div></div>
      <div class="sec">Permissions<span class="ln"></span></div>
      <div class="perm ${e.allFiles ? 'done' : ''}"><div class="pi hue-violet">${icon('folder')}</div><div class="t"><b>All files access</b><span>Needed to find and delete files</span></div>${e.allFiles ? `<span class="st">${icon('check')}</span>` : `<button class="btn sm primary" data-req="requestAllFiles">Allow</button>`}</div>
      <div class="perm ${e.usage ? 'done' : ''}"><div class="pi hue-amber">${icon('chart')}</div><div class="t"><b>Usage access</b><span>Shows app sizes, cache and when you last used each app</span></div>${e.usage ? `<span class="st">${icon('check')}</span>` : `<button class="btn sm primary" data-req="requestUsage">Allow</button>`}</div>
      <div class="sec">About<span class="ln"></span></div>
      <div class="card" style="padding:4px 14px">
        <div class="optrow"><div class="t"><b>Purgo Uninstaller &amp; Cleaner</b><span>Version ${esc(e.version)} · ${esc(e.device)}</span></div></div>
        <div class="optrow"><div class="t"><b>Privacy</b><span>Purgo works entirely offline. Nothing about your files or apps ever leaves your phone.</span></div></div>
        <div class="optrow" id="gh" style="cursor:pointer"><div class="t"><b>Open source</b><span>github.com/laslobogdan-create/purgo · GPL-3.0</span></div>${icon('github')}</div>
        <div class="optrow"><div class="t"><b>Freed so far</b><span>${fmt(S.freed)}</span></div></div>
      </div>`;
    $('#sw-bin', el).onclick = ev => { const on = !ev.currentTarget.classList.contains('on'); ev.currentTarget.classList.toggle('on', on); S.env.bin = on; N.call('setSetting', { key: 'bin', value: on }); };
    $$('[data-req]', el).forEach(b => b.onclick = () => b.dataset.req === 'requestUsage' ? usageHelp() : N.call(b.dataset.req));
    $('#gh', el).onclick = () => N.call('openUrl', { url: 'https://github.com/laslobogdan-create/purgo' });
  },
};

// ======================================================================== usage access helper
/** Android 13+ blocks "Usage access" for apps installed from an APK until the user allows restricted settings. */
function usageHelp() {
  if (!S.env || S.env.sdk < 33) { N.call('requestUsage'); return; }
  const step = (n, t, d) => `<div class="optrow" style="align-items:flex-start"><div class="pi hue-violet" style="width:30px;height:30px;border-radius:10px;display:grid;place-items:center;flex:none;font-weight:700">${n}</div><div class="t"><b>${t}</b><span>${d}</span></div></div>`;
  const s = sheet(`<div class="si hue-amber">${icon('key')}</div><h3>Allow usage access</h3>
    <p>Android protects this setting for apps installed outside the Play Store. It takes 3 quick steps — you only do it once.</p>
    ${step(1, 'Try to turn it on', 'Tap <b>Open Usage access</b>, find Purgo and tap the switch. If Android says <b>“Restricted setting”</b>, tap OK and come back.')}
    ${step(2, 'Allow restricted settings', 'Tap <b>Open Purgo app info</b>, then the <b>⋮</b> menu (top-right) → <b>Allow restricted settings</b> and confirm with your PIN or fingerprint.')}
    ${step(3, 'Turn it on', 'Open Usage access again and switch Purgo on.')}
    <div class="acts col"><button class="btn" data-u="info">${icon('info')}Open Purgo app info</button><button class="btn primary" data-u="usage">${icon('chart')}Open Usage access</button></div>`);
  s.el.addEventListener('click', e => {
    const b = e.target.closest('[data-u]'); if (!b) return;
    if (b.dataset.u === 'usage') N.call('requestUsage'); else N.call('appSettings', { pkg: 'ro.purgo.android' });
  });
  const off = () => { if (S.env.usage) { s.close(); toast('Usage access is on'); } };
  N.on('resume', () => setTimeout(off, 400));
}

// ======================================================================== onboarding
function onboarding() {
  const o = document.createElement('div'); o.className = 'onb'; o.id = 'onb';
  const draw = () => {
    const e = S.env;
    o.innerHTML = `<div class="hero"><div class="biglogo">${icon('logo')}</div><h2>Welcome to Purgo</h2><p>Find junk, duplicates and big files, clean chat media and remove apps you don't use — all on your phone, nothing uploaded.</p></div>
      <div class="perm ${e.allFiles ? 'done' : ''}" style="animation-delay:.1s"><div class="pi hue-violet">${icon('folder')}</div><div class="t"><b>All files access</b><span>Required — lets Purgo find and remove files. Turn on “Allow access to manage all files”.</span></div>${e.allFiles ? `<span class="st">${icon('check')}</span>` : ''}</div>
      <div class="perm ${e.usage ? 'done' : ''}" style="animation-delay:.2s"><div class="pi hue-amber">${icon('chart')}</div><div class="t"><b>Usage access</b><span>Optional — shows app sizes, cache and unused apps.</span></div>${e.usage ? `<span class="st">${icon('check')}</span>` : ''}</div>
      <button class="btn primary wide shine" id="onb-go" style="margin-top:12px">${e.allFiles ? (e.usage ? 'Get started' : 'Allow usage access') : 'Allow file access'}</button>
      ${e.allFiles && !e.usage ? '<button class="btn ghost wide" id="onb-skip" style="margin-top:6px">Skip for now</button>' : ''}`;
    $('#onb-go', o).onclick = () => { if (!S.env.allFiles) N.call('requestAllFiles'); else if (!S.env.usage) usageHelp(); else finish(); };
    const sk = $('#onb-skip', o); if (sk) sk.onclick = finish;
  };
  const finish = () => { localStorage.setItem('purgo.onb', '1'); o.style.transition = 'opacity .4s, transform .4s'; o.style.opacity = 0; o.style.transform = 'scale(1.04)'; setTimeout(() => o.remove(), 400); Router.go('home'); };
  draw(); document.body.appendChild(o);
  N.on('resume', async () => { if (!$('#onb')) return; await refreshEnv(); draw(); if (S.env.allFiles && S.env.usage) finish(); });
}

// ======================================================================== boot
N.on('resume', async () => {
  const before = S.env ? S.env.usage : null;
  await refreshEnv();
  if (S.env && before === false && S.env.usage) { S.results.apps = null; const c = Router.cur(); if (c.name === 'apps' || c.name === 'cache') c.refresh(); }
});
(async function boot() {
  buildNav();
  $('#logo').innerHTML = icon('logo');
  await refreshEnv();
  S.root = Demo.ROOT;
  if (!S.env.allFiles || !localStorage.getItem('purgo.onb')) { if (!S.env.allFiles || !S.env.usage) onboarding(); else { localStorage.setItem('purgo.onb', '1'); Router.go('home'); } }
  else Router.go('home');
  if (S.env.allFiles && !Router.cur().name) Router.go('home');
  N.call('bin').then(r => setCount('bin', r.items.length)).catch(() => {});
})();
