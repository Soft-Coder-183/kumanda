// The "/" commands a chat can use, for the composer's autocomplete. The authority is Claude Code itself: the `init` message
// of every run lists `slash_commands` (skills, custom commands, built-ins) and `terminal_slash_commands` (ones that only
// work in the terminal). That list is saved per project; before the first run in a project the skill and command folders
// are scanned instead. Descriptions come from the SKILL.md / command files' front matter.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { DATA, atomicWrite, readJsonFile } from './config.mjs';
import { CLAUDE_DIR } from './projects.mjs';

const FILE = path.join(DATA, 'commands.json');
let saved = null; // project id → { names: [], terminal: [], skills: [], at }
const load = () => { if (!saved) saved = readJsonFile(FILE, {}); return saved; };

/** Called with a run's init message. */
export function rememberCommands(projectId, init) {
  if (!Array.isArray(init?.slash_commands)) return;
  const all = load();
  const next = { names: init.slash_commands.filter(s => typeof s === 'string'), terminal: (init.terminal_slash_commands || []).filter(s => typeof s === 'string'),
    skills: (init.skills || []).filter(s => typeof s === 'string'), at: Date.now() };
  if (JSON.stringify({ ...all[projectId], at: 0 }) === JSON.stringify({ ...next, at: 0 })) return;
  all[projectId] = next;
  try { atomicWrite(FILE, JSON.stringify(all)); } catch { /* keep it in memory */ }
}

// Built-ins that are useful from Kumanda, with a short description (the init list gives names only).
const BUILT_IN = {
  btw: 'Side question that does not interrupt the work (Kumanda)', compact: 'Compact the conversation to free context',
  context: 'Show what fills the context window', usage: 'Show plan usage', init: 'Write a CLAUDE.md for this project',
  'security-review': 'Review the pending changes for security issues', 'code-review': 'Review the current changes for bugs',
  recap: 'Summarise the session so far', insights: 'Report on your Claude Code sessions', rename: 'Rename this chat',
  clear: 'Start over with an empty context', model: 'Change the model', effort: 'Change the effort',
};
// Handled by Kumanda's own controls or not meaningful from a phone.
const HIDDEN = new Set(['__remote-workflow', 'workflow-launch-exec', 'heapdump', 'login', 'logout', 'resume', 'exit', 'quit']);

/** First lines of a SKILL.md / command .md: `description:` from the front matter, else the first text line. */
async function describe(file) {
  let text;
  try { text = (await fsp.readFile(file, 'utf8')).slice(0, 4000); } catch { return null; }
  const front = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  const head = front?.[1] || '';
  const field = k => (head.split(/\r?\n/).find(l => l.startsWith(`${k}:`)) || '').slice(k.length + 1).trim().replace(/^["']|["']$/g, '');
  if (/^user-invocable:\s*false/m.test(head)) return { hidden: true };
  const line = (front ? text.slice(front[0].length) : text).split(/\r?\n/).map(l => l.replace(/^#+\s*/, '').trim()).find(Boolean) || '';
  return { name: field('name'), description: field('description') || line };
}

/** Skills (folders with SKILL.md) and commands (.md files, subfolders give "dir:name") in the user and project folders. */
async function scan(projectPath) {
  const found = new Map(); // name → { description, kind }
  const roots = [path.join(CLAUDE_DIR), path.join(projectPath, '.claude')];
  for (const root of roots) {
    let skills = [];
    try { skills = await fsp.readdir(path.join(root, 'skills'), { withFileTypes: true }); } catch { /* none */ }
    for (const e of skills) {
      if (!e.isDirectory()) continue;
      const file = path.join(root, 'skills', e.name, 'SKILL.md');
      if (!fs.existsSync(file)) continue;
      const d = await describe(file);
      if (d && !d.hidden) found.set(d.name || e.name, { description: d.description, kind: 'skill' });
    }
    const walk = async (dir, prefix) => {
      let entries = [];
      try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch { return; }
      for (const e of entries) {
        if (e.isDirectory()) await walk(path.join(dir, e.name), `${prefix}${e.name}:`);
        else if (e.name.endsWith('.md')) {
          const d = await describe(path.join(dir, e.name));
          if (d && !d.hidden) found.set(`${prefix}${e.name.slice(0, -3)}`, { description: d.description, kind: 'command' });
        }
      }
    };
    await walk(path.join(root, 'commands'), '');
  }
  return found;
}

/** [{ name, description, kind: 'skill' | 'command' | 'built-in' }] for the project, the most useful first. */
export async function listCommands(project) {
  const files = await scan(project.path);
  const known = load()[project.id] || Object.values(load()).sort((a, b) => b.at - a.at)[0]; // another project's list is close
  const terminal = new Set(known?.terminal || []);
  const skills = new Set(known?.skills || []);
  const names = new Set(['btw', ...(known?.names || []), ...files.keys()]);
  const out = [];
  for (const name of names) {
    if (terminal.has(name) || HIDDEN.has(name)) continue;
    const f = files.get(name);
    const kind = f?.kind || (skills.has(name) ? 'skill' : 'built-in');
    out.push({ name, description: f?.description || BUILT_IN[name] || '', kind });
  }
  const order = { skill: 0, command: 1, 'built-in': 2 };
  return { commands: out.sort((a, b) => order[a.kind] - order[b.kind] || a.name.localeCompare(b.name, 'en')), fromClaude: Boolean(known) };
}
