// Scheduled prompts: "send this to the chat at 14:30" or "when the usage limit resets". Kept in the data folder so they
// survive a restart; a timer sends the due ones through the same path as a prompt typed in the UI.
import path from 'node:path';
import crypto from 'node:crypto';
import { DATA, atomicWrite, readJsonFile } from './config.mjs';
import { findProject } from './projects.mjs';
import { send, getLastLimit } from './sessions.mjs';

const FILE = path.join(DATA, 'scheduled.json');
const MISSED_AFTER = 12 * 3600e3; // the computer was off/asleep for longer than this: do not send a stale prompt
const LIMIT = 100;
let items = null;
let onEvent = () => {};

const load = () => { if (!items) items = readJsonFile(FILE, []).filter(o => o && o.id); return items; };
const save = () => atomicWrite(FILE, JSON.stringify(items));

/** Called with { kind: 'sent' | 'failed' | 'missed', item, error? } (the server sends a notification for failures). */
export function onScheduleEvent(f) { onEvent = f; }

/** When the usage limit is expected to reset (ms), from the last rate limit Claude Code reported; null if unknown. */
export function limitResetTime() {
  const l = getLastLimit();
  if (!l) return null;
  const times = [l.resetsAt, l.fiveHourResetsAt, l.sevenDayResetsAt].filter(t => typeof t === 'number' && t * 1000 > Date.now());
  // A rejected window resets at `resetsAt`; otherwise the five-hour window is the one that usually runs out.
  const t = l.status === 'rejected' && l.resetsAt ? l.resetsAt : times.sort((a, b) => a - b)[0];
  return t ? t * 1000 : null;
}

export function listScheduled(session) {
  return load().filter(o => !session || o.session === session).sort((a, b) => a.at - b.at);
}

export function addScheduled({ project, session, text, at, mode, model, effort, afterLimit }) {
  if (load().filter(o => o.state === 'waiting').length >= LIMIT) throw Object.assign(new Error('Too many scheduled prompts'), { status: 400 });
  const item = { id: crypto.randomUUID(), project, session, text, at, mode, model, effort, afterLimit: Boolean(afterLimit), state: 'waiting', created: Date.now() };
  items.push(item);
  save();
  return item;
}

export function removeScheduled(id) {
  const i = load().findIndex(o => o.id === id);
  if (i < 0) return false;
  items.splice(i, 1);
  save();
  return true;
}

async function run(item) {
  item.state = 'sending';
  try {
    const project = await findProject(item.project);
    if (!project) throw new Error('The project is gone');
    await send(project, { session: item.session, text: item.text, images: [], mode: item.mode, model: item.model, effort: item.effort });
    removeScheduled(item.id);
    onEvent({ kind: 'sent', item });
  } catch (e) {
    item.state = 'failed';
    item.error = e.message;
    save();
    onEvent({ kind: 'failed', item, error: e.message });
  }
}

/** Sends a scheduled prompt right away (the "Send now" button). */
export async function runScheduled(id) {
  const item = load().find(o => o.id === id);
  if (!item || item.state === 'sending') return false;
  await run(item);
  return true;
}

export function tick(now = Date.now()) {
  for (const item of load()) {
    if (item.state !== 'waiting' || item.at > now) continue;
    if (now - item.at > MISSED_AFTER) {
      item.state = 'missed';
      save();
      onEvent({ kind: 'missed', item });
    } else run(item);
  }
}

setInterval(tick, Number(process.env.KUMANDA_TICK_MS) || 15e3).unref();
setTimeout(tick, 3e3).unref(); // ones that became due while the server was off
