// UI smoke test: runs app.js with a fake DOM and fake server replies; draws every view and every event type and
// clicks the buttons. The goal is not visual correctness but catching runtime errors (typos, missing fields) without
// opening a browser. The view must still be tried in a real browser.
import test from 'node:test';
import assert from 'node:assert/strict';

const all = [];   // every element created
const errors = [];
process.on('unhandledRejection', e => errors.push(e));

const node = c => (c?.nodeType ? c : { nodeType: 3, text: String(c) });
let focused = null;

function element(tag) {
  const classes = () => new Set(h.className.split(/\s+/).filter(Boolean));
  const h = {
    tag, nodeType: 1, children: [], listeners: {}, dataset: {}, style: { setProperty: () => {} }, className: '', isConnected: true, value: '', files: [],
    scrollHeight: 0, scrollTop: 0, clientHeight: 0, innerHTML: '', textContent: '', width: 10, height: 10, blurred: false,
    classList: {
      add: (...a) => { h.className = [...new Set([...classes(), ...a])].join(' '); },
      remove: (...a) => { h.className = [...classes()].filter(s => !a.includes(s)).join(' '); },
      contains: a => classes().has(a),
      toggle: (a, force) => { const has = classes().has(a); const on = force === undefined ? !has : force; h.classList[on ? 'add' : 'remove'](a); return on; },
    },
    // Like the real DOM: anything that is not a node (null, array, object) becomes text, so misuse becomes visible.
    append: (...c) => { h.children.push(...c.map(node)); },
    remove: () => {}, replaceChildren: (...c) => { h.children = c.map(node); }, insertBefore: a => { h.children.push(a); return a; },
    addEventListener: (t, f) => { (h.listeners[t] ||= []).push(f); }, removeEventListener: () => {}, setAttribute: () => {},
    querySelector: () => null, querySelectorAll: () => [], focus: () => { focused = proxy; }, blur: () => { h.blurred = true; if (focused === proxy) focused = null; }, click: () => {},
    getContext: () => ({ drawImage: () => {} }), toDataURL: () => 'data:image/jpeg;base64,AAAA',
  };
  const proxy = new Proxy(h, { has: (_, k) => typeof k === 'string' && !k.includes('-') });
  all.push(proxy);
  return proxy;
}

