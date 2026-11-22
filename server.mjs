#!/usr/bin/env node
// Kumanda: two small HTTP servers for using the local Claude Code and project products from any device.
//   control (7777): UI + API. Chat, permissions, project and product lists.
//   product (7778): serves product files from project folders on a SEPARATE origin, so a script in a product
//                   page cannot reach the control API (that is, Claude).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { config, watchConfig, saveConfig, loadConfig, atomicWrite, ROOT, DATA } from './src/config.mjs';
import { HttpError, Router, cookies, setCookie, sendFile, plainText, requestInfo, json, readJson, redirect } from './src/http.mjs';
import * as auth from './src/auth.mjs';
import { readFileForView, safePath, listFolder, sessionFile, listSessions, findProject, hideProject, listProjects, hideProducts, listProducts, linkProductsToSessions } from './src/projects.mjs';
import { EFFORTS, MODELS, MODES, setNotifier, effortSettings, readHistory, send, closeAllRuns, findRun, listRuns, lastRequest, getLastLimit } from './src/sessions.mjs';
import * as push from './src/push.mjs';
import { interleave, askBtw, btwExists, btwQuestions } from './src/btw.mjs';
import { DRAFT_KEY, getDraft, setDraft, getSnippets, setSnippets, SNIPPET_LIMIT, SNIPPET_TEXT, chatFlags, setChatFlags } from './src/store.mjs';
import { listScheduled, addScheduled, removeScheduled, runScheduled, limitResetTime, onScheduleEvent } from './src/schedule.mjs';
import { gitStatus, gitDiff, validGitPath, validHash } from './src/git.mjs';
import { searchChats } from './src/search.mjs';

const VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
const WEB = path.join(ROOT, 'web');
const LOCAL_KEY_FILE = path.join(DATA, 'local-key');
const localAddress = () => `http://127.0.0.1:${config.controlPort}`;

// ───────────── command line ─────────────
const flag = process.argv[2];

const LOG = path.join(DATA, 'server.log');

function startInBackground() {
  // A windowless copy independent of whoever started it (the startup shortcut uses this too).
  try { if (fs.statSync(LOG).size > 2e6) fs.renameSync(LOG, LOG + '.old'); } catch { /* none */ }
  if (process.platform === 'win32' && !process.env.KUMANDA_DIRECT) {
    // On Windows start through WMI: the process does not join the job object of the terminal, VS Code or Claude Code
    // that started it, so it does not die with them. WMI cannot redirect output, so the server writes its own log (--log).
    const quote = s => `"${s}"`;
    const line = [process.execPath, import.meta.filename].map(quote).join(' ') + ' --log';
    const ps = `$b = New-CimInstance -ClassName Win32_ProcessStartup -ClientOnly -Property @{ShowWindow=[uint16]0}; `
      + `$r = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{CommandLine=$env:KUMANDA_CMDLINE; CurrentDirectory=$env:KUMANDA_ROOT; ProcessStartupInformation=$b}; `
      + 'exit $r.ReturnValue';
    const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps],
      { env: { ...process.env, KUMANDA_CMDLINE: line, KUMANDA_ROOT: ROOT }, windowsHide: true, encoding: 'utf8' });
    if (r.status === 0) return;
    console.error(`Could not start through WMI (${r.status ?? r.error?.message}); starting directly.`);
  }
  const out = fs.openSync(LOG, 'a');
  spawn(process.execPath, [import.meta.filename], { detached: true, windowsHide: true, stdio: ['ignore', out, out], cwd: ROOT }).unref();
}
const isRunning = async () => { try { await fetch(`${localAddress()}/api/status`, { signal: AbortSignal.timeout(1500) }); return true; } catch { return false; } };
/** Stops the running server and waits until it has really exited. Returns true if it was running. */
async function stop() {
  if (!(await isRunning())) return false;
  const key = fs.readFileSync(LOCAL_KEY_FILE, 'utf8');
  const post = (route, header) => fetch(`${localAddress()}${route}`, { method: 'POST', headers: { 'X-Kumanda': '1', [header]: key } });
  let r = await post('/api/local/shutdown', 'X-Local-Key');
  if (r.status === 404) r = await post('/api/yerel/kapat', 'X-Yerel-Anahtar'); // a 1.x server is running (update from 1.x)
  if (!r.ok) throw new Error(`Could not stop it (${r.status}).`);
  for (let i = 0; i < 40 && await isRunning(); i++) await new Promise(c => setTimeout(c, 250));
  if (await isRunning()) throw new Error('Kumanda did not shut down.');
  await new Promise(c => setTimeout(c, 300)); // let the process finish exiting
  return true;
}

