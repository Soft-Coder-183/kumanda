// Finds projects (subfolders of the root folders + folders Claude Code has worked in before)
// and scans each project for products (runnable/openable output files).
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { config, saveConfig, loadConfig } from './config.mjs';

export const CLAUDE_DIR = process.env.KUMANDA_CLAUDE_DIR || path.join(os.homedir(), '.claude');
export const CLAUDE_PROJECTS = path.join(CLAUDE_DIR, 'projects');

const lower = p => path.resolve(p).toLowerCase();
export const projectId = p => crypto.createHash('sha1').update(lower(p)).digest('hex').slice(0, 12);
const isInside = (parent, child) => { const a = lower(parent), b = lower(child); return b !== a && b.startsWith(a + path.sep); };

async function readChunk(file, start, length) {
  const fh = await fsp.open(file, 'r');
  try {
    const buf = Buffer.alloc(length);
    const { bytesRead } = await fh.read(buf, 0, length, start);
    return buf.subarray(0, bytesRead).toString('utf8');
  } finally { await fh.close(); }
}

// ---------- Claude Code records (~/.claude/projects) ----------
const cwdCache = new Map(); // log dir → working folder

async function findCwd(file, size) {
  for (const start of [0, Math.max(0, size - 262144)]) {
    const m = /"cwd":"((?:[^"\\]|\\.)*)"/.exec(await readChunk(file, start, 262144));
    if (m) { try { return JSON.parse(`"${m[1]}"`); } catch { /* keep looking */ } }
  }
  return null;
}

const logDirName = p => path.resolve(p).replace(/[^a-zA-Z0-9]/g, '-').toLowerCase();

// When a transcript was really last used: the newest "timestamp" in its last lines. The file's modification time is not
// enough: Claude Code sometimes rewrites old transcripts (metadata lines), which moved old or chat-less projects to the top
// of the list (2026-11-23). Cached by modification time + size.
const activityCache = new Map(); // file → { key, at }
const STAMP = /"timestamp":"(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z)"/g;
export async function lastUsed(file, mtime, size) {
  const key = `${mtime}:${size}`;
  const c = activityCache.get(file);
  if (c?.key === key) return c.at;
  let at = 0;
  try {
    for (const m of (await readChunk(file, Math.max(0, size - 65536), 65536)).matchAll(STAMP)) at = Math.max(at, Date.parse(m[1]) || 0);
    if (!at && size > 65536) for (const m of (await readChunk(file, 0, 65536)).matchAll(STAMP)) at = Math.max(at, Date.parse(m[1]) || 0);
  } catch { /* deleted meanwhile */ }
  at = at ? Math.min(at, mtime) : mtime; // no timestamp at all: fall back to the file time
  activityCache.set(file, { key, at });
  return at;
}
let logDirNames = new Set(); // folders Claude Code knows even without sessions (e.g. only memory)

/** lowercase path → { path, dirs[], last (ms), count } */
async function readLogs() {
  const out = new Map();
  let entries;
  try { entries = await fsp.readdir(CLAUDE_PROJECTS, { withFileTypes: true }); } catch { return out; }
  logDirNames = new Set(entries.filter(e => e.isDirectory()).map(e => e.name.toLowerCase()));
  await Promise.all(entries.filter(e => e.isDirectory()).map(async e => {
    const dir = path.join(CLAUDE_PROJECTS, e.name);
    let names;
    try { names = (await fsp.readdir(dir)).filter(f => f.endsWith('.jsonl')); } catch { return; }
    if (!names.length) return;
    const files = (await Promise.all(names.map(async f => {
      try { const s = await fsp.stat(path.join(dir, f)); return { f, m: await lastUsed(path.join(dir, f), s.mtimeMs, s.size), b: s.size }; } catch { return null; }
    }))).filter(Boolean).sort((a, b) => b.m - a.m);
    if (!files.length) return;
    let cwd = cwdCache.get(dir);
    if (cwd === undefined) {
      cwd = null;
      for (const f of files.slice(0, 3)) { cwd = await findCwd(path.join(dir, f.f), f.b); if (cwd) break; }
      if (cwd) cwdCache.set(dir, cwd);
    }
    if (!cwd) return;
    const key = lower(cwd);
    const r = out.get(key) || { path: path.resolve(cwd), dirs: [], last: 0, count: 0 };
    r.dirs.push(dir); r.last = Math.max(r.last, files[0].m); r.count += files.length;
    out.set(key, r);
  }));
  return out;
}