const SID = '11111111-2222-4333-8444-555555555555', PID = 'aaaaaaaaaaaa';
const now = Date.now();
const products = [
  { path: 'index.html', name: 'index.html', kind: 'web', size: 900, mtime: now, title: 'Alpha Site', session: SID },
  { path: 'dist/a-debug.apk', name: 'a-debug.apk', kind: 'android', size: 5e6, mtime: now - 9e7, secondary: 'debug build', session: SID },
  { path: 'dist/a.exe', name: 'a.exe', kind: 'windows', size: 5e7, mtime: now - 9e9, hidden: true },
  { path: 'docs/deck.pptx', name: 'deck.pptx', kind: 'document', size: 100, mtime: now },
  { path: 'note.pdf', name: 'note.pdf', kind: 'document', size: 100, mtime: now },
  { path: 'dist/a.zip', name: 'a.zip', kind: 'archive', size: 100, mtime: now },
  { path: 'v/a.mp4', name: 'a.mp4', kind: 'video', size: 100, mtime: now },
];
const project = { id: PID, name: 'Alpha', path: 'C:\\x\\Alpha', sessionCount: 1, lastActivity: now - 5000, hidden: false };
const RICH = '# Title\n\nA **bold**, *italic*, `code` and [link](https://example.com) <script>alert(1)</script>\n\n- one\n  - inner\n- two\n\n1. a\n2. b\n\n> quote\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n```js\nconst x = "<b>";\n```\n\n---\nend';
const replies = {
  '/api/status': { version: '2.0.0', setUp: true, local: true, minPassword: 10, loggedIn: true },
  '/api/projects': { projects: [{ ...project, productCount: 2, live: ['running'] }, { ...project, id: 'bbbbbbbbbbbb', name: 'Beta', lastActivity: 0, productCount: 0, live: [], hidden: true }] },
  [`/api/project/${PID}`]: { project, sessions: [{ id: SID, title: 'First chat', mtime: now, live: 'waiting' }, { id: 'x', title: 'Old', mtime: now - 9e9, live: null }] },
  [`/api/project/${PID}/products`]: { products, sessions: { [SID]: { title: 'APK build chat', mtime: now } } },
  '/api/products': { groups: [{ project, products, sessions: { [SID]: { title: 'APK build chat', mtime: now } } }] },
  [`/api/project/${PID}/session/${SID}`]: {
    truncated: true,
    items: [{ type: 'user', text: 'hi', images: 1 }, { type: 'text', text: RICH }, { type: 'tool', id: 't0', name: 'Read', input: { file_path: 'C:\\a\\b.txt' } }, { type: 'tool-result', id: 't0', isError: false, text: 'content' }, { type: 'note', text: '/clear' }, { type: 'btw', id: 'b0', at: now, question: 'terminal question', source: 'terminal' }],
    live: { type: 'status', state: 'running', mode: 'default', model: 'claude-x', generation: 'n1', limit: { fiveHour: 0.5, sevenDay: 0.1 } },
    lastRequest: { effort: 'high', model: 'claude-x' },
  },
  [`/api/project/${PID}/effort`]: { default: 'medium', model: 'opus', models: { 'claude-opus-5-5': 'high' } },
  '/api/project-create': { project: { id: 'cccccccccccc', name: 'Test Project' } },
  '/api/devices': { devices: [{ id: 'k1', device: 'Android · Chrome', lastSeen: now, current: true }, { id: 'k2', device: 'Windows · Edge', lastSeen: now - 1e6, current: false }] },
  [`/api/project/${PID}/send`]: { session: SID, generation: 'n1' },
  '/api/snippets': { snippets: ['Continue.', 'Run the tests'] },
  '/api/schedule': { items: [{ id: 's1', project: PID, session: SID, text: 'later prompt', at: now + 3600e3, state: 'waiting' }], limitResetsAt: now + 7200e3 },
  '/api/drafts': { text: '', at: 0 },
  [`/api/project/${PID}/commands`]: { fromClaude: true, commands: [{ name: 'handoff', kind: 'skill', description: 'Keeps the handoff docs' }, { name: 'compact', kind: 'built-in', description: 'Compact' }] },
  [`/api/project/${PID}/artifacts`]: { artifacts: [{ url: 'https://claude.ai/code/artifact/abc', title: 'Weekly report', file: 'weekly-report.html', at: now, session: SID }] },
  [`/api/project/${PID}/git`]: { repo: true, branch: 'main', upstream: 'origin/main', ahead: 1, behind: 0,
    files: [{ path: 'src/a.js', status: 'modified', staged: false }, { path: 'n.txt', status: 'new', staged: false }],
    commits: [{ hash: 'abcdef1234567890', short: 'abcdef1', author: 'E', at: now, subject: 'First commit' }] },
  [`/api/project/${PID}/git/diff`]: { text: 'diff --git a/a b/a\n@@ -1 +1 @@\n-old line\n+new line\n', truncated: false },
  '/api/search': { results: [{ project: PID, projectName: 'Alpha', session: SID, title: 'First chat', mtime: now, byTitle: false, matches: [{ role: 'user', text: 'hello world', at: now }] }], truncated: false },
  [`/api/project/${PID}/files`]: { path: '', truncated: true, entries: [
    { name: 'src', path: 'src', dir: true, size: 0, mtime: now }, { name: 'README.md', path: 'README.md', dir: false, size: 20, mtime: now },
    { name: 'a.js', path: 'src/a.js', dir: false, size: 20, mtime: now }] },
};
// File viewer: different replies by the path query.
const CODE = 'import x from "y";\n// a comment line\nconst num = 42; /* block\ncomment */\nfunction add(a, b) { return a + b; }\nconst s = `template ${num}`;\n';
const files = {
  'src/a.js': { name: 'a.js', path: 'src/a.js', size: CODE.length, mtime: now, kind: 'text', text: CODE, truncated: false },
  'README.md': { name: 'README.md', path: 'README.md', size: 20, mtime: now, kind: 'text', text: '# Title\n\n<script>alert(1)</script> **bold**', truncated: true },
  'p.ps1': { name: 'p.ps1', path: 'p.ps1', size: 20, mtime: now, kind: 'text', text: '<# block #>\n$name = "x" # comment\nif ($true) { Write-Host $name }' },
  'i.png': { name: 'i.png', path: 'i.png', size: 4, mtime: now, kind: 'image', mime: 'image/png', data: 'AAAA' },
  'a.apk': { name: 'a.apk', path: 'a.apk', size: 4, mtime: now, kind: 'binary' },
};
const requests = [];

const streams = [];
class FakeEventSource {
  static CLOSED = 2;
  constructor(url) { this.url = url; this.readyState = 1; streams.push(this); }
  close() { this.readyState = 2; }
}

