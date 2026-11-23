// Manages Claude Code processes. Each live session keeps one `claude -p` process open in stream-json mode:
// prompts go to stdin; replies, tool calls and permission requests are read from stdout and turned into simple "items".
// If the client disconnects the process keeps running; the event log is replayed from where a reconnecting client left off.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { DATA, atomicWrite, config } from './config.mjs';
import { CLAUDE_DIR, logDir, sessionFile, userText } from './projects.mjs';
import { rememberCommands } from './commands.mjs';

export const MODES = ['default', 'acceptEdits', 'auto', 'plan', 'bypassPermissions'];
export const MODELS = ['', 'fable', 'opus', 'sonnet', 'haiku'];
export const EFFORTS = ['', 'low', 'medium', 'high', 'xhigh', 'max']; // '' = the user's Claude Code setting
const MODE_FLAG = { default: 'manual' }; // on the CLI flag "default" is called "manual"

const shorten = (s, n) => (s.length > n ? `${s.slice(0, n)}… (+${s.length - n} characters)` : s);
const shortenInput = input => (input && typeof input === 'object'
  ? JSON.parse(JSON.stringify(input, (_, v) => (typeof v === 'string' ? shorten(v, 6000) : v)))
  : input);

function resultText(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.map(b => (b.type === 'text' ? b.text : b.type === 'image' ? '[image]' : '')).filter(Boolean).join('\n');
}

// Messages with the user role that the user did not write (skill contents, system notes).
const NOT_TYPED = /^\s*(<local-command|<command-message>|<system-reminder>|<task-notification>|<bash-|<user-prompt-submit-hook>|Caveat:|Base directory for this skill:)/;