// ---------- project list ----------
let projectCache = { time: 0, list: [] };

async function isDir(p) { try { return (await fsp.stat(p)).isDirectory(); } catch { return false; } }

export async function listProjects({ fresh = false, includeHidden = false } = {}) {
  if (!fresh && Date.now() - projectCache.time < 8000) return includeHidden ? projectCache.list : projectCache.list.filter(p => !p.hidden);
  const logs = await readLogs();
  const home = lower(os.homedir());
  const isTemp = a => a.includes(`${path.sep}appdata${path.sep}local${path.sep}temp${path.sep}`) || a.startsWith(lower(os.tmpdir()));
  const known = p => logs.has(lower(p)) || logDirNames.has(logDirName(p));
  const candidates = new Map(); // lowercase path → { path, root }

  for (const root of config.roots) {
    let entries;
    try { entries = await fsp.readdir(root, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (!e.isDirectory() || e.name.startsWith('.')) continue;
      const p = path.join(root, e.name);
      candidates.set(lower(p), { path: p, root });
      // One level down: projects Claude Code knows inside container folders ("Games", "Pocket Apps").
      let subs = [];
      try { subs = await fsp.readdir(p, { withFileTypes: true }); } catch { /* unreadable */ }
      for (const s of subs) {
        if (!s.isDirectory() || s.name.startsWith('.') || s.name === 'node_modules') continue;
        const sub = path.join(p, s.name);
        if (known(sub)) candidates.set(lower(sub), { path: sub, root });
      }
    }
  }
  for (const p of config.extraProjects) if (await isDir(p)) candidates.set(lower(p), { path: path.resolve(p), root: null });
  for (const [key, r] of logs) {
    if (candidates.has(key)) continue;
    if (key === home || isTemp(key) || key.includes(`${path.sep}.claude`) || key.includes('~')) continue;
    if (!(await isDir(r.path))) continue;
    candidates.set(key, { path: r.path, root: config.roots.find(rt => isInside(rt, r.path)) || null });
  }
  // Folders without their own record but containing known projects are only containers ("Games", "Pocket Apps").
  for (const [key, c] of [...candidates]) {
    if (known(c.path)) continue;
    if ([...candidates.values()].some(o => isInside(c.path, o.path))) candidates.delete(key);
  }

  const list = [...candidates.entries()].map(([key, c]) => {
    const r = logs.get(key);
    const id = projectId(c.path);
    return {
      id,
      name: c.root ? path.relative(c.root, c.path).split(path.sep).join(' / ') : path.basename(c.path),
      path: c.path,
      logDirs: r?.dirs || [],
      sessionCount: r?.count || 0,
      lastActivity: r?.last || 0,
      hidden: config.hiddenProjects.includes(id),
    };
  }).sort((x, y) => (y.lastActivity - x.lastActivity) || x.name.localeCompare(y.name, 'en'));

  projectCache = { time: Date.now(), list };
  return includeHidden ? list : list.filter(p => !p.hidden);
}

export async function findProject(id) {
  let p = (await listProjects({ includeHidden: true })).find(x => x.id === id);
  if (!p) p = (await listProjects({ fresh: true, includeHidden: true })).find(x => x.id === id);
  return p || null;
}

export function hideProject(id, hidden) {
  loadConfig();
  config.hiddenProjects = config.hiddenProjects.filter(k => k !== id);
  if (hidden) config.hiddenProjects.push(id);
  saveConfig();
  projectCache.time = 0;
}

/** Log dir a new session is written to (Claude Code's naming rule: everything but letters/digits becomes '-'). */
export function logDir(project) {
  return path.join(CLAUDE_PROJECTS, project.path.replace(/[^a-zA-Z0-9]/g, '-'));
}

// ---------- session list ----------
const titleCache = new Map(); // file → { key, title }
const HIDDEN_PREFIX = /^\s*(<|Caveat:|Base directory for this skill:|\[Request interrupted)/;

export function userText(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.filter(b => b.type === 'text').map(b => b.text).join('\n');
}

/**
 * The part of a user message the user typed. Claude Code may put a system note into the same message as the prompt
 * (seen 2026-11-25 on 2.1.330: [image, "<system-reminder>…", prompt] after a resume), so text blocks are judged one by
 * one: `<system-reminder>` sections are cut out and blocks matching `hidden` (skill contents, command output…) dropped.
 */
export function typedText(content, hidden) {
  const blocks = typeof content === 'string' ? [content] : Array.isArray(content) ? content.filter(b => b.type === 'text').map(b => b.text) : [];
  return blocks.map(t => String(t).replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '').trim())
    .filter(t => t && !hidden.test(t)).join('\n');
}

async function findTitle(file, size) {
  const head = await readChunk(file, 0, 262144);
  const tail = size > 262144 ? await readChunk(file, Math.max(262144, size - 131072), 131072) : '';
  let title = null, first = null;
  for (const line of (head + '\n' + tail).split('\n')) {
    if (line.includes('"type":"ai-title"') || line.includes('"type":"custom-title"')) {
      try { const o = JSON.parse(line); title = o.customTitle || o.aiTitle || title; } catch { /* partial line */ }
    } else if (!first && line.includes('"type":"user"')) {
      try {
        const o = JSON.parse(line);
        if (o.type === 'user' && !o.isMeta && !o.isSidechain) {
          const t = typedText(o.message?.content, HIDDEN_PREFIX);
          if (t) first = t.replace(/\s+/g, ' ').slice(0, 90);
        }
      } catch { /* partial line */ }
    }
  }
  return title || first;
}

export async function listSessions(project, limit = 80) {
  const all = [];
  const dirs = new Set([...project.logDirs, logDir(project)]);
  for (const dir of dirs) {
    let names;
    try { names = (await fsp.readdir(dir)).filter(f => f.endsWith('.jsonl')); } catch { continue; }
    for (const f of names) {
      try {
        const file = path.join(dir, f);
        const s = await fsp.stat(file);
        all.push({ id: f.slice(0, -6), file, mtime: await lastUsed(file, s.mtimeMs, s.size), size: s.size });
      } catch { /* deleted */ }
    }
  }
  all.sort((a, b) => b.mtime - a.mtime);
  const list = all.slice(0, limit);
  await Promise.all(list.map(async s => {
    const key = `${s.mtime}:${s.size}`;
    const c = titleCache.get(s.file);
    if (c?.key === key) { s.title = c.title; return; }
    try { s.title = await findTitle(s.file, s.size); } catch { s.title = null; }
    titleCache.set(s.file, { key, title: s.title });
  }));
  return list.filter(s => s.title);
}

export async function sessionFile(project, sessionId) {
  if (!/^[0-9a-f-]{36}$/i.test(sessionId)) return null;
  for (const dir of new Set([...project.logDirs, logDir(project)])) {
    const file = path.join(dir, `${sessionId}.jsonl`);
    if (fs.existsSync(file)) return file;
  }
  return null;
}

// ---------- finding the session that produced a product ----------
// A product is linked to the session whose activity is closest to the file's last modification (±MATCH). Time is used
// instead of searching for the file name because built products (APK, EXE, ZIP) are written by build commands, not by
// the Write tool, and their names may never appear in the transcript. Transcripts only grow at the end: they are
// cached, and only the new part is read when they grow.
const MATCH = 20 * 60e3;
const TIMESTAMP = /"timestamp":"(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z)"/g;
const timeCache = new Map(); // file → { size, times: number[] (sorted) }

async function readTimes(file) {
  let size;
  try { size = (await fsp.stat(file)).size; } catch { return []; }
  const c = timeCache.get(file);
  if (c?.size === size) return c.times;
  const grew = c && size > c.size;
  const times = grew ? [...c.times] : [];
  const fh = await fsp.open(file, 'r');
  try {
    const CHUNK = 8 * 1024 * 1024, OVERLAP = 96; // a timestamp split at a chunk border must not be missed
    for (let start = grew ? Math.max(0, c.size - OVERLAP) : 0; start < size; start += CHUNK - OVERLAP) {
      const buf = Buffer.alloc(Math.min(CHUNK, size - start));
      const { bytesRead } = await fh.read(buf, 0, buf.length, start);
      const text = buf.subarray(0, bytesRead).toString('latin1'); // timestamps are ASCII; fast and never split
      for (const m of text.matchAll(TIMESTAMP)) times.push(Date.parse(m[1]));
      if (bytesRead < buf.length) break;
    }
  } finally { await fh.close(); }
  times.sort((a, b) => a - b);
  timeCache.set(file, { size, times });
  return times;
}

/** session id → sorted activity times (subagent activity counts for the main session). */
async function sessionActivity(project) {
  const out = new Map();
  const add = (sid, t) => { const l = out.get(sid); if (l) l.push(...t); else out.set(sid, [...t]); };
  for (const dir of new Set([...project.logDirs, logDir(project)])) {
    let entries;
    try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (e.isFile() && /^[0-9a-f-]{36}\.jsonl$/i.test(e.name)) add(e.name.slice(0, -6), await readTimes(path.join(dir, e.name)));
      else if (e.isDirectory() && /^[0-9a-f-]{36}$/i.test(e.name)) {
        let subs = [];
        try { subs = (await fsp.readdir(path.join(dir, e.name, 'subagents'))).filter(f => f.endsWith('.jsonl')); } catch { /* no subagents */ }
        for (const f of subs) add(e.name, await readTimes(path.join(dir, e.name, 'subagents', f)));
      }
    }
  }
  for (const l of out.values()) l.sort((a, b) => a - b);
  return out;
}