if (flag === '--background') {
  startInBackground();
  process.exit(0);
} else if (flag === '--log') {
  // The copy started through WMI: it has no console, so it writes its output to the log file itself.
  const stream = fs.createWriteStream(LOG, { flags: 'a' });
  const write = (...a) => stream.write(a.map(x => (typeof x === 'string' ? x : x instanceof Error ? x.stack : JSON.stringify(x))).join(' ') + '\n');
  console.log = console.error = console.warn = write;
  process.on('uncaughtException', e => { write(new Date().toISOString(), 'Unexpected error:', e); stream.end(() => process.exit(1)); });
} else if (flag === '--stop') {
  try { console.log((await stop()) ? 'Kumanda stopped.' : 'Kumanda is not running.'); }
  catch (e) { console.log(e.message); process.exitCode = 1; }
  process.exit();
} else if (flag === '--status') {
  try {
    const d = await (await fetch(`${localAddress()}/api/status`)).json();
    console.log(`Kumanda ${d.version} is running: ${localAddress()}  (password ${d.setUp ? 'set' : 'NOT SET'})`);
  } catch { console.log('Kumanda is not running.'); process.exitCode = 1; }
  process.exit();
} else if (flag === '--ports') {
  console.log(`${config.controlPort} ${config.productPort}`); // for the setup scripts
  process.exit(0);
} else if (flag === '--reset-password') {
  // The running server keeps device sessions in memory: unless it is stopped first, old devices would stay logged in.
  let wasRunning;
  try { wasRunning = await stop(); } catch (e) { console.log(`${e.message} The password was not reset.`); process.exit(1); }
  auth.resetPassword();
  if (wasRunning) startInBackground();
  console.log(`The password and all device sessions were deleted${wasRunning ? '; Kumanda was restarted' : ''}. Set a new password from this computer: ${localAddress()}`);
  process.exit(0);
} else if (flag) {
  console.log(`Unknown option: ${flag}\nOptions: --background, --stop, --status, --ports, --reset-password`);
  process.exit(1);
}

// ───────────── shared ─────────────
// Cookie names stay as in 1.x so devices stay logged in after the update.
const CONTROL_COOKIE = 'kumanda_o', PRODUCT_COOKIE = 'kumanda_u', LAST_COOKIE = 'kumanda_son';
const SECURITY = {
  'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin', 'X-Frame-Options': 'DENY',
  'Content-Security-Policy': "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
};

function productOrigin(info) {
  const custom = config.publicOrigins?.[info.host];
  if (custom) return String(custom).replace(/\/$/, '');
  // Tailscale serve/funnel layout: 443 → control, 8443 → product (remote-setup.ps1 sets it up this way).
  if (info.https && !info.port) return `https://${info.hostname}:8443`;
  return `${info.https ? 'https' : 'http'}://${info.hostname}:${config.productPort}`;
}

/** Does a browser API request really come from the control UI? (product pages and other sites are rejected) */
function originAllowed(req) {
  const site = req.headers['sec-fetch-site'];
  if (site && site !== 'same-origin' && site !== 'none') return false;
  const origin = req.headers.origin;
  if (origin) { try { if (new URL(origin).host !== req.headers.host) return false; } catch { return false; } }
  return true;
}

async function getProject(id) {
  const p = await findProject(id);
  if (!p) throw new HttpError(404, 'Project not found');
  return p;
}
function getRun(session) {
  const r = findRun(session);
  if (!r) throw new HttpError(404, 'This session is not running right now');
  return r;
}
const projectSummary = p => ({ id: p.id, name: p.name, path: p.path, sessionCount: p.sessionCount, lastActivity: p.lastActivity, hidden: p.hidden });

// ───────────── API ─────────────
const api = new Router();
const open = { open: true };

api.add('GET', '/api/status', ({ req, res, info }) => json(res, 200, {
  version: VERSION, setUp: auth.hasPassword(), local: info.local, minPassword: auth.MIN_PASSWORD,
  loggedIn: Boolean(auth.findSession(cookies(req)[CONTROL_COOKIE], 'control')),
}), open);

function logIn(req, res, info) {
  const token = auth.openSession('control', auth.deviceName(req.headers['user-agent']));
  json(res, 200, { ok: true }, { 'Set-Cookie': setCookie(CONTROL_COOKIE, token, { secure: info.https }) });
}

api.add('POST', '/api/setup', async ({ req, res, info }) => {
  if (auth.hasPassword()) throw new HttpError(409, 'The password is already set');
  // The first password can only be set at the computer itself; nobody coming through the tunnel can claim the system.
  if (!info.local) throw new HttpError(403, 'The first password can only be set from the computer itself (localhost)');
  const { password } = await readJson(req, 4096);
  try { await auth.setPassword(password); } catch (e) { throw new HttpError(400, e.message); }
  logIn(req, res, info);
}, open);

api.add('POST', '/api/login', async ({ req, res, info }) => {
  if (!auth.hasPassword()) throw new HttpError(409, 'Set a password on the computer first');
  const allowed = auth.loginAllowed(info.client);
  if (!allowed.allowed) throw new HttpError(429, `Too many wrong attempts. Try again in ${Math.ceil(allowed.wait / 60)} minutes.`);
  const { password } = await readJson(req, 4096);
  if (!(await auth.checkPassword(password))) {
    auth.loginFailed(info.client);
    throw new HttpError(401, 'Wrong password');
  }
  auth.loginSucceeded(info.client);
  logIn(req, res, info);
}, open);

api.add('POST', '/api/logout', ({ req, res, info }) => {
  auth.closeSession(cookies(req)[CONTROL_COOKIE]);
  json(res, 200, { ok: true }, { 'Set-Cookie': setCookie(CONTROL_COOKIE, '', { remove: true, secure: info.https }) });
});