/** Turns a transcript or stream line into the simple items the UI shows. */
export function toItems(line) {
  if (!line || line.isSidechain || line.parent_tool_use_id || line.isMeta || line.isCompactSummary) return [];
  const content = line.message?.content;
  const items = [];
  if (line.type === 'assistant' && Array.isArray(content)) {
    for (const b of content) {
      if (b.type === 'text' && b.text.trim()) items.push({ type: 'text', text: b.text });
      else if (b.type === 'tool_use') items.push({ type: 'tool', id: b.id, name: b.name, input: shortenInput(b.input) });
    }
  } else if (line.type === 'user') {
    if (Array.isArray(content) && content.some(b => b.type === 'tool_result')) {
      for (const b of content) {
        if (b.type === 'tool_result') items.push({ type: 'tool-result', id: b.tool_use_id, isError: Boolean(b.is_error), text: shorten(resultText(b.content), 6000) });
      }
    } else {
      const text = userText(content).trim();
      const images = Array.isArray(content) ? content.filter(b => b.type === 'image').length : 0;
      const command = /<command-name>([^<]+)<\/command-name>/.exec(text);
      // A terminal /btw lands in the transcript only as an empty call; the real questions come from btw.mjs.
      if (command) { if (command[1].trim() !== '/btw') items.push({ type: 'note', text: command[1].trim() }); }
      else if (/^\[Request interrupted/.test(text)) items.push({ type: 'note', text: 'Stopped' });
      else if ((text || images) && !NOT_TYPED.test(text)) items.push({ type: 'user', text, images });
    }
  } else if (line.type === 'system' && line.subtype === 'compact_boundary') {
    items.push({ type: 'note', text: 'Context compacted' });
  }
  const at = line.timestamp ? Date.parse(line.timestamp) : 0;
  if (at) for (const it of items) it.at = at;
  return items;
}

// Default window; a wide one when "older messages" are requested (tools are grouped in the UI, so items can be many).
const WINDOW = { bytes: 12 * 1024 * 1024, items: 1500 }, WIDE = { bytes: 128 * 1024 * 1024, items: 50000 };

/** Reads the last items from the part of a transcript up to byte `limit`. */
export async function readHistory(file, limit = Infinity, older = false) {
  const { bytes: MAX_BYTES, items: MAX_ITEMS } = older ? WIDE : WINDOW;
  let size;
  try { size = (await fsp.stat(file)).size; } catch { return { items: [], truncated: false }; }
  const end = Math.min(size, limit);
  const start = Math.max(0, end - MAX_BYTES);
  if (end <= 0) return { items: [], truncated: false };
  const fh = await fsp.open(file, 'r');
  let text;
  try {
    const buf = Buffer.alloc(end - start);
    const { bytesRead } = await fh.read(buf, 0, end - start, start);
    text = buf.subarray(0, bytesRead).toString('utf8');
  } finally { await fh.close(); }
  const lines = text.split('\n');
  if (start > 0) lines.shift(); // the first line may be partial
  let items = [];
  for (const l of lines) {
    if (!l.includes('"type":"user"') && !l.includes('"type":"assistant"') && !l.includes('compact_boundary')) continue;
    try { items.push(...toItems(JSON.parse(l))); } catch { /* partial or broken line */ }
  }
  items = addTurnEnds(items);
  const truncated = start > 0 || items.length > MAX_ITEMS;
  if (items.length > MAX_ITEMS) items = items.slice(-MAX_ITEMS);
  return { items, truncated };
}

/** The transcript has no "turn finished" line: after each prompt's last item a "result" item is added, like in the live
 *  stream (duration = prompt to last item; time = when the work finished). The counterpart of Claude Code's "worked / done". */
function addTurnEnds(items) {
  const out = [];
  let start = 0, last = 0, content = false, stopped = false;
  const close = () => {
    if (start && content && last >= start) out.push({ type: 'result', error: null, interrupted: stopped, durationMs: last - start, at: last });
    start = 0; content = false; stopped = false;
  };
  for (const it of items) {
    if (it.type === 'user') { close(); start = it.at || 0; last = start; }
    else if (it.at) { last = it.at; if (it.type !== 'note') content = true; stopped = it.type === 'note' && it.text === 'Stopped'; }
    out.push(it);
  }
  close();
  return out;
}

// Subscription usage only arrives after a request (rate_limit_event); the last known value is saved so it is visible
// even when no process is open.
const LIMIT_FILE = path.join(DATA, 'limit.json');
let lastLimit = (() => { try { return JSON.parse(fs.readFileSync(LIMIT_FILE, 'utf8')); } catch { return null; } })();
export const getLastLimit = () => lastLimit;
function saveLimit(limit) {
  lastLimit = { ...limit, at: Date.now() };
  try { atomicWrite(LIMIT_FILE, JSON.stringify(lastLimit)); } catch { /* not writable: keep it in memory */ }
}

/** Tokens in the context window after an API call: what was sent (new + cache write + cache read) plus the reply. */
export const contextTokens = u => (u && typeof u === 'object'
  ? (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.output_tokens || 0) : 0);

/** Model and effort of the last main API request in the transcript, and the context size after the last reply. Claude
 *  Code writes every request as an `api-request` line (`params.output_config.effort`); it is the only reliable source of
 *  "which effort is it using now". The context comes from the `usage` of the last main-chat assistant message. */
export async function lastRequest(file) {
  let fh;
  try { fh = await fsp.open(file, 'r'); } catch { return null; }
  try {
    const { size } = await fh.stat();
    const start = Math.max(0, size - 2 * 1024 * 1024);
    const buf = Buffer.alloc(size - start);
    const { bytesRead } = await fh.read(buf, 0, buf.length, start);
    const lines = buf.subarray(0, bytesRead).toString('utf8').split('\n');
    let request = null, context = null;
    for (let i = lines.length - 1; i >= 0 && (!request || context === null); i--) {
      const l = lines[i];
      if (context === null && l.includes('"type":"assistant"') && l.includes('"usage"')) {
        try {
          const o = JSON.parse(l);
          if (o.type === 'assistant' && !o.isSidechain && o.message?.usage) context = contextTokens(o.message.usage);
        } catch { /* partial line */ }
      }
      if (request || !l.includes('"api-request"') || !l.includes('output_config')) continue;
      let o;
      try { o = JSON.parse(l); } catch { continue; }
      if (o.type !== 'api-request' || (o.querySource && !['sdk', 'repl_main_thread'].includes(o.querySource))) continue;
      const effort = o.params?.output_config?.effort;
      if (typeof effort === 'string') request = { effort, model: typeof o.params.model === 'string' ? o.params.model : null, at: Date.parse(o.timestamp) || 0 };
    }
    if (!request && context === null) return null;
    return { ...(request || { effort: null, model: null, at: 0 }), context };
  } finally { await fh.close(); }
}

/** Claude Code's effort settings (user → project → the project's local settings; each overrides the previous). */
export async function effortSettings(project) {
  const read = async f => { try { return JSON.parse(await fsp.readFile(f, 'utf8')) || {}; } catch { return {}; } };
  const out = { default: null, model: null, models: {} };
  for (const s of [await read(path.join(CLAUDE_DIR, 'settings.json')), await read(path.join(project.path, '.claude', 'settings.json')),
    await read(path.join(project.path, '.claude', 'settings.local.json'))]) {
    if (s.effortLevel && EFFORTS.includes(s.effortLevel)) out.default = s.effortLevel;
    if (typeof s.model === 'string' && s.model) out.model = s.model;
    for (const [m, v] of Object.entries(s.modelSettings && typeof s.modelSettings === 'object' ? s.modelSettings : {})) {
      if (v?.effortLevel && EFFORTS.includes(v.effortLevel)) out.models[m] = v.effortLevel;
    }
  }
  return out;
}

export function claudeCommand() {
  const c = process.env.KUMANDA_CLAUDE ? JSON.parse(process.env.KUMANDA_CLAUDE) : config.claude;
  if (Array.isArray(c) && c.length) return [c[0], c.slice(1)];
  return [typeof c === 'string' && c ? c : 'claude', []];
}

const runs = new Map(); // session id → Run
let notifier = () => {};
export function setNotifier(f) { notifier = f; }

class Run {
  constructor(project, session, { resume, mode, model, effort, limit }) {
    this.project = project;
    this.session = session;
    this.generation = crypto.randomBytes(4).toString('hex');
    this.mode = MODES.includes(mode) ? mode : 'acceptEdits';
    this.requestedModel = MODELS.includes(model) ? model : '';
    this.effort = EFFORTS.includes(effort) ? effort : '';
    this.model = null;
    this.historyLimit = limit;  // the transcript up to this byte is "history"; the rest is in the event log below
    this.historyLimitAt = Date.now(); // time of that limit (/btw questions after it come from the event log)
    this.events = [];
    this.seq = 0;
    this.base = 0;              // the log was last reset at this sequence number
    this.listeners = new Set();
    this.pending = new Map();   // permission request id → request
    this.control = new Map();   // control request we sent → callback
    this.openTurns = 0;
    this.streaming = null;      // text block currently streaming { block, text }
    this.block = 0;
    this.limit = null;
    this.lastText = '';
    this.closed = false;
    this.closedAt = 0;
    this.lastActivity = Date.now();
    this.stderr = '';
    this.lastRequest = null;    // { effort, model } of the last API request (from the transcript)
    this.context = null;        // tokens in the context window after the last reply
    this.turnStart = 0;         // when the current work started (for "working for 3 min")
    this.finishedAt = 0;        // when the last turn finished
    this.effortRead = false;
    this.#start(resume);
    if (resume) this.#readLastRequest();
  }

  get state() {
    if (this.closed) return 'closed';
    if (this.pending.size) return 'waiting';
    return this.openTurns > 0 ? 'running' : 'ready';
  }

  snapshot() {
    return { type: 'status', state: this.state, mode: this.mode, model: this.model, requestedModel: this.requestedModel, effort: this.effort,
      limit: this.limit, lastRequest: this.lastRequest, context: this.context, turnStart: this.turnStart, finishedAt: this.finishedAt,
      generation: this.generation };
  }

  #start(resume) {
    const [command, prefix] = claudeCommand();
    const args = [...prefix, '-p', '--output-format', 'stream-json', '--input-format', 'stream-json', '--verbose',
      '--include-partial-messages', '--permission-prompt-tool', 'stdio', '--allow-dangerously-skip-permissions',
      '--permission-mode', MODE_FLAG[this.mode] || this.mode,
      ...(resume ? ['--resume', this.session] : ['--session-id', this.session]),
      ...(this.requestedModel ? ['--model', this.requestedModel] : []),
      ...(this.effort ? ['--effort', this.effort] : [])];
    const proc = spawn(command, args, { cwd: this.project.path, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    this.proc = proc;
    proc.stdout.setEncoding('utf8');
    proc.stderr.setEncoding('utf8');
    let buf = '';
    proc.stdout.on('data', data => {
      buf += data;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 1);
        if (!line.trim()) continue;
        let m;
        try { m = JSON.parse(line); } catch { continue; }
        try { this.#line(m); } catch (e) { console.error('[run] could not process line:', e); }
      }
    });
    proc.stderr.on('data', data => { this.stderr = (this.stderr + data).slice(-2000); });
    proc.stdin.on('error', () => {});
    proc.on('error', e => this.#closed(`Could not start Claude Code: ${e.message}`));
    proc.on('exit', code => this.#closed(code && this.openTurns > 0 ? (this.stderr.trim() || `Claude Code exited unexpectedly (code ${code})`) : null));
  }

  #closed(error) {
    if (this.closed) return;
    for (const req of [...this.pending.keys()]) this.#closePermission(req, 'cancelled');
    if (error) this.#publish({ type: 'error', text: shorten(error, 1500) });
    this.closed = true;
    this.closedAt = Date.now();
    this.openTurns = 0;
    this.streaming = null;
    this.#transient(this.snapshot());
  }

  #write(obj) {
    if (!this.closed && this.proc.stdin.writable) this.proc.stdin.write(JSON.stringify(obj) + '\n');
  }

  #broadcast(o) {
    const data = `${o.seq ? `id: ${this.generation}:${o.seq}\n` : ''}data: ${JSON.stringify(o)}\n\n`;
    for (const res of this.listeners) res.write(data);
  }
  /** Persistent event: goes into the log and is replayed to reconnecting clients. */
  #publish(o) {
    o.seq = ++this.seq;
    if (!o.at) o.at = Date.now();
    this.events.push(o);
    this.#broadcast(o);
  }
  /** Transient event: only to those connected right now (streaming text chunks, status). */
  #transient(o) { this.#broadcast(o); }

  #line(m) {
    this.lastActivity = Date.now();
    switch (m.type) {
      case 'system':
        if (m.subtype === 'init') {
          this.model = m.model || this.model;
          rememberCommands(this.project.id, m); // for the composer's "/" autocomplete
          if (MODES.includes(m.permissionMode)) this.mode = m.permissionMode;
          this.#transient(this.snapshot());
        } else if (m.subtype === 'compact_boundary') this.#publish({ type: 'note', text: 'Context compacted' });
        else if (m.subtype === 'status' && m.status === 'compacting') this.#transient({ type: 'activity', what: 'Compacting context' });
        break;
      case 'stream_event': {
        if (m.parent_tool_use_id) break;
        const e = m.event || {};
        if (e.type === 'content_block_start') {
          const kind = e.content_block?.type;
          if (kind === 'text') this.streaming = { block: ++this.block, text: '' };
          else if (kind === 'tool_use') this.#transient({ type: 'activity', what: `Preparing ${e.content_block.name}` });
          else if (kind === 'thinking') this.#transient({ type: 'activity', what: 'Thinking' });
        } else if (e.type === 'content_block_delta' && e.delta?.type === 'text_delta' && this.streaming) {
          this.streaming.text += e.delta.text;
          this.#transient({ type: 'delta', block: this.streaming.block, chunk: e.delta.text });
        }
        break;
      }
      case 'assistant':
      case 'user':
        for (const it of toItems(m)) {
          if (it.type === 'user') continue; // we published the user's prompt when sending it
          if (it.type === 'text') { it.block = this.streaming?.block; this.streaming = null; this.lastText = it.text; }
          delete it.at;
          this.#publish(it);
        }
        if (m.type === 'assistant' && !this.effortRead) { this.effortRead = true; this.#readLastRequest(); }
        if (m.type === 'assistant' && !m.parent_tool_use_id && m.message?.usage) {
          const tokens = contextTokens(m.message.usage);
          if (tokens && tokens !== this.context) { this.context = tokens; this.#transient(this.snapshot()); }
        }
        break;
      case 'control_request': this.#request(m); break;
      case 'control_response': {
        const r = m.response || {};
        const callback = this.control.get(r.request_id);
        this.control.delete(r.request_id);
        callback?.(r);
        break;
      }
      case 'control_cancel_request': this.#closePermission(m.request_id, 'cancelled'); break;
      case 'result': {
        this.openTurns = Math.max(0, this.openTurns - 1);
        this.streaming = null;
        if (this.openTurns === 0) { this.finishedAt = Date.now(); this.turnStart = 0; }
        for (const req of [...this.pending.keys()]) this.#closePermission(req, 'cancelled');
        const interrupted = this.interruptRequested && m.subtype !== 'success';
        this.interruptRequested = false;
        const error = m.is_error && !interrupted ? shorten(String(m.result || m.subtype || 'Error'), 1500) : null;
        this.#publish({ type: 'result', error, interrupted, durationMs: m.duration_ms, cost: m.total_cost_usd });
        this.effortRead = false;
        this.#readLastRequest();
        this.#transient(this.snapshot());
        if (!interrupted) this.#notify(error ? 'error' : 'done', error || this.lastText);
        break;
      }
      case 'rate_limit_event': {
        const info = m.rate_limit_info || {};
        const w = info.unifiedWindows || {};
        this.limit = { status: info.status, fiveHour: w.five_hour?.utilization ?? null, sevenDay: w.seven_day?.utilization ?? null,
          resetsAt: info.resetsAt || null, fiveHourResetsAt: w.five_hour?.resetsAt || null, sevenDayResetsAt: w.seven_day?.resetsAt || null };
        saveLimit(this.limit);
        this.#transient({ type: 'limit', limit: this.limit });
        break;
      }
      default: break;
    }
  }

  /** Reads this turn's API request effort from the transcript; sends it to the status bar if it changed. */
  async #readLastRequest() {
    const r = await lastRequest(path.join(logDir(this.project), `${this.session}.jsonl`)).catch(() => null);
    if (!r || (this.lastRequest && r.effort === this.lastRequest.effort && r.model === this.lastRequest.model && r.at === this.lastRequest.at)) return;
    this.lastRequest = r;
    if (r.context && !this.context) this.context = r.context;
    this.#transient(this.snapshot());
  }

  #notify(kind, text) {
    if (this.listeners.size === 0) notifier({ kind, project: this.project, session: this.session, text: shorten(String(text || '').replace(/\s+/g, ' '), 140) });
  }

  #request(m) {
    const r = m.request || {};
    if (r.subtype !== 'can_use_tool') {
      this.#write({ type: 'control_response', response: { subtype: 'error', request_id: m.request_id, error: 'Kumanda does not support this request' } });
      return;
    }
    this.pending.set(m.request_id, r);
    this.#publish({
      type: 'permission', request: m.request_id, toolUseId: r.tool_use_id, name: r.tool_name, input: shortenInput(r.input),
      reason: r.decision_reason || r.description || null, canAlways: Boolean(r.permission_suggestions?.length),
    });
    this.#transient(this.snapshot());
    this.#notify('permission', r.tool_name === 'AskUserQuestion' ? 'Claude is asking a question' : `Waiting for permission: ${r.tool_name}`);
  }

  #closePermission(request, decision) {
    if (!this.pending.delete(request)) return;
    this.#publish({ type: 'permission-reply', request, decision });
  }

  /** decision: 'allow' | 'always' (save the rule permanently) | 'deny'. answers: for AskUserQuestion { question: answer }. */
  answerPermission(request, { decision, answers, message } = {}) {
    const r = this.pending.get(request);
    if (!r) return false;
    let reply;
    if (decision === 'deny') {
      reply = { behavior: 'deny', message: (typeof message === 'string' && message.trim()) || 'The user denied this action.' };
    } else {
      const input = r.tool_name === 'AskUserQuestion' && answers && typeof answers === 'object' ? { ...r.input, answers } : r.input;
      reply = { behavior: 'allow', updatedInput: input };
      if (decision === 'always' && r.permission_suggestions?.length) reply.updatedPermissions = r.permission_suggestions;
    }
    this.#write({ type: 'control_response', response: { subtype: 'success', request_id: request, response: reply } });
    this.#closePermission(request, decision === 'deny' ? 'deny' : decision === 'always' ? 'always' : 'allow');
    this.#transient(this.snapshot());
    return true;
  }

  #sendControl(request) {
    return new Promise(resolve => {
      const id = crypto.randomUUID();
      const timer = setTimeout(() => { this.control.delete(id); resolve({ subtype: 'error', error: 'No reply' }); }, 8000);
      this.control.set(id, r => { clearTimeout(timer); resolve(r); });
      this.#write({ type: 'control_request', request_id: id, request });
    });
  }

  send(text, images = []) {
    if (this.closed) throw new Error('Process closed');
    if (this.openTurns === 0 && this.events.length > 3000) this.#rebase();
    const content = [
      ...images.map(i => ({ type: 'image', source: { type: 'base64', media_type: i.type, data: i.data } })),
      ...(text ? [{ type: 'text', text }] : []),
    ];
    if (this.openTurns === 0) this.turnStart = Date.now();
    this.openTurns++;
    this.lastActivity = Date.now();
    this.#publish({ type: 'user', text, images: images.length });
    this.#write({ type: 'user', message: { role: 'user', content } });
    this.#transient(this.snapshot());
  }

  /** /btw side question: lands in the chat stream as a persistent event (again with the same id when answered). */
  publishBtw(o) { if (!this.closed) this.#publish({ ...o, type: 'btw' }); }

  /** The log grew too large: finished turns are in the transcript already, so empty the log and make clients reload. */
  #rebase() {
    try {
      this.historyLimit = fs.statSync(path.join(logDir(this.project), `${this.session}.jsonl`)).size;
      this.historyLimitAt = Date.now();
      this.events = [];
      this.base = this.seq;
      this.#transient({ type: 'reload' });
    } catch { /* no file: keep the log */ }
  }

  async interrupt() {
    if (this.closed || this.openTurns === 0) return;
    this.interruptRequested = true;
    await this.#sendControl({ subtype: 'interrupt' });
  }

  async setMode(mode) {
    if (!MODES.includes(mode)) throw new Error('Invalid mode');
    if (mode === this.mode) return;
    const r = await this.#sendControl({ subtype: 'set_permission_mode', mode });
    if (r.subtype !== 'success') throw new Error(r.error || 'Could not change the mode');
    this.mode = mode;
    this.#transient(this.snapshot());
  }

  async setModel(model) {
    if (!MODELS.includes(model)) throw new Error('Invalid model');
    if (model === this.requestedModel) return;
    const r = await this.#sendControl({ subtype: 'set_model', model: model || 'default' });
    if (r.subtype !== 'success') throw new Error(r.error || 'Could not change the model');
    this.requestedModel = model;
    if (r.response?.model) this.model = r.response.model;
    this.#transient(this.snapshot());
  }

  /** Changes the effort of a running session; applies from the next request. '' returns to the user's setting.
   *  (Tried on 2.1.322: the 'flag' layer also overrides the user's per-model effortLevel; null removes that layer.) */
  async setEffort(effort) {
    if (!EFFORTS.includes(effort)) throw new Error('Invalid effort');
    if (effort === this.effort) return;
    const r = await this.#sendControl({ subtype: 'apply_flag_settings', settings: { effortLevel: effort || null } });
    if (r.subtype !== 'success') throw new Error(r.error || 'Could not change the effort');
    this.effort = effort;
    this.#transient(this.snapshot());
  }

  subscribe(res, marker) {
    // marker: "<generation>:<seq>" (the last persistent event the client saw). If it is from another generation or from
    // before the log was reset, the client's view is stale: make it reload the history and replay the log from the start.
    const [generation, n] = String(marker || '').split(':');
    let after = generation === this.generation ? Number(n) || 0 : -1;
    const write = o => res.write(`${o.seq ? `id: ${this.generation}:${o.seq}\n` : ''}data: ${JSON.stringify(o)}\n\n`);
    write(this.snapshot());
    if (after < this.base) { if (marker) write({ type: 'reload' }); after = 0; }
    for (const o of this.events) if (o.seq > after) write(o);
    if (this.streaming?.text) write({ type: 'delta', block: this.streaming.block, full: this.streaming.text });
    this.listeners.add(res);
    res.on('close', () => this.listeners.delete(res));
  }

  close() {
    if (this.closed) return;
    try { this.proc.stdin.end(); } catch { /* already closed */ }
    setTimeout(() => { if (!this.closed) this.proc.kill(); }, 5000).unref();
  }
}

