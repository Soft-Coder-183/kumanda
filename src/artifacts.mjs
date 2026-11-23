// Claude artifacts: web pages Claude Code publishes to claude.ai with its Artifact tool (private by default). The transcript
// has the call (`file_path`, `title`) and its result with the claude.ai link; they are listed per chat so a project's
// Products tab and the chat show them. Kumanda only links to claude.ai; the page opens there, with your claude.ai login.
import fs from 'node:fs';
import readline from 'node:readline';
import { listSessions } from './projects.mjs';

export const ARTIFACT_LINK = /https:\/\/claude\.ai\/(?:code\/)?artifacts?\/[A-Za-z0-9_-]+/;
const cache = new Map(); // file → { key, list }

const resultText = c => (typeof c === 'string' ? c : Array.isArray(c) ? c.map(b => (b.type === 'text' ? b.text : '')).join('\n') : '');

async function readFile(file) {
  const calls = new Map(); // tool id → input
  const found = new Map(); // url → { url, title, file, at }
  const lines = readline.createInterface({ input: fs.createReadStream(file, { encoding: 'utf8' }), crlfDelay: Infinity });
  for await (const line of lines) {
    if (!line.includes('Artifact') && !line.includes('claude.ai/')) continue;
    let o;
    try { o = JSON.parse(line); } catch { continue; }
    const content = o.message?.content;
    if (!Array.isArray(content)) continue;
    for (const b of content) {
      if (b.type === 'tool_use' && b.name === 'Artifact' && (!b.input?.action || b.input.action === 'publish')) calls.set(b.id, b.input || {});
      if (b.type === 'tool_result' && calls.has(b.tool_use_id) && !b.is_error) {
        const input = calls.get(b.tool_use_id);
        const url = ARTIFACT_LINK.exec(resultText(b.content))?.[0] || (typeof input.url === 'string' && ARTIFACT_LINK.test(input.url) ? input.url : null);
        if (!url) continue;
        const name = typeof input.file_path === 'string' ? input.file_path.split(/[\\/]/).pop() : '';
        found.set(url, { url, title: input.title || name.replace(/\.(html?|md)$/i, '') || 'Artifact', file: name, at: Date.parse(o.timestamp) || 0 });
      }
    }
  }
  return [...found.values()];
}

/** Artifacts of a project's chats: [{ url, title, file, at, session }], newest first. */
export async function listArtifacts(project, onlySession) {
  const out = [];
  for (const s of await listSessions(project)) {
    if (onlySession && s.id !== onlySession) continue;
    const key = `${s.mtime}:${s.size}`;
    let c = cache.get(s.file);
    if (c?.key !== key) {
      try { c = { key, list: await readFile(s.file) }; } catch { c = { key, list: [] }; }
      cache.set(s.file, c);
    }
    out.push(...c.list.map(a => ({ ...a, session: s.id })));
  }
  return out.sort((a, b) => b.at - a.at);
}
