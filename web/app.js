// Kumanda UI: a dependency-free single page app with no build step.
const app = document.getElementById('app');

// ───────── helpers ─────────
function h(tag, attrs, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'html') e.innerHTML = v;
    else if (k === 'dataset') Object.assign(e.dataset, v);
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k in e) e[k] = v;
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat(Infinity)) if (c != null && c !== false) e.append(c.nodeType ? c : document.createTextNode(String(c)));
  return e;
}

class ApiError extends Error { constructor(status, message) { super(message); this.status = status; } }

// crypto.randomUUID only exists in a secure context (localhost/https); otherwise build the same format with getRandomValues.
const newId = () => crypto.randomUUID?.()
  || '10000000-1000-4000-8000-100000000000'.replace(/[018]/g, c => (c ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (c / 4)))).toString(16));

async function api(url, body) {
  const r = await fetch(url, body === undefined ? {} : {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Kumanda': '1' }, body: JSON.stringify(body),
  });
  let j = {};
  try { j = await r.json(); } catch { /* no body */ }
  if (r.status === 401 && !/^\/api\/(login|password|setup)/.test(url)) { showLogin(); throw new ApiError(401, 'Login required'); }
  if (!r.ok) throw new ApiError(r.status, j.error || `Error (${r.status})`);
  return j;
}

// Settings saved in this browser. Keys from 1.x (Turkish names) are moved over once.
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { if (v == null || v === '') localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* quota / private mode */ } },
};
(function migrateStorage() {
  try {
    const moves = { 'kumanda.mod': 'kumanda.mode', 'kumanda.efor': 'kumanda.effort', 'kumanda.satirSar': 'kumanda.wrap' };
    for (const [from, to] of Object.entries(moves)) {
      const v = localStorage.getItem(from);
      if (v != null) { if (localStorage.getItem(to) == null) localStorage.setItem(to, v); localStorage.removeItem(from); }
    }
    const old = localStorage.getItem('kumanda.duzen');
    if (old != null) {
      try {
        const d = JSON.parse(old) || {};
        if (localStorage.getItem('kumanda.layout') == null) {
          localStorage.setItem('kumanda.layout', JSON.stringify({ sideWidth: d.yanGen, sideClosed: d.yanKapali, explorerWidth: d.gezginGen, explorerOpen: d.gezginAcik }));
        }
      } catch { /* broken */ }
      localStorage.removeItem('kumanda.duzen');
    }
    for (const k of Object.keys(localStorage)) {
      if (!k.startsWith('kumanda.taslak.')) continue;
      const to = `kumanda.draft.${k.slice('kumanda.taslak.'.length).replace(/\.yeni$/, '.new')}`;
      if (localStorage.getItem(to) == null) localStorage.setItem(to, localStorage.getItem(k));
      localStorage.removeItem(k);
    }
  } catch { /* no storage */ }
})();

let toastTimer;
function toast(message) {
  document.querySelector('.toast')?.remove();
  const e = h('div', { class: 'toast', role: 'status' }, message);
  document.body.append(e);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => e.remove(), 3500);
}

const esc = s => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function timeAgo(ms) {
  if (!ms) return '';
  const diff = Date.now() - ms;
  if (diff < 60e3) return 'just now';
  if (diff < 3600e3) return `${Math.floor(diff / 60e3)} min ago`;
  if (diff < 86400e3) return `${Math.floor(diff / 3600e3)} h ago`;
  if (diff < 7 * 86400e3) { const d = Math.floor(diff / 86400e3); return `${d} day${d > 1 ? 's' : ''} ago`; }
  return new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: diff > 300 * 86400e3 ? 'numeric' : undefined });
}
function formatSize(b) {
  if (b < 1024) return `${b} B`;
  if (b < 1048576) return `${Math.round(b / 1024)} KB`;
  return `${(b / 1048576).toFixed(b < 10485760 ? 1 : 0)} MB`;
}
function formatDuration(ms) {
  if (!ms) return '';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
}
/** When the work finished: the time if today, else day + time (so you can see when it finished, like in Claude Code). */
function formatMoment(at) {
  if (!at) return '';
  const t = new Date(at), today = new Date().toDateString() === t.toDateString();
  const time = t.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  return today ? time : `${t.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })} ${time}`;
}

// ───────── a small Markdown renderer (escape first, then format: no HTML injection) ─────────
function inline(s) {
  const codes = [];
  s = s.replace(/`([^`\n]+)`/g, (_, k) => { codes.push(k); return `\u0000${codes.length - 1}\u0000`; });
  s = esc(s);
  s = s.replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, (_, t, u) => `<a href="${u}" target="_blank" rel="noopener noreferrer">${t}</a>`);
  s = s.replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, (_, o, u) => `${o}<a href="${u}" target="_blank" rel="noopener noreferrer">${u}</a>`);
  s = s.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*\w])\*([^*\s][^*\n]*)\*(?!\w)/g, '$1<em>$2</em>')
    .replace(/~~([^~\n]+)~~/g, '<del>$1</del>');
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${esc(codes[i])}</code>`);
}
const indent = s => /^\s*/.exec(s)[0].replace(/\t/g, '  ').length;
const ITEM = /^\s*([-*+]|\d+[.)])\s+(.*)$/;
const cells = s => s.trim().replace(/^\||\|$/g, '').split('|').map(x => x.trim());