const doc = {
  hidden: false, title: 'Kumanda', body: element('body'), listeners: {},
  getElementById: () => root, createElement: element, createTextNode: m => ({ nodeType: 3, text: m }),
  querySelector: () => null, querySelectorAll: () => [], addEventListener: (t, f) => { (doc.listeners[t] ||= []).push(f); }, removeEventListener: () => {},
};
const root = element('div');
const win = {};
const define = (name, value) => Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
define('document', doc);
define('navigator', { userAgent: 'Mozilla/5.0 (Linux; Android 14) Chrome/130', platform: 'Linux', maxTouchPoints: 5 });
define('matchMedia', () => ({ matches: false }));
const drafts = new Map(); // only prompt drafts are kept (the other settings start with defaults in every view)
define('localStorage', { getItem: k => drafts.get(k) ?? null, setItem: (k, v) => { if (k.startsWith('kumanda.draft.')) drafts.set(k, v); }, removeItem: k => drafts.delete(k) });
define('location', { hash: '', reload: () => {} });
define('history', { replaceState: (_, __, h) => { location.hash = h; } });
define('addEventListener', (t, f) => { (win[t] ||= []).push(f); });
define('innerHeight', 800);
define('innerWidth', 390);
define('removeEventListener', () => {});
define('EventSource', FakeEventSource);
define('setInterval', () => 0);
define('createImageBitmap', async () => ({ width: 4000, height: 3000 }));
define('fetch', async (url, opts) => {
  requests.push({ url, body: opts?.body ? JSON.parse(opts.body) : null });
  const [where, query = ''] = url.split('?');
  if (where === `/api/project/${PID}/files` && new URLSearchParams(query).get('path') === 'src') {
    return { ok: true, status: 200, json: async () => ({ path: 'src', entries: [{ name: 'a.js', path: 'src/a.js', dir: false, size: 20, mtime: now }] }) };
  }
  if (where.endsWith('/btw')) {
    const g = JSON.parse(opts.body);
    return { ok: true, status: 200, json: async () => ({ ...g, at: now, source: 'kumanda', answer: '**side answer**' }) };
  }
  if (where === `/api/project/${PID}/file`) {
    const d = files[new URLSearchParams(query).get('path')];
    return d ? { ok: true, status: 200, json: async () => d } : { ok: false, status: 404, json: async () => ({ error: 'File not found' }) };
  }
  const j = replies[where] || { ok: true };
  return { ok: true, status: 200, json: async () => j };
});

const wait = ms => new Promise(c => setTimeout(c, ms));
async function go(hash) { location.hash = hash; for (const f of win.hashchange || []) f(); await wait(30); }
const event = el => ({ preventDefault() {}, currentTarget: el, target: el, key: 'a', clipboardData: { files: [] } });
/** Runs the click/submit listeners of the elements created after `from`. */
async function clickAll(from, skip = () => false) {
  const run = async el => { for (const type of ['click', 'submit', 'input', 'change', 'keydown', 'paste']) for (const f of el.listeners[type] || []) await f(event(el)); };
  const later = [];
  for (const el of all.slice(from)) {
    if (skip(el)) continue;
    if (el.disabled === true) { later.push(el); continue; } // a disabled button cannot be clicked
    await run(el);
  }
  for (const el of later) if (el.disabled !== true) await run(el); // ones enabled by other clicks
  await wait(20);
}
const texts = el => (el.children || []).flatMap(c => (c.nodeType === 3 ? [c.text] : texts(c)));
const fileHrefOf = p => `#/p/${PID}/f/${encodeURIComponent(p)}`;
const isBtwCard = e => /^btw( pending)?$/.test(e.className);