api.add('POST', '/api/password', async ({ req, res, info }) => {
  const allowed = auth.loginAllowed(info.client);
  if (!allowed.allowed) throw new HttpError(429, 'Too many wrong attempts. Try again later.');
  const { old, password } = await readJson(req, 4096);
  if (!(await auth.checkPassword(old))) { auth.loginFailed(info.client); throw new HttpError(401, 'The old password is wrong'); }
  try { await auth.setPassword(password); } catch (e) { throw new HttpError(400, e.message); }
  json(res, 200, { ok: true });
});

api.add('GET', '/api/devices', ({ res, session }) => json(res, 200, { devices: auth.deviceList(session.key) }));
api.add('POST', '/api/devices/close', async ({ req, res, session }) => {
  const { id, others } = await readJson(req, 4096);
  if (others) {
    for (const d of auth.deviceList(session.key)) if (!d.current) auth.closeDevice(auth.deviceKey(d.id));
  } else {
    const key = typeof id === 'string' && id.length === 16 ? auth.deviceKey(id) : null;
    if (!key) throw new HttpError(404, 'Device not found');
    auth.closeDevice(key);
  }
  json(res, 200, { ok: true });
});

api.add('GET', '/api/projects', async ({ res, url }) => {
  const projects = await listProjects({ includeHidden: url.searchParams.has('hidden') });
  const live = listRuns();
  const list = await Promise.all(projects.map(async p => {
    const products = await listProducts(p);
    return { ...projectSummary(p), productCount: products.filter(u => !u.secondary).length, live: live.filter(r => r.project === p.id).map(r => r.state) };
  }));
  json(res, 200, { projects: list });
});

api.add('GET', '/api/products', async ({ res, url }) => {
  const projects = await listProjects();
  const includeHidden = url.searchParams.has('hidden'); // hidden products too (with hidden: true)
  const groups = [];
  for (const p of projects) {
    const products = await listProducts(p, { includeHidden });
    if (products.length) groups.push({ project: projectSummary(p), products, sessions: await linkProductsToSessions(p, products) });
  }
  json(res, 200, { groups });
});