function nearestGap(sorted, t) {
  let a = 0, b = sorted.length - 1;
  if (b < 0) return Infinity;
  while (a < b) { const m = (a + b) >> 1; if (sorted[m] < t) a = m + 1; else b = m; }
  return Math.min(Math.abs(sorted[a] - t), a > 0 ? Math.abs(sorted[a - 1] - t) : Infinity);
}

/** Writes `session` (id or null) on every product; returns the titles of the linked sessions. */
export async function linkProductsToSessions(project, products) {
  const activity = await sessionActivity(project);
  for (const p of products) {
    let best = null, gap = MATCH;
    for (const [sid, times] of activity) {
      const g = nearestGap(times, p.mtime);
      if (g <= gap) { gap = g; best = sid; }
    }
    p.session = best;
  }
  const needed = new Set(products.map(p => p.session).filter(Boolean));
  const sessions = {};
  if (needed.size) {
    for (const s of await listSessions(project, 2000)) if (needed.has(s.id)) sessions[s.id] = { title: s.title, mtime: s.mtime };
    for (const sid of needed) sessions[sid] ||= { title: null, mtime: activity.get(sid)?.at(-1) || 0 };
  }
  return sessions;
}

// ---------- product scan ----------
const EXTENSION = {
  '.html': 'web', '.htm': 'web', '.apk': 'android', '.exe': 'windows', '.msi': 'windows', '.zip': 'archive',
  '.mp4': 'video', '.webm': 'video', '.mov': 'video', '.pdf': 'document', '.pptx': 'document', '.docx': 'document', '.xlsx': 'document',
};
// Folders not worth searching: dependencies, virtual envs, test reports, intermediate build output, data dumps.
const SKIP = new Set(['node_modules', 'venv', 'env', '__pycache__', 'site-packages', 'lib', 'scripts', 'include',
  'intermediates', 'generated', 'tmp', 'temp', 'obj', 'reports', 'report', 'coverage', 'playwright-report',
  'test-results', 'tests', 'test', '__tests__', 'e2e', 'dist-e2e', 'addons', 'vendor', 'third_party', 'fixtures',
  'captures', 'logs', 'dump', 'archive', 'arsiv', 'arşiv', 'template', 'templates', 'locales', 'resources', 'swiftshader']);