function md(source) {
  const lines = String(source).replace(/\r/g, '').split('\n');
  const out = [], para = [];
  const flush = () => { if (para.length) { out.push(`<p>${para.map(inline).join('<br>')}</p>`); para.length = 0; } };
  let i = 0;
  while (i < lines.length) {
    const s = lines[i];
    let m;
    if ((m = /^\s*(```|~~~)/.exec(s))) {
      flush();
      const code = [];
      for (i++; i < lines.length && !lines[i].trimStart().startsWith(m[1]); i++) code.push(lines[i]);
      i++;
      out.push(`<pre><code>${esc(code.join('\n'))}</code></pre>`);
    } else if (!s.trim()) { flush(); i++; }
    else if ((m = /^(#{1,6})\s+(.*)$/.exec(s))) {
      flush();
      const d = Math.min(m[1].length, 4);
      out.push(`<h${d}>${inline(m[2])}</h${d}>`); i++;
    } else if (/^\s*([-*_])\s*(\1\s*){2,}$/.test(s)) { flush(); out.push('<hr>'); i++; }
    else if (/^\s*>/.test(s)) {
      flush();
      const quote = [];
      for (; i < lines.length && /^\s*>/.test(lines[i]); i++) quote.push(lines[i].replace(/^\s*>\s?/, ''));
      out.push(`<blockquote>${md(quote.join('\n'))}</blockquote>`);
    } else if (s.includes('|') && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(lines[i + 1])) {
      flush();
      const head = cells(s);
      const body = [];
      for (i += 2; i < lines.length && lines[i].includes('|') && lines[i].trim(); i++) body.push(cells(lines[i]));
      out.push(`<div class="table-wrap"><table><thead><tr>${head.map(x => `<th>${inline(x)}</th>`).join('')}</tr></thead><tbody>${
        body.map(r => `<tr>${r.map(x => `<td>${inline(x)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`);
    } else if (ITEM.test(s)) {
      flush();
      const base = indent(s), ordered = /^\s*\d/.test(s), items = [];
      const sameKind = x => ITEM.test(x) && /^\s*\d/.test(x) === ordered; // a "-" list and a "1." list are separate lists
      while (i < lines.length) {
        const x = lines[i];
        if (!x.trim()) {
          const y = lines[i + 1];
          if (y && y.trim() && (indent(y) > base || (sameKind(y) && indent(y) === base))) { items.at(-1)?.push(''); i++; continue; }
          break;
        }
        const lm = ITEM.exec(x);
        if (lm && indent(x) <= base + 1) { if (indent(x) < base || !sameKind(x)) break; items.push([lm[2]]); i++; }
        else if (indent(x) > base && items.length) { items.at(-1).push(x); i++; }
        else break;
      }
      const li = items.map(o => {
        const rest = o.slice(1);
        const least = Math.min(...rest.filter(x => x.trim()).map(indent), 99);
        return `<li>${inline(o[0])}${rest.some(x => x.trim()) ? md(rest.map(x => x.slice(Math.min(least, x.length - x.trimStart().length))).join('\n')) : ''}</li>`;
      });
      out.push(ordered ? `<ol>${li.join('')}</ol>` : `<ul>${li.join('')}</ul>`);
    } else { para.push(s); i++; }
  }
  flush();
  return out.join('');
}

// ───────── device and product compatibility ─────────
const ua = navigator.userAgent;
const DEVICE = /Android/.test(ua) ? 'android' : (/iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) ? 'ios'
  : /Windows/.test(ua) ? 'windows' : 'other';
const TOUCH = matchMedia('(pointer: coarse)').matches;
const KIND_LABEL = { web: 'WEB', android: 'APK', windows: 'EXE', archive: 'ZIP', video: 'VID' };
const kindLabel = u => KIND_LABEL[u.kind] || u.name.split('.').pop().toUpperCase().slice(0, 4);

function productAction(u) {
  const pdf = /\.pdf$/i.test(u.name);
  switch (u.kind) {
    case 'web': return { label: 'Open', fits: true };
    case 'video': return { label: 'Watch', fits: true };
    case 'document': return pdf ? { label: 'Open', fits: true } : { label: 'Download', fits: true, download: true };
    case 'android': return DEVICE === 'android' ? { label: 'Install', fits: true, download: true } : { label: 'Download', fits: false, download: true, note: 'Android only' };
    case 'windows': return DEVICE === 'windows' ? { label: 'Download', fits: true, download: true } : { label: 'Download', fits: false, download: true, note: 'Windows only' };
    default: return { label: 'Download', fits: true, download: true };
  }
}

const chatTitle = s => s?.title || 'Untitled chat';

function productCard(pid, u, reload) {
  const a = productAction(u);
  const href = `/open?p=${pid}&path=${encodeURIComponent(u.path)}${a.download ? '&download=1' : ''}`;
  const folder = u.path.includes('/') ? u.path.slice(0, u.path.lastIndexOf('/')) : '';
  return h('div', { class: `product${u.hidden ? ' faded' : ''}` },
    h('div', { class: 'head' },
      h('div', { class: 'kind' }, kindLabel(u)),
      h('div', { style: 'min-width:0' },
        h('div', { class: 'name' }, u.title || u.name),
        h('div', { class: 'path' }, u.title ? u.path : (folder || 'project root')))),
    h('div', { class: 'foot' },
      h('span', { class: 'badge' }, formatSize(u.size)),
      h('span', { class: 'badge' }, timeAgo(u.mtime)),
      a.note && h('span', { class: 'badge warn' }, a.note),
      u.secondary && h('span', { class: 'badge' }, u.secondary),
      h('span', { class: 'spacer' }),
      h('button', { class: 'btn flat small', title: u.hidden ? 'Show again' : 'Hide from the list', onclick: async e => {
        const b = e.currentTarget; // currentTarget is empty after await
        b.disabled = true; // rapid clicks must not hit the same card twice
        try { await api(`/api/project/${pid}/hide-products`, { path: u.path, hidden: !u.hidden }); reload(); } catch (x) { toast(x.message); b.disabled = false; }
      } }, u.hidden ? 'Show' : 'Hide'),
      h('a', { class: `btn small${a.fits ? ' primary' : ''}`, href, target: '_blank', rel: 'noopener' }, a.label)));
}

// "Other files" / "Hidden by you" boxes left open: they must not close when the list is redrawn (e.g. after "Show").
const openBoxes = new Set();

/** Shows/hides several products with one request. */
async function hideMany(pid, paths, hidden, reload, button) {
  if (button) button.disabled = true;
  try { await api(`/api/project/${pid}/hide-products`, { paths, hidden }); reload(); }
  catch (x) { toast(x.message); if (button) button.disabled = false; }
}
const showAllButton = (pid, hiddenOnes, reload, label = `Show all (${hiddenOnes.length})`) =>
  h('button', { class: 'btn small', type: 'button', title: 'Put all hidden products back in the list',
    onclick: e => hideMany(pid, hiddenOnes.map(u => u.path), false, reload, e.currentTarget) }, label);

/** `key`: the name under which the open/closed state of the boxes is remembered (separate per group on one page). */
function productGrid(pid, products, reload, key = pid) {
  const main = products.filter(u => !u.secondary && !u.hidden);
  const secondary = products.filter(u => u.secondary && !u.hidden);
  const hidden = products.filter(u => u.hidden);
  const box = (summary, list, cls, top) => {
    if (!list.length) return null;
    const k = `${key}|${cls}`;
    const d = h('details', { class: `more ${cls}`, open: openBoxes.has(k), ontoggle: () => (d.open ? openBoxes.add(k) : openBoxes.delete(k)) },
      h('summary', {}, summary), top, h('div', { class: 'products' }, list.map(u => productCard(pid, u, reload))));
    return d;
  };
  // Always returns an array of DOM nodes only (spread into replaceChildren).
  return [
    main.length ? h('div', { class: 'products' }, main.map(u => productCard(pid, u, reload))) : null,
    box(`Other files (${secondary.length}): source files, helper files, debug builds`, secondary, 'secondary'),
    box(`Hidden by you (${hidden.length}): "Show" brings them back`, hidden, 'hidden-box',
      hidden.length > 1 && h('div', { class: 'box-tools' }, showAllButton(pid, hidden, reload))),
  ].filter(Boolean);
}

/** Keeps the scroll position while redrawing (you stay where you were reading even if the list changes). */
function redrawInPlace(container, ...nodes) {
  const scroller = container.closest?.('.scroll');
  const top = scroller?.scrollTop;
  container.replaceChildren(...nodes);
  if (scroller && top) scroller.scrollTop = top;
}

/** Groups products by the chat that made them: the chat with the newest product on top, ones linked to no chat at the bottom. */
function sessionGroups(pid, products, sessions, reload) {
  const groups = new Map();
  for (const u of products) {
    const k = u.session || '';
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(u);
  }
  const order = [...groups.entries()].sort(([a, x], [b, y]) =>
    (a === '') - (b === '') || Math.max(...y.map(u => u.mtime)) - Math.max(...x.map(u => u.mtime)));
  return order.map(([sid, list]) => h('section', { class: 'session-group' },
    sid
      ? h('a', { class: 'session-head', href: `#/p/${pid}/s/${sid}` },
        h('span', { class: 'name' }, chatTitle(sessions[sid])),
        h('span', { class: 'muted small' }, `${timeAgo(Math.max(...list.map(u => u.mtime)))} · go to chat ›`))
      : h('div', { class: 'session-head' },
        h('span', { class: 'name' }, 'Not linked to a chat'),
        h('span', { class: 'muted small' }, 'Files changed outside Claude Code or long ago')),
    productGrid(pid, list, reload, `${pid}|${sid || '-'}`)));
}

// ───────── login / first setup ─────────
let status = null;

function showLogin() {
  view?.close?.();
  view = null;
  app.className = '';
  const setup = !status?.setUp;
  const error = h('div', { class: 'error-text', role: 'alert' });
  const password = h('input', { type: 'password', autocomplete: setup ? 'new-password' : 'current-password', required: true, id: 'password' });
  const repeat = setup ? h('input', { type: 'password', autocomplete: 'new-password', required: true, id: 'repeat' }) : null;
  const button = h('button', { class: 'btn primary', type: 'submit' }, setup ? 'Set password' : 'Log in');
  let content;
  if (setup && !status?.local) {
    content = h('p', {}, 'Kumanda is not set up yet. For security the first password can only be set on the computer itself: open ',
      h('b', {}, 'http://127.0.0.1:7777'), ' on your computer.');
  } else {
    content = h('form', { onsubmit: async e => {
      e.preventDefault();
      error.textContent = '';
      if (setup && password.value !== repeat.value) { error.textContent = 'The passwords do not match'; return; }
      button.disabled = true;
      try { await api(setup ? '/api/setup' : '/api/login', { password: password.value }); location.reload(); }
      catch (x) { error.textContent = x.message; button.disabled = false; }
    } },
      setup && h('p', { class: 'muted' }, `This password allows running Claude Code on your computer. At least ${status.minPassword} characters; pick a long one you do not use anywhere else.`),
      h('label', { for: 'password' }, 'Password'), password,
      setup && [h('label', { for: 'repeat' }, 'Password (again)'), repeat],
      button, error);
  }
  app.replaceChildren(h('div', { class: 'scroll' }, h('div', { class: 'login' },
    h('h1', {}, 'Kumanda'), h('p', { class: 'muted' }, setup ? 'First setup' : 'Claude Code and your products on your computer'), content)));
  password.focus?.();
}

// ───────── shell and routing ─────────
let projects = [];
let view = null; // the active view (cleaned up with close())
let side, main, listEl, searchEl, explorer, treeEl, explorerNameEl, newProjectEl;

/** The "new project" form under the search box in the sidebar: creates an empty folder in the projects folder, goes to a new chat. */
function newProjectForm() {
  if (!newProjectEl.hidden) { newProjectEl.hidden = true; return; }
  const input = h('input', { type: 'text', placeholder: 'Project name', 'aria-label': 'New project name', maxlength: 80 });
  const button = h('button', { class: 'btn primary small', type: 'submit' }, 'Create');
  newProjectEl.replaceChildren(h('form', { onsubmit: async e => {
    e.preventDefault();
    const name = input.value.trim();
    if (!name) return;
    button.disabled = true;
    try {
      const r = await api('/api/project-create', { name });
      newProjectEl.hidden = true;
      await refreshProjects();
      location.hash = r.project ? `#/p/${r.project.id}/new` : '#/';
    } catch (x) { if (x.status !== 401) toast(x.message); } finally { button.disabled = false; }
  } }, input, button),
  h('div', { class: 'small muted' }, 'An empty folder is created in the projects folder; then you start the first chat.'));
  newProjectEl.hidden = false;
  input.focus();
}

// ───────── layout: sidebar (projects) and explorer (files) ─────────
// On desktop both grow/shrink by dragging their edge; dragged below the threshold they close. The ☰ and Files buttons
// (Ctrl+B, Ctrl+Shift+E) open and close them. On the phone both are drawers opening from the left: swipe right → projects,
// swipe left or tap outside → closed.
const isDesktop = () => matchMedia('(min-width: 900px)').matches;
const CLOSE_THRESHOLD = 150, NARROWEST = 190;
const layout = { sideWidth: 300, sideClosed: false, explorerWidth: 270, explorerOpen: false };
try { for (const [k, v] of Object.entries(JSON.parse(store.get('kumanda.layout')) || {})) if (v != null && k in layout) layout[k] = v; } catch { /* broken or none */ }
const saveLayout = () => store.set('kumanda.layout', JSON.stringify(layout));
let explorerPid = null; // the project the explorer shows (only on project pages)

function applyLayout() {
  const widest = Math.max(260, Math.round(innerWidth * 0.5));
  layout.sideWidth = Math.min(Math.max(layout.sideWidth, NARROWEST), widest);
  layout.explorerWidth = Math.min(Math.max(layout.explorerWidth, NARROWEST), widest);
  const explorerShown = layout.explorerOpen && Boolean(explorerPid);
  app.classList.toggle('side-closed', layout.sideClosed);
  app.classList.toggle('explorer-open', explorerShown);
  if (!explorerPid) app.classList.remove('explorer-drawer');
  app.style.setProperty('--side-width', layout.sideClosed ? '0px' : `${layout.sideWidth}px`);
  app.style.setProperty('--explorer-width', explorerShown ? `${layout.explorerWidth}px` : '0px');
  for (const d of document.querySelectorAll('.explorer-button')) d.classList.toggle('active', explorerShown || app.classList.contains('explorer-drawer'));
}

function closeDrawers() { app.classList.remove('side-drawer', 'explorer-drawer'); applyLayout(); }

function toggleSide() {
  if (isDesktop()) { layout.sideClosed = !layout.sideClosed; saveLayout(); applyLayout(); return; }
  const open = !app.classList.contains('side-drawer');
  closeDrawers();
  if (open && app.classList.contains('main-open')) app.classList.add('side-drawer');
}

function toggleExplorer() {
  if (!explorerPid) return;
  if (isDesktop()) { layout.explorerOpen = !layout.explorerOpen; saveLayout(); }
  else {
    const open = !app.classList.contains('explorer-drawer');
    app.classList.remove('side-drawer');
    app.classList.toggle('explorer-drawer', open);
  }
  if (explorerVisible()) refreshTree(); // fresh folder contents on every open
  applyLayout();
}

/** Edge handle: dragging sets the width, below the threshold it closes the panel. */
function handle(cls, { start, set }) {
  return h('div', { class: cls, role: 'separator', 'aria-orientation': 'vertical', title: 'Drag: widen / narrow / close',
    onpointerdown: e => {
      if (e.button !== 0) return;
      e.preventDefault();
      const x0 = e.clientX, w0 = start();
      app.classList.add('dragging');
      const move = ev => { set(w0 + ev.clientX - x0); applyLayout(); };
      const release = () => {
        app.classList.remove('dragging');
        removeEventListener('pointermove', move); removeEventListener('pointerup', release); removeEventListener('pointercancel', release);
        saveLayout();
      };
      addEventListener('pointermove', move); addEventListener('pointerup', release); addEventListener('pointercancel', release);
    } });
}

function shell() {
  app.className = '';
  searchEl = h('input', { type: 'search', placeholder: 'Search projects', 'aria-label': 'Search projects', oninput: drawProjects });
  listEl = h('div', { class: 'list' });
  const setSide = w => { layout.sideClosed = w < CLOSE_THRESHOLD; if (!layout.sideClosed) layout.sideWidth = w; };
  side = h('aside', { id: 'side' },
    h('div', { class: 'top' },
      h('div', { class: 'title' }, h('h1', {}, 'Kumanda')),
      h('a', { class: 'btn small', href: '#/products' }, 'Products'),
      h('a', { class: 'btn icon flat', href: '#/settings', title: 'Settings', 'aria-label': 'Settings' }, '⚙'),
      h('button', { class: 'btn icon flat side-close', type: 'button', title: 'Close the project list (Ctrl+B)', 'aria-label': 'Close the project list', onclick: toggleSide }, '«')),
    h('div', { class: 'search' }, searchEl,
      h('button', { class: 'btn icon small', type: 'button', title: 'New project', 'aria-label': 'New project', onclick: () => newProjectForm() }, '＋')),
    newProjectEl = h('div', { class: 'new-project', hidden: true }),
    h('div', { class: 'scroll' }, listEl),
    handle('handle', { start: () => layout.sideWidth, set: setSide }));
  treeEl = h('div', { class: 'tree', role: 'tree', 'aria-label': 'Project files' });
  explorerNameEl = h('div', { class: 'explorer-name' });
  explorer = h('aside', { id: 'explorer' },
    h('div', { class: 'explorer-head' },
      h('div', { class: 'explorer-title' }, h('div', { class: 'label' }, 'Files'), explorerNameEl),
      h('button', { class: 'btn icon flat small', type: 'button', title: 'Refresh', 'aria-label': 'Refresh files', onclick: refreshTree }, '⟳'),
      h('button', { class: 'btn icon flat small', type: 'button', title: 'Collapse all folders', 'aria-label': 'Collapse all', onclick: () => { openFolders.delete(explorerPid); drawTree(); } }, '⊟'),
      h('button', { class: 'btn icon flat small', type: 'button', title: 'Close (Ctrl+Shift+E)', 'aria-label': 'Close files', onclick: toggleExplorer }, '×')),
    h('div', { class: 'scroll' }, treeEl),
    handle('handle', { start: () => layout.explorerWidth, set: w => { layout.explorerOpen = w >= CLOSE_THRESHOLD; if (layout.explorerOpen) layout.explorerWidth = w; } }));
  main = h('main', { id: 'main' });
  // A closed sidebar opens again by dragging from the left edge of the screen.
  const edge = handle('edge-handle', { start: () => 0, set: setSide });
  app.replaceChildren(side, explorer, main, edge, h('div', { class: 'backdrop', onclick: closeDrawers }));
  applyLayout();
  touchSwipe();
}

/** Horizontal swipe on the phone: right → project list drawer, left → close the open drawer. */
function touchSwipe() {
  let start = null;
  const scrollsSideways = el => {
    for (; el && el !== app && el.nodeType === 1; el = el.parentElement) {
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return true;
      if (el.scrollWidth > el.clientWidth + 2 && /auto|scroll/.test(getComputedStyle(el).overflowX)) return true;
    }
    return false;
  };
  app.addEventListener('touchstart', e => {
    start = e.touches.length === 1 && !isDesktop() ? { x: e.touches[0].clientX, y: e.touches[0].clientY, target: e.target } : null;
  }, { passive: true });
  app.addEventListener('touchend', e => {
    if (!start) return;
    const t = e.changedTouches[0], dx = t.clientX - start.x, dy = t.clientY - start.y, target = start.target;
    start = null;
    if (Math.abs(dx) < 70 || Math.abs(dx) < Math.abs(dy) * 1.8 || scrollsSideways(target)) return;
    const drawer = app.classList.contains('side-drawer') || app.classList.contains('explorer-drawer');
    if (dx < 0 && drawer) closeDrawers();
    else if (dx > 0 && !drawer && app.classList.contains('main-open')) app.classList.add('side-drawer');
  }, { passive: true });
}

// ───────── explorer: project files (like the VS Code explorer; read only) ─────────
const treeCache = new Map(); // `${pid}|${folder}` → { entries, truncated } | { loading } | { error }
const openFolders = new Map(); // pid → Set(folder path)
let selectedFile = '';
const explorerVisible = () => Boolean(explorerPid) && (isDesktop() ? layout.explorerOpen : app.classList.contains('explorer-drawer'));
const fileHref = (pid, path) => `#/p/${pid}/f/${encodeURIComponent(path)}`;

const ICONS = [
  [/\.(m?jsx?|cjs)$/i, 'JS', 'yellow'], [/\.(tsx?|mts|cts)$/i, 'TS', 'blue'], [/\.(json|jsonc|webmanifest)$/i, '{}', 'yellow'],
  [/\.(html?|xml|vue|svelte)$/i, '<>', 'orange'], [/\.(css|scss|sass|less)$/i, '#', 'blue'], [/\.(md|markdown)$/i, 'M↓', 'blue'],
  [/\.(py|pyw|ipynb)$/i, 'PY', 'blue'], [/\.(ps1|psm1|psd1)$/i, 'PS', 'blue'], [/\.(sh|bash|zsh|bat|cmd)$/i, '$', 'green'],
  [/\.(png|jpe?g|gif|webp|svg|ico|bmp|avif)$/i, '▣', 'purple'], [/\.(apk|aab)$/i, 'AP', 'green'], [/\.(exe|msi|dll)$/i, 'EX', 'red'],
  [/\.(zip|7z|rar|gz|tgz)$/i, 'ZP', 'orange'], [/\.(ya?ml|toml|ini|cfg|conf|env|properties|gradle|kts)$/i, '⚙', 'faded'],
  [/\.(c|h|cpp|hpp|cc|cs|java|kt|go|rs|swift|dart|php|rb|lua|sql)$/i, '</>', 'purple'], [/\.(mp4|mov|webm|mkv|mp3|wav)$/i, '▶', 'purple'],
  [/\.(txt|log|csv)$/i, '≡', 'faded'], [/\.pdf$/i, 'PDF', 'red'],
];
function fileIcon(name) {
  const s = ICONS.find(([r]) => r.test(name));
  return h('span', { class: `ficon ${s ? s[2] : 'faded'}`, 'aria-hidden': 'true' }, s ? s[1] : '•');
}

async function loadFolder(pid, path) {
  const k = `${pid}|${path}`;
  if (treeCache.get(k)?.loading) return;
  treeCache.set(k, { loading: true });
  try {
    const v = await api(`/api/project/${pid}/files?path=${encodeURIComponent(path)}`);
    treeCache.set(k, { entries: v.entries || [], truncated: Boolean(v.truncated) });
  } catch (x) { treeCache.set(k, { error: x.status === 404 ? 'Folder not found' : x.message }); }
  if (pid === explorerPid) drawTree();
}

function refreshTree() {
  if (!explorerPid) return;
  for (const k of [...treeCache.keys()]) if (k.startsWith(`${explorerPid}|`) && !treeCache.get(k).loading) treeCache.delete(k);
  drawTree();
}

function toggleFolder(path) {
  if (!openFolders.has(explorerPid)) openFolders.set(explorerPid, new Set());
  const open = openFolders.get(explorerPid);
  if (open.has(path)) open.delete(path); else open.add(path);
  drawTree();
}

function drawTree() {
  if (!treeEl) return;
  if (!explorerPid) { treeEl.replaceChildren(); return; }
  const pid = explorerPid;
  explorerNameEl.textContent = projectName(pid) || 'Project';
  if (!explorerVisible()) return; // no network request while closed
  const open = openFolders.get(pid) || new Set();
  const rows = [];
  const info = (text, d) => h('div', { class: 'tree-info', style: `padding-left:${26 + d * 14}px` }, text);
  const walk = (folder, d) => {
    const k = treeCache.get(`${pid}|${folder}`);
    if (!k) { loadFolder(pid, folder); rows.push(info('Loading…', d)); return; }
    if (k.loading) { rows.push(info('Loading…', d)); return; }
    if (k.error) { rows.push(info(k.error, d)); return; }
    if (!k.entries.length) rows.push(info(d ? 'empty' : 'This folder is empty', d));
    for (const g of k.entries) {
      const isOpen = g.dir && open.has(g.path);
      const common = { class: `tree-row${g.dir ? ' folder' : ''}${!g.dir && g.path === selectedFile ? ' selected' : ''}`,
        style: `padding-left:${6 + d * 14}px`, title: g.path, role: 'treeitem' };
      rows.push(g.dir
        ? h('button', { ...common, type: 'button', 'aria-expanded': isOpen ? 'true' : 'false', onclick: () => toggleFolder(g.path) },
          h('span', { class: 'arrow' }, isOpen ? '▾' : '▸'), h('span', { class: 'name' }, g.name))
        : h('a', { ...common, href: fileHref(pid, g.path) },
          h('span', { class: 'arrow' }), fileIcon(g.name), h('span', { class: 'name' }, g.name)));
      if (isOpen) walk(g.path, d + 1);
    }
    if (k.truncated) rows.push(info('… too many entries; showing the first 3000', d));
  };
  walk('', 0);
  treeEl.replaceChildren(...rows);
}

/** Called on routing: the explorer's project and the selected file (the file's folders are opened, as in VS Code). */
function setExplorer(pid, file) {
  explorerPid = pid;
  selectedFile = file || '';
  if (pid && file) {
    if (!openFolders.has(pid)) openFolders.set(pid, new Set());
    const parts = file.split('/');
    for (let i = 1; i < parts.length; i++) openFolders.get(pid).add(parts.slice(0, i).join('/'));
  }
  applyLayout();
  drawTree();
}

async function refreshProjects() {
  try { projects = (await api('/api/projects')).projects; drawProjects(); } catch { /* the login screen is shown, or no network */ }
}

function drawProjects() {
  if (!listEl) return;
  const q = searchEl.value.trim().toLocaleLowerCase();
  const selected = /^#\/p\/([0-9a-f]+)/.exec(location.hash)?.[1];
  const shown = projects.filter(p => !q || p.name.toLocaleLowerCase().includes(q));
  listEl.replaceChildren(...shown.map(p => {
    const state = p.live.includes('waiting') ? 'waiting' : p.live.includes('running') ? 'running' : p.live.length ? 'ready' : '';
    const info = [p.lastActivity ? timeAgo(p.lastActivity) : 'no chats yet', p.productCount ? `${p.productCount} product${p.productCount > 1 ? 's' : ''}` : null].filter(Boolean).join(' · ');
    // Choosing a project opens its latest chat directly (#/p/<pid>/last); the back arrow in the chat goes to the project's chats tab.
    return h('a', { class: `row${p.id === selected ? ' selected' : ''}`, href: `#/p/${p.id}/last` },
      h('span', { class: `dot ${state}`, title: state === 'waiting' ? 'Waiting for your answer' : state === 'running' ? 'Running' : '' }),
      h('div', { class: 'body' }, h('div', { class: 'name' }, p.name), h('div', { class: 'info' }, info)));
  }));
  if (!shown.length) listEl.append(h('div', { class: 'empty' }, q ? 'No matching project' : 'No projects found'));
  if (explorerPid) explorerNameEl.textContent = projectName(explorerPid) || 'Project';
}

const projectName = pid => projects.find(p => p.id === pid)?.name || '';

/** With `pid` there is an explorer (Files) button on the right. */
function topBar({ title, sub, back = '#/', right = [], pid }) {
  return h('div', { class: 'top' },
    h('a', { class: 'btn icon flat back', href: back, 'aria-label': 'Back' }, '‹'),
    h('button', { class: 'btn icon flat side-button', type: 'button', title: 'Project list (Ctrl+B)', 'aria-label': 'Toggle the project list', onclick: toggleSide }, '☰'),
    h('div', { class: 'title' }, typeof title === 'string' ? h('h1', {}, title) : title, sub && (typeof sub === 'string' ? h('div', { class: 'sub' }, sub) : sub)),
    right,
    pid && h('button', { class: `btn icon flat explorer-button${explorerVisible() ? ' active' : ''}`, type: 'button', title: 'Project files (Ctrl+Shift+E)',
      'aria-label': 'Toggle the project files', onclick: toggleExplorer }, h('span', { class: 'folder-icon', 'aria-hidden': 'true' })));
}

function route() {
  view?.close?.();
  view = null;
  const p = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  app.classList.toggle('main-open', p.length > 0);
  app.classList.remove('side-drawer', 'explorer-drawer'); // picked from a drawer on the phone: close it
  let file = '';
  if (p[0] === 'p' && p[1] && p[2] === 'f') { try { file = decodeURIComponent(p.slice(3).join('/')); } catch { file = ''; } }
  setExplorer(p[0] === 'p' && p[1] ? p[1] : null, file);
  if (p[0] === 'p' && p[1]) {
    if (p[2] === 's' && p[3]) view = chatView(p[1], p[3]);
    else if (p[2] === 'new') view = chatView(p[1], null);
    else if (p[2] === 'last') { openLastChat(p[1]); return; }
    else if (p[2] === 'f' && file) view = fileView(p[1], file);
    else view = projectPage(p[1], p[2] === 'products' ? 'products' : 'chats');
  } else if (p[0] === 'products') view = allProducts();
  else if (p[0] === 'settings') view = settingsPage();
  else main.replaceChildren(h('div', { class: 'center muted' }, 'Pick a project on the left or look at Products.'));
  drawProjects();
}

/** #/p/<pid>/last: opens the project's latest chat (or the chats tab if there is none). The address is replaced so Back does not loop. */
async function openLastChat(pid) {
  main.replaceChildren(h('div', { class: 'center muted' }, 'Loading…'));
  let target = `#/p/${pid}`;
  try { const v = await api(`/api/project/${pid}`); if (v.sessions[0]) target = `#/p/${pid}/s/${v.sessions[0].id}`; } catch { /* the chats tab shows the error */ }
  if (location.hash !== `#/p/${pid}/last`) return; // moved somewhere else meanwhile
  history.replaceState(null, '', target);
  route();
}

// ───────── project page ─────────
function projectPage(pid, tab) {
  const body = h('div', { class: 'inner' }, h('div', { class: 'empty' }, 'Loading…'));
  const title = h('h1', {}, projectName(pid) || 'Project');
  const sub = h('div', { class: 'sub' });
  main.replaceChildren(
    topBar({ title, sub, pid, right: [h('a', { class: 'btn primary small', href: `#/p/${pid}/new` }, 'New chat')] }),
    h('div', { class: 'tabs' },
      h('a', { class: `tab${tab === 'chats' ? ' selected' : ''}`, href: `#/p/${pid}` }, 'Chats'),
      h('a', { class: `tab${tab === 'products' ? ' selected' : ''}`, href: `#/p/${pid}/products` }, 'Products')),
    h('div', { class: 'scroll' }, body));
  let cancelled = false;

  async function load(fresh) {
    try {
      if (tab === 'chats') {
        const v = await api(`/api/project/${pid}`);
        if (cancelled) return;
        title.textContent = v.project.name; sub.textContent = v.project.path;
        body.replaceChildren(
          v.sessions.length ? h('div', { class: 'list', style: 'padding:0' }, v.sessions.map(s => h('a', { class: 'row', href: `#/p/${pid}/s/${s.id}` },
            h('span', { class: `dot ${s.live || ''}` }),
            h('div', { class: 'body' }, h('div', { class: 'name' }, s.title), h('div', { class: 'info' }, timeAgo(s.mtime))),
            s.live === 'waiting' && h('span', { class: 'badge warn' }, 'waiting for answer'),
            s.live === 'running' && h('span', { class: 'badge accent' }, 'running'))))
            : h('div', { class: 'empty' }, 'No chats in this project yet. Start with "New chat".'),
          h('div', { style: 'margin-top:18px;text-align:center' },
            h('button', { class: 'btn flat small muted', onclick: async () => {
              try { await api(`/api/project/${pid}/hide`, { hidden: true }); toast('Project hidden (undo in Settings)'); await refreshProjects(); location.hash = '#/'; } catch (x) { toast(x.message); }
            } }, 'Hide this project from the list')));
      } else {
        const v = await api(`/api/project/${pid}/products?hidden${fresh ? '&fresh' : ''}`);
        if (cancelled) return;
        const hiddenOnes = v.products.filter(u => u.hidden);
        redrawInPlace(body,
          h('div', { class: 'toolbar' },
            h('span', { class: 'muted small', style: 'flex:1' }, v.products.length ? 'Each product under the chat that last changed it' : ''),
            hiddenOnes.length > 0 && showAllButton(pid, hiddenOnes, () => load(false), `Show all hidden (${hiddenOnes.length})`),
            h('button', { class: 'btn small', onclick: () => load(true) }, 'Rescan')),
          ...(v.products.length ? sessionGroups(pid, v.products, v.sessions || {}, () => load(false))
            : [h('div', { class: 'empty' }, 'No products found in this project (HTML, APK, EXE, ZIP, video, document).')]));
      }
    } catch (x) { if (!cancelled && x.status !== 401) body.replaceChildren(h('div', { class: 'empty' }, x.message)); }
  }
  load(false);
  return { close() { cancelled = true; } };
}

// ───────── all products ─────────
function allProducts() {
  const body = h('div', { class: 'inner' }, h('div', { class: 'empty' }, 'Scanning projects…'));
  main.replaceChildren(topBar({ title: 'Products', sub: 'The outputs of all projects' }), h('div', { class: 'scroll' }, body));
  let cancelled = false;
  async function load() {
    try {
      const v = await api('/api/products?hidden');
      if (cancelled) return;
      // Under the project title, split by chat like the project's Products tab.
      redrawInPlace(body, ...(v.groups.length ? v.groups.map(g => h('section', { class: 'project-group' },
        h('div', { class: 'project-group-head' },
          h('h2', {}, h('a', { href: `#/p/${g.project.id}/products`, style: 'color:inherit;text-decoration:none' }, `${g.project.name} ›`)),
          g.products.some(u => u.hidden) && showAllButton(g.project.id, g.products.filter(u => u.hidden), load, `Show hidden (${g.products.filter(u => u.hidden).length})`)),
        sessionGroups(g.project.id, g.products, g.sessions || {}, load)))
        : [h('div', { class: 'empty' }, 'No products found in any project.')]));
    } catch (x) { if (!cancelled && x.status !== 401) body.replaceChildren(h('div', { class: 'empty' }, x.message)); }
  }
  load();
  return { close() { cancelled = true; } };
}

// ───────── file viewer ─────────
// Syntax highlighting: each language's ordered rules are joined into one regular expression; the matching group gives the class.
// The output is only <span>s built with h() (the text is never interpreted as HTML).
const RULE = {
  cComment: /\/\/[^\n]*|\/\*[\s\S]*?(?:\*\/|$)/, blockComment: /\/\*[\s\S]*?(?:\*\/|$)/, hashComment: /#[^\n]*/,
  htmlComment: /<!--[\s\S]*?(?:-->|$)/, psComment: /<#[\s\S]*?(?:#>|$)/, sqlComment: /--[^\n]*/, iniComment: /(?:^|(?<=\n))[ \t]*;[^\n]*/,
  batComment: /(?:^|(?<=\n))[ \t]*(?:@?rem\b|::)[^\n]*/i,
  string: /"(?:[^"\\\n]|\\.)*"?|'(?:[^'\\\n]|\\.)*'?/, dqString: /"(?:[^"\\\n]|\\.)*"?/, template: /`(?:[^`\\]|\\[\s\S])*`?/,
  tripleString: /"""[\s\S]*?(?:"""|$)|'''[\s\S]*?(?:'''|$)/, attrString: /(?<==\s*)(?:"[^"]*"|'[^']*')/,
  jsonKey: /"(?:[^"\\\n]|\\.)*"(?=\s*:)/, cssProperty: /(?<=[{;]\s*)-{0,2}[a-zA-Z][\w-]*(?=\s*:)/, cssValue: /#[\da-fA-F]{3,8}\b|@[\w-]+|!important/,
  yamlKey: /(?:^|(?<=\n))[ \t]*(?:- )?[\w.$-]+(?=[ \t]*:)/, iniKey: /(?:^|(?<=\n))[ \t]*[\w.$-]+(?=[ \t]*=)/, iniSection: /(?:^|(?<=\n))[ \t]*\[[^\]\n]*\]/,
  tag: /<\/?[A-Za-z][\w:.-]*|\/?>/, attribute: /[A-Za-z_:@][\w:.-]*(?==)/,
  variable: /\$\{?[\w:@#?*!-]+\}?/, batVariable: /%[\w~:]+%?/, preprocessor: /(?:^|(?<=\n))[ \t]*#[ \t]*\w+/, decorator: /@[\w.]+/,
  number: /\b(?:0[xX][\da-fA-F_]+|\d[\d_]*(?:\.\d+)?(?:[eE][+-]?\d+)?)\b/, word: /[A-Za-z_$][\w$]*/,
  mdHeading: /(?:^|(?<=\n))#{1,6} [^\n]*/, mdCode: /(?:^|(?<=\n))```[\s\S]*?(?:\n```|$)|`[^`\n]+`/, mdEmphasis: /\*\*[^*\n]+\*\*|__[^_\n]+__/, mdLink: /\[[^\]\n]*\]\([^)\n]*\)/,
};
const set = s => new Set(s.split(' '));
const KEYWORDS = {
  js: set('break case catch class const continue debugger default delete do else export extends finally for from function if import in instanceof let new of return static super switch this throw try typeof var void while with yield async await as interface type enum implements private protected public readonly declare namespace abstract keyof satisfies get set'),
  py: set('and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield match case self cls'),
  ps: set('begin break catch class continue data do dynamicparam else elseif end exit filter finally for foreach from function if in param process return switch throw trap try until using var while workflow'),
  c: set('auto break case char const continue default do double else enum extern float for goto if int long register return short signed sizeof static struct switch typedef union unsigned void volatile while class public private protected internal namespace using new delete virtual override template typename bool package import func go defer chan map range type var fn let mut impl trait pub use mod match loop where crate self Self val fun when object interface extends implements final abstract string async await this super throw throws try catch finally in is as out ref sealed data suspend'),
  sh: set('if then else elif fi for while until do done case esac in function return local export readonly set unset shift source exit'),
  sql: set('select from where and or not insert into values update set delete create table drop alter add index primary key foreign references join left right inner outer on group by order having limit offset as distinct union all null is in like between exists case when then else end default unique view'),
  bat: set('if else goto call set echo exit for in do not exist defined errorlevel setlocal endlocal shift pushd popd start'),
};
const CONSTANTS = set('true false null undefined NaN Infinity None True False nil $true $false $null');
const language = (parts, keywords = null, caseInsensitive = false) => ({
  re: new RegExp(parts.map(([r]) => `(${r.source})`).join('|'), `g${parts.some(([r]) => r.flags.includes('i')) ? 'i' : ''}`),
  classes: parts.map(([, s]) => s), keywords, caseInsensitive,
});
const R = RULE;
const LANGUAGES = {
  js: language([[R.cComment, 'comment'], [R.template, 'string'], [R.string, 'string'], [R.number, 'number'], [R.word, 'word']], KEYWORDS.js),
  json: language([[R.cComment, 'comment'], [R.jsonKey, 'property'], [R.dqString, 'string'], [R.number, 'number'], [R.word, 'word']], new Set()),
  css: language([[R.blockComment, 'comment'], [R.string, 'string'], [R.cssProperty, 'property'], [R.cssValue, 'keyword'], [R.number, 'number']]),
  html: language([[R.htmlComment, 'comment'], [R.tag, 'tag'], [R.attribute, 'property'], [R.attrString, 'string']]),
  py: language([[R.hashComment, 'comment'], [R.tripleString, 'string'], [R.string, 'string'], [R.decorator, 'function'], [R.number, 'number'], [R.word, 'word']], KEYWORDS.py),
  ps: language([[R.psComment, 'comment'], [R.hashComment, 'comment'], [R.string, 'string'], [R.variable, 'variable'], [R.number, 'number'], [R.word, 'word']], KEYWORDS.ps, true),
  sh: language([[R.hashComment, 'comment'], [R.string, 'string'], [R.variable, 'variable'], [R.number, 'number'], [R.word, 'word']], KEYWORDS.sh),
  bat: language([[R.batComment, 'comment'], [R.dqString, 'string'], [R.batVariable, 'variable'], [R.number, 'number'], [R.word, 'word']], KEYWORDS.bat, true),
  c: language([[R.cComment, 'comment'], [R.preprocessor, 'keyword'], [R.template, 'string'], [R.string, 'string'], [R.decorator, 'function'], [R.number, 'number'], [R.word, 'word']], KEYWORDS.c),
  sql: language([[R.sqlComment, 'comment'], [R.blockComment, 'comment'], [R.string, 'string'], [R.number, 'number'], [R.word, 'word']], KEYWORDS.sql, true),
  yaml: language([[R.hashComment, 'comment'], [R.yamlKey, 'property'], [R.string, 'string'], [R.number, 'number'], [R.word, 'word']], new Set()),
  ini: language([[R.hashComment, 'comment'], [R.iniComment, 'comment'], [R.iniSection, 'tag'], [R.iniKey, 'property'], [R.string, 'string'], [R.number, 'number']]),
  md: language([[R.htmlComment, 'comment'], [R.mdCode, 'string'], [R.mdHeading, 'keyword'], [R.mdEmphasis, 'type'], [R.mdLink, 'function']]),
};
const EXTENSION_LANGUAGE = {
  js: 'js', mjs: 'js', cjs: 'js', jsx: 'js', ts: 'js', tsx: 'js', mts: 'js', cts: 'js', json: 'json', jsonc: 'json', webmanifest: 'json',
  css: 'css', scss: 'css', sass: 'css', less: 'css', html: 'html', htm: 'html', xml: 'html', svg: 'html', vue: 'html', svelte: 'html', xaml: 'html', csproj: 'html', plist: 'html',
  py: 'py', pyw: 'py', ps1: 'ps', psm1: 'ps', psd1: 'ps', sh: 'sh', bash: 'sh', zsh: 'sh', bat: 'bat', cmd: 'bat',
  c: 'c', h: 'c', cpp: 'c', hpp: 'c', cc: 'c', cs: 'c', java: 'c', kt: 'c', kts: 'c', go: 'c', rs: 'c', swift: 'c', dart: 'c', gradle: 'c', groovy: 'c', php: 'c', scala: 'c',
  sql: 'sql', yml: 'yaml', yaml: 'yaml', toml: 'ini', ini: 'ini', cfg: 'ini', conf: 'ini', properties: 'ini', env: 'ini', md: 'md', markdown: 'md',
};
const languageOf = name => (/^(makefile|dockerfile)$/i.test(name) ? 'sh' : EXTENSION_LANGUAGE[name.toLowerCase().split('.').pop()] || null);
const HIGHLIGHT_LIMIT = 400000; // longer text is shown without colors (so the phone does not freeze)

/** Splits the text into lines; each line is an array of [class | null, piece]. */
function highlight(text, lang) {
  const lines = [[]];
  const add = (cls, piece) => piece.split('\n').forEach((x, i) => {
    if (i) lines.push([]);
    if (!x) return;
    const line = lines.at(-1), last = line.at(-1);
    if (last && last[0] === cls) last[1] += x; else line.push([cls, x]);
  });
  const d = LANGUAGES[lang];
  if (!d || text.length > HIGHLIGHT_LIMIT) { add(null, text); return lines; }
  const re = d.re;
  re.lastIndex = 0;
  let last = 0, m;
  while ((m = re.exec(text))) {
    if (!m[0]) { re.lastIndex++; continue; }
    if (m.index > last) add(null, text.slice(last, m.index));
    let i = 1;
    while (m[i] === undefined) i++;
    let cls = d.classes[i - 1];
    if (cls === 'word') {
      const k = d.caseInsensitive ? m[0].toLowerCase() : m[0];
      cls = d.keywords?.has(k) ? 'keyword' : CONSTANTS.has(m[0]) || CONSTANTS.has(k) ? 'constant'
        : /^\s*\(/.test(text.slice(re.lastIndex, re.lastIndex + 12)) ? 'function' : /^[A-Z][a-z]/.test(m[0]) && !d.caseInsensitive ? 'type' : null;
    }
    add(cls, m[0]);
    last = re.lastIndex;
  }
  add(null, text.slice(last));
  return lines;
}

function codeView(text, lang) {
  const lines = highlight(text, lang);
  if (lines.length > 1 && !lines.at(-1).length) lines.pop(); // the trailing newline does not count as an empty line
  return h('pre', { class: 'code-view', style: `--digits:${String(lines.length).length}` },
    lines.map(s => h('span', { class: 'ln' }, s.map(([cls, piece]) => (cls ? h('span', { class: `s-${cls}` }, piece) : piece)))));
}

function fileView(pid, path) {
  const name = path.split('/').pop();
  const body = h('div', { class: 'file-body' }, h('div', { class: 'empty' }, 'Loading…'));
  const infoEl = h('div', { class: 'file-bar' });
  const open = `/open?p=${pid}&path=${encodeURIComponent(path)}`;
  main.replaceChildren(
    topBar({ title: name, sub: [projectName(pid), ...path.split('/').slice(0, -1)].filter(Boolean).join(' › '), back: `#/p/${pid}`, pid,
      right: [h('a', { class: 'btn small', href: open, target: '_blank', rel: 'noopener', title: 'Open in a separate browser tab (as a product)' }, 'Open'),
        h('a', { class: 'btn small', href: `${open}&download=1`, target: '_blank', rel: 'noopener', title: 'Download to this device' }, 'Download')] }),
    infoEl, h('div', { class: 'scroll' }, body));
  let cancelled = false;
  let wrap = store.get('kumanda.wrap') === '1';

  (async () => {
    let v;
    try { v = await api(`/api/project/${pid}/file?path=${encodeURIComponent(path)}`); }
    catch (x) { if (!cancelled && x.status !== 401) body.replaceChildren(h('div', { class: 'empty' }, x.status === 404 ? 'File not found (it may have been deleted or be in a hidden folder).' : x.message)); return; }
    if (cancelled) return;
    const badges = [h('span', { class: 'badge' }, formatSize(v.size)), h('span', { class: 'badge' }, timeAgo(v.mtime))];
    if (v.kind === 'image') {
      infoEl.replaceChildren(...badges);
      body.replaceChildren(h('div', { class: 'file-image' }, h('img', { src: `data:${v.mime};base64,${v.data}`, alt: v.name })));
      return;
    }
    if (v.kind !== 'text') {
      infoEl.replaceChildren(...badges);
      body.replaceChildren(h('div', { class: 'empty' }, `${v.reason || 'This file is not text'}; it cannot be shown here. Use "Open" or "Download".`));
      return;
    }
    const lang = languageOf(v.name);
    const markdown = lang === 'md';
    let preview = markdown;
    const content = h('div', {});
    const draw = () => {
      content.replaceChildren(preview ? h('div', { class: 'msg claude md-preview', html: md(v.text) }) : codeView(v.text, lang));
      content.classList.toggle('wrap', wrap);
    };
    const toggle = (label, on, flip) => h('button', { class: `btn flat small${on() ? ' active' : ''}`, type: 'button', 'aria-pressed': on() ? 'true' : 'false',
      onclick: e => { flip(); e.currentTarget.classList.toggle('active', on()); e.currentTarget.setAttribute('aria-pressed', on() ? 'true' : 'false'); draw(); } }, label);
    const lineCount = v.text ? v.text.split('\n').length - (v.text.endsWith('\n') ? 1 : 0) : 0;
    infoEl.replaceChildren(...[...badges, h('span', { class: 'badge' }, `${lineCount} lines`),
      v.truncated && h('span', { class: 'badge warn' }, 'showing the first 1 MB'),
      h('span', { class: 'spacer' }),
      markdown && toggle('Preview', () => preview, () => { preview = !preview; }),
      toggle('Wrap lines', () => wrap, () => { wrap = !wrap; store.set('kumanda.wrap', wrap ? '1' : '0'); })].filter(Boolean));
    body.replaceChildren(content);
    draw();
  })();
  return { close() { cancelled = true; } };
}

// ───────── chat ─────────
const MODE_LABEL = { default: 'Ask for everything', acceptEdits: 'Accept edits', auto: 'Auto', plan: 'Plan mode', bypassPermissions: 'Allow all (risky)' };
// The selects are narrow on the phone: the default option is one word (details in title/aria-label).
const MODEL_LABEL = { '': 'Model', fable: 'Fable', opus: 'Opus', sonnet: 'Sonnet', haiku: 'Haiku' };
const EFFORT_SHORT = { low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh', max: 'max' };
const EFFORT_LABEL = { '': 'Effort: default', ...Object.fromEntries(Object.entries(EFFORT_SHORT).map(([d, a]) => [d, `Effort: ${a}`])) };

function toolSummary(name, g = {}) {
  const file = y => String(y || '').split(/[\\/]/).pop();
  const first = s => String(s || '').split('\n')[0];
  switch (name) {
    case 'Bash': case 'PowerShell': return first(g.command);
    case 'Read': case 'Write': case 'Edit': case 'MultiEdit': case 'NotebookEdit': return file(g.file_path || g.notebook_path);
    case 'Glob': return g.pattern || '';
    case 'Grep': return `${g.pattern || ''}${g.path ? `  ·  ${file(g.path)}` : ''}`;
    case 'WebFetch': return g.url || '';
    case 'WebSearch': case 'ToolSearch': return g.query || '';
    case 'Task': case 'Agent': return g.description || '';
    case 'Skill': return g.skill || '';
    case 'TodoWrite': return `${g.todos?.length || 0} tasks`;
    case 'AskUserQuestion': return g.questions?.[0]?.question || '';
    case 'ExitPlanMode': return 'Plan approval';
    default: return first(Object.values(g).find(v => typeof v === 'string') || '');
  }
}

function toolDetails(name, g = {}) {
  const block = (label, text, cls = '') => [h('div', { class: 'label' }, label), h('pre', { class: `block ${cls}` }, text)];
  if ((name === 'Bash' || name === 'PowerShell') && g.command) return block('Command', g.command);
  if (name === 'Edit' && typeof g.old_string === 'string') {
    return [h('div', { class: 'label' }, g.file_path || 'Edit'),
      h('pre', { class: 'block' },
        h('span', { class: 'diff-del' }, g.old_string.split('\n').map(s => `- ${s}`).join('\n')), '\n',
        h('span', { class: 'diff-add' }, String(g.new_string ?? '').split('\n').map(s => `+ ${s}`).join('\n')))];
  }
  if (name === 'Write' && typeof g.content === 'string') return block(g.file_path || 'File', g.content);
  if (name === 'ExitPlanMode' && typeof g.plan === 'string') return [h('div', { class: 'msg claude', html: md(g.plan) })];
  return block('Input', JSON.stringify(g, null, 2));
}

async function prepareImage(file) {
  // Phone photos are large: keep the long edge at 1568 pixels and convert to JPEG.
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, 1568 / Math.max(bmp.width, bmp.height));
  const canvas = h('canvas', { width: Math.round(bmp.width * scale), height: Math.round(bmp.height * scale) });
  canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height);
  const url = canvas.toDataURL('image/jpeg', 0.86);
  return { type: 'image/jpeg', data: url.slice(url.indexOf(',') + 1), url };
}

function chatView(pid, sid) {
  let source = null, marker = '', live = null, activity = '', closed = false, queue = null;
  let streamingEl = null, streamingText = '', drawTimer = 0, hiddenTimer = 0;
  const tools = new Map(), permissions = new Map(), btws = new Map(), attachments = [];
  let mode = store.get('kumanda.mode') || 'acceptEdits';
  let model = store.get('kumanda.model') || '';
  let effort = store.get('kumanda.effort') || '';
  let effortConfig = null, historyLastRequest = null, savedLimit = null; // Claude Code's effort settings; { effort, model } of the last request in the transcript

  // An unsent prompt is kept per chat: it is still there after visiting another chat and coming back.
  const draftKey = () => `kumanda.draft.${pid}.${sid || 'new'}`;
  const draft = { read: () => store.get(draftKey()) || '', write: m => store.set(draftKey(), m.trim() ? m : '') };

  const titleEl = h('h1', {}, sid ? 'Chat' : 'New chat');
  const streamEl = h('div', { class: 'chat' });
  const scrollEl = h('div', { class: 'scroll' }, streamEl);
  const statusEl = h('div', { class: 'status-bar' });
  const attachmentsEl = h('div', { class: 'attachments' });
  const input = h('textarea', { rows: 1, placeholder: 'Write to Claude… (/btw for a side question)', 'aria-label': 'Prompt' });
  const fileInput = h('input', { type: 'file', accept: 'image/*', multiple: true, hidden: true });
  const modeSelect = h('select', { 'aria-label': 'Permission mode' }, Object.entries(MODE_LABEL).map(([d, a]) => h('option', { value: d }, a)));
  const modelOptions = Object.entries(MODEL_LABEL).map(([d, a]) => h('option', { value: d }, a));
  const modelSelect = h('select', { 'aria-label': 'Model', title: 'Model ("default" = the one in your Claude Code settings, shown in parentheses)' }, modelOptions);
  const effortOptions = Object.entries(EFFORT_LABEL).map(([d, a]) => h('option', { value: d }, a));
  const effortSelect = h('select', { class: 'effort-select', 'aria-label': 'Effort (thinking depth)', title: 'Effort ("default" = the one in your Claude Code settings, shown in parentheses). Low: fast and little quota, max: deepest and most quota' },
    effortOptions);
  const stopButton = h('button', { class: 'btn small danger', type: 'button', hidden: true, onclick: () => api(`/api/session/${sid}/interrupt`, {}).catch(x => toast(x.message)) }, 'Stop');
  const nowButton = h('button', { class: 'btn small', type: 'button', hidden: true, title: 'Send now: interrupt the running work and send this prompt right away (Ctrl+Enter)', 'aria-label': 'Send now', onclick: () => send({ now: true }) }, 'Now');
  const sendButton = h('button', { class: 'btn primary small', type: 'submit', title: 'If Claude is working the prompt is queued; Ctrl+Enter interrupts and sends right away' }, 'Send');
  modeSelect.value = mode; modelSelect.value = model; effortSelect.value = effort;
  input.value = draft.read();

  // The "Effort: default" option says which effort the Claude Code setting really is for the selected model.
  function defaultEffort() {
    if (!effortConfig) return null;
    const models = effortConfig.models || {};
    const runningModel = live && live.state !== 'closed' && (live.requestedModel || '') === modelSelect.value ? live.model : null;
    const alias = modelSelect.value || effortConfig.model || '';
    const full = runningModel || Object.keys(models).find(m => alias && (m === alias || m.includes(`-${alias}-`)));
    return (full && models[full]) || effortConfig.default || null;
  }
  function labelEffort() {
    const v = defaultEffort();
    effortOptions[0].textContent = v ? `Effort: ${EFFORT_SHORT[v] || v} (default)` : EFFORT_LABEL[''];
    const m = effortConfig?.model;
    modelOptions[0].textContent = m ? `Model: ${MODEL_LABEL[m] || m.replace(/^claude-/, '')} (default)` : MODEL_LABEL[''];
  }

  const form = h('form', { class: 'composer', onsubmit: e => { e.preventDefault(); send(); } },
    h('div', { class: 'composer-inner' }, attachmentsEl, input,
      h('div', { class: 'composer-bar' },
        h('button', { class: 'btn flat small', type: 'button', title: 'Add image', 'aria-label': 'Add image', onclick: () => fileInput.click() }, '＋'),
        fileInput, modeSelect, modelSelect, effortSelect, h('span', { class: 'spacer' }), stopButton, nowButton, sendButton)));

  // The products this chat made/changed: the "Products" tab next to the title, a panel opening under the top bar (the
  // composer stays visible). Rescanned when a turn finishes. The open/closed state is remembered per chat.
  const panelKey = `${pid}|tab:${sid}`;
  const productPanel = h('div', { class: 'chat-products', hidden: true });
  const productButton = h('button', { class: 'btn small products-tab', type: 'button', hidden: !sid, 'aria-expanded': 'false', title: 'Products of this chat',
    onclick: () => openProductPanel(productPanel.hidden) }, 'Products');
  function openProductPanel(open) {
    productPanel.hidden = !open;
    productButton.classList.toggle('active', open);
    productButton.setAttribute('aria-expanded', String(open));
    if (open) openBoxes.add(panelKey); else openBoxes.delete(panelKey);
  }
  let productTimer = 0;
  async function loadProducts(fresh) {
    if (!sid || closed) return;
    try {
      const v = await api(`/api/project/${pid}/products?session=${sid}${fresh ? '&fresh' : ''}`);
      if (closed) return;
      productButton.textContent = `Products (${v.products.length})`;
      const top = productPanel.firstElementChild?.scrollTop; // after Show/Hide the panel stays where you were reading
      const inner = h('div', { class: 'chat-products-inner' }, v.products.length
        ? productGrid(pid, v.products, () => loadProducts(false), `${pid}|s:${sid}`)
        : h('div', { class: 'empty' }, 'This chat has not made a product yet. It shows up here when Claude writes or builds a file.'));
      productPanel.replaceChildren(inner);
      if (top) inner.scrollTop = top;
    } catch { /* network error: leave the panel as it is */ }
  }
  const rescanProducts = () => { clearTimeout(productTimer); productTimer = setTimeout(() => loadProducts(true), 1500); };
  if (sid && openBoxes.has(panelKey)) openProductPanel(true);

  const titleRow = h('div', { class: 'title-tabs' }, titleEl, productButton);
  main.replaceChildren(topBar({ title: titleRow, sub: projectName(pid), back: `#/p/${pid}`, pid }), productPanel, scrollEl, statusEl, form);

  // ── drawing ──
  const atBottom = () => scrollEl.scrollHeight - scrollEl.scrollTop - scrollEl.clientHeight < 120;
  let toolGroup = null; // consecutive tool calls are collected into one collapsible row
  function add(el, grouped = false) {
    if (!grouped) toolGroup = null;
    const stick = atBottom();
    if (streamingEl && streamingEl.isConnected) streamEl.insertBefore(el, streamingEl); else streamEl.append(el);
    if (stick) scrollEl.scrollTop = scrollEl.scrollHeight;
    return el;
  }

  // A single tool looks as before; when a second one comes, both go into a closed group summarised as "Bash ×6 · Edit ×2".
  // Clicking the group shows the tools one by one; clicking those shows the command/output.
  function drawTool(o) {
    const state = h('span', { class: 'tool-status pending' }, '…');
    const body = h('div', { class: 'tool-body' }, toolDetails(o.name, o.input));
    const el = h('details', { class: 'tool' },
      h('summary', {}, h('span', { class: 'tool-name' }, o.name), h('span', { class: 'tool-summary' }, toolSummary(o.name, o.input)), state), body);
    tools.set(o.id, { el, body, state });
    if (!toolGroup || !toolGroup.el.isConnected) {
      const summary = h('span', { class: 'tool-summary' });
      const groupState = h('span', { class: 'tool-status' });
      const groupBody = h('div', { class: 'tool-group-body' });
      const g = h('details', { class: 'tool-group single', open: true }, h('summary', {}, h('span', { class: 'tool-name' }, 'Tools'), summary, groupState), groupBody);
      toolGroup = { el: g, body: groupBody, summary, groupState, counts: new Map(), members: [] };
      add(g, true);
    }
    const a = toolGroup;
    a.members.push(o.id);
    a.counts.set(o.name, (a.counts.get(o.name) || 0) + 1);
    a.body.append(el);
    if (a.members.length === 2) { a.el.classList.remove('single'); a.el.open = false; }
    a.summary.textContent = `${a.members.length} steps: ${[...a.counts].map(([name, n]) => (n > 1 ? `${name} ×${n}` : name)).join(' · ')}`;
    tools.get(o.id).group = a;
    groupStatus(a);
    if (atBottom()) scrollEl.scrollTop = scrollEl.scrollHeight;
  }
  function groupStatus(a) {
    const states = a.members.map(id => tools.get(id)?.state.className || '');
    const pending = states.some(d => d.includes('pending')), errors = states.filter(d => d.includes('error')).length;
    a.groupState.className = `tool-status ${pending ? 'pending' : errors ? 'error' : 'done'}`;
    a.groupState.textContent = pending ? '…' : errors ? `✕${errors > 1 ? errors : ''}` : '✓';
  }
  function toolResult(o) {
    const a = tools.get(o.id);
    if (!a) return;
    a.state.className = `tool-status ${o.isError ? 'error' : 'done'}`;
    a.state.textContent = o.isError ? '✕' : '✓';
    if (o.text) a.body.append(h('div', { class: 'label' }, o.isError ? 'Error' : 'Result'), h('pre', { class: `block${o.isError ? ' error' : ''}` }, o.text));
    if (a.group) groupStatus(a.group);
  }
  function settlePendingTools() {
    for (const a of tools.values()) if (a.state.classList.contains('pending')) { a.state.className = 'tool-status'; a.state.textContent = ''; if (a.group) groupStatus(a.group); }
  }

  function drawPermission(o) {
    const reply = async body => {
      try { await api(`/api/session/${sid}/permission`, { request: o.request, ...body }); } catch (x) { toast(x.message); }
    };
    let el;
    if (o.name === 'AskUserQuestion' && Array.isArray(o.input?.questions)) {
      const choices = o.input.questions.map(() => ({ selected: new Set(), other: '' }));
      const answerButton = h('button', { class: 'btn primary', disabled: true, onclick: () => {
        const answers = {};
        o.input.questions.forEach((s, i) => { answers[s.question] = [...choices[i].selected, choices[i].other.trim()].filter(Boolean).join(', '); });
        reply({ decision: 'allow', answers });
      } }, 'Answer');
      const check = () => { answerButton.disabled = !choices.every(s => s.selected.size || s.other.trim()); };
      el = h('div', { class: 'permission question' },
        o.input.questions.map((s, i) => {
          const buttons = (s.options || []).map(opt => h('button', { class: 'option', type: 'button', onclick: e => {
            const b = e.currentTarget, picked = choices[i].selected;
            if (s.multiSelect) { picked.has(opt.label) ? picked.delete(opt.label) : picked.add(opt.label); b.classList.toggle('selected'); }
            else { picked.clear(); picked.add(opt.label); buttons.forEach(d => d.classList.toggle('selected', d === b)); }
            check();
          } }, h('b', {}, opt.label), opt.description && h('span', {}, opt.description)));
          return h('div', { style: 'display:grid;gap:8px' },
            h('div', { class: 'permission-head' }, s.header && h('span', { class: 'badge accent' }, s.header), s.question),
            h('div', { class: 'options' }, buttons),
            h('input', { type: 'text', placeholder: 'Write another answer…', 'aria-label': 'Other answer', oninput: e => { choices[i].other = e.target.value; check(); } }));
        }),
        h('div', { class: 'buttons' }, answerButton, h('button', { class: 'btn', onclick: () => reply({ decision: 'deny', message: 'The user skipped the question without answering.' }) }, 'Skip')));
    } else {
      const plan = o.name === 'ExitPlanMode';
      el = h('div', { class: 'permission' },
        h('div', { class: 'permission-head' }, plan ? 'Plan approval' : 'Permission needed', h('span', { class: 'badge warn' }, o.name)),
        toolDetails(o.name, o.input),
        o.reason && !plan && h('div', { class: 'small muted' }, o.reason),
        h('div', { class: 'buttons' },
          h('button', { class: 'btn primary', onclick: () => reply({ decision: 'allow' }) }, plan ? 'Approve plan' : 'Allow'),
          o.canAlways && !plan && h('button', { class: 'btn', onclick: () => reply({ decision: 'always' }) }, 'Always allow'),
          h('button', { class: 'btn danger', onclick: () => reply({ decision: 'deny' }) }, 'Deny')));
    }
    permissions.set(o.request, el);
    add(el);
  }
  function finishPermission(o) {
    const el = permissions.get(o.request);
    if (!el) return;
    permissions.delete(o.request);
    const result = { allow: 'Allowed', always: 'Always allowed', deny: 'Denied', cancelled: 'Cancelled' }[o.decision] || o.decision;
    el.classList.add('done');
    el.querySelectorAll('.buttons, .options, input').forEach(x => x.remove());
    el.append(h('div', { class: 'small muted' }, result));
  }

  // /btw side question: each id has a single card; history, the live stream and the POST reply refresh the same card.
  // Whatever the order of arrival, an answered card never goes back to "pending".
  function drawBtw(o) {
    const old = btws.get(o.id);
    if (old && o.pending && !old.pending) return;
    const card = old?.card || h('div', { class: 'btw' });
    card.classList.toggle('pending', Boolean(o.pending));
    const body = o.pending ? h('div', { class: 'small muted' }, 'Answering… (the chat is not affected)')
      : o.error ? h('div', { class: 'btw-error' }, o.error)
        : typeof o.answer === 'string' ? h('div', { class: 'msg claude btw-answer', html: md(o.answer) })
          : h('div', { class: 'small muted' }, 'Asked in the terminal. Claude Code does not save the answers to side questions.');
    card.replaceChildren(
      h('div', { class: 'btw-head' }, h('span', { class: 'badge accent' }, '/btw'),
        o.source === 'terminal' && h('span', { class: 'badge' }, 'terminal'),
        o.at && h('span', { class: 'small muted' }, new Date(o.at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }))),
      h('div', { class: 'btw-question' }, o.question), body);
    btws.set(o.id, { card, pending: Boolean(o.pending) });
    if (!old) add(card);
  }

  async function sendBtw(question) {
    if (!question) { toast('Usage: /btw <your question>'); return; }
    if (!sid) { toast('Start the chat before asking a side question'); return; }
    const o = { id: newId(), at: Date.now(), question, source: 'kumanda', pending: true };
    input.value = ''; resize(); draft.write('');
    if (attachments.length) toast('Images are not added to side questions; they stay in the composer');
    drawBtw(o);
    scrollEl.scrollTop = scrollEl.scrollHeight;
    try { drawBtw(await api(`/api/project/${pid}/session/${sid}/btw`, { id: o.id, question, model: modelSelect.value, effort: effortSelect.value })); }
    catch (x) { if (x.status !== 401) drawBtw({ ...o, pending: false, error: x.message }); }
  }

  function drawItem(o) {
    switch (o.type) {
      case 'btw': drawBtw(o); break;
      case 'user':
        add(h('div', { class: 'msg user' }, o.text, o.images ? h('div', { class: 'small muted' }, `${o.images} image${o.images > 1 ? 's' : ''} attached`) : null));
        scrollEl.scrollTop = scrollEl.scrollHeight;
        break;
      case 'text':
        if (streamingEl) { streamingEl.remove(); streamingEl = null; streamingText = ''; }
        add(h('div', { class: 'msg claude', html: md(o.text) }));
        break;
      case 'tool': drawTool(o); break;
      case 'tool-result': toolResult(o); break;
      case 'permission': drawPermission(o); break;
      case 'permission-reply': finishPermission(o); break;
      case 'note': add(h('div', { class: 'msg note' }, o.text)); break;
      case 'error': add(h('div', { class: 'msg error' }, o.text)); break;
      case 'result':
        settlePendingTools();
        if (o.error) add(h('div', { class: 'msg error' }, o.error));
        else if (!o.interrupted) add(h('div', { class: 'msg result', title: o.at ? new Date(o.at).toLocaleString() : '' },
          [o.durationMs ? `Worked for ${formatDuration(o.durationMs)}` : 'Done', formatMoment(o.at) && `finished ${formatMoment(o.at)}`].filter(Boolean).join(' · ')));
        break;
      default: break;
    }
  }

  function delta(o) {
    if (!streamingEl || streamingEl.dataset.block !== String(o.block)) {
      streamingEl?.remove();
      streamingText = '';
      streamingEl = null;
      streamingEl = add(h('div', { class: 'msg claude cursor', dataset: { block: String(o.block) } }));
    }
    streamingText = o.full != null ? o.full : streamingText + o.chunk;
    if (!drawTimer) drawTimer = setTimeout(() => {
      drawTimer = 0;
      if (!streamingEl) return;
      const stick = atBottom();
      streamingEl.innerHTML = md(streamingText);
      if (stick) scrollEl.scrollTop = scrollEl.scrollHeight;
    }, 60);
  }

  function drawStatus() {
    const d = live?.state;
    const working = d === 'running' || d === 'waiting';
    stopButton.hidden = !working;
    nowButton.hidden = !working;
    const left = d === 'running' ? `${activity || 'Working'}…` : d === 'waiting' ? 'Waiting for your answer' : d === 'ready' ? 'Ready' : '';
    // Usage arrives after a request; with no open process the last value saved by the server is shown. A window whose
    // reset time has passed is stale and not shown.
    const l = live?.limit || savedLimit;
    const valid = resetsAt => !resetsAt || resetsAt * 1000 > Date.now();
    // Effort: what the last API request really used (Claude Code writes it to the transcript); the select shows the next prompt's.
    const last = live?.lastRequest || historyLastRequest;
    const right = [(live?.model || last?.model)?.replace(/^claude-/, ''), last?.effort ? `effort ${EFFORT_SHORT[last.effort] || last.effort}` : null,
      l?.fiveHour != null && valid(l.fiveHourResetsAt) ? `5h ${Math.round(l.fiveHour * 100)}%` : null,
      l?.sevenDay != null && valid(l.sevenDayResetsAt) ? `week ${Math.round(l.sevenDay * 100)}%` : null].filter(Boolean).join(' · ');
    const resets = [l?.fiveHourResetsAt && `5-hour window ${formatMoment(l.fiveHourResetsAt * 1000)}`, l?.sevenDayResetsAt && `weekly ${formatMoment(l.sevenDayResetsAt * 1000)}`].filter(Boolean).join(', ');
    statusEl.replaceChildren(d && d !== 'closed' ? h('span', { class: `dot ${d}` }) : '', h('span', {}, left), h('span', { class: 'spacer' }),
      h('span', { title: `Model · effort of the last request · 5-hour and weekly usage${resets ? `. Resets: ${resets}` : ''}${l?.at ? ` (last measured ${formatMoment(l.at)})` : ''}` }, right));
    labelEffort();
    if (live?.mode && d !== 'closed' && modeSelect.value !== live.mode) modeSelect.value = live.mode;
    // Show it if it was changed from another device (only with an open process; when closed the next prompt opens with this device's choice).
    if (live && d !== 'closed' && typeof live.effort === 'string' && effortSelect.value !== live.effort) effortSelect.value = live.effort;
  }

  // ── stream ──
  function onEvent(o) {
    if (queue) { queue.push(o); return; }
    switch (o.type) {
      case 'status':
        live = o; if (o.state !== 'running') activity = '';
        drawStatus();
        if (o.state === 'closed') { closeStream(); settlePendingTools(); }
        break;
      case 'reload': loadHistory(); break;
      case 'delta': delta(o); break;
      case 'activity': activity = o.what; drawStatus(); break;
      case 'limit': if (live) { live.limit = o.limit; drawStatus(); } break;
      default:
        if ((o.type === 'result' || o.type === 'permission') && document.hidden) document.title = '● Kumanda';
        if (o.type === 'result') rescanProducts();
        drawItem(o);
    }
  }

  function closeStream() { source?.close(); source = null; }
  function openStream() {
    if (closed || source || !sid) return;
    const s = new EventSource(`/api/session/${sid}/stream${marker ? `?after=${encodeURIComponent(marker)}` : ''}`);
    source = s;
    s.onmessage = e => { if (e.lastEventId) marker = e.lastEventId; onEvent(JSON.parse(e.data)); };
    s.onerror = () => {
      // Closed for good: the run no longer exists (the server may have restarted). Refresh the history from the transcript.
      if (s.readyState === EventSource.CLOSED && source === s) { source = null; marker = ''; loadHistory(); }
    };
  }

  async function loadHistory(older = false) {
    if (!sid || queue) return;
    queue = [];
    try {
      const v = await api(`/api/project/${pid}/session/${sid}${older === true ? '?older' : ''}`);
      if (closed) return;
      tools.clear(); permissions.clear(); btws.clear(); streamingEl = null; toolGroup = null;
      streamingText = '';
      const fromBottom = scrollEl.scrollHeight - scrollEl.scrollTop; // the reading position must not jump when older ones load
      streamEl.replaceChildren();
      if (v.truncated) streamEl.append(h('button', { class: 'btn small load-older', type: 'button', onclick: () => loadHistory(true) },
        older === true ? 'The whole chat is too long; the oldest part is not shown' : 'Load older messages'));
      for (const o of v.items) drawItem(o);
      settlePendingTools();
      live = v.live;
      historyLastRequest = v.lastRequest || null;
      savedLimit = v.limit || null;
      drawStatus();
      scrollEl.scrollTop = older === true ? scrollEl.scrollHeight - fromBottom : scrollEl.scrollHeight;
    } catch (x) {
      if (x.status === 404) streamEl.replaceChildren(h('div', { class: 'empty' }, 'This chat was not found.'));
      else if (x.status !== 401) toast(x.message);
    } finally {
      const waiting = queue || [];
      queue = null;
      for (const o of waiting) onEvent(o);
      if (live && live.state !== 'closed') openStream();
    }
  }

  // now: if Claude is working, interrupts the running turn and sends right away (Ctrl+Enter in Claude Code); otherwise the prompt is queued.
  async function send({ now = false } = {}) {
    const text = input.value.trim();
    if (!text && !attachments.length) return;
    const btw = /^\/btw(?:\s+([\s\S]*))?$/i.exec(text);
    if (btw) { sendBtw((btw[1] || '').trim()); return; }
    sendButton.disabled = true;
    const working = live?.state === 'running' || live?.state === 'waiting';
    try {
      const r = await api(`/api/project/${pid}/send`, { session: sid, text, images: attachments.map(e => ({ type: e.type, data: e.data })), mode, model, effort: effortSelect.value,
        ...(now && working ? { now: true } : {}) });
      draft.write('');
      input.value = ''; attachments.length = 0; drawAttachments(); resize();
      if (!sid) { sid = r.session; history.replaceState(null, '', `#/p/${pid}/s/${sid}`); titleEl.textContent = text.slice(0, 60) || 'Chat'; productButton.hidden = false; }
      if (r.generation !== live?.generation) { closeStream(); marker = ''; }
      openStream();
    } catch (x) { if (x.status !== 401) toast(x.message); }
    finally { sendButton.disabled = false; }
  }

  // ── composer ──
  function resize() { input.style.height = 'auto'; input.style.height = `${Math.min(input.scrollHeight, innerHeight * 0.4)}px`; }
  function drawAttachments() {
    attachmentsEl.replaceChildren(...attachments.map((e, i) => h('div', { class: 'attachment' }, h('img', { src: e.url, alt: 'Attached image' }),
      h('button', { type: 'button', 'aria-label': 'Remove image', onclick: () => { attachments.splice(i, 1); drawAttachments(); } }, '×'))));
  }
  async function addImages(files) {
    for (const f of files) {
      if (!f.type.startsWith('image/') || attachments.length >= 8) continue;
      try { attachments.push(await prepareImage(f)); } catch { toast('Could not read the image'); }
    }
    drawAttachments();
  }
  input.addEventListener('input', () => { resize(); draft.write(input.value); });
  input.addEventListener('keydown', e => {
    if (e.key !== 'Enter' || e.isComposing) return;
    if (e.ctrlKey || e.metaKey) { e.preventDefault(); send({ now: true }); } // on touch devices too (hardware keyboard)
    else if (!e.shiftKey && !TOUCH) { e.preventDefault(); send(); }
  });
  input.addEventListener('paste', e => {
    const images = [...(e.clipboardData?.files || [])].filter(f => f.type.startsWith('image/'));
    if (images.length) { e.preventDefault(); addImages(images); }
  });
  fileInput.addEventListener('change', () => { addImages([...fileInput.files]); fileInput.value = ''; });
  modeSelect.addEventListener('change', async () => {
    mode = modeSelect.value; store.set('kumanda.mode', mode);
    if (sid && live && live.state !== 'closed') { try { await api(`/api/session/${sid}/mode`, { mode }); } catch (x) { toast(x.message); modeSelect.value = live.mode; } }
  });
  modelSelect.addEventListener('change', async () => {
    model = modelSelect.value; store.set('kumanda.model', model);
    labelEffort();
    if (sid && live && live.state !== 'closed') { try { await api(`/api/session/${sid}/mode`, { model }); } catch (x) { toast(x.message); } }
  });
  effortSelect.addEventListener('change', async () => {
    effort = effortSelect.value; store.set('kumanda.effort', effort);
    if (sid && live && live.state !== 'closed') {
      try { await api(`/api/session/${sid}/mode`, { effort }); toast(live.state === 'running' ? 'Effort applies from the next step' : 'Effort changed'); }
      catch (x) { toast(x.message); effortSelect.value = live.effort ?? ''; }
    }
  });

  // When the tab is hidden, drop the stream: the server knows "nobody is watching" and sends a push to the phone. Back on the tab, it continues.
  const visibility = () => {
    clearTimeout(hiddenTimer);
    if (document.hidden) hiddenTimer = setTimeout(closeStream, 15000);
    else { document.title = 'Kumanda'; if (live && live.state !== 'closed') openStream(); }
  };
  document.addEventListener('visibilitychange', visibility);

  if (sid) {
    loadHistory();
    loadProducts(false);
    api(`/api/project/${pid}`).then(v => { const s = v.sessions.find(x => x.id === sid); if (s && !closed) titleEl.textContent = s.title; }).catch(() => {});
  } else {
    streamEl.append(h('div', { class: 'empty' }, `A new Claude Code chat in the ${projectName(pid) || 'project'} folder. What should be done?`));
    if (!TOUCH) input.focus();
  }
  api(`/api/project/${pid}/effort`).then(v => { if (!closed) { effortConfig = v; labelEffort(); } }).catch(() => {});
  if (input.value) setTimeout(resize, 0); // a restored draft: the composer grows to fit it
  drawStatus();

  return { close() { closed = true; closeStream(); clearTimeout(hiddenTimer); clearTimeout(drawTimer); clearTimeout(productTimer); document.removeEventListener('visibilitychange', visibility); } };
}

// ───────── settings ─────────
function b64Decode(s) {
  const raw = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, c => c.charCodeAt(0));
}

