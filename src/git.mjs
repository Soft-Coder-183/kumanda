// Read-only git view of a project: branch, changed files, recent commits and diffs, so the work Claude did can be
// reviewed from the phone. Only fixed read commands run (an argument array, no shell); nothing is written.
import { execFile } from 'node:child_process';

const DIFF_LIMIT = 600000;
const HASH = /^[0-9a-f]{4,40}$/i;

function git(cwd, args, { limit = 4e6 } = {}) {
  return new Promise(resolve => {
    execFile('git', ['-c', 'core.quotepath=off', '-c', 'color.ui=never', '--no-pager', ...args], {
      cwd, timeout: 15000, maxBuffer: limit, windowsHide: true, encoding: 'utf8',
      env: { ...process.env, GIT_PAGER: 'cat', GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C' },
    }, (error, stdout, stderr) => resolve({ ok: !error, out: stdout || '', err: (stderr || error?.message || '').trim(), tooLong: error?.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' }));
  });
}

/** A relative path from the UI: no absolute paths, no "..", no options. */
export const validGitPath = p => typeof p === 'string' && p.length > 0 && p.length < 1000 && !/^[-/\\]|^[a-zA-Z]:|(^|[\\/])\.\.([\\/]|$)|\0/.test(p);
export const validHash = h => typeof h === 'string' && HASH.test(h);

const STATUS = { M: 'modified', A: 'added', D: 'deleted', R: 'renamed', C: 'copied', U: 'conflict', T: 'type changed', '?': 'new' };

export async function gitStatus(cwd) {
  const top = await git(cwd, ['rev-parse', '--show-toplevel']);
  if (!top.ok) return { repo: false, reason: /not a git repository/i.test(top.err) ? 'This project is not a git repository.' : top.err || 'git is not available' };
  const s = await git(cwd, ['status', '--porcelain=v1', '--branch', '--untracked-files=all', '--', '.']);
  const files = [];
  let branch = '', ahead = 0, behind = 0, upstream = '';
  for (const line of s.out.split('\n')) {
    if (!line) continue;
    if (line.startsWith('## ')) {
      const m = /^## (?:No commits yet on )?(.+?)(?:\.\.\.(\S+))?(?: \[(.*)\])?$/.exec(line);
      branch = m?.[1] || line.slice(3);
      upstream = m?.[2] || '';
      ahead = Number(/ahead (\d+)/.exec(m?.[3] || '')?.[1] || 0);
      behind = Number(/behind (\d+)/.exec(m?.[3] || '')?.[1] || 0);
      continue;
    }
    const x = line[0], y = line[1];
    let file = line.slice(3);
    let from = null;
    if (file.includes(' -> ')) [from, file] = file.split(' -> ');
    const unquote = f => (f.startsWith('"') ? f.slice(1, -1).replace(/\\(.)/g, '$1') : f);
    const code = x === '?' ? '?' : x === 'U' || y === 'U' ? 'U' : x !== ' ' ? x : y;
    files.push({ path: unquote(file), from: from && unquote(from), status: STATUS[code] || code, staged: x !== ' ' && x !== '?', code });
  }
  // The paths git prints are relative to the repository root; the project may be a subfolder of it.
  const prefix = (await git(cwd, ['rev-parse', '--show-prefix'])).out.trim();
  const strip = f => (prefix && f?.startsWith(prefix) ? f.slice(prefix.length) : f);
  for (const f of files) { f.path = strip(f.path); f.from = strip(f.from); }
  const log = await git(cwd, ['log', '-n', '30', '--date=unix', '--pretty=format:%H%x1f%h%x1f%an%x1f%ad%x1f%s', '--', '.']);
  const commits = log.ok ? log.out.split('\n').filter(Boolean).map(l => {
    const [hash, short, author, at, subject] = l.split('\x1f');
    return { hash, short, author, at: Number(at) * 1000, subject };
  }) : [];
  return { repo: true, branch, upstream, ahead, behind, files, commits };
}

/** The diff of one changed file (working tree + staged against HEAD), or of a commit (optionally only one file). */
export async function gitDiff(cwd, { file, commit }) {
  let r;
  if (commit) {
    r = await git(cwd, ['show', '--stat', '--patch', '--format=%H%n%an <%ae>%n%ad%n%n%B', '--date=iso', commit, '--', file || '.'], { limit: DIFF_LIMIT * 4 });
  } else {
    r = await git(cwd, ['diff', 'HEAD', '--', file], { limit: DIFF_LIMIT * 4 });
    if (r.ok && !r.out.trim()) r = await git(cwd, ['diff', '--cached', '--', file], { limit: DIFF_LIMIT * 4 }); // no commit yet
  }
  if (!r.ok && !r.tooLong) return { error: r.err || 'git failed' };
  const text = r.out.length > DIFF_LIMIT ? r.out.slice(0, DIFF_LIMIT) : r.out;
  return { text, truncated: r.tooLong || r.out.length > DIFF_LIMIT };
}
