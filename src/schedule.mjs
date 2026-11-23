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

/** When the usage limit that is in force now resets (ms); null if no limit is in force (or it is not known).
 *  Claude Code reports the reset time of the current windows even when nothing is used up (status "allowed"); that time
 *  must not be used, or "continue when the limit resets" would wait for the next window although the limit is over. */
export function limitResetTime(now = Date.now()) {
  const l = getLastLimit();
  if (!l) return null;
  const future = t => (typeof t === 'number' && t * 1000 > now ? t * 1000 : null);
  if (l.status === 'rejected') return future(l.resetsAt) || future(l.fiveHourResetsAt);
  if (l.fiveHour >= 1) return future(l.fiveHourResetsAt);
  if (l.sevenDay >= 1) return future(l.sevenDayResetsAt);
  return null;
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