async function enablePush() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    throw new Error(DEVICE === 'ios' ? 'On iPhone first install it with Share → "Add to Home Screen", then open it from there.' : 'This browser or address (https is needed) does not support notifications.');
  }
  if (await Notification.requestPermission() !== 'granted') throw new Error('Notification permission was not given');
  const reg = await navigator.serviceWorker.ready;
  const { key } = await api('/api/push/key');
  const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64Decode(key) });
  await api('/api/push/subscribe', { endpoint: sub.endpoint });
}

function settingsPage() {
  const body = h('div', { class: 'inner' });
  main.replaceChildren(topBar({ title: 'Settings', sub: `Kumanda ${status?.version || ''}` }), h('div', { class: 'scroll' }, body));
  let cancelled = false;

  async function draw() {
    let devices = [], hiddenProjects = [], subscribed = false;
    try {
      devices = (await api('/api/devices')).devices;
      hiddenProjects = (await api('/api/projects?hidden')).projects.filter(p => p.hidden);
      const reg = await navigator.serviceWorker?.getRegistration();
      subscribed = Boolean(await reg?.pushManager?.getSubscription());
    } catch (x) { if (x.status === 401) return; }
    if (cancelled) return;

    const old = h('input', { type: 'password', autocomplete: 'current-password', placeholder: 'Current password' });
    const fresh = h('input', { type: 'password', autocomplete: 'new-password', placeholder: `New password (at least ${status.minPassword} characters)` });
    const folder = h('input', { type: 'text', placeholder: 'C:\\Users\\…\\Project folder', autocapitalize: 'off', spellcheck: false });

    body.replaceChildren(
      h('h2', {}, 'Notifications'),
      h('div', { class: 'card' },
        h('p', { style: 'margin-top:0' }, 'When Claude finishes or waits for permission while the page is not open, this device gets a notification.'),
        h('div', { class: 'buttons' },
          subscribed
            ? h('button', { class: 'btn', onclick: async () => {
              try {
                const s = await (await navigator.serviceWorker.getRegistration()).pushManager.getSubscription();
                await api('/api/push/unsubscribe', { endpoint: s.endpoint }); await s.unsubscribe(); draw();
              } catch (x) { toast(x.message); }
            } }, 'Turn off on this device')
            : h('button', { class: 'btn primary', onclick: async () => { try { await enablePush(); toast('Notifications are on'); draw(); } catch (x) { toast(x.message); } } }, 'Turn on on this device'),
          subscribed && h('button', { class: 'btn', onclick: async () => { try { await api('/api/push/test', {}); toast('Test notification sent'); } catch (x) { toast(x.message); } } }, 'Send a test')),
        h('p', { class: 'small muted', style: 'margin-bottom:0' }, 'On the phone you can install it like an app with "Add to Home screen" in the browser menu. On iPhone notifications only work when installed this way.')),

      h('h2', {}, 'Logged-in devices'),
      h('div', { class: 'card' },
        devices.map(c => h('div', { class: 'setting-row' },
          h('div', { class: 'body' }, h('div', {}, c.device, c.current && h('span', { class: 'badge accent', style: 'margin-left:6px' }, 'this device')),
            h('div', { class: 'small muted' }, `Last seen ${timeAgo(c.lastSeen)}`)),
          !c.current && h('button', { class: 'btn small danger', onclick: async () => { try { await api('/api/devices/close', { id: c.id }); draw(); } catch (x) { toast(x.message); } } }, 'Remove'))),
        h('div', { class: 'buttons', style: 'margin-top:10px' },
          devices.length > 1 && h('button', { class: 'btn', onclick: async () => { try { await api('/api/devices/close', { others: true }); draw(); } catch (x) { toast(x.message); } } }, 'Remove all other devices'),
          h('button', { class: 'btn danger', onclick: async () => { try { await api('/api/logout', {}); } finally { location.reload(); } } }, 'Log out'))),

      h('h2', {}, 'Password'),
      h('form', { class: 'card', style: 'display:grid;gap:8px', onsubmit: async e => {
        e.preventDefault();
        try { await api('/api/password', { old: old.value, password: fresh.value }); old.value = fresh.value = ''; toast('Password changed'); } catch (x) { toast(x.message); }
      } }, old, fresh, h('div', {}, h('button', { class: 'btn', type: 'submit' }, 'Change password'))),

      h('h2', {}, 'Projects'),
      h('div', { class: 'card' },
        h('p', { class: 'small muted', style: 'margin-top:0' }, 'You can also add a folder outside the project folders as a project (its full path on the computer).'),
        h('form', { style: 'display:flex;gap:8px', onsubmit: async e => {
          e.preventDefault();
          try { await api('/api/project-add', { path: folder.value.trim() }); folder.value = ''; toast('Project added'); refreshProjects(); } catch (x) { toast(x.message); }
        } }, folder, h('button', { class: 'btn', type: 'submit' }, 'Add')),
        hiddenProjects.length ? [h('div', { class: 'label', style: 'margin-top:14px' }, 'Hidden projects'),
          hiddenProjects.map(p => h('div', { class: 'setting-row' }, h('div', { class: 'body' }, p.name),
            h('button', { class: 'btn small', onclick: async () => { try { await api(`/api/project/${p.id}/hide`, { hidden: false }); refreshProjects(); draw(); } catch (x) { toast(x.message); } } }, 'Show')))] : null));
  }
  draw();
  return { close() { cancelled = true; } };
}

// ───────── start ─────────
async function start() {
  try { status = await (await fetch('/api/status')).json(); }
  catch { app.replaceChildren(h('div', { class: 'center muted' }, 'Cannot reach Kumanda. Is the computer on and connected?')); setTimeout(start, 4000); return; }
  if (!status.setUp || !status.loggedIn) return showLogin();
  shell();
  addEventListener('hashchange', route);
  // VS Code shortcuts: Ctrl+B project list, Ctrl+Shift+E files.
  document.addEventListener('keydown', e => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
    const key = String(e.key).toLowerCase();
    if (key === 'b' && !e.shiftKey) { e.preventDefault(); toggleSide(); }
    else if (key === 'e' && e.shiftKey && explorerPid) { e.preventDefault(); toggleExplorer(); }
  });
  let resizeTimer = 0;
  addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => { applyLayout(); drawTree(); }, 150); });
  route();
  await refreshProjects();
  setInterval(() => { if (!document.hidden) refreshProjects(); }, 20000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshProjects(); });
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
    navigator.serviceWorker.addEventListener('message', e => { if (typeof e.data?.go === 'string') location.hash = e.data.go.replace(/^\/?#?/, '#'); });
  }
}
start();