// A single name that can be a folder name on Windows: no path separator, no forbidden character, no leading or
// trailing dot, no reserved name.
const validFolderName = name => Boolean(name) && name.length <= 80 && !/[<>:"/\\|?*\u0000-\u001f]/.test(name) && !/^\./.test(name)
  && !/[. ]$/.test(name) && !/^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$/i.test(name);
const BAD_NAME = 'Invalid project name (at most 80 characters; no / \\ : * ? " < > |, cannot start or end with a dot)';

// New project: creates an empty folder under the first root; Claude Code picks it up in the first chat.
api.add('POST', '/api/project-create', async ({ req, res }) => {
  const { name } = await readJson(req, 4096);
  const clean = typeof name === 'string' ? name.trim() : '';
  if (!validFolderName(clean)) throw new HttpError(400, BAD_NAME);
  const root = config.roots[0];
  if (!root || !fs.existsSync(root)) throw new HttpError(400, 'The projects folder does not exist (config.json → roots)');
  const dir = path.join(root, clean);
  if (path.dirname(dir) !== path.resolve(root)) throw new HttpError(400, 'Invalid project name');
  try { fs.mkdirSync(dir); } catch (e) { throw new HttpError(e.code === 'EEXIST' ? 409 : 500, e.code === 'EEXIST' ? 'A folder with this name already exists' : e.message); }
  const p = (await listProjects({ fresh: true, includeHidden: true })).find(x => x.path.toLowerCase() === dir.toLowerCase());
  json(res, 200, { project: p ? projectSummary(p) : null });
});

api.add('POST', '/api/project-add', async ({ req, res }) => {
  const { path: dir } = await readJson(req, 4096);
  if (typeof dir !== 'string' || !path.isAbsolute(dir) || !fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
    throw new HttpError(400, 'There is no such folder on this computer (write the full path)');
  }
  loadConfig();
  if (!config.extraProjects.some(y => path.resolve(y).toLowerCase() === path.resolve(dir).toLowerCase())) config.extraProjects.push(path.resolve(dir));
  saveConfig();
  const p = (await listProjects({ fresh: true, includeHidden: true })).find(x => x.path.toLowerCase() === path.resolve(dir).toLowerCase());
  json(res, 200, { project: p ? projectSummary(p) : null });
});

api.add('GET', '/api/project/:pid', async ({ res, params }) => {
  const project = await getProject(params.pid);
  const live = new Map(listRuns().filter(r => r.project === project.id).map(r => [r.session, r.state]));
  const sessions = (await listSessions(project)).map(s => ({ id: s.id, title: s.title, mtime: s.mtime, live: live.get(s.id) || null, ...chatFlags(s.id) }));
  // New live sessions whose transcript has not been written yet show up in the list too.
  for (const [session, state] of live) if (!sessions.some(s => s.id === session)) sessions.unshift({ id: session, title: 'New chat', mtime: Date.now(), live: state });
  json(res, 200, { project: projectSummary(project), sessions });
});

api.add('POST', '/api/project/:pid/hide', async ({ req, res, params }) => {
  const project = await getProject(params.pid);
  hideProject(project.id, Boolean((await readJson(req, 4096)).hidden));
  json(res, 200, { ok: true });
});

api.add('GET', '/api/project/:pid/products', async ({ res, params, url }) => {
  const project = await getProject(params.pid);
  let products = await listProducts(project, { fresh: url.searchParams.has('fresh'), includeHidden: url.searchParams.has('hidden') });
  const sessions = await linkProductsToSessions(project, products);
  const only = url.searchParams.get('session'); // only this chat's products
  if (only) products = products.filter(u => u.session === only);
  json(res, 200, { products, sessions });
});

api.add('POST', '/api/project/:pid/hide-products', async ({ req, res, params }) => {
  const project = await getProject(params.pid);
  const { path: one, paths, hidden } = await readJson(req, 512000);
  // A single product (`path`) or many (`paths`, e.g. "Show all").
  const list = paths !== undefined ? paths : [one];
  if (!Array.isArray(list) || !list.length || list.length > 5000 || list.some(y => typeof y !== 'string')) throw new HttpError(400, 'Path required');
  hideProducts(project, list, Boolean(hidden));
  json(res, 200, { ok: true });
});

// Claude Code's effort settings: so the UI can say which effort "Default" really is.
api.add('GET', '/api/project/:pid/effort', async ({ res, params }) => json(res, 200, await effortSettings(await getProject(params.pid))));

// File browser: read only, JSON only (a file is never served as a document from the control origin; opening goes
// through /open on the product origin).
api.add('GET', '/api/project/:pid/files', async ({ res, params, url }) => {
  const v = await listFolder(await getProject(params.pid), url.searchParams.get('path') || '');
  if (!v) throw new HttpError(404, 'Folder not found');
  json(res, 200, v);
});
api.add('GET', '/api/project/:pid/file', async ({ res, params, url }) => {
  const v = await readFileForView(await getProject(params.pid), url.searchParams.get('path') || '');
  if (!v) throw new HttpError(404, 'File not found');
  json(res, 200, v);
});

api.add('GET', '/api/project/:pid/session/:sid', async ({ res, params, url }) => {
  const project = await getProject(params.pid);
  const r = findRun(params.sid);
  const file = await sessionFile(project, params.sid);
  if (!file && !r) throw new HttpError(404, 'Session not found');
  // A closed run (kept in memory for 10 minutes) does not open a stream; then the whole transcript is history.
  const history = file ? await readHistory(file, r && !r.closed ? r.historyLimit : Infinity, url.searchParams.has('older')) : { items: [], truncated: false };
  // With an open run, side questions after its start come from the live stream (not drawn twice, order stays right).
  const first = history.truncated ? history.items.find(o => o.at)?.at || 0 : 0;
  const btws = (await btwQuestions(params.sid)).filter(y => y.at >= first && !(r && !r.closed && y.at >= r.historyLimitAt));
  json(res, 200, { ...history, items: interleave(history.items, btws), live: r ? r.snapshot() : null,
    lastRequest: file ? await lastRequest(file) : null, limit: getLastLimit() });
});

// /btw side question: a tool-less copy of the chat that is never written to disk answers it; the chat itself does not
// change (src/btw.mjs).
api.add('POST', '/api/project/:pid/session/:sid/btw', async ({ req, res, params }) => {
  const project = await getProject(params.pid);
  const g = await readJson(req, 64 * 1024);
  const question = typeof g.question === 'string' ? g.question.trim() : '';
  if (!question || question.length > 20000) throw new HttpError(400, 'The side question is empty or too long');
  if (typeof g.id !== 'string' || !/^[0-9a-f-]{36}$/i.test(g.id)) throw new HttpError(400, 'Invalid id');
  if (g.model != null && !MODELS.includes(g.model)) throw new HttpError(400, 'Invalid model');
  if (g.effort != null && !EFFORTS.includes(g.effort)) throw new HttpError(400, 'Invalid effort');
  if (!await sessionFile(project, params.sid)) throw new HttpError(404, 'This chat has no transcript yet; wait for the first reply');
  if (await btwExists(params.sid, g.id)) throw new HttpError(409, 'This side question was already asked');
  let o;
  try { o = await askBtw(project, params.sid, { id: g.id, question, model: g.model || '', effort: g.effort || '' }, x => findRun(params.sid)?.publishBtw(x)); }
  catch (e) { throw new HttpError(e.status || 500, e.message); }
  json(res, 200, o);
});

// Open the project in VS Code on this computer; with `session`, the chat opens in the Claude Code extension's panel there
// (its URI handler: vscode://anthropic.claude-code/open?session=<id>). VS Code cannot be told from outside to run a command
// in its terminal, so the panel is the way to continue the same session in VS Code.
function vscodeCommand() {
  if (process.env.KUMANDA_VSCODE) { const c = JSON.parse(process.env.KUMANDA_VSCODE); return [c[0], c.slice(1)]; }
  const candidates = [
    config.vscode,
    ...(process.env.PATH || '').split(path.delimiter).filter(Boolean).flatMap(d => (fs.existsSync(path.join(d, 'code.cmd')) ? [path.resolve(d, '..', 'Code.exe')] : [])),
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs', 'Microsoft VS Code', 'Code.exe'),
    process.env.ProgramFiles && path.join(process.env.ProgramFiles, 'Microsoft VS Code', 'Code.exe'),
  ].filter(Boolean);
  const exe = candidates.find(c => fs.existsSync(c));
  return exe ? [exe, []] : null;
}
function launch([command, prefix], args) {
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (/^(ELECTRON_RUN_AS_NODE|CLAUDECODE|CLAUDE_CODE_)/.test(k)) delete env[k];
  spawn(command, [...prefix, ...args], { detached: true, stdio: 'ignore', env }).on('error', e => console.error('VS Code:', e.message)).unref();
}
api.add('POST', '/api/project/:pid/vscode', async ({ req, res, params }) => {
  const project = await getProject(params.pid);
  const { session, file } = await readJson(req, 4096);
  if (session != null && (typeof session !== 'string' || !/^[0-9a-f-]{36}$/i.test(session))) throw new HttpError(400, 'Invalid session');
  if (file != null) {
    // One file of the project, opened in the project's window (the file viewer's "VS Code" button).
    const target = typeof file === 'string' ? safePath(project, file) : null;
    if (!target || !fs.statSync(target).isFile()) throw new HttpError(404, 'File not found');
    const command = vscodeCommand();
    if (!command) throw new HttpError(501, 'VS Code was not found on this computer (set "vscode" in config.json to Code.exe)');
    launch(command, [project.path, target]);
    return json(res, 200, { ok: true });
  }
  if (session && !await sessionFile(project, session)) throw new HttpError(404, 'This chat has no transcript yet; wait for the first reply');
  const command = vscodeCommand();
  if (!command) throw new HttpError(501, 'VS Code was not found on this computer (set "vscode" in config.json to Code.exe)');
  // The same session in two processes would write to one transcript: hand it over only when Kumanda's process is idle.
  const r = session ? findRun(session) : null;
  if (r && !r.closed && r.state !== 'ready') throw new HttpError(409, 'Claude is still working on this chat in Kumanda; wait or stop it first');
  const handed = Boolean(r && !r.closed);
  if (handed) r.close();
  launch(command, [project.path]);
  // Give the window a moment to open on the folder, so the extension looks for the session in the right project.
  if (session) setTimeout(() => launch(command, ['--open-url', `vscode://anthropic.claude-code/open?session=${session}`]), 2500).unref();
  json(res, 200, { ok: true, closedRun: handed });
});

const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
api.add('POST', '/api/project/:pid/send', async ({ req, res, params }) => {
  const project = await getProject(params.pid);
  const g = await readJson(req);
  const text = typeof g.text === 'string' ? g.text.trim() : '';
  const images = Array.isArray(g.images) ? g.images.slice(0, 8) : [];
  for (const i of images) {
    if (!i || !IMAGE_TYPES.has(i.type) || typeof i.data !== 'string' || i.data.length > 7e6 || /[^A-Za-z0-9+/=]/.test(i.data)) throw new HttpError(400, 'Invalid image');
  }
  if (!text && !images.length) throw new HttpError(400, 'Empty prompt');
  if (g.session != null && !/^[0-9a-f-]{36}$/i.test(g.session)) throw new HttpError(400, 'Invalid session');
  if (g.mode != null && !MODES.includes(g.mode)) throw new HttpError(400, 'Invalid mode');
  if (g.model != null && !MODELS.includes(g.model)) throw new HttpError(400, 'Invalid model');
  if (g.effort != null && !EFFORTS.includes(g.effort)) throw new HttpError(400, 'Invalid effort');
  let r;
  try { r = await send(project, { session: g.session || null, text, images, mode: g.mode, model: g.model, effort: g.effort, now: g.now === true }); }
  catch (e) { throw new HttpError(e.message === 'Session not found' ? 404 : 500, e.message); }
  json(res, 200, { session: r.session, generation: r.generation });
});

api.add('GET', '/api/session/:sid/stream', ({ req, res, params, url }) => {
  const r = getRun(params.sid);
  res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', 'X-Accel-Buffering': 'no', Connection: 'keep-alive' });
  res.write('retry: 2000\n\n');
  r.subscribe(res, req.headers['last-event-id'] || url.searchParams.get('after') || '');
  const heartbeat = setInterval(() => res.write(': heartbeat\n\n'), 20000);
  res.on('close', () => clearInterval(heartbeat));
});

api.add('POST', '/api/session/:sid/permission', async ({ req, res, params }) => {
  const r = getRun(params.sid);
  const g = await readJson(req, 200000);
  if (!['allow', 'always', 'deny'].includes(g.decision)) throw new HttpError(400, 'Invalid decision');
  if (!r.answerPermission(String(g.request), g)) throw new HttpError(409, 'This request is no longer waiting');
  json(res, 200, { ok: true });
});

api.add('POST', '/api/session/:sid/interrupt', async ({ res, params }) => { await getRun(params.sid).interrupt(); json(res, 200, { ok: true }); });
api.add('POST', '/api/session/:sid/close', ({ res, params }) => { getRun(params.sid).close(); json(res, 200, { ok: true }); });
api.add('POST', '/api/session/:sid/mode', async ({ req, res, params }) => {
  const r = getRun(params.sid);
  const g = await readJson(req, 4096);
  try {
    if (g.mode != null) await r.setMode(g.mode);
    if (g.model != null) await r.setModel(g.model);
    if (g.effort != null) await r.setEffort(g.effort);
  } catch (e) { throw new HttpError(400, e.message); }
  json(res, 200, r.snapshot());
});

// Every open Claude process with its chat title: the "Now" list at the top of the sidebar.
api.add('GET', '/api/runs', async ({ res }) => {
  const runs = listRuns();
  const titles = new Map();
  for (const pid of new Set(runs.map(r => r.project))) {
    const project = await findProject(pid);
    if (project) for (const s of await listSessions(project)) titles.set(s.id, s.title);
  }
  json(res, 200, { runs: runs.map(r => ({ ...r, title: titles.get(r.session) || 'New chat' })) });
});

// ── chat list: pin, archive, rename ──
api.add('POST', '/api/project/:pid/session/:sid/meta', async ({ req, res, params }) => {
  const project = await getProject(params.pid);
  const file = await sessionFile(project, params.sid);
  if (!file) throw new HttpError(404, 'Session not found');
  const g = await readJson(req, 8192);
  if (g.title != null) {
    const title = typeof g.title === 'string' ? g.title.replace(/\s+/g, ' ').trim() : '';
    if (!title || title.length > 120) throw new HttpError(400, 'The title must be 1–120 characters');
    const r = findRun(params.sid);
    if (r && !r.closed && r.state !== 'ready') throw new HttpError(409, 'Claude is working on this chat; rename it when it is done');
    // The same line Claude Code's /rename writes, so the terminal and VS Code show the new name too.
    fs.appendFileSync(file, JSON.stringify({ type: 'custom-title', customTitle: title, sessionId: params.sid }) + '\n');
  }
  json(res, 200, { ok: true, ...setChatFlags(params.sid, g) });
});

// ── search: chat titles everywhere; with `pid`, inside that project's messages too ──
api.add('GET', '/api/search', async ({ res, url }) => {
  const pid = url.searchParams.get('pid');
  const projects = pid ? [await getProject(pid)] : await listProjects();
  json(res, 200, await searchChats(projects, url.searchParams.get('q') || '', { content: Boolean(pid) }));
});

// ── drafts shared between devices ──
api.add('GET', '/api/drafts', ({ res, url }) => {
  const key = url.searchParams.get('key') || '';
  if (!DRAFT_KEY.test(key)) throw new HttpError(400, 'Invalid key');
  json(res, 200, getDraft(key));
});
api.add('POST', '/api/drafts', async ({ req, res }) => {
  const { key, text, at } = await readJson(req, 512 * 1024);
  if (!DRAFT_KEY.test(String(key)) || typeof text !== 'string' || !Number.isFinite(at)) throw new HttpError(400, 'Invalid draft');
  json(res, 200, setDraft(key, text, Math.min(at, Date.now() + 60e3)));
});

// ── saved prompts ──
api.add('GET', '/api/snippets', ({ res }) => json(res, 200, { snippets: getSnippets() }));
api.add('POST', '/api/snippets', async ({ req, res }) => {
  const { snippets } = await readJson(req, 512 * 1024);
  if (!Array.isArray(snippets) || snippets.length > SNIPPET_LIMIT || snippets.some(s => typeof s !== 'string' || s.length > SNIPPET_TEXT)) {
    throw new HttpError(400, `At most ${SNIPPET_LIMIT} saved prompts of ${SNIPPET_TEXT} characters`);
  }
  json(res, 200, { snippets: setSnippets(snippets) });
});

// ── scheduled prompts ──
api.add('GET', '/api/schedule', ({ res, url }) => json(res, 200, { items: listScheduled(url.searchParams.get('session')), limitResetsAt: limitResetTime() }));
api.add('POST', '/api/schedule', async ({ req, res }) => {
  const g = await readJson(req, 128 * 1024);
  const project = await getProject(String(g.project || ''));
  if (typeof g.session !== 'string' || !await sessionFile(project, g.session)) throw new HttpError(404, 'Start the chat first: a prompt can only be scheduled into an existing chat');
  const text = typeof g.text === 'string' ? g.text.trim() : '';
  if (!text || text.length > 100000) throw new HttpError(400, 'Empty or too long prompt');
  if (g.mode != null && !MODES.includes(g.mode)) throw new HttpError(400, 'Invalid mode');
  if (g.model != null && !MODELS.includes(g.model)) throw new HttpError(400, 'Invalid model');
  if (g.effort != null && !EFFORTS.includes(g.effort)) throw new HttpError(400, 'Invalid effort');
  let at = Number(g.at);
  if (g.afterLimit) {
    const reset = limitResetTime();
    if (!reset) throw new HttpError(409, 'The reset time of the usage limit is not known yet (it is learned from Claude\'s replies)');
    at = reset + 60e3; // a minute of margin
  }
  if (!Number.isFinite(at) || at < Date.now() - 60e3 || at > Date.now() + 14 * 86400e3) throw new HttpError(400, 'Pick a time within the next 14 days');
  try {
    json(res, 200, addScheduled({ project: project.id, session: g.session, text, at, mode: g.mode, model: g.model, effort: g.effort, afterLimit: g.afterLimit }));
  } catch (e) { throw new HttpError(e.status || 500, e.message); }
});
api.add('POST', '/api/schedule/cancel', async ({ req, res }) => {
  if (!removeScheduled(String((await readJson(req, 4096)).id))) throw new HttpError(404, 'Not found (it may have been sent already)');
  json(res, 200, { ok: true });
});
api.add('POST', '/api/schedule/run', async ({ req, res }) => {
  if (!await runScheduled(String((await readJson(req, 4096)).id))) throw new HttpError(404, 'Not found (it may have been sent already)');
  json(res, 200, { ok: true });
});

// ── git (read only) ──
api.add('GET', '/api/project/:pid/git', async ({ res, params }) => json(res, 200, await gitStatus((await getProject(params.pid)).path)));
api.add('GET', '/api/project/:pid/git/diff', async ({ res, params, url }) => {
  const project = await getProject(params.pid);
  const file = url.searchParams.get('path'), commit = url.searchParams.get('commit');
  if (file != null && !validGitPath(file)) throw new HttpError(400, 'Invalid path');
  if (commit != null && !validHash(commit)) throw new HttpError(400, 'Invalid commit');
  if (!file && !commit) throw new HttpError(400, 'A path or a commit is needed');
  const d = await gitDiff(project.path, { file, commit });
  if (d.error) throw new HttpError(400, d.error);
  json(res, 200, d);
});

// notifications
api.add('GET', '/api/push/key', ({ res }) => json(res, 200, { key: push.publicKey(), subscribers: push.subscriberCount() }));
api.add('POST', '/api/push/subscribe', async ({ req, res, session }) => {
  const { endpoint } = await readJson(req, 8192);
  try { push.subscribe(session.key, String(endpoint)); } catch (e) { throw new HttpError(400, e.message); }
  json(res, 200, { ok: true });
});
api.add('POST', '/api/push/unsubscribe', async ({ req, res }) => {
  push.unsubscribe(String((await readJson(req, 8192)).endpoint));
  json(res, 200, { ok: true });
});
api.add('GET', '/api/push/last', ({ res }) => json(res, 200, { notification: push.lastNotification() }));
api.add('POST', '/api/push/test', async ({ res }) => {
  const results = await push.notify({ title: 'Kumanda', body: 'Notifications work.', url: '/', tag: 'test' }, deviceValid);
  json(res, 200, { results });
});

api.add('POST', '/api/local/shutdown', ({ req, res, info }) => {
  const key = String(req.headers['x-local-key'] || '');
  if (!info.local || key.length !== localKey.length || !crypto.timingSafeEqual(Buffer.from(key), Buffer.from(localKey))) throw new HttpError(403, 'Only from this computer');
  json(res, 200, { ok: true });
  setTimeout(shutdown, 100);
}, open);

const deviceValid = key => auth.deviceList().some(d => key.startsWith(d.id));
setNotifier(({ kind, project, session, text }) => {
  const title = kind === 'permission' ? `${project.name}: waiting for permission` : kind === 'error' ? `${project.name}: error` : `${project.name}: Claude is done`;
  push.notify({ title, body: text, url: `/#/p/${project.id}/s/${session}`, tag: session }, deviceValid).catch(() => {});
});
// A scheduled prompt that could not go out is reported; a sent one shows up in the chat (and notifies when Claude is done).
onScheduleEvent(({ kind, item, error }) => {
  if (kind === 'sent') return;
  const title = kind === 'missed' ? 'A scheduled prompt was not sent' : 'A scheduled prompt failed';
  const body = kind === 'missed' ? 'The computer was off or asleep at the time. Send it again from the chat.' : error;
  push.notify({ title, body, url: `/#/p/${item.project}/s/${item.session}`, tag: `schedule-${item.id}` }, deviceValid).catch(() => {});
});

// ───────────── control server ─────────────
const STATIC = new Set(['/index.html', '/app.js', '/style.css', '/sw.js', '/manifest.webmanifest', '/icon-192.png', '/icon-512.png', '/icon.svg']);

async function controlRequest(req, res) {
  const url = new URL(req.url, 'http://x');
  const pathname = url.pathname;
  const info = requestInfo(req);
  for (const [k, v] of Object.entries(SECURITY)) res.setHeader(k, v);

  if (pathname.startsWith('/api/')) {
    if (!originAllowed(req)) return json(res, 403, { error: 'Origin rejected' });
    if (req.method !== 'GET' && req.headers['x-kumanda'] !== '1') return json(res, 403, { error: 'Missing header' });
    const route = api.find(req.method, pathname);
    if (!route) return json(res, 404, { error: 'Not found' });
    if (route.wrongMethod) return json(res, 405, { error: 'Method not supported' });
    let session = null;
    if (!route.options.open) {
      session = auth.findSession(cookies(req)[CONTROL_COOKIE], 'control');
      if (!session) return json(res, 401, { error: 'Login required' });
    }
    return route.handler({ req, res, params: route.params, url, info, session });
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') return plainText(res, 405, 'Method not supported');

  if (pathname === '/open') {
    // Open a product: move to the product origin with a one-time ticket (its own cookie is set there).
    const session = auth.findSession(cookies(req)[CONTROL_COOKIE], 'control');
    if (!session) return redirect(res, '/');
    const project = await findProject(url.searchParams.get('p') || '');
    const relative = url.searchParams.get('path') || '';
    if (!project || !safePath(project, relative)) return plainText(res, 404, 'Product not found');
    const target = `/p/${project.id}/${relative.split('/').map(encodeURIComponent).join('/')}${url.searchParams.has('download') ? '?download=1' : ''}`;
    return redirect(res, `${productOrigin(info)}/_open?t=${auth.issueTicket(session.key)}&to=${encodeURIComponent(target)}`);
  }

  const file = pathname === '/' ? '/index.html' : pathname;
  if (!STATIC.has(file)) return plainText(res, 404, 'Not found');
  return sendFile(req, res, path.join(WEB, file), file === '/sw.js' ? { headers: { 'Service-Worker-Allowed': '/' } } : {});
}

// ───────────── product server ─────────────
const DOWNLOADED = new Set(['.apk', '.exe', '.msi', '.zip']);
const PRODUCT_PATH = /^\/p\/([0-9a-f]{12})\/(.*)$/;
/** 'a/b/c.html' → 'a/b', 'a/b/' → 'a/b', 'c.html' → '' */
const folderOf = relative => {
  if (relative.endsWith('/')) return relative.replace(/\/+$/, '');
  const k = path.posix.dirname(relative);
  return k === '.' || k === '/' ? '' : k;
};

async function findProductFile(project, relative) {
  let target = safePath(project, relative);
  if (!target) return null;
  try {
    if (fs.statSync(target).isDirectory()) target = path.join(target, 'index.html');
    return fs.statSync(target).isFile() ? target : null;
  } catch { return null; }
}

async function productRequest(req, res) {
  const url = new URL(req.url, 'http://x');
  let pathname;
  try { pathname = decodeURIComponent(url.pathname); } catch { return plainText(res, 400, 'Invalid address'); }
  const info = requestInfo(req);
  res.setHeader('X-Robots-Tag', 'noindex');
  if (req.method !== 'GET' && req.method !== 'HEAD') return plainText(res, 405, 'Method not supported');

  if (pathname === '/_open') {
    const ticket = auth.useTicket(url.searchParams.get('t') || '');
    const to = url.searchParams.get('to') || '';
    if (!ticket || !to.startsWith('/p/')) return plainText(res, 403, 'The link has expired. Open the product from Kumanda again.');
    const token = auth.openSession('product', auth.deviceName(req.headers['user-agent']), ticket.parent);
    return redirect(res, to, { 'Set-Cookie': setCookie(PRODUCT_COOKIE, token, { secure: info.https }) });
  }

  const c = cookies(req);
  if (!auth.findSession(c[PRODUCT_COOKIE], 'product')) return plainText(res, 401, 'To see this product, log in to Kumanda and open the product from there.');

  let project = null, file = null;
  const m = PRODUCT_PATH.exec(pathname);
  if (m) {
    project = await findProject(m[1]);
    if (project) file = await findProductFile(project, m[2]);
  } else {
    // Root-absolute path ("/assets/a.js"): built sites ask like this. Search from the folder of the product page making
    // the request (Referer, or else the last opened product) up to the project root.
    let id = null, base = '';
    try {
      const r = PRODUCT_PATH.exec(decodeURIComponent(new URL(req.headers.referer).pathname));
      if (r) { id = r[1]; base = folderOf(r[2]); }
    } catch { /* no Referer */ }
    if (!id && /^[0-9a-f]{12}:/.test(c[LAST_COOKIE] || '')) { id = c[LAST_COOKIE].slice(0, 12); base = c[LAST_COOKIE].slice(13); }
    project = id ? await findProject(id) : null;
    for (let t = base, i = 0; project && !file && i < 12; t = folderOf(t), i++) {
      file = await findProductFile(project, path.posix.join(t, pathname));
      if (!t) break;
    }
  }
  if (!project || !file) return plainText(res, 404, 'Not found');

  const ext = path.extname(file).toLowerCase();
  const headers = {};
  if (m && (ext === '.html' || ext === '.htm')) headers['Set-Cookie'] = setCookie(LAST_COOKIE, `${project.id}:${folderOf(m[2])}`, { days: 1, secure: info.https });
  return sendFile(req, res, file, { download: url.searchParams.has('download') || DOWNLOADED.has(ext), headers });
}

// ───────────── start ─────────────
const wrap = handler => async (req, res) => {
  try { await handler(req, res); } catch (e) {
    if (!(e instanceof HttpError)) console.error(new Date().toISOString(), req.method, req.url, e);
    if (res.headersSent) return res.destroy();
    json(res, e instanceof HttpError ? e.status : 500, { error: e instanceof HttpError ? e.message : 'Server error' });
  }
};

const localKey = crypto.randomBytes(24).toString('hex');
const controlServer = http.createServer(wrap(controlRequest));
const productServer = http.createServer(wrap(productRequest));

function shutdown() {
  closeAllRuns();
  controlServer.close(); productServer.close();
  controlServer.closeAllConnections(); productServer.closeAllConnections();
  setTimeout(() => process.exit(0), 1500).unref();
}

const listen = (server, port) => new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(port, config.listen, () => { server.off('error', reject); resolve(); });
});

try {
  await listen(controlServer, config.controlPort);
  await listen(productServer, config.productPort);
} catch (e) {
  console.error(e.code === 'EADDRINUSE' ? `Port in use (${e.port}): Kumanda may already be running.` : e);
  process.exit(e.code === 'EADDRINUSE' ? 0 : 1);
}
atomicWrite(LOCAL_KEY_FILE, localKey);
watchConfig();
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
console.log(`${new Date().toISOString()} Kumanda ${VERSION} is running: http://${config.listen === '0.0.0.0' ? 'localhost' : config.listen}:${config.controlPort}  (products: ${config.productPort})`);
if (!auth.hasPassword()) console.log(`No password set. Open this from this computer and set one: ${localAddress()}`);