test('UI: every view and event type draws without errors', async () => {
  await import('../web/app.js');
  await wait(50);
  assert.deepEqual(root.children.slice(0, 3).map(c => c.id || c.tag), ['side', 'explorer', 'main'], 'the shell (side + explorer + main) is built');
  assert.ok(texts(root).includes('Alpha'), 'the project list is drawn');

  assert.ok(all.some(e => e.tag === 'a' && e.href === `#/p/${PID}/last`), 'a project in the sidebar goes to its latest chat');
  await go(`#/p/${PID}/last`);
  await wait(30);
  assert.equal(location.hash, `#/p/${PID}/s/${SID}`, 'the latest chat opened');
  const newButton = all.find(e => e.title === 'New project');
  for (const f of newButton.listeners.click) f(event(newButton));
  const newName = all.findLast(e => e.placeholder === 'Project name');
  newName.value = 'Test Project';
  const newForm = all.findLast(e => e.tag === 'form' && e.listeners.submit && all.indexOf(e) > all.indexOf(newName));
  for (const f of newForm.listeners.submit) await f(event(newForm));
  await wait(30);
  assert.deepEqual(requests.findLast(i => i.url === '/api/project-create')?.body, { name: 'Test Project' });
  assert.equal(location.hash, '#/p/cccccccccccc/new', 'a new chat opens in the new project');
  streams.length = 0; // the streams of the latest-chat and new-chat screens must not affect the count below

  let from = all.length;
  await go(`#/p/${PID}`);
  assert.ok(texts(root).includes('First chat'));
  await go(`#/p/${PID}/products`);
  assert.ok(texts(root).includes('Alpha Site'));
  assert.ok(texts(root).includes('APK build chat'), 'products are grouped under the chat title');
  assert.ok(texts(root).includes('Not linked to a chat'));
  assert.ok(all.slice(from).some(e => e.tag === 'a' && e.className === 'session-head' && e.href === `#/p/${PID}/s/${SID}`), 'the group title goes to the chat');
  assert.ok(texts(root).includes('Install'), '"Install" for an APK on an Android device');
  assert.ok(texts(root).includes('Windows only'));
  const links = all.slice(from).filter(e => e.tag === 'a' && String(e.href).startsWith('/open?'));
  assert.ok(links.some(e => e.href === `/open?p=${PID}&path=index.html`));
  assert.ok(links.some(e => e.href === `/open?p=${PID}&path=${encodeURIComponent('dist/a-debug.apk')}&download=1`));
  await clickAll(from);
  const many = requests.filter(i => i.url === `/api/project/${PID}/hide-products` && i.body?.paths);
  assert.ok(many.some(i => i.body.hidden === false && i.body.paths.join() === 'dist/a.exe'), '"Show all hidden" goes in one request');
  // A "Hidden by you" box left open stays open when the list is redrawn (after Show).
  const box = all.findLast(e => e.tag === 'details' && e.className === 'more hidden-box');
  box.open = true;
  for (const f of box.listeners.toggle) f();
  from = all.length;
  await go(`#/p/${PID}/products`);
  assert.equal(all.slice(from).find(e => e.tag === 'details' && e.className === 'more hidden-box')?.open, true, 'the box stays open');
  await go('#/products');
  const allTexts = texts(root);
  assert.ok(allTexts.includes('Alpha ›') && allTexts.includes('APK build chat') && allTexts.includes('Not linked to a chat'),
    'the all-products page is split into project → chat too');
  assert.ok(requests.some(i => i.url === '/api/products?hidden'), 'hidden ones are requested too');
  assert.ok(allTexts.some(m => m.startsWith('Hidden by you (1)')), 'a hidden product is in its own box');
  assert.ok(allTexts.some(m => m.startsWith('Other files (1)')), 'a debug build does not mix with the hidden ones');
  await go('#/settings');
  await wait(50);
  assert.ok(texts(root).includes('Windows · Edge'));
  from = all.length - 200;
  await clickAll(Math.max(0, from), el => texts(el).includes('Log out'));

  // chat: history + live stream
  from = all.length;
  await go(`#/p/${PID}/s/${SID}`);
  await wait(50);
  const rich = all.slice(from).find(e => e.className === 'msg claude' && e.innerHTML.includes('<h1>'));
  assert.ok(rich, 'the Markdown in the history is drawn');
  for (const piece of ['<strong>bold</strong>', '<em>italic</em>', '<code>code</code>', '<a href="https://example.com"', '<ul><li>one<ul><li>inner</li></ul></li><li>two</li></ul>', '<ol><li>a</li><li>b</li></ol>', '<blockquote>', '<table>', '<pre><code>const x = &quot;&lt;b&gt;&quot;;</code></pre>', '<hr>']) {
    assert.ok(rich.innerHTML.includes(piece), `Markdown: ${piece}\n${rich.innerHTML}`);
  }
  assert.ok(!rich.innerHTML.includes('<script>'), 'HTML is escaped');
  assert.equal(streams.length, 1, 'a stream opened for the live session');
  assert.ok(requests.some(i => i.url === `/api/project/${PID}/products?session=${SID}`), 'the chat\'s products were requested');
  // The "Products" tab next to the chat title opens only this chat's products.
  const panel = all.slice(from).find(e => e.className === 'chat-products');
  const tab = all.slice(from).find(e => e.className.includes('products-tab'));
  assert.equal(tab.textContent, `Products (${products.length + 1})`, "the product count on the tab (the files + the chat's artifact)");
  assert.equal(panel.hidden, true, 'the panel starts closed');
  for (const f of tab.listeners.click) f(event(tab));
  assert.equal(panel.hidden, false, 'the tab opens the panel');
  assert.ok(texts(panel).includes('Alpha Site'));
  // The project's other chats: the back arrow says "Chats" (shown on the desktop too) and goes to the chat list.
  assert.ok(all.slice(from).some(e => e.tag === 'a' && e.className.includes('back') && !e.className.includes('home') && e.href === `#/p/${PID}` && e.title === 'Chats'));
  // VS Code: opens this project and chat on the computer.
  const vscodeButton = all.slice(from).find(e => e.className.includes('vscode-button'));
  for (const f of vscodeButton.listeners.click) await f(event(vscodeButton));
  assert.deepEqual(requests.findLast(i => i.url === `/api/project/${PID}/vscode`)?.body, { session: SID });
  // Effort: the "default" option writes the real value, the status bar the last request's effort.
  assert.equal(all.slice(from).find(e => e.tag === 'option' && e.value === '' && texts(e)[0]?.startsWith('Effort'))?.textContent, 'Effort: medium (default)');
  assert.equal(all.slice(from).find(e => e.tag === 'option' && e.value === '' && texts(e)[0] === 'Model')?.textContent, 'Model: Opus (default)');
  assert.ok(texts(root).some(m => m === 'x · effort high · 5h 50% · week 10%'), 'the effort in the status bar');
  const s = streams[0];
  assert.equal(s.url, `/api/session/${SID}/stream`);
  let n = 0;
  const push = (o, persistent = true) => s.onmessage({ data: JSON.stringify(persistent ? { ...o, seq: ++n } : o), lastEventId: persistent ? `n1:${n}` : '' });
  push({ type: 'status', state: 'running', mode: 'acceptEdits', model: 'claude-x', generation: 'n1', limit: null }, false);
  push({ type: 'user', text: 'do this', images: 0 });
  push({ type: 'activity', what: 'Thinking' }, false);
  push({ type: 'delta', block: 1, chunk: 'Hel' }, false);
  push({ type: 'delta', block: 1, chunk: 'lo **world**' }, false);
  await wait(90);
  assert.ok(all.some(e => e.className.includes('cursor') && e.innerHTML === '<p>Hello <strong>world</strong></p>'), 'the streaming text is drawn');
  push({ type: 'delta', block: 2, full: 'from scratch' }, false);
  push({ type: 'text', text: 'Hello **world**', block: 2 });
  push({ type: 'tool', id: 't1', name: 'Edit', input: { file_path: 'a.js', old_string: 'x', new_string: 'y' } });
  push({ type: 'tool', id: 't2', name: 'Bash', input: { command: 'npm test\nsecond line' } });
  push({ type: 'tool', id: 't3', name: 'Write', input: { file_path: 'b.txt', content: 'content' } });
  push({ type: 'tool', id: 't4', name: 'Unknown', input: { num: 3 } });
  for (const name of ['Grep', 'Glob', 'WebFetch', 'WebSearch', 'Task', 'Skill', 'TodoWrite']) push({ type: 'tool', id: `x-${name}`, name, input: { pattern: 'p', path: 'C:\\a', todos: [1] } });
  // consecutive tools in one collapsible group: the summary gives counts, the group starts closed
  const group = all.findLast(e => e.className === 'tool-group');
  assert.ok(group, 'two or more tools are grouped');
  assert.equal(group.open, false);
  assert.ok(all.some(e => e.className === 'tool-summary' && String(e.textContent).startsWith('11 steps: Edit · Bash · Write')), 'group summary');
  assert.ok(all.some(e => e.className === 'tool-group single'), 'a single tool shows without grouping');
  const olderButton = all.find(e => e.className === 'btn small load-older');
  for (const f of olderButton.listeners.click) await f(event(olderButton));
  await wait(20);
  assert.ok(requests.some(i => i.url === `/api/project/${PID}/session/${SID}?older`), 'older messages are requested');
  push({ type: 'permission', request: 'i1', toolUseId: 't2', name: 'Bash', input: { command: 'npm test' }, reason: 'needs approval', canAlways: true });
  push({ type: 'status', state: 'waiting', mode: 'plan', model: 'claude-x', generation: 'n1', limit: { fiveHour: 0.9, sevenDay: 0.4 } }, false);
  push({ type: 'permission', request: 'i2', name: 'AskUserQuestion', input: { questions: [{ question: 'Which one?', header: 'Pick', multiSelect: false, options: [{ label: 'A', description: 'a' }, { label: 'B' }] }, { question: 'Several?', multiSelect: true, options: [{ label: 'X' }, { label: 'Y' }] }] } });
  push({ type: 'permission', request: 'i3', name: 'ExitPlanMode', input: { plan: '## Plan\n1. one' } });
  const permissionFrom = all.length - 120;
  await clickAll(Math.max(0, permissionFrom));
  const permissionRequests = requests.filter(i => i.url === `/api/session/${SID}/permission`).map(i => i.body);
  assert.ok(permissionRequests.some(g => g.request === 'i1' && g.decision === 'allow'));
  assert.ok(permissionRequests.some(g => g.request === 'i1' && g.decision === 'always'));
  assert.ok(permissionRequests.some(g => g.request === 'i1' && g.decision === 'deny'));
  const answer = permissionRequests.find(g => g.request === 'i2' && g.decision === 'allow');
  assert.deepEqual(Object.keys(answer.answers), ['Which one?', 'Several?']);
  assert.equal(answer.answers['Which one?'], 'B', 'with a single choice the last one clicked stays');
  assert.ok(permissionRequests.some(g => g.request === 'i3' && g.decision === 'allow'));
  for (const [request, decision] of [['i1', 'allow'], ['i2', 'deny'], ['i3', 'cancelled'], ['none', 'allow']]) push({ type: 'permission-reply', request, decision });
  push({ type: 'tool-result', id: 't1', isError: false, text: '' });
  push({ type: 'tool-result', id: 't2', isError: true, text: 'exploded' });
  push({ type: 'tool-result', id: 'unknown', isError: false, text: 'x' });
  push({ type: 'note', text: 'Context compacted' });
  push({ type: 'error', text: 'An error' });
  push({ type: 'limit', limit: { fiveHour: 0.95, sevenDay: 0.5 } }, false);
  push({ type: 'result', error: null, interrupted: false, durationMs: 75000, at: now });
  push({ type: 'result', error: 'Quota used up', interrupted: false });
  push({ type: 'result', error: null, interrupted: true });
  const time = new Date(now).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  assert.ok(texts(root).includes(`Worked for 1m 15s · finished ${time}`), 'the duration and finish time are written');
  // /btw side questions: a terminal card without an answer; live "pending" → the answer updates the same card
  assert.ok(texts(root).includes('terminal question') && texts(root).some(m => m.startsWith('Asked in the terminal')), 'the terminal /btw is in the history');
  const cardsBefore = all.filter(isBtwCard).length;
  push({ type: 'btw', id: 'b1', at: now, question: 'live side', source: 'kumanda', pending: true });
  push({ type: 'btw', id: 'b1', at: now, question: 'live side', source: 'kumanda', answer: '**reply**' });
  push({ type: 'btw', id: 'b1', at: now, question: 'live side', source: 'kumanda', pending: true });
  assert.equal(all.filter(isBtwCard).length, cardsBefore + 1, 'one card per id');
  const card = all.findLast(isBtwCard);
  assert.equal(card.className, 'btw', 'an answered card does not go back to "pending"');
  assert.ok(card.children.some(c => c.innerHTML === '<p><strong>reply</strong></p>'), 'the answer is drawn as Markdown');
  const chatInput = all.findLast(e => e.tag === 'textarea');
  const chatForm = all.findLast(e => e.tag === 'form' && e.className === 'composer');
  chatInput.value = '/btw how is it going?';
  for (const f of chatForm.listeners.submit) await f(event(chatForm));
  await wait(30);
  const btwRequest = requests.findLast(i => i.url === `/api/project/${PID}/session/${SID}/btw`);
  assert.equal(btwRequest?.body.question, 'how is it going?', 'a prompt starting with /btw goes as a side question');
  assert.match(btwRequest.body.id, /^[0-9a-f-]{36}$/);
  assert.ok(!requests.some(i => i.url === `/api/project/${PID}/send` && i.body?.text?.startsWith('/btw')), 'it does not go to the chat itself');
  assert.equal(chatInput.value, '', 'the composer is emptied');
  assert.ok(all.some(e => e.innerHTML === '<p><strong>side answer</strong></p>'), 'the answer is written to the card');
  // Ctrl+Enter: while Claude works, interrupts the running turn and sends right away
  chatInput.value = 'urgent work';
  for (const f of chatInput.listeners.keydown) await f({ key: 'Enter', ctrlKey: true, preventDefault() {} });
  await wait(20);
  assert.equal(requests.findLast(i => i.url === `/api/project/${PID}/send`)?.body.now, true, 'Ctrl+Enter sends "now"');
  push({ type: 'reload' }, false);
  await wait(40);
  push({ type: 'status', state: 'closed', mode: 'default', model: 'claude-x', generation: 'n1', limit: null }, false);
  assert.equal(s.readyState, 2, 'the stream is dropped when the run closes');

  // a published artifact gets a card with its claude.ai link
  push({ type: 'tool', id: 'art1', name: 'Artifact', input: { file_path: 'C:/x/weekly-report.html', title: 'Weekly report' } });
  push({ type: 'tool-result', id: 'art1', isError: false, text: 'Published: https://claude.ai/code/artifact/0a1b' });
  assert.ok(all.some(e => e.tag === 'a' && e.href === 'https://claude.ai/code/artifact/0a1b' && texts(e).includes('Open on claude.ai')), 'artifact card');
  // "/" at the start of the prompt lists the skills; Enter picks the highlighted one
  const slashInput = all.findLast(e => e.tag === 'textarea');
  slashInput.value = '/hand';
  for (const f of slashInput.listeners.input) f(event(slashInput));
  await wait(30);
  const slashMenu = all.findLast(e => e.className === 'slash-menu');
  assert.equal(slashMenu.hidden, false, 'the menu opens');
  assert.ok(texts(slashMenu).includes('/handoff') && !texts(slashMenu).includes('/compact'), 'filtered by what was typed');
  for (const f of slashInput.listeners.keydown) await f({ key: 'Enter', preventDefault() {}, stopPropagation() {} });
  assert.equal(slashInput.value, '/handoff ', 'Enter completes the name');
  assert.ok(!requests.some(i => i.url === `/api/project/${PID}/send` && i.body?.text?.startsWith('/hand')), 'picking does not send');
  slashInput.value = '';
  for (const f of slashInput.listeners.input) f(event(slashInput)); // the emptied composer clears its draft

  // an unsent prompt is not lost when moving to another chat
  await go(`#/p/${PID}/new`);
  const draftInput = all.findLast(e => e.tag === 'textarea');
  draftInput.value = 'a half-written prompt';
  for (const f of draftInput.listeners.input) f(event(draftInput));
  await go(`#/p/${PID}`);
  await go(`#/p/${PID}/new`);
  assert.equal(all.findLast(e => e.tag === 'textarea').value, 'a half-written prompt', 'the draft came back');

  // new chat: on sending, the session id is written to the address and a stream opens
  const before = streams.length;
  await go(`#/p/${PID}/new`);
  const input = all.findLast(e => e.tag === 'textarea');
  const form = all.findLast(e => e.tag === 'form' && e.className === 'composer');
  input.value = 'new prompt';
  const file = all.findLast(e => e.tag === 'input' && e.type === 'file');
  file.files = [{ type: 'image/png' }];
  for (const f of file.listeners.change) await f(event(file));
  await wait(20);
  for (const f of form.listeners.submit) await f(event(form));
  await wait(30);
  const sent = requests.findLast(i => i.url === `/api/project/${PID}/send`).body;
  assert.deepEqual([sent.session, sent.text, sent.mode, sent.effort, sent.images.length], [null, 'new prompt', 'acceptEdits', '', 1]);
  assert.equal(sent.now, undefined, 'in a chat that is not working Enter sends normally');
  assert.equal(drafts.size, 0, 'the draft of a sent prompt is deleted');
  const effortSelect = all.findLast(e => e.tag === 'select' && e['aria-label'] === undefined && e.title?.startsWith('Effort'));
  assert.ok(effortSelect, 'there is an effort select');
  streams.at(-1).onmessage({ data: JSON.stringify({ type: 'status', state: 'ready', mode: 'acceptEdits', effort: '', generation: 'n1' }), lastEventId: '' });
  effortSelect.value = 'high';
  focused = effortSelect;
  for (const f of effortSelect.listeners.change) await f(event(effortSelect));
  await wait(20);
  assert.deepEqual(requests.findLast(i => i.url === `/api/session/${SID}/mode`)?.body, { effort: 'high' }, 'an effort change in a live session goes to the server');
  // After picking from the menu the focus goes back to the prompt: Enter sends the prompt, it does not reopen the menu.
  assert.equal(effortSelect.blurred, true, 'the effort select lets go of the focus');
  assert.equal(focused, input, 'the prompt gets the focus back');
  const modelSelect = all.findLast(e => e.tag === 'select' && e.title?.startsWith('Model'));
  focused = modelSelect;
  for (const f of modelSelect.listeners.change) await f(event(modelSelect));
  assert.equal(focused, input, 'the model select returns the focus too');
  assert.equal(location.hash, `#/p/${PID}/s/${SID}`);
  assert.equal(streams.length, before + 1);
  // if the stream closes for good (the server restarted) the history is reloaded
  const last = streams.at(-1);
  last.readyState = 2;
  last.onerror();
  await wait(40);

  // explorer (project files) and file viewer
  from = all.length;
  await go(`#/p/${PID}/f/${encodeURIComponent('src/a.js')}`);
  await wait(30);
  assert.ok(all.slice(from).some(e => e.className.includes('back') && e.href === `#/p/${PID}/s/${SID}` && e.title === 'Back to chat'),
    'from a file the back arrow returns to the chat it was opened from');
  const explorerButton = all.slice(from).find(e => e.className.includes('explorer-button'));
  assert.ok(explorerButton, 'a Files button on project pages');
  for (const f of explorerButton.listeners.click) f(event(explorerButton));
  await wait(40);
  assert.ok(root.className.includes('explorer-drawer'), 'on the phone the explorer opens as a drawer');
  assert.ok(requests.some(i => i.url === `/api/project/${PID}/files?path=`), 'the root folder was requested');
  assert.ok(requests.some(i => i.url === `/api/project/${PID}/files?path=src`), 'the open file\'s folder opens by itself');
  const tree = all.findLast(e => e.className === 'tree');
  const treeTexts = texts(tree);
  assert.ok(['src', 'a.js', 'README.md'].every(m => treeTexts.includes(m)), treeTexts.join('|'));
  assert.ok(tree.children.some(e => e.className?.includes('selected') && e.href === `#/p/${PID}/f/${encodeURIComponent('src/a.js')}`), 'the open file is selected');
  assert.ok(treeTexts.some(m => m.includes('first 3000')), 'a truncated folder is marked');
  const span = (cls, text) => all.slice(from).some(e => e.className === cls && texts(e).join('') === text);
  for (const [c, m] of [['s-keyword', 'import'], ['s-string', '"y"'], ['s-comment', '// a comment line'], ['s-keyword', 'const'], ['s-number', '42'],
    ['s-comment', '/* block'], ['s-comment', 'comment */'], ['s-function', 'add'], ['s-string', '`template ${num}`']]) assert.ok(span(c, m), `highlighting: ${c} ${m}`);
  const codeEl = all.slice(from).findLast(e => e.className === 'code-view');
  assert.equal(codeEl.children.length, 6, 'one element per line');
  const fileBody = all.slice(from).find(e => e.className === 'file-body');
  assert.ok(fileBody.children.some(c => c.children?.includes(codeEl)), 'the code view is placed on the page');
  await clickAll(from);

  from = all.length;
  await go(`#/p/${PID}/f/README.md`);
  const preview = all.slice(from).find(e => e.className === 'msg claude md-preview');
  assert.ok(preview?.innerHTML.includes('<h1>') && !preview.innerHTML.includes('<script>'), 'the Markdown preview is escaped');
  assert.ok(texts(root).includes('showing the first 1 MB'));
  await clickAll(from);
  assert.ok(all.slice(from).some(e => e.className === 'code-view'), 'with Preview off the source shows');

  from = all.length;
  await go(`#/p/${PID}/f/p.ps1`);
  assert.ok(span('s-comment', '<# block #>') && span('s-variable', '$name') && span('s-keyword', 'if') && span('s-comment', '# comment'), 'PowerShell highlighting');
  from = all.length;
  await go(`#/p/${PID}/f/i.png`);
  assert.ok(all.slice(from).some(e => e.tag === 'img' && e.src === 'data:image/png;base64,AAAA'), 'the image is shown');
  await go(`#/p/${PID}/f/a.apk`);
  assert.ok(texts(root).some(m => m.includes('is not text')));
  await go(`#/p/${PID}/f/missing.txt`);
  assert.ok(texts(root).some(m => m.includes('File not found')));

  // no "Now" list in the sidebar (removed in 2.3.1): chats show only under their project
  assert.ok(!texts(root).includes('Now'), 'no "Now" section in the sidebar');

  // Changes tab (git): files, commits; a diff and a commit view go back to Changes
  from = all.length;
  await go(`#/p/${PID}/changes`);
  assert.ok(texts(root).includes('⎇ main') && texts(root).includes('First commit'), 'branch and commits');
  assert.ok(all.slice(from).some(e => e.tag === 'a' && e.href === `#/p/${PID}/diff/${encodeURIComponent('src/a.js')}`), 'a changed file links to its diff');
  assert.ok(all.slice(from).some(e => e.tag === 'a' && e.href === fileHrefOf('n.txt')), 'a new file opens in the viewer');
  from = all.length;
  await go(`#/p/${PID}/diff/${encodeURIComponent('src/a.js')}`);
  assert.ok(all.slice(from).some(e => e.className === 'ln d-add' && texts(e).join('') === '+new line'), 'additions are marked');
  assert.ok(all.slice(from).some(e => e.className.includes('back') && e.href === `#/p/${PID}/changes` && e.title === 'Changes'), 'back to Changes');
  await go(`#/p/${PID}/commit/abcdef1234567890`);
  assert.ok(requests.some(i => i.url === `/api/project/${PID}/git/diff?commit=abcdef1234567890`));

  // chats tab: message search shows the matching prompt
  from = all.length;
  await go(`#/p/${PID}`);
  const search = all.slice(from).find(e => e.placeholder?.startsWith('Filter chats'));
  search.value = 'hello';
  for (const f of search.listeners.keydown) await f({ key: 'Enter', preventDefault() {} });
  await wait(30);
  assert.ok(requests.some(i => i.url === `/api/search?pid=${PID}&q=hello`), 'the message search went out');
  assert.ok(all.slice(from).some(e => e.tag === 'mark' && texts(e).join('') === 'hello'), 'the match is marked');
  await clickAll(from);

  // share page: the shared text goes into the picked project's new chat
  await go('#/share');
  assert.ok(texts(root).includes('Share to Claude'));

  // sidebar: ☰ opens a drawer on the phone, tapping outside closes it
  const sideButton = all.findLast(e => e.className.includes('side-button'));
  for (const f of sideButton.listeners.click) f(event(sideButton));
  assert.ok(root.className.includes('side-drawer'));
  const backdrop = root.children.find(e => e.className === 'backdrop');
  for (const f of backdrop.listeners.click) f(event(backdrop));
  assert.ok(!root.className.includes('side-drawer') && !root.className.includes('explorer-drawer'));
  await go('#/');

  const broken = all.flatMap(e => e.children.filter(c => c.nodeType === 3 && /^(null|undefined|false|true)$|\[object /.test(c.text)).map(c => `${e.tag}.${e.className}: ${c.text}`));
  assert.deepEqual(broken, [], 'no null/array/object instead of a node into the DOM');
  assert.deepEqual(errors.map(e => e?.stack || String(e)), []);
});