const HELPER_EXE = /^(unins|uninstall|elevate|crashpad|notification_helper|vc_?redist|python|pip|node|ffmpeg|ffprobe|chromedriver|adb|7z|rcedit|squirrel|update|createdump)/i;
const LEFTOVER = /^(xref-.*\.html|base_library\.zip)$/i; // PyInstaller intermediates
const HTML_LIMIT = 6;

const skip = name => name.startsWith('.') || SKIP.has(name.toLowerCase()) || /-unpacked$/i.test(name);

async function htmlInfo(file) {
  let head;
  try { head = await readChunk(file, 0, 16384); } catch { return { skip: true }; }
  // A source template (Vite and similar): does not run unbuilt, so it is not a product.
  if (/<script[^>]+src=["']\/?src\//i.test(head)) return { skip: true };
  const m = /<title[^>]*>([^<]{1,120})<\/title>/i.exec(head);
  return { title: m ? m[1].replace(/\s+/g, ' ').trim() : null };
}

async function scan(project, subProjects) {
  const products = [];
  let budget = 40000;
  const excluded = new Set(subProjects.map(lower));

  async function walk(dir, depth) {
    if (depth > 9 || budget <= 0) return;
    let entries;
    try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch { return; }
    budget -= entries.length;
    const found = [], subs = [];
    for (const e of entries) {
      if (e.isDirectory()) { if (!skip(e.name) && !excluded.has(lower(path.join(dir, e.name)))) subs.push(e.name); }
      else if (e.isFile() && !e.name.startsWith('.')) {
        const kind = EXTENSION[path.extname(e.name).toLowerCase()];
        if (kind && !LEFTOVER.test(e.name)) found.push({ name: e.name, kind });
      }
    }
    // A folder with many HTML files is a data/report dump: only index.html (if any) is a product.
    const htmls = found.filter(f => f.kind === 'web');
    const chosen = found.filter(f => f.kind !== 'web' && !(f.kind === 'windows' && HELPER_EXE.test(f.name)));
    if (htmls.length <= HTML_LIMIT) chosen.push(...htmls);
    else chosen.push(...htmls.filter(h => /^index\.html?$/i.test(h.name)));

    for (const f of chosen) {
      const file = path.join(dir, f.name);
      let st;
      try { st = await fsp.stat(file); } catch { continue; }
      if (st.size === 0) continue;
      const product = {
        path: path.relative(project.path, file).split(path.sep).join('/'),
        name: f.name, kind: f.kind, size: st.size, mtime: st.mtimeMs,
      };
      if (f.kind === 'web') {
        const info = await htmlInfo(file);
        if (info.skip) continue;
        product.title = info.title;
      }
      products.push(product);
    }
    for (const s of subs) await walk(path.join(dir, s), depth + 1);
  }

  await walk(project.path, 0);

  // More than 3 exe files in one folder (a packaged app folder): only the largest is a product.
  const exeDirs = new Map();
  for (const p of products) if (p.kind === 'windows') {
    const d = path.posix.dirname(p.path);
    exeDirs.set(d, [...(exeDirs.get(d) || []), p]);
  }
  const drop = new Set();
  for (const list of exeDirs.values()) if (list.length > 3) {
    list.sort((a, b) => b.size - a.size).slice(1).forEach(p => drop.add(p));
  }
  const rest = products.filter(p => !drop.has(p)).sort((a, b) => b.mtime - a.mtime);
  markSecondary(rest);
  // Latest versions only: old versions and copies of the same product are not listed (the files stay on disk).
  return rest.filter(p => p.secondary !== 'old version' && p.secondary !== 'copy');
}

const SOURCE_DIRS = new Set(['src', 'assets', 'android', 'ios', 'app', 'public', 'static']);
const OUTPUT_DIRS = new Set(['dist', 'release', 'releases', 'kurulum', 'installer', 'out', 'paket', 'package', 'build']);
const VERSION = /\d+(\.\d+)+/;
const versionKey = name => name.replace(VERSION, '#');
const compareVersions = (a, b) => {
  const x = (VERSION.exec(a) || ['0'])[0].split('.').map(Number), y = (VERSION.exec(b) || ['0'])[0].split('.').map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0);
  return 0;
};

/** Writes a "secondary" reason on everything but the main products, so the main ones stand out. */
function markSecondary(products) {
  for (const p of products) {
    const dirs = p.path.toLowerCase().split('/').slice(0, -1);
    if (p.kind === 'web' && dirs.some(d => SOURCE_DIRS.has(d))) p.secondary = 'source file';
    else if (p.kind === 'windows' && p.size < 1e6) p.secondary = 'helper file';
    else if (p.kind === 'android' && /debug/i.test(p.path)) p.secondary = 'debug build';
    else if (p.kind === 'archive' && dirs.length && !dirs.some(d => OUTPUT_DIRS.has(d))) p.secondary = 'archive';
  }
  // Same kind and same size means a copy: the one with the shallowest path is the original.
  const bySize = new Map();
  for (const p of products) {
    const k = `${p.kind}|${p.size}`;
    bySize.set(k, [...(bySize.get(k) || []), p]);
  }
  for (const group of bySize.values()) if (group.length > 1) {
    const depth = p => p.path.split('/').length + (p.secondary ? 100 : 0);
    const original = group.reduce((a, b) => (depth(b) < depth(a) ? b : a));
    for (const p of group) if (p !== original && !p.secondary) p.secondary = 'copy';
  }
  // Of files that differ only in their version number, only the newest version is the main one.
  const byVersion = new Map();
  for (const p of products) if (!p.secondary && VERSION.test(p.name)) {
    const k = `${p.kind}|${versionKey(p.name)}`; // folder does not matter: dist/a-1.0.apk and release/a-1.1.apk are one product
    byVersion.set(k, [...(byVersion.get(k) || []), p]);
  }
  for (const group of byVersion.values()) if (group.length > 1) {
    const newest = group.reduce((a, b) => (compareVersions(b.name, a.name) > 0 ? b : a));
    for (const p of group) if (p !== newest) p.secondary = 'old version';
  }
}

const productCache = new Map(); // project id → { time, products }

export async function listProducts(project, { fresh = false, includeHidden = false } = {}) {
  let c = productCache.get(project.id);
  if (fresh || !c || Date.now() - c.time > 60e3) {
    const all = await listProjects({ includeHidden: true });
    const subProjects = all.filter(p => isInside(project.path, p.path)).map(p => p.path);
    c = { time: Date.now(), products: await scan(project, subProjects) };
    productCache.set(project.id, c);
  }
  const hidden = new Set(config.hiddenProducts[project.id] || []);
  const list = c.products.map(p => ({ ...p, hidden: hidden.has(p.path) }));
  return includeHidden ? list : list.filter(p => !p.hidden);
}

/** Hides or shows one or more products (`paths` is an array or a single path). */
export function hideProducts(project, paths, hidden) {
  loadConfig();
  const set = new Set([paths].flat());
  const list = (config.hiddenProducts[project.id] || []).filter(p => !set.has(p));
  if (hidden) list.push(...set);
  if (list.length) config.hiddenProducts[project.id] = list; else delete config.hiddenProducts[project.id];
  saveConfig();
}

/** Safely turns a path relative to the project into an absolute one; rejects leaving the project or hidden (.) entries. */
export function safePath(project, relative) {
  const parts = String(relative).split(/[\\/]+/).filter(Boolean);
  if (parts.some(p => p === '..' || p.startsWith('.'))) return null;
  const target = path.resolve(project.path, ...parts);
  if (target !== path.resolve(project.path) && !isInside(project.path, target)) return null;
  try {
    // Block escaping through links (symlink/junction).
    const real = fs.realpathSync(target);
    const root = fs.realpathSync(project.path);
    if (real !== root && !isInside(root, real)) return null;
    return real;
  } catch { return null; }
}

// ---------- file explorer (read only) ----------
// Content reaches the control origin only as text inside JSON (or base64 for images); the UI draws it as text and never
// interprets it as a document or script. "Opening" a file in the browser still goes through the product origin (/open).
const DIR_LIMIT = 3000, TEXT_LIMIT = 1e6, IMAGE_LIMIT = 5e6;
const IMAGE_TYPE = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
  '.bmp': 'image/bmp', '.ico': 'image/x-icon', '.svg': 'image/svg+xml', '.avif': 'image/avif' };
