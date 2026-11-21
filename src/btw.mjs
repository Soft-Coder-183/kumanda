// /btw side questions. Claude Code does not keep them: for a /btw asked in the terminal only the question lands in
// ~/.claude/history.jsonl (the prompt history); the answer is written nowhere. Kumanda does two things:
//  1. A side question asked from Kumanda is answered by a forked, never-saved, tool-less copy of the chat
//     (`--resume <session> --fork-session --no-session-persistence --tools ""`); the chat and its transcript do not change.
//     The question and answer are kept in the data folder (`btw/<session>.jsonl`).
//  2. /btw questions asked in the terminal are read from history.jsonl and shown in the same chat (without an answer).
import { spawn } from 'node:child_process';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { DATA } from './config.mjs';
import { CLAUDE_DIR } from './projects.mjs';
import { EFFORTS, MODELS, claudeCommand } from './sessions.mjs';

const DIR = path.join(DATA, 'btw');
const HISTORY = path.join(CLAUDE_DIR, 'history.jsonl');
const TIMEOUT = 3 * 60e3;
const MAX_RUNNING = 3;
const UUID = /^[0-9a-f-]{36}$/i;

const INSTRUCTION = 'This is a side question (/btw): the user is asking something quick without interrupting the ongoing work. '
  + 'You cannot use tools; answer briefly and directly from what is already known in this conversation. If you do not know, say so.';

const fileOf = session => path.join(DIR, `${session}.jsonl`);
const running = new Map(); // session → Map(id → question waiting for its answer)
let runningCount = 0;

async function saved(session) {
  let text;
  try { text = await fsp.readFile(fileOf(session), 'utf8'); } catch { return []; }
  const byId = new Map();
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try { const o = JSON.parse(line); if (o.id) byId.set(o.id, o); } catch { /* partial line */ }
  }
  return [...byId.values()];
}

// history.jsonl may grow large: only the appended part is read, /btw lines are kept per session.
const terminal = { read: 0, rest: '', bySession: new Map() };
async function terminalQuestions(session) {
  let st;
  try { st = await fsp.stat(HISTORY); } catch { return []; }
  if (st.size < terminal.read) Object.assign(terminal, { read: 0, rest: '', bySession: new Map() }); // the file shrank
  if (st.size > terminal.read) {
    const fh = await fsp.open(HISTORY, 'r');
    try {
      const buf = Buffer.alloc(st.size - terminal.read);
      const { bytesRead } = await fh.read(buf, 0, buf.length, terminal.read);
      terminal.read += bytesRead;
      const lines = (terminal.rest + buf.subarray(0, bytesRead).toString('utf8')).split('\n');
      terminal.rest = lines.pop();
      for (const line of lines) {
        if (!line.includes('"/btw')) continue;
        let o;
        try { o = JSON.parse(line); } catch { continue; }
        const m = /^\/btw\s+(\S[\s\S]*)$/.exec(typeof o.display === 'string' ? o.display : '');
        if (!m || typeof o.sessionId !== 'string' || !Number.isFinite(o.timestamp)) continue;
        const list = terminal.bySession.get(o.sessionId) || [];
        list.push({ id: `terminal-${o.timestamp}`, at: o.timestamp, question: m[1].trim(), source: 'terminal' });
        terminal.bySession.set(o.sessionId, list);
      }
    } finally { await fh.close(); }
  }
  return terminal.bySession.get(session) || [];
}

/** All side questions of a chat (asked from Kumanda, still waiting, asked in the terminal), by time. */
export async function btwQuestions(session) {
  if (!UUID.test(session)) return [];
  const all = [...await saved(session), ...(running.get(session)?.values() || []), ...await terminalQuestions(session)];
  return all.sort((a, b) => a.at - b.at);
}

/** Places side questions between history items by their time. */
export function interleave(items, questions) {
  if (!questions.length) return items;
  const out = [];
  let i = 0;
  for (const it of items) {
    while (i < questions.length && it.at && questions[i].at < it.at) out.push({ ...questions[i++], type: 'btw' });
    out.push(it);
  }
  while (i < questions.length) out.push({ ...questions[i++], type: 'btw' });
  return out;
}

function run(project, session, question, { model, effort }) {
  return new Promise((resolve, reject) => {
    const [command, prefix] = claudeCommand();
    const args = [...prefix, '-p', '--output-format', 'json', '--resume', session, '--fork-session', '--no-session-persistence',
      '--tools', '', '--strict-mcp-config', '--append-system-prompt', INSTRUCTION,
      ...(model ? ['--model', model] : []), ...(effort ? ['--effort', effort] : [])];
    const proc = spawn(command, args, { cwd: project.path, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '', err = '';
    proc.stdout.setEncoding('utf8').on('data', v => { out += v; });
    proc.stderr.setEncoding('utf8').on('data', v => { err = (err + v).slice(-1500); });
    const timer = setTimeout(() => { proc.kill(); reject(new Error('The side question was not answered within 3 minutes')); }, TIMEOUT);
    proc.on('error', e => { clearTimeout(timer); reject(new Error(`Could not start Claude Code: ${e.message}`)); });
    proc.on('exit', code => {
      clearTimeout(timer);
      const line = out.trim().split('\n').reverse().find(s => s.trim().startsWith('{'));
      let r = null;
      try { r = line ? JSON.parse(line) : null; } catch { /* not JSON */ }
      if (r && !r.is_error && typeof r.result === 'string') resolve(r.result);
      else reject(new Error(String(r?.result || err.trim() || `Claude Code did not answer (code ${code})`).slice(0, 1500)));
    });
    proc.stdin.on('error', () => {});
    proc.stdin.end(question);
  });
}

/** Gets the side question answered and saves it. `publish(o)`: puts the card into the live stream if the chat is open. */
export async function askBtw(project, session, { id, question, model, effort }, publish = () => {}) {
  if (runningCount >= MAX_RUNNING) throw Object.assign(new Error('At most 3 side questions can run at once'), { status: 429 });
  if (!MODELS.includes(model)) model = '';
  if (!EFFORTS.includes(effort)) effort = '';
  const o = { id, at: Date.now(), question, source: 'kumanda', model: model || null, pending: true };
  if (!running.has(session)) running.set(session, new Map());
  running.get(session).set(id, o);
  publish(o);
  runningCount++;
  try { o.answer = await run(project, session, question, { model, effort }); }
  catch (e) { o.error = e.message; }
  finally {
    runningCount--;
    running.get(session)?.delete(id);
    if (!running.get(session)?.size) running.delete(session);
    delete o.pending;
  }
  await fsp.mkdir(DIR, { recursive: true });
  await fsp.appendFile(fileOf(session), JSON.stringify(o) + '\n');
  publish(o);
  return o;
}

export const btwExists = async (session, id) => (running.get(session)?.has(id)) || (await saved(session)).some(o => o.id === id);
