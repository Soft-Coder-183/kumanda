// Searching chats: by title in every project, and inside the messages (your prompts and Claude's replies) of one
// project's chats. Transcripts are read line by line; a cheap text check comes before JSON parsing.
import fs from 'node:fs';
import readline from 'node:readline';
import { listSessions, userText } from './projects.mjs';

const lower = s => s.toLocaleLowerCase('tr');
const NOT_TYPED = /^\s*(<|Caveat:|Base directory for this skill:|\[Request interrupted|\[Side question)/;
const PER_CHAT = 4, TOTAL = 80, SESSIONS = 80, BUDGET_MS = 5000;

function snippet(text, i, length) {
  const start = Math.max(0, i - 70), end = Math.min(text.length, i + length + 110);
  return { text: `${start ? '…' : ''}${text.slice(start, end).replace(/\s+/g, ' ')}${end < text.length ? '…' : ''}`, start: start ? 1 : 0 };
}

/** Messages of one transcript that contain `q` (already lower case). */
async function searchFile(file, q) {
  const found = [];
  const lines = readline.createInterface({ input: fs.createReadStream(file, { encoding: 'utf8' }), crlfDelay: Infinity });
  try {
    for await (const line of lines) {
      if (!lower(line).includes(q) || !(line.includes('"type":"user"') || line.includes('"type":"assistant"'))) continue;
      let o;
      try { o = JSON.parse(line); } catch { continue; }
      if (o.isSidechain || o.isMeta || o.isCompactSummary) continue;
      const content = o.message?.content;
      let text = '';
      if (o.type === 'user') {
        if (Array.isArray(content) && content.some(b => b.type === 'tool_result')) continue;
        text = userText(content);
        if (NOT_TYPED.test(text)) continue;
      } else if (o.type === 'assistant' && Array.isArray(content)) text = content.filter(b => b.type === 'text').map(b => b.text).join('\n');
      const i = lower(text).indexOf(q);
      if (i < 0) continue;
      found.push({ role: o.type, at: Date.parse(o.timestamp) || 0, ...snippet(text, i, q.length) });
      if (found.length >= PER_CHAT) break;
    }
  } finally { lines.close(); }
  return found;
}

/** Title matches across `projects`; with `content`, also message matches (meant for one project). */
export async function searchChats(projects, query, { content = false } = {}) {
  const q = lower(String(query).trim());
  if (q.length < 2) return { results: [], truncated: false };
  const results = [];
  const deadline = Date.now() + BUDGET_MS;
  let truncated = false;
  for (const project of projects) {
    const sessions = await listSessions(project, SESSIONS);
    for (const s of sessions) {
      const byTitle = lower(s.title || '').includes(q);
      let matches = [];
      if (content && Date.now() < deadline) {
        try { matches = await searchFile(s.file, q); } catch { /* deleted meanwhile */ }
      } else if (content) truncated = true;
      if (byTitle || matches.length) {
        results.push({ project: project.id, projectName: project.name, session: s.id, title: s.title, mtime: s.mtime, byTitle, matches });
        if (results.length >= TOTAL) return { results, truncated: true };
      }
    }
  }
  return { results, truncated };
}