export const findRun = session => runs.get(session) || null;

export function listRuns() {
  return [...runs.values()].filter(r => !r.closed)
    .map(r => ({ session: r.session, project: r.project.id, projectName: r.project.name, state: r.state, turnStart: r.turnStart,
      finishedAt: r.finishedAt, lastText: shorten(r.lastText.replace(/\s+/g, ' '), 160) }));
}

/** now: if Claude is working, interrupts the running turn and sends the prompt right away (Claude Code's Ctrl+Enter). */
export async function send(project, { session, text, images, mode, model, effort, now }) {
  let r = session ? runs.get(session) : null;
  if (r?.closed) { runs.delete(session); r = null; }
  if (!r) {
    let resume = false, limit = 0;
    if (session) {
      const file = await sessionFile(project, session);
      if (!file) throw new Error('Session not found');
      resume = true;
      limit = (await fsp.stat(file)).size;
    } else session = crypto.randomUUID();
    r = new Run(project, session, { resume, mode, model, effort, limit });
    runs.set(session, r);
  } else {
    if (mode && mode !== r.mode) await r.setMode(mode).catch(() => {});
    if (typeof model === 'string' && model !== r.requestedModel) await r.setModel(model).catch(() => {});
    if (typeof effort === 'string' && effort !== r.effort) await r.setEffort(effort).catch(() => {});
  }
  if (now && r.openTurns > 0) await r.interrupt();
  r.send(text, images);
  return r;
}

export function closeAllRuns() { for (const r of runs.values()) r.close(); }

// Close idle processes; forget closed runs after a while.
setInterval(() => {
  const now = Date.now();
  for (const [session, r] of runs) {
    if (r.closed) { if (now - r.closedAt > 10 * 60e3 && r.listeners.size === 0) runs.delete(session); }
    else if (r.state === 'ready' && now - r.lastActivity > (config.idleCloseMinutes || 20) * 60e3) r.close();
  }
}, 60e3).unref();