const BINARY = /\.(exe|dll|apk|aab|zip|7z|rar|gz|tgz|jar|class|so|o|obj|pdb|bin|dat|db|sqlite|mp4|mov|mkv|webm|mp3|wav|ogg|flac|pdf|docx?|xlsx?|pptx?|ttf|otf|woff2?|psd|keystore|jks|msi|iso)$/i;
const byName = (a, b) => (b.dir - a.dir) || a.name.localeCompare(b.name, 'en', { numeric: true, sensitivity: 'base' });

/** Entries of a folder inside the project: folders first, by name like VS Code. Hidden (.) entries are not shown. */
export async function listFolder(project, relative = '') {
  const dir = safePath(project, relative);
  if (!dir || !(await isDir(dir))) return null;
  const base = String(relative).split(/[\\/]+/).filter(Boolean).join('/');
  const entries = (await fsp.readdir(dir, { withFileTypes: true })).filter(e => !e.name.startsWith('.'));
  const truncated = entries.length > DIR_LIMIT;
  const list = (await Promise.all(entries.slice(0, DIR_LIMIT).map(async e => {
    const p = base ? `${base}/${e.name}` : e.name;
    let target = path.join(dir, e.name);
    if (e.isSymbolicLink()) { target = safePath(project, p); if (!target) return null; } // links leading outside are hidden
    try {
      const s = await fsp.stat(target);
      return { name: e.name, path: p, dir: s.isDirectory(), size: s.isDirectory() ? 0 : s.size, mtime: s.mtimeMs };
    } catch { return null; }
  }))).filter(Boolean).sort(byName);
  return { path: base, entries: list, truncated };
}

