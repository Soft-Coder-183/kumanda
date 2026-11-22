// Small JSON stores in the data folder that every device shares: prompt drafts, saved prompts (snippets) and the
// pinned/archived flags of chats. Each is one file, read once and written atomically on change.
import path from 'node:path';
import { DATA, atomicWrite, readJsonFile } from './config.mjs';

function jsonStore(name, fallback) {
  const file = path.join(DATA, name);
  let value = null;
  return {
    get() { if (value === null) value = readJsonFile(file, fallback()); return value; },
    save() { atomicWrite(file, JSON.stringify(value)); },
  };
}

// ── drafts: an unsent prompt per chat, so a prompt started on the phone can be finished on the computer ──
export const DRAFT_KEY = /^[0-9a-f]{12}\.([0-9a-f-]{36}|new)$/;
const DRAFT_LIMIT = 300, DRAFT_TEXT = 100000;
const drafts = jsonStore('drafts.json', () => ({}));

export function getDraft(key) { return drafts.get()[key] || { text: '', at: 0 }; }

/** Saves a draft unless a newer one is already stored (two devices typing: the last writer wins). Returns the stored one. */
export function setDraft(key, text, at) {
  const all = drafts.get();
  const old = all[key];
  if (old && old.at > at) return old;
  if (!text) delete all[key];
  else all[key] = { text: String(text).slice(0, DRAFT_TEXT), at };
  const keys = Object.keys(all);
  if (keys.length > DRAFT_LIMIT) { // forget the oldest
    for (const k of keys.sort((a, b) => all[a].at - all[b].at).slice(0, keys.length - DRAFT_LIMIT)) delete all[k];
  }
  drafts.save();
  return all[key] || { text: '', at };
}

// ── saved prompts (snippets): one tap inserts them into the composer ──
const DEFAULT_SNIPPETS = [
  'Continue.',
  'The usage limit has reset. Continue where you left off.',
  'Run the tests and fix anything that fails.',
  'Commit the changes with a clear message and push.',
  'Summarise briefly what you changed and what is left.',
];
const snippets = jsonStore('snippets.json', () => DEFAULT_SNIPPETS);
export const SNIPPET_LIMIT = 60, SNIPPET_TEXT = 4000;
export const getSnippets = () => snippets.get();
export function setSnippets(list) {
  const clean = list.map(s => String(s).trim()).filter(Boolean).slice(0, SNIPPET_LIMIT).map(s => s.slice(0, SNIPPET_TEXT));
  const all = snippets.get();
  all.splice(0, all.length, ...clean);
  snippets.save();
  return all;
}

// ── chat flags: pinned (on top of the list) and archived (out of the list, in the "Archived" box) ──
const chats = jsonStore('chats.json', () => ({}));
export const chatFlags = session => chats.get()[session] || {};
export function setChatFlags(session, flags) {
  const all = chats.get();
  const next = { ...all[session] };
  for (const k of ['pinned', 'archived']) {
    if (flags[k] === true) next[k] = true;
    else if (flags[k] === false) delete next[k];
  }
  if (Object.keys(next).length) all[session] = next; else delete all[session];
  chats.save();
  return next;
}