/** Reads a file for viewing: text (up to 1 MB), image (base64, up to 5 MB) or info only (binary). */
export async function readFileForView(project, relative) {
  const file = safePath(project, relative);
  if (!file) return null;
  let s;
  try { s = await fsp.stat(file); } catch { return null; }
  if (!s.isFile()) return null;
  const info = { name: path.basename(file), path: String(relative).split(/[\\/]+/).filter(Boolean).join('/'), size: s.size, mtime: s.mtimeMs };
  const ext = path.extname(file).toLowerCase();
  if (IMAGE_TYPE[ext]) {
    if (s.size > IMAGE_LIMIT) return { ...info, kind: 'binary', reason: 'Image too large' };
    return { ...info, kind: 'image', mime: IMAGE_TYPE[ext], data: (await fsp.readFile(file)).toString('base64') };
  }
  if (BINARY.test(ext)) return { ...info, kind: 'binary' };
  const fh = await fsp.open(file, 'r');
  let buf;
  try {
    buf = Buffer.alloc(Math.min(s.size, TEXT_LIMIT));
    buf = buf.subarray(0, (await fh.read(buf, 0, buf.length, 0)).bytesRead);
  } finally { await fh.close(); }
  let text;
  const even = () => buf.subarray(2, buf.length - (buf.length % 2));
  if (buf[0] === 0xff && buf[1] === 0xfe) text = even().toString('utf16le'); // Windows PowerShell output
  else if (buf[0] === 0xfe && buf[1] === 0xff) text = Buffer.from(even()).swap16().toString('utf16le');
  else {
    if (buf.subarray(0, 8000).includes(0)) return { ...info, kind: 'binary' };
    text = buf.toString('utf8').replace(/^\uFEFF/, '');
  }
  return { ...info, kind: 'text', text, truncated: s.size > TEXT_LIMIT };
}
