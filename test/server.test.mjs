// End-to-end tests: the real server process + a fake Claude (spends no usage quota).
// Run: npm test
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import http from 'node:http';
import { spawn, spawnSync } from 'node:child_process';

const ROOT = path.resolve(import.meta.dirname, '..');
const temp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'kumanda-test-'));
const data = path.join(temp, 'data'), claudeDir = path.join(temp, 'claude'), projectsDir = path.join(temp, 'projects');
const PASSWORD = 'test-password-123';
const LEGACY_SID = '33333333-3333-4333-8333-333333333333';
let C, P, server, cookie = '', alpha, session, generation;

const freePort = () => new Promise(resolve => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });
const writeFile = (file, content) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, content); };
// KUMANDA_DIRECT: --background starts directly instead of through WMI (a process started by WMI does not inherit these variables).
const env = () => ({ ...process.env, KUMANDA_DIRECT: '1', KUMANDA_DATA: data, KUMANDA_CLAUDE_DIR: claudeDir, KUMANDA_CLAUDE: JSON.stringify([process.execPath, path.join(ROOT, 'test', 'fake-claude.mjs')]),
  KUMANDA_VSCODE: JSON.stringify([process.execPath, path.join(ROOT, 'test', 'fake-vscode.mjs')]), KUMANDA_TICK_MS: '250' });

async function request(url, { body, headers = {}, withCookie = true, base = C, method } = {}) {
  const r = await fetch(base + url, {
    method: method || (body === undefined ? 'GET' : 'POST'), redirect: 'manual',
    headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json', 'X-Kumanda': '1' }), ...(withCookie && cookie ? { Cookie: cookie } : {}), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  let j = null;
  try { j = JSON.parse(text); } catch { /* not json */ }
  return { status: r.status, j, text, headers: r.headers };
}

/** Reads the SSE stream until `until` holds; returns the events seen. */
async function stream(after, until, { onEvent, timeout = 8000 } = {}) {
  const control = new AbortController();
  const timer = setTimeout(() => control.abort(), timeout);
  const events = [];
  try {
    const r = await fetch(`${C}/api/session/${session}/stream${after ? `?after=${encodeURIComponent(after)}` : ''}`, { headers: { Cookie: cookie }, signal: control.signal });
    assert.equal(r.status, 200);
    let buffer = '';
    for await (const piece of r.body) {
      buffer += Buffer.from(piece).toString('utf8');
      let i;
      while ((i = buffer.indexOf('\n\n')) >= 0) {
        const block = buffer.slice(0, i); buffer = buffer.slice(i + 2);
        const line = block.split('\n').find(s => s.startsWith('data: '));
        if (!line) continue;
        const o = JSON.parse(line.slice(6));
        events.push(o);
        await onEvent?.(o, events);
        if (until(o, events)) { control.abort(); return events; }
      }
    }
  } catch (e) { if (e.name !== 'AbortError') throw e; }
  finally { clearTimeout(timer); }
  if (!events.some(o => until(o, events))) assert.fail(`Stream condition not met. Seen: ${events.map(o => o.type).join(',')}`);
  return events;
}
const send = (text, extra = {}) => request(`/api/project/${alpha}/send`, { body: { session, text, ...extra } });
const isResult = o => o.type === 'result';

before(async () => {
  const [cp, pp] = [await freePort(), await freePort()];
  C = `http://127.0.0.1:${cp}`; P = `http://127.0.0.1:${pp}`;
  // A data folder as written by Kumanda 1.x (Turkish file and field names): it is migrated on the first start.
  writeFile(path.join(data, 'ayar.json'), JSON.stringify({ kumandaPort: cp, urunPort: pp, kokler: [projectsDir] }));
  writeFile(path.join(data, 'yan-sorular', `${LEGACY_SID}.jsonl`), JSON.stringify({ id: 'x', z: 5, soru: 'old question', yanit: 'old answer', kaynak: 'kumanda' }) + '\n');
  writeFile(path.join(projectsDir, 'Alpha', 'index.html'), '<!doctype html><title>Alpha Site</title><h1>alpha</h1>');
  writeFile(path.join(projectsDir, 'Alpha', 'site', 'index.html'), '<title>Site</title><script src="/asset.js"></script>');
  writeFile(path.join(projectsDir, 'Alpha', 'site', 'asset.js'), 'console.log("asset")');
  writeFile(path.join(projectsDir, 'Alpha', 'dist', 'app-1.0.0.apk'), 'old-apk');
  writeFile(path.join(projectsDir, 'Alpha', 'dist', 'app-1.10.0.apk'), 'new-apk-content');
  writeFile(path.join(projectsDir, 'Alpha', 'node_modules', 'x', 'index.html'), '<title>dependency</title>');
  writeFile(path.join(projectsDir, 'Alpha', '.hidden', 'secret.txt'), 'secret');
  writeFile(path.join(projectsDir, 'Alpha', 'source', 'index.html'), '<div id="app"></div><script type="module" src="/src/main.ts"></script>');
  writeFile(path.join(temp, 'outside.txt'), 'outside the project');
  fs.mkdirSync(path.join(projectsDir, 'Beta'), { recursive: true });
  fs.mkdirSync(path.join(projectsDir, 'Box', 'Inner'), { recursive: true });
  fs.mkdirSync(path.join(claudeDir, 'projects', path.join(projectsDir, 'Box', 'Inner').replace(/[^a-zA-Z0-9]/g, '-')), { recursive: true });

  server = spawn(process.execPath, [path.join(ROOT, 'server.mjs')], { env: env(), stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  server.stderr.on('data', d => { output += d; });
  await new Promise((resolve, reject) => {
    server.stdout.on('data', d => { output += d; if (output.includes('is running')) resolve(); });
    server.on('exit', code => reject(new Error(`The server did not start (${code}): ${output}`)));
    setTimeout(() => reject(new Error(`Server timeout: ${output}`)), 8000);
  });
});

after(() => {
  server?.kill();
  fs.rmSync(temp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

test('a 1.x data folder is migrated to the English names', () => {
  const config = JSON.parse(fs.readFileSync(path.join(data, 'config.json'), 'utf8'));
  assert.deepEqual([config.controlPort, config.roots], [Number(new URL(C).port), [projectsDir]]);
  assert.ok(fs.existsSync(path.join(data, 'ayar.json.migrated')) && !fs.existsSync(path.join(data, 'ayar.json')));
  const btw = JSON.parse(fs.readFileSync(path.join(data, 'btw', `${LEGACY_SID}.jsonl`), 'utf8'));
  assert.deepEqual([btw.at, btw.question, btw.answer, btw.source], [5, 'old question', 'old answer', 'kumanda']);
});

test('first setup only locally and with a long enough password', async () => {
  const d = await request('/api/status');
  assert.deepEqual([d.j.setUp, d.j.local, d.j.loggedIn], [false, true, false]);
  assert.equal((await request('/api/setup', { body: { password: PASSWORD }, headers: { 'X-Forwarded-For': '8.8.8.8' } })).status, 403, 'setup through the tunnel must be rejected');
  // fetch does not let the Host header change; imitate a DNS rebinding attack with a raw request.
  const foreignHost = await new Promise(resolve => {
    const req = http.request(`${C}/api/setup`, { method: 'POST', headers: { Host: 'evil.example', 'Content-Type': 'application/json', 'X-Kumanda': '1' } }, r => { r.resume(); resolve(r.statusCode); });
    req.end(JSON.stringify({ password: PASSWORD }));
  });
  assert.equal(foreignHost, 403, 'setup with a foreign Host must be rejected');
  assert.equal((await request('/api/setup', { body: { password: 'short' } })).status, 400);
  const r = await request('/api/setup', { body: { password: PASSWORD } });
  assert.equal(r.status, 200);
  cookie = r.headers.get('set-cookie').split(';')[0];
  assert.match(r.headers.get('set-cookie'), /HttpOnly/);
  assert.equal((await request('/api/setup', { body: { password: PASSWORD } })).status, 409, 'a second setup must be rejected');
  assert.equal(JSON.parse(fs.readFileSync(path.join(data, 'config.json'), 'utf8')).password.hash.length, 128, 'the password is not stored in plain text');
});

test('login: wrong passwords are counted, locked after the fifth; the right password gives a cookie', async () => {
  const bad = { 'X-Forwarded-For': '9.9.9.9' };
  for (let i = 0; i < 5; i++) assert.equal((await request('/api/login', { body: { password: 'wrong-password-000' }, headers: bad, withCookie: false })).status, 401);
  assert.equal((await request('/api/login', { body: { password: PASSWORD }, headers: bad, withCookie: false })).status, 429, 'while locked even the right password is rejected');
  const r = await request('/api/login', { body: { password: PASSWORD }, headers: { 'X-Forwarded-For': '7.7.7.7' }, withCookie: false });
  assert.equal(r.status, 200);
  assert.ok(r.headers.get('set-cookie').includes('kumanda_o='));
});

test('the API cannot be used without the cookie, from a foreign origin or without the custom header', async () => {
  assert.equal((await request('/api/projects', { withCookie: false })).status, 401);
  assert.equal((await request('/api/projects', { headers: { Origin: P } })).status, 403, 'request from the product origin');
  assert.equal((await request('/api/projects', { headers: { 'Sec-Fetch-Site': 'same-site' } })).status, 403);
  assert.equal((await request('/api/logout', { method: 'POST' })).status, 403, 'no X-Kumanda header');
  assert.equal((await request('/api/projects', { headers: { Origin: C, 'Sec-Fetch-Site': 'same-origin' } })).status, 200);
});

test('projects: the ones under the root and a recognised project inside a container folder', async () => {
  const { j } = await request('/api/projects');
  const names = j.projects.map(p => p.name).sort();
  assert.deepEqual(names, ['Alpha', 'Beta', 'Box / Inner']);
  alpha = j.projects.find(p => p.name === 'Alpha').id;
  assert.equal(j.projects.find(p => p.name === 'Alpha').productCount, 3);
});

test('new project: an empty folder in the first root; the name is checked, no escaping', async () => {
  const r = await request('/api/project-create', { body: { name: 'New Test' } });
  assert.equal(r.status, 200);
  assert.equal(r.j.project.name, 'New Test');
  assert.ok(fs.statSync(path.join(projectsDir, 'New Test')).isDirectory());
  assert.equal((await request('/api/project-create', { body: { name: 'New Test' } })).status, 409, 'an existing folder is not overwritten');
  for (const name of ['', '  ', '../outside', 'a/b', 'a\b', '.hidden', 'CON', 'lpt1.txt', 'dot.', 'a:b', 'x'.repeat(81), 5]) {
    assert.equal((await request('/api/project-create', { body: { name } })).status, 400, String(name));
  }
  assert.ok(!fs.existsSync(path.join(temp, 'outside')));
  assert.equal((await request('/api/project-create', { body: { name: 'other' }, withCookie: false })).status, 401);
  fs.rmdirSync(path.join(projectsDir, 'New Test'));
});

test('products: the title is read, only the latest version is listed, dependency/source/hidden folders are not scanned', async () => {
  const { j } = await request(`/api/project/${alpha}/products`);
  const byPath = Object.fromEntries(j.products.map(u => [u.path, u]));
  assert.deepEqual(Object.keys(byPath).sort(), ['dist/app-1.10.0.apk', 'index.html', 'site/index.html'], 'the old version (1.0.0) is not listed');
  assert.equal(byPath['index.html'].title, 'Alpha Site');
  assert.equal(byPath['dist/app-1.10.0.apk'].secondary, undefined);
  await request(`/api/project/${alpha}/hide-products`, { body: { path: 'site/index.html', hidden: true } });
  assert.equal((await request(`/api/project/${alpha}/products`)).j.products.length, 2);
  assert.equal((await request(`/api/project/${alpha}/products?hidden`)).j.products.find(u => u.path === 'site/index.html').hidden, true);
  await request(`/api/project/${alpha}/hide-products`, { body: { path: 'site/index.html', hidden: false } });
  // Many at once: "Show all" in one request.
  await request(`/api/project/${alpha}/hide-products`, { body: { paths: ['site/index.html', 'index.html'], hidden: true } });
  assert.deepEqual((await request(`/api/project/${alpha}/products?hidden`)).j.products.filter(u => u.hidden).map(u => u.path).sort(), ['index.html', 'site/index.html']);
  await request(`/api/project/${alpha}/hide-products`, { body: { paths: ['site/index.html', 'index.html'], hidden: false } });
  assert.equal((await request(`/api/project/${alpha}/products`)).j.products.length, 3);
  for (const body of [{ paths: 'x' }, { paths: [] }, { paths: [1] }, {}]) assert.equal((await request(`/api/project/${alpha}/hide-products`, { body })).status, 400);
});

test('file browser: folder listing and file reading only inside the project, hidden entries closed', async () => {
  const beta = (await request('/api/projects')).j.projects.find(p => p.name === 'Beta').id;
  const betaDir = path.join(projectsDir, 'Beta');
  writeFile(path.join(betaDir, 'src', 'a.js'), 'const a = 1;\n');
  writeFile(path.join(betaDir, 'image.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  writeFile(path.join(betaDir, 'output.txt'), Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('Ünïcode output', 'utf16le')]));
  writeFile(path.join(betaDir, 'data.bin'), Buffer.from([1, 0, 2, 0]));
  writeFile(path.join(betaDir, '.env'), 'SECRET=1');

  const root = await request(`/api/project/${alpha}/files`);
  assert.equal(root.status, 200);
  assert.match(root.headers.get('content-type'), /^application\/json/);
  const names = root.j.entries.map(g => g.name);
  assert.ok(!names.includes('.hidden'), 'a hidden folder is not listed');
  assert.ok(names.includes('node_modules') && names.includes('index.html'));
  const firstFile = root.j.entries.findIndex(g => !g.dir);
  assert.ok(root.j.entries.slice(firstFile).every(g => !g.dir), 'folders first');
  assert.deepEqual((await request(`/api/project/${alpha}/files?path=site`)).j.entries.map(g => g.path), ['site/asset.js', 'site/index.html']);

  const js = await request(`/api/project/${alpha}/file?path=site/asset.js`);
  assert.deepEqual([js.status, js.j.kind, js.j.text], [200, 'text', 'console.log("asset")']);
  assert.match(js.headers.get('content-type'), /^application\/json/, 'the content always comes inside JSON, never as a document');
  assert.equal((await request(`/api/project/${beta}/file?path=output.txt`)).j.text, 'Ünïcode output', 'UTF-16 (BOM) is decoded');
  const png = (await request(`/api/project/${beta}/file?path=image.png`)).j;
  assert.deepEqual([png.kind, png.mime, png.data], ['image', 'image/png', Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString('base64')]);
  const bin = (await request(`/api/project/${beta}/file?path=data.bin`)).j;
  assert.equal(bin.kind, 'binary');
  assert.equal(bin.text, undefined, 'the content of a binary file is not sent');
  assert.equal((await request(`/api/project/${alpha}/file?path=${encodeURIComponent('dist/app-1.10.0.apk')}`)).j.kind, 'binary');
  assert.ok(!(await request(`/api/project/${beta}/files`)).j.entries.some(g => g.name === '.env'));

  const outside = path.join(temp, 'outside.txt');
  for (const p of ['.hidden/secret.txt', '.hidden', '../outside.txt', '..\\outside.txt', 'site/../../outside.txt', '../../projects/Beta/src/a.js', outside, `/${outside}`, 'missing.txt']) {
    assert.equal((await request(`/api/project/${alpha}/file?path=${encodeURIComponent(p)}`)).status, 404, `file: ${p}`);
    assert.equal((await request(`/api/project/${alpha}/files?path=${encodeURIComponent(p)}`)).status, 404, `folder: ${p}`);
  }
  assert.equal((await request(`/api/project/${beta}/file?path=.env`)).status, 404, '.env is not read');
  // A link leading outside the project (a junction on Windows; needs no admin rights) is not listed and not read through.
  fs.symlinkSync(temp, path.join(betaDir, 'out'), 'junction');
  assert.ok(!(await request(`/api/project/${beta}/files`)).j.entries.some(g => g.name === 'out'), 'a link outside is not listed');
  assert.equal((await request(`/api/project/${beta}/file?path=out/outside.txt`)).status, 404);
  assert.equal((await request(`/api/project/${beta}/files?path=out`)).status, 404);
  assert.equal((await request(`/api/project/${alpha}/files?path=index.html`)).status, 404, 'a file is not listed like a folder');
  assert.equal((await request(`/api/project/${alpha}/file?path=site`)).status, 404, 'a folder is not read like a file');
  assert.equal((await request(`/api/project/${alpha}/file?path=index.html`, { withCookie: false })).status, 401, 'not read without login');
  assert.equal((await request(`/api/project/${alpha}/file?path=index.html`, { headers: { Origin: P } })).status, 403, 'not read from the product origin');
  assert.equal((await request(`/api/project/${alpha}/files`, { headers: { 'Sec-Fetch-Site': 'cross-site' } })).status, 403, 'not listed from another site');
});

let productCookie = '';
test('product server: login with a ticket, serving files, no escaping the project', async () => {
  const product = (url, headers = {}) => request(url, { base: P, withCookie: false, headers: { ...(productCookie ? { Cookie: productCookie } : {}), ...headers } });
  assert.equal((await product(`/p/${alpha}/index.html`)).status, 401, 'a product does not open without the cookie');
  assert.equal((await request(`/open?p=${alpha}&path=index.html`, { withCookie: false })).status, 302);
  assert.equal((await request(`/open?p=${alpha}&path=index.html`, { withCookie: false })).headers.get('location'), '/', '/open without login goes back to the home page');

  const open = await request(`/open?p=${alpha}&path=${encodeURIComponent('dist/app-1.10.0.apk')}&download=1`);
  const target = open.headers.get('location');
  assert.ok(target.startsWith(`${P}/_open?t=`), target);
  const hop = await fetch(target, { redirect: 'manual' });
  assert.equal(hop.status, 302);
  productCookie = hop.headers.get('set-cookie').split(';')[0];
  assert.ok(productCookie.startsWith('kumanda_u='));
  assert.equal((await fetch(target, { redirect: 'manual' })).status, 403, 'the ticket is single use');

  const apk = await product(hop.headers.get('location'));
  assert.equal(apk.status, 200);
  assert.equal(apk.text, 'new-apk-content');
  assert.equal(apk.headers.get('content-type'), 'application/vnd.android.package-archive');
  assert.match(apk.headers.get('content-disposition'), /attachment/);

  const page = await product(`/p/${alpha}/index.html`);
  assert.equal(page.status, 200);
  assert.match(page.text, /alpha/);
  assert.equal((await product(`/p/${alpha}/site/`)).status, 200, 'a folder request gives index.html');
  assert.equal((await product(`/p/${alpha}/index.html`, { Range: 'bytes=0-4' })).status, 206);
  assert.equal((await product('/asset.js', { Referer: `${P}/p/${alpha}/site/index.html` })).text, 'console.log("asset")', 'a root-absolute path is resolved from the Referer folder');
  assert.equal((await product(`/p/${alpha}/.hidden/secret.txt`)).status, 404);
  assert.equal((await product(`/p/${alpha}/missing.html`)).status, 404);

  // fetch normalises paths with "../" itself; try with a raw request.
  const raw = url => new Promise(resolve => http.get(`${P}${url}`, { headers: { Cookie: productCookie } }, r => { r.resume(); resolve(r.statusCode); }));
  assert.equal(await raw(`/p/${alpha}/%2e%2e/%2e%2e/outside.txt`), 404);
  assert.equal(await raw(`/p/${alpha}/..%5c..%5coutside.txt`), 404);
  assert.equal(await raw(`/p/${alpha}/site/../../../outside.txt`), 404);
});

test('chat: the prompt goes, the reply streams, the turn ends', async () => {
  assert.equal((await send('x', { effort: 'lots' })).status, 400, 'invalid effort');
  const r = await send('hello world', { mode: 'default', effort: 'low' });
  assert.equal(r.status, 200);
  ({ session, generation } = r.j);
  assert.match(session, /^[0-9a-f-]{36}$/);
  const events = await stream('', isResult);
  assert.equal(events[0].type, 'status');
  assert.equal(events.find(o => o.type === 'user').text, 'hello world');
  assert.equal(events.find(o => o.type === 'text').text, 'Reply: **hello world** (mode: default, effort: low)', 'the effort is given with --effort when the process starts');
  assert.equal(events[0].effort, 'low');
  assert.equal(events.at(-1).error, null);
  const list = await request(`/api/project/${alpha}`);
  assert.equal(list.j.sessions[0].id, session);
  assert.equal(list.j.sessions[0].live, 'ready');
  assert.equal(list.j.sessions[0].title, 'hello world');
});

test('permission request: allow / always allow / deny', async () => {
  for (const [decision, expected] of [['allow', 'The command ran.'], ['always', 'The command ran (rule saved).'], ['deny', 'The command was denied.']]) {
    await send(`try permission ${decision}`);
    const events = await stream(`${generation}:0`, (o, all) => isResult(o) && all.some(x => x.type === 'user' && x.text === `try permission ${decision}`), {
      onEvent: async (o, all) => {
        if (o.type !== 'permission' || all.some(x => x.type === 'permission-reply' && x.request === o.request)) return;
        assert.equal(o.name, 'Bash');
        assert.equal(o.input.command, 'echo hello');
        assert.equal(o.canAlways, true);
        const y = await request(`/api/session/${session}/permission`, { body: { request: o.request, decision } });
        assert.ok([200, 409].includes(y.status));
      },
    });
    const lastText = events.filter(o => o.type === 'text').at(-1).text;
    assert.equal(lastText, expected);
    assert.equal(events.filter(o => o.type === 'permission-reply').at(-1).decision, decision);
  }
});

test('Claude\'s question is answered', async () => {
  await send('ask me a question');
  const events = await stream(`${generation}:0`, (o, all) => isResult(o) && all.some(x => x.type === 'text' && x.text.startsWith('Your choice')), {
    onEvent: async (o, all) => {
      if (o.type === 'permission' && o.name === 'AskUserQuestion' && !all.some(x => x.type === 'permission-reply' && x.request === o.request)) {
        await request(`/api/session/${session}/permission`, { body: { request: o.request, decision: 'allow', answers: { 'Tea or coffee?': 'Tea' } } });
      }
    },
  });
  assert.equal(events.filter(o => o.type === 'text').at(-1).text, 'Your choice: Tea');
});

test('interrupting and reconnecting where it left off', async () => {
  await send('write a long reply');
  let interrupted = false, lastSeq = 0;
  const events = await stream(`${generation}:0`, (o, all) => isResult(o) && all.some(x => x.type === 'delta'), {
    onEvent: async (o, all) => {
      if (o.seq) lastSeq = o.seq;
      if (o.type === 'delta' && !interrupted && all.filter(x => x.type === 'delta').length >= 3) { interrupted = true; await request(`/api/session/${session}/interrupt`, { body: {} }); }
    },
  });
  assert.equal(events.at(-1).interrupted, true);
  assert.equal(events.at(-1).error, null);
  assert.ok(events.some(o => o.type === 'note' && o.text === 'Stopped'));

  await send('short');
  const rest = await stream(`${generation}:${lastSeq}`, isResult);
  assert.ok(rest.filter(o => o.seq).every(o => o.seq > lastSeq), 'only the missed events come');
  assert.equal(rest.find(o => o.type === 'user').text, 'short');
  const foreign = await stream('other-generation:5', o => o.type === 'user');
  assert.equal(foreign[1].type, 'reload', 'a client from another generation is told to reload the history');
});

test('a mode change reaches the running process', async () => {
  const r = await request(`/api/session/${session}/mode`, { body: { mode: 'plan' } });
  assert.equal(r.j.mode, 'plan');
  assert.equal((await request(`/api/session/${session}/mode`, { body: { mode: 'missing' } })).status, 400);
  await send('mode test');
  const events = await stream(`${generation}:0`, (o, all) => isResult(o) && all.some(x => x.type === 'text' && x.text.includes('mode test')));
  assert.match(events.filter(o => o.type === 'text').at(-1).text, /mode: plan/);
});

test('effort changes in a running session and goes back to the default', async () => {
  const r = await request(`/api/session/${session}/mode`, { body: { effort: 'max' } });
  assert.equal(r.j.effort, 'max');
  assert.equal((await request(`/api/session/${session}/mode`, { body: { effort: 'lots' } })).status, 400);
  const last = async text => {
    await send(text);
    const events = await stream(`${generation}:0`, (o, all) => isResult(o) && all.some(x => x.type === 'text' && x.text.includes(text)));
    return events.filter(o => o.type === 'text').at(-1).text;
  };
  assert.match(await last('effort one'), /effort: max/);
  await send('effort two', { effort: 'xhigh' }); // an effort sent with the prompt is applied too
  assert.match((await stream(`${generation}:0`, (o, all) => isResult(o) && all.some(x => x.type === 'text' && x.text.includes('effort two')))).filter(o => o.type === 'text').at(-1).text, /effort: xhigh/);
  // The current effort is read from the last API request in the transcript and comes with the status.
  let lastRequest = null;
  for (let i = 0; i < 20 && lastRequest?.effort !== 'xhigh'; i++) {
    lastRequest = (await request(`/api/project/${alpha}/session/${session}`)).j.live.lastRequest;
    if (lastRequest?.effort !== 'xhigh') await new Promise(c => setTimeout(c, 50));
  }
  assert.equal(lastRequest?.effort, 'xhigh', 'the effort of the last request is in the status');
  assert.equal(lastRequest.model, 'claude-fake');
  assert.equal((await request(`/api/session/${session}/mode`, { body: { effort: '' } })).j.effort, '');
  assert.match(await last('effort three'), /effort: setting/, 'an empty choice goes back to the user\'s Claude Code setting');
});

test('effort settings: user → project → local settings layers', async () => {
  writeFile(path.join(claudeDir, 'settings.json'), JSON.stringify({ effortLevel: 'medium', model: 'opus', modelSettings: { 'claude-opus-5-5': { effortLevel: 'high' }, x: { effortLevel: 'nonsense' } } }));
  writeFile(path.join(projectsDir, 'Alpha', '.claude', 'settings.local.json'), JSON.stringify({ effortLevel: 'low' }));
  const r = await request(`/api/project/${alpha}/effort`);
  assert.deepEqual(r.j, { default: 'low', model: 'opus', models: { 'claude-opus-5-5': 'high' } });
  fs.rmSync(path.join(projectsDir, 'Alpha', '.claude'), { recursive: true, force: true });
});

test('Ctrl+Enter: a prompt sent "now" while working interrupts the running turn and goes right away', async () => {
  await send('long reply two');
  let sent = false, from = -1;
  const events = await stream('', (o, all) => {
    const i = all.findIndex(x => x.type === 'text' && x.text.includes('do this now'));
    return i >= 0 && isResult(o) && all.indexOf(o) > i;
  }, {
    onEvent: async (o, all) => {
      if (o.type === 'user' && o.text === 'long reply two') from = all.length;
      if (!sent && from >= 0 && all.slice(from).filter(x => x.type === 'delta').length >= 3) { sent = true; assert.equal((await send('do this now', { now: true })).status, 200); }
    },
  });
  const later = events.slice(from);
  assert.ok(later.some(o => isResult(o) && o.interrupted), 'the running turn was interrupted');
  assert.ok(!later.some(o => o.type === 'text' && o.text.startsWith('word word')), 'the long reply did not finish');
  assert.ok(later.some(o => o.type === 'user' && o.text === 'do this now'));
});

test('when the process closes the history is read from the transcript; a new prompt continues the session', async () => {
  const whileLive = await request(`/api/project/${alpha}/session/${session}`);
  assert.equal(whileLive.j.items.length, 0, 'with a live run, history is the part before the run');
  assert.equal(whileLive.j.live.state, 'ready');
  await request(`/api/session/${session}/close`, { body: {} });
  await stream('', o => o.type === 'status' && o.state === 'closed');
  // A closed run stays in memory for 10 minutes; a page opened then must see what the run wrote from the transcript (no stream opens).
  const whileClosed = await request(`/api/project/${alpha}/session/${session}`);
  assert.ok(whileClosed.j.items.some(o => o.type === 'user' && o.text === 'hello world'), 'what the closed run wrote is in the history');
  const oldGeneration = generation;
  const r = await send('we continue');
  assert.equal(r.j.session, session);
  generation = r.j.generation;
  assert.notEqual(generation, oldGeneration);
  await stream('', isResult);
  const history = await request(`/api/project/${alpha}/session/${session}`);
  const texts = history.j.items.filter(o => o.type === 'user').map(o => o.text);
  assert.deepEqual(texts.slice(0, 2), ['hello world', 'try permission allow']);
  assert.ok(!texts.includes('we continue'), 'the new run\'s events do not repeat in the history');
  assert.ok(history.j.items.some(o => o.type === 'tool' && o.name === 'Bash'));
  assert.ok(history.j.items.some(o => o.type === 'tool-result' && o.text === 'hello'));
  // The transcript has no "turn finished" line: a "result" item with duration and finish time is added after each turn.
  const results = history.j.items.filter(o => o.type === 'result');
  assert.ok(results.length >= 2 && results.every(o => o.at > 0 && o.durationMs >= 0), 'turn ends in the history');
  // The usage percentage is kept as the last known value (so it shows when no process is open too).
  assert.equal(history.j.limit?.fiveHour, 0.25);
  assert.ok(fs.existsSync(path.join(data, 'limit.json')));
  assert.equal((await send('', {})).status, 400);
  assert.equal((await request(`/api/project/${alpha}/send`, { body: { session: '00000000-0000-4000-8000-000000000000', text: 'x' } })).status, 404);
});

test('/btw side question: a tool-less, unsaved copy of the chat answers; terminal ones come from history.jsonl', async () => {
  const transcriptName = fs.readdirSync(path.join(claudeDir, 'projects'), { recursive: true }).find(f => f.endsWith(`${session}.jsonl`));
  const transcript = path.join(claudeDir, 'projects', transcriptName);
  // Claude Code writes only the question of a terminal /btw to the prompt history (the answer goes nowhere).
  writeFile(path.join(claudeDir, 'history.jsonl'), [
    { display: '/btw question from the terminal', timestamp: 1000, project: 'x', sessionId: session },
    { display: '/btw', timestamp: 1001, project: 'x', sessionId: session },
    { display: '/btw another chat\'s question', timestamp: 1002, project: 'x', sessionId: '99999999-0000-4000-8000-000000000000' },
    { display: 'an ordinary prompt', timestamp: 1003, project: 'x', sessionId: session },
  ].map(o => JSON.stringify(o)).join('\n') + '\n');
  const first = await request(`/api/project/${alpha}/session/${session}`);
  const terminal = first.j.items.filter(o => o.type === 'btw');
  assert.deepEqual(terminal.map(o => [o.question, o.source]), [['question from the terminal', 'terminal']], 'an empty /btw and other chats\' ones do not come');
  assert.equal(first.j.items[0].type, 'btw', 'placed by its time');
  assert.equal(terminal[0].answer, undefined);

  const size = fs.statSync(transcript).size;
  const id = crypto.randomUUID();
  const watch = stream('', o => o.type === 'btw' && o.id === id && typeof o.answer === 'string');
  const r = await request(`/api/project/${alpha}/session/${session}/btw`, { body: { id, question: 'what colour?', model: 'haiku' } });
  assert.equal(r.status, 200);
  assert.equal(r.j.answer, 'Side reply: **what colour?**', 'ran forked + not saved, with the chat\'s tools and the tool-blocking hook');
  const hook = spawnSync(process.execPath, [path.join(ROOT, 'src', 'btw-no-tools.mjs')], { encoding: 'utf8' });
  assert.equal(hook.status, 2, 'the /btw PreToolUse hook denies every tool call (exit code 2)');
  const events = await watch;
  assert.ok(events.some(o => o.type === 'btw' && o.id === id && o.pending), 'in an open chat a "pending" card streams first');
  assert.ok(!events.some(o => o.type === 'user' && o.text?.includes('what colour?')), 'no prompt goes to the chat itself');
  assert.equal(fs.statSync(transcript).size, size, 'the chat transcript does not change');
  assert.ok(fs.existsSync(path.join(data, 'btw', `${session}.jsonl`)), 'the question and answer are kept in the data folder');

  const whileLive = await request(`/api/project/${alpha}/session/${session}`);
  assert.ok(!whileLive.j.items.some(o => o.id === id), 'one asked during an open run comes in the stream, not in the history');
  assert.equal((await request(`/api/project/${alpha}/session/${session}/btw`, { body: { id, question: 'again' } })).status, 409);
  assert.equal((await request(`/api/project/${alpha}/session/${session}/btw`, { body: { id: 'x', question: 'a' } })).status, 400);
  assert.equal((await request(`/api/project/${alpha}/session/${session}/btw`, { body: { id: crypto.randomUUID(), question: '  ' } })).status, 400);
  assert.equal((await request(`/api/project/${alpha}/session/${session}/btw`, { body: { id: crypto.randomUUID(), question: 'a', model: 'gpt' } })).status, 400);
  assert.equal((await request(`/api/project/${alpha}/session/00000000-0000-4000-8000-000000000000/btw`, { body: { id: crypto.randomUUID(), question: 'a' } })).status, 404);
  assert.equal((await request(`/api/project/${alpha}/session/${session}/btw`, { body: { id: crypto.randomUUID(), question: 'a' }, withCookie: false })).status, 401);
  const failed = await request(`/api/project/${alpha}/session/${session}/btw`, { body: { id: crypto.randomUUID(), question: 'explode' } });
  assert.equal(failed.j.error, 'The side question exploded', 'a Claude error shows on the card');

  await request(`/api/session/${session}/close`, { body: {} });
  await stream('', o => o.type === 'status' && o.state === 'closed');
  const later = await request(`/api/project/${alpha}/session/${session}`);
  const btws = later.j.items.filter(o => o.type === 'btw');
  assert.deepEqual(btws.map(o => o.question), ['question from the terminal', 'what colour?', 'explode'], 'after the process closes all are in the history, in order');
  assert.equal(btws[1].answer, 'Side reply: **what colour?**');
});

test('products are linked to the chat that changed them (subagents too, as the transcript grows)', async () => {
  const alphaDir = path.join(projectsDir, 'Alpha');
  writeFile(path.join(alphaDir, 'dist', 'setup.zip'), 'zip'); // S1's product, since the old version is no longer listed
  const logs = path.join(claudeDir, 'projects', alphaDir.replace(/[^a-zA-Z0-9]/g, '-'));
  const line = (o, at) => JSON.stringify({ ...o, cwd: alphaDir, timestamp: at }) + '\n';
  const S1 = '11111111-1111-4111-8111-111111111111', S2 = '22222222-2222-4222-8222-222222222222';
  fs.writeFileSync(path.join(logs, `${S1}.jsonl`), JSON.stringify({ type: 'ai-title', aiTitle: 'Old build' }) + '\n'
    + line({ type: 'user', message: { role: 'user', content: 'build the apk' } }, '2026-01-01T10:00:00.000Z')
    + line({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'ok' }] } }, '2026-01-01T10:05:00.000Z'));
  fs.writeFileSync(path.join(logs, `${S2}.jsonl`), line({ type: 'user', message: { role: 'user', content: 'set up the site' } }, '2026-01-20T09:00:00.000Z'));
  writeFile(path.join(logs, S2, 'subagents', 'agent-x.jsonl'), line({ type: 'assistant', isSidechain: true, message: { role: 'assistant', content: [] } }, '2026-02-01T10:00:00.000Z'));
  const touch = (relative, at) => fs.utimesSync(path.join(alphaDir, relative), new Date(at), new Date(at));
  touch('dist/setup.zip', '2026-01-01T10:04:00Z');      // 1 min from S1's activity
  touch('site/index.html', '2026-02-01T10:12:00Z');     // 12 min from S2's subagent
  touch('index.html', '2025-01-01T00:00:00Z');          // near no chat
  touch('dist/app-1.10.0.apk', '2026-03-01T00:00:00Z'); // near none for now

  const read = async extra => (await request(`/api/project/${alpha}/products?fresh${extra || ''}`)).j;
  let v = await read();
  const sessionOf = p => v.products.find(u => u.path === p).session;
  assert.equal(sessionOf('dist/setup.zip'), S1);
  assert.equal(sessionOf('site/index.html'), S2, 'subagent activity counts for the main session');
  assert.equal(sessionOf('index.html'), null);
  assert.equal(sessionOf('dist/app-1.10.0.apk'), null);
  assert.equal(v.sessions[S1].title, 'Old build');
  assert.equal(v.sessions[S2].title, 'set up the site', 'without a title, the first prompt');

  fs.appendFileSync(path.join(logs, `${S1}.jsonl`), line({ type: 'user', message: { role: 'user', content: 'new version' } }, '2026-03-01T00:15:00.000Z'));
  v = await read();
  assert.equal(sessionOf('dist/app-1.10.0.apk'), S1, 'activity added to the transcript is seen');
  assert.equal(sessionOf('dist/setup.zip'), S1, 'the earlier match is kept');

  const one = await read(`&session=${S1}`);
  assert.deepEqual(one.products.map(u => u.path).sort(), ['dist/app-1.10.0.apk', 'dist/setup.zip']);
  const all = (await request('/api/products')).j.groups.find(g => g.project.id === alpha);
  assert.equal(all.products.find(u => u.path === 'site/index.html').session, S2);
  assert.equal(all.sessions[S2].title, 'set up the site');

  // A hidden product drops out of the all-products list and comes back marked "hidden" with ?hidden.
  await request(`/api/project/${alpha}/hide-products`, { body: { path: 'site/index.html', hidden: true } });
  const find = async extra => (await request(`/api/products${extra}`)).j.groups.find(g => g.project.id === alpha).products.find(u => u.path === 'site/index.html');
  assert.equal(await find(''), undefined);
  assert.equal((await find('?hidden')).hidden, true);
  await request(`/api/project/${alpha}/hide-products`, { body: { path: 'site/index.html', hidden: false } });
  assert.ok(await find(''), 'back in the list when shown again');
});

test('VS Code: opens the project and the chat there; an idle Kumanda process hands the chat over, a working one does not', async () => {
  const calls = path.join(data, 'vscode-calls.jsonl');
  const read = async n => {
    const lines = () => (fs.existsSync(calls) ? fs.readFileSync(calls, 'utf8').trim().split(/\r?\n/) : []);
    for (let i = 0; i < 40 && lines().length < n; i++) await new Promise(c => setTimeout(c, 150));
    return lines().map(l => JSON.parse(l));
  };
  assert.equal((await request(`/api/project/${alpha}/vscode`, { body: {} })).status, 200, 'only the project');
  assert.deepEqual((await read(1))[0], [path.join(projectsDir, 'Alpha')]);
  await send('long reply three');
  await stream(`${generation}:0`, o => o.type === 'delta');
  assert.equal((await request(`/api/project/${alpha}/vscode`, { body: { session } })).status, 409, 'not while Claude works in Kumanda');
  await request(`/api/session/${session}/interrupt`, { body: {} });
  await stream('', o => o.type === 'status' && o.state === 'ready');
  const r = await request(`/api/project/${alpha}/vscode`, { body: { session } });
  assert.deepEqual([r.status, r.j.closedRun], [200, true], 'the idle process is closed so two processes do not write one transcript');
  const all = await read(3);
  assert.deepEqual(all.slice(1), [[path.join(projectsDir, 'Alpha')], ['--open-url', `vscode://anthropic.claude-code/open?session=${session}`]]);
  for (const body of [{ session: 'x' }, { session: 5 }]) assert.equal((await request(`/api/project/${alpha}/vscode`, { body })).status, 400);
  assert.equal((await request(`/api/project/${alpha}/vscode`, { body: { session: '00000000-0000-4000-8000-000000000000' } })).status, 404);
  assert.equal((await request(`/api/project/${alpha}/vscode`, { body: {}, withCookie: false })).status, 401);
  assert.equal((await request(`/api/project/${alpha}/vscode`, { body: {}, headers: { Origin: P } })).status, 403, 'not from the product origin');
});

test('VS Code: one file of the project opens in the project window; files outside the project do not', async () => {
  const calls = path.join(data, 'vscode-calls.jsonl');
  const before = fs.readFileSync(calls, 'utf8').trim().split(/\r?\n/).length;
  assert.equal((await request(`/api/project/${alpha}/vscode`, { body: { file: 'index.html' } })).status, 200);
  for (let i = 0; i < 40 && fs.readFileSync(calls, 'utf8').trim().split(/\r?\n/).length <= before; i++) await new Promise(c => setTimeout(c, 150));
  const last = JSON.parse(fs.readFileSync(calls, 'utf8').trim().split(/\r?\n/).at(-1));
  assert.deepEqual(last, [path.join(projectsDir, 'Alpha'), fs.realpathSync(path.join(projectsDir, 'Alpha', 'index.html'))]);
  for (const file of ['../outside.txt', '.hidden/secret.txt', 'missing.txt', 5]) {
    assert.equal((await request(`/api/project/${alpha}/vscode`, { body: { file } })).status, 404, String(file));
  }
});

test('context size: the tokens after the last reply come with the history and the live status', async () => {
  const history = await request(`/api/project/${alpha}/session/${session}`);
  assert.equal(history.j.lastRequest.context, 1260, 'from the usage of the last assistant message in the transcript');
  await send('hello context');
  const events = await stream('', isResult);
  assert.ok(events.some(o => o.type === 'status' && o.context === 1260), 'the live status carries it too');
  const runs = await request('/api/runs');
  const run = runs.j.runs.find(r => r.session === session);
  assert.ok(run.title && run.finishedAt > 0 && run.lastText.includes('hello context'), 'the runs list has the title, finish time and last reply');
});

test('chat list: pin, archive and rename (the rename is the same line Claude Code\'s /rename writes)', async () => {
  const meta = body => request(`/api/project/${alpha}/session/${session}/meta`, { body });
  assert.deepEqual((await meta({ pinned: true })).j, { ok: true, pinned: true });
  assert.equal((await meta({ title: 'Renamed chat', archived: true })).status, 200);
  let s = (await request(`/api/project/${alpha}`)).j.sessions.find(x => x.id === session);
  assert.deepEqual([s.title, s.pinned, s.archived], ['Renamed chat', true, true]);
  const file = fs.readdirSync(path.join(claudeDir, 'projects'), { recursive: true }).find(f => f.endsWith(`${session}.jsonl`));
  assert.ok(fs.readFileSync(path.join(claudeDir, 'projects', file), 'utf8').includes('"type":"custom-title","customTitle":"Renamed chat"'));
  await meta({ pinned: false, archived: false });
  s = (await request(`/api/project/${alpha}`)).j.sessions.find(x => x.id === session);
  assert.deepEqual([s.pinned, s.archived], [undefined, undefined]);
  for (const body of [{ title: '' }, { title: 'x'.repeat(121) }]) assert.equal((await meta(body)).status, 400);
  assert.equal((await request(`/api/project/${alpha}/session/00000000-0000-4000-8000-000000000000/meta`, { body: { pinned: true } })).status, 404);
});

test('search: titles in every project, messages inside one project', async () => {
  const everywhere = await request(`/api/search?q=${encodeURIComponent('renamed')}`);
  assert.ok(everywhere.j.results.some(r => r.session === session && r.byTitle && r.matches.length === 0), 'title search without content');
  const inside = await request(`/api/search?q=${encodeURIComponent('try permission')}&pid=${alpha}`);
  const hit = inside.j.results.find(r => r.session === session);
  assert.ok(hit && hit.matches.some(m => m.role === 'user' && m.text.includes('try permission')), 'a prompt matches');
  const reply = await request(`/api/search?q=${encodeURIComponent('The command ran')}&pid=${alpha}`);
  assert.ok(reply.j.results[0]?.matches.some(m => m.role === 'assistant'), 'a reply matches');
  assert.deepEqual((await request('/api/search?q=a')).j.results, [], 'too short');
  assert.equal((await request('/api/search?q=ab&pid=000000000000')).status, 404);
});

test('drafts are shared between devices; an older write does not overwrite a newer one', async () => {
  const key = `${alpha}.${session}`;
  assert.deepEqual((await request(`/api/drafts?key=${key}`)).j, { text: '', at: 0 });
  assert.equal((await request('/api/drafts', { body: { key, text: 'from the phone', at: 2000 } })).j.text, 'from the phone');
  assert.equal((await request('/api/drafts', { body: { key, text: 'stale', at: 1000 } })).j.text, 'from the phone', 'older write ignored');
  assert.deepEqual((await request(`/api/drafts?key=${key}`)).j, { text: 'from the phone', at: 2000 });
  await request('/api/drafts', { body: { key, text: '', at: 3000 } });
  assert.equal((await request(`/api/drafts?key=${key}`)).j.text, '', 'an empty draft is deleted');
  assert.equal((await request('/api/drafts?key=../x')).status, 400);
  assert.equal((await request('/api/drafts', { body: { key: 'bad', text: 'x', at: 1 } })).status, 400);
});

test('saved prompts: defaults, then the edited list for every device', async () => {
  const first = await request('/api/snippets');
  assert.ok(first.j.snippets.includes('Continue.'));
  assert.deepEqual((await request('/api/snippets', { body: { snippets: ['  One  ', '', 'Two'] } })).j.snippets, ['One', 'Two']);
  assert.deepEqual((await request('/api/snippets')).j.snippets, ['One', 'Two']);
  assert.equal((await request('/api/snippets', { body: { snippets: 'x' } })).status, 400);
});

test('scheduled prompts: sent into the chat at the time; cancel, send now, the limit reset time', async () => {
  const body = extra => ({ project: alpha, session, text: 'scheduled hello', mode: 'acceptEdits', ...extra });
  assert.equal((await request('/api/schedule', { body: body({ at: Date.now() + 20 * 86400e3 }) })).status, 400, 'not more than 14 days ahead');
  assert.equal((await request('/api/schedule', { body: body({ session: '00000000-0000-4000-8000-000000000000', at: Date.now() }) })).status, 404);
  assert.equal((await request('/api/schedule', { body: body({ text: ' ', at: Date.now() }) })).status, 400);
  const later = (await request('/api/schedule', { body: body({ at: Date.now() + 3600e3, text: 'much later' }) })).j;
  assert.equal(later.state, 'waiting');
  let list = await request(`/api/schedule?session=${session}`);
  assert.deepEqual(list.j.items.map(o => o.text), ['much later']);
  assert.equal((await request('/api/schedule/cancel', { body: { id: later.id } })).status, 200);
  assert.equal((await request('/api/schedule/cancel', { body: { id: later.id } })).status, 404);
  // due in a moment: the timer (KUMANDA_TICK_MS) sends it into the chat
  const soon = (await request('/api/schedule', { body: body({ at: Date.now() + 300 }) })).j;
  const events = await stream('', (o, all) => isResult(o) && all.some(x => x.type === 'user' && x.text === 'scheduled hello'), { timeout: 10000 });
  assert.ok(events.some(o => o.type === 'text' && o.text.includes('scheduled hello')));
  assert.ok(!(await request(`/api/schedule?session=${session}`)).j.items.some(o => o.id === soon.id), 'a sent one leaves the list');
  // "Send now"
  const manual = (await request('/api/schedule', { body: body({ at: Date.now() + 3600e3, text: 'sent by hand' }) })).j;
  assert.equal((await request('/api/schedule/run', { body: { id: manual.id } })).status, 200);
  await stream('', (o, all) => isResult(o) && all.some(x => x.type === 'user' && x.text === 'sent by hand'));
  // "When the limit resets": the fake reports the next window's reset time with status "allowed" (as the real CLI does);
  // no limit is in force, so that time must not be used: the prompt goes right away (bug seen 2026-11-23).
  list = await request(`/api/schedule?session=${session}`);
  assert.equal(list.j.limitResetsAt, null, 'no limit in force: no reset time');
  const over = await request('/api/schedule', { body: body({ afterLimit: true, text: 'limit over' }) });
  assert.deepEqual([over.status, over.j.now], [200, true]);
  await stream('', (o, all) => isResult(o) && all.some(x => x.type === 'user' && x.text === 'limit over'));
  // A reset time read from the limit message: in the future → a minute after it; already past → right away.
  const resetAt = Date.now() + 2 * 3600e3;
  const waiting = await request('/api/schedule', { body: body({ afterLimit: true, resetAt, text: 'after the reset' }) });
  assert.deepEqual([waiting.j.now, waiting.j.at], [false, resetAt + 60e3]);
  await request('/api/schedule/cancel', { body: { id: waiting.j.id } });
  const past = await request('/api/schedule', { body: body({ afterLimit: true, resetAt: Date.now() - 600e3, text: 'reset passed' }) });
  assert.equal(past.j.now, true, 'a reset time already passed: sent now, not "pick a time"');
  await stream('', (o, all) => isResult(o) && all.some(x => x.type === 'user' && x.text === 'reset passed'));
});

test('"/" commands: from Claude Code\'s init list plus the skill files; terminal-only ones left out', async () => {
  writeFile(path.join(projectsDir, 'Alpha', '.claude', 'skills', 'deploy', 'SKILL.md'), '---\nname: deploy\ndescription: Ships the site\n---\nBody');
  writeFile(path.join(projectsDir, 'Alpha', '.claude', 'commands', 'tools', 'lint.md'), '---\ndescription: Lints everything\n---\n');
  writeFile(path.join(projectsDir, 'Alpha', '.claude', 'skills', 'secret', 'SKILL.md'), '---\nname: secret\nuser-invocable: false\n---\n');
  const r = await request(`/api/project/${alpha}/commands`);
  const byName = Object.fromEntries(r.j.commands.map(c => [c.name, c]));
  assert.equal(r.j.fromClaude, true, 'the init list of the earlier runs was saved');
  assert.equal(byName['fake-skill'].kind, 'skill');
  assert.deepEqual([byName.deploy.kind, byName.deploy.description], ['skill', 'Ships the site'], 'a project skill with its description');
  assert.equal(byName['tools:lint'].description, 'Lints everything', 'a command in a subfolder is "folder:name"');
  assert.ok(byName.btw && byName.compact && byName.context);
  for (const gone of ['doctor', 'heapdump', 'secret']) assert.ok(!byName[gone], `${gone} is not offered`);
  fs.rmSync(path.join(projectsDir, 'Alpha', '.claude'), { recursive: true, force: true });
});

test('artifacts: a page Claude published to claude.ai is listed with its link, per project and per chat', async () => {
  await send('make an artifact');
  await stream('', (o, all) => isResult(o) && all.some(x => x.type === 'user' && x.text === 'make an artifact'));
  const all = await request(`/api/project/${alpha}/artifacts`);
  assert.deepEqual(all.j.artifacts.map(a => [a.title, a.file, a.url, a.session]),
    [['Weekly report', 'weekly-report.html', 'https://claude.ai/code/artifact/0a1b2c3d-1111-4222-8333-444455556666', session]]);
  assert.equal((await request(`/api/project/${alpha}/artifacts?session=${session}`)).j.artifacts.length, 1);
  assert.equal((await request(`/api/project/${alpha}/artifacts?session=00000000-0000-4000-8000-000000000000`)).j.artifacts.length, 0);
  assert.equal((await request(`/api/project/${alpha}/artifacts?session=bad`)).status, 400);
});

test('the project list is ordered by the last message, not by the file time (Claude Code rewrites old transcripts)', async () => {
  const before = (await request('/api/projects')).j.projects.map(p => p.name);
  // An old chat in Beta whose file was just rewritten: it must not jump above Alpha.
  const dir = path.join(claudeDir, 'projects', path.join(projectsDir, 'Beta').replace(/[^a-zA-Z0-9]/g, '-'));
  writeFile(path.join(dir, '99999999-9999-4999-8999-999999999999.jsonl'),
    JSON.stringify({ type: 'user', message: { role: 'user', content: 'old question' }, cwd: path.join(projectsDir, 'Beta'), timestamp: '2025-01-02T10:00:00.000Z' }) + '\n'
    + JSON.stringify({ type: 'cost-state' }) + '\n');
  await new Promise(c => setTimeout(c, 8200)); // the project list is cached for 8 s
  const list = (await request('/api/projects')).j.projects;
  const beta = list.find(p => p.name === 'Beta');
  assert.equal(new Date(beta.lastActivity).toISOString(), '2025-01-02T10:00:00.000Z');
  assert.ok(list.findIndex(p => p.name === 'Alpha') < list.findIndex(p => p.name === 'Beta'), `${before} → ${list.map(p => p.name)}`);
  const sessions = (await request(`/api/project/${beta.id}`)).j.sessions;
  assert.equal(new Date(sessions[0].mtime).toISOString(), '2025-01-02T10:00:00.000Z', 'the chat list uses the same time');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a chat going on outside Kumanda: a prompt sharing its message with a system note shows; new lines come after the offset', async () => {
  const beta = (await request('/api/projects')).j.projects.find(p => p.name === 'Beta');
  const dir = path.join(claudeDir, 'projects', path.join(projectsDir, 'Beta').replace(/[^a-zA-Z0-9]/g, '-'));
  const sid = '88888888-8888-4888-8888-888888888888', file = path.join(dir, `${sid}.jsonl`);
  const line = o => JSON.stringify({ cwd: path.join(projectsDir, 'Beta'), timestamp: '2025-01-03T10:00:00.000Z', ...o }) + '\n';
  // What Claude Code 2.1.330 wrote after a resume: image, a system note, then the typed prompt, all in one message.
  writeFile(file, line({ type: 'user', message: { role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AA==' } },
    { type: 'text', text: '<system-reminder>\nThis conversation is now continuing.\n</system-reminder>' }, { type: 'text', text: 'Show the weekly view too' }] } })
    + line({ type: 'user', message: { role: 'user', content: [{ type: 'text', text: '<system-reminder>only a note</system-reminder>' }] } }));
  const h = await request(`/api/project/${beta.id}/session/${sid}`);
  assert.deepEqual(h.j.items.filter(o => o.type === 'user').map(o => [o.text, o.images]), [['Show the weekly view too', 1]], 'the prompt shows, the note alone does not');
  assert.equal(h.j.offset, fs.statSync(file).size);
  // Another window goes on: a complete line and one still being written (no newline yet).
  fs.appendFileSync(file, line({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'Adding it' }] } }) + '{"type":"assistant","mess');
  const a = await request(`/api/project/${beta.id}/session/${sid}/since?offset=${h.j.offset}`);
  assert.deepEqual(a.j.items.map(o => o.text), ['Adding it']);
  assert.equal(a.j.offset, fs.statSync(file).size - '{"type":"assistant","mess'.length, 'a half-written line waits');
  fs.appendFileSync(file, 'age":{"role":"assistant","content":[{"type":"text","text":"Done"}]}}\n');
  const b = await request(`/api/project/${beta.id}/session/${sid}/since?offset=${a.j.offset}`);
  assert.deepEqual(b.j.items.map(o => o.text), ['Done']);
  assert.deepEqual((await request(`/api/project/${beta.id}/session/${sid}/since?offset=${b.j.offset}`)).j.items, []);
  assert.equal((await request(`/api/project/${beta.id}/session/${sid}/since?offset=${b.j.offset + 50}`)).j.reset, true, 'a shorter file: load it all again');
  assert.equal((await request(`/api/project/${beta.id}/session/${sid}/since?offset=-1`)).status, 400);
  assert.equal((await request(`/api/project/${beta.id}/session/00000000-0000-4000-8000-000000000000/since?offset=0`)).status, 404);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a chat working outside Kumanda shows as running (Claude Code\'s process status files); idle or ended ones do not', async () => {
  const beta = (await request('/api/projects')).j.projects.find(p => p.name === 'Beta');
  const dir = path.join(claudeDir, 'projects', path.join(projectsDir, 'Beta').replace(/[^a-zA-Z0-9]/g, '-'));
  const sid = '77777777-7777-4777-8777-777777777777';
  writeFile(path.join(dir, `${sid}.jsonl`), JSON.stringify({ type: 'user', message: { role: 'user', content: 'build it' }, cwd: path.join(projectsDir, 'Beta'), timestamp: new Date().toISOString() }) + '\n');
  const status = (pid, o) => writeFile(path.join(claudeDir, 'sessions', `${pid}.json`), JSON.stringify({ pid, cwd: path.join(projectsDir, 'Beta'), entrypoint: 'claude-desktop', ...o }));
  status(process.pid, { sessionId: sid, status: 'busy' }); // the test process: alive
  status(2147483000, { sessionId: '66666666-6666-4666-8666-666666666666', status: 'busy' }); // ended long ago
  status(process.ppid, { sessionId: '55555555-5555-4555-8555-555555555555', status: 'idle' });
  await new Promise(c => setTimeout(c, 2100)); // the status files are read at most every 2 s
  assert.deepEqual((await request('/api/projects')).j.projects.find(p => p.name === 'Beta').live, ['running']);
  const chats = (await request(`/api/project/${beta.id}`)).j.sessions;
  assert.deepEqual(chats.filter(s => s.live).map(s => [s.id, s.live, s.elsewhere]), [[sid, 'running', true]]);
  const h = await request(`/api/project/${beta.id}/session/${sid}`);
  assert.equal(h.j.elsewhere?.state, 'running');
  assert.equal(h.j.elsewhere?.app, 'claude-desktop');
  assert.equal((await request(`/api/project/${beta.id}/session/${sid}/since?offset=${h.j.offset}`)).j.elsewhere?.state, 'running');
  status(process.pid, { sessionId: sid, status: 'idle' });
  await new Promise(c => setTimeout(c, 2100));
  assert.deepEqual((await request('/api/projects')).j.projects.find(p => p.name === 'Beta').live, []);
  assert.equal((await request(`/api/project/${beta.id}/session/${sid}`)).j.elsewhere, null);
  fs.rmSync(path.join(claudeDir, 'sessions'), { recursive: true, force: true });
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a turn whose end never comes: Stop still stops it; "close all" frees every chat for other apps', async () => {
  const until = async (sid, ok, ms = 6000) => {
    const end = Date.now() + ms;
    for (;;) {
      const v = (await request(`/api/project/${alpha}/session/${sid}`)).j;
      if (ok(v)) return v;
      if (Date.now() > end) assert.fail(`timed out: ${JSON.stringify(v.live)}`);
      await new Promise(c => setTimeout(c, 200));
    }
  };
  const sid = (await request(`/api/project/${alpha}/send`, { body: { text: 'answer with no result' } })).j.session;
  await new Promise(c => setTimeout(c, 1500)); // the reply is written; no result line follows
  assert.equal((await request(`/api/project/${alpha}/session/${sid}`)).j.live.state, 'running');
  assert.equal((await request(`/api/session/${sid}/interrupt`, { body: {} })).status, 200);
  await until(sid, v => v.live?.state === 'ready'); // Claude Code is idle and sends nothing: Kumanda settles after 3 s
  // A result line ends every prompt sent so far (Claude Code can answer a prompt sent mid-turn in the same turn).
  const r = await request('/api/runs/close', { body: {} });
  assert.ok(r.j.closed >= 1);
  await until(sid, v => !v.live || v.live.state === 'closed');
  assert.ok(!(await request('/api/runs')).j.runs.some(x => x.session === sid));
});

test('git: status, file diff and commit diff of a project (read only)', async () => {
  const dir = path.join(projectsDir, 'Alpha');
  const g = (...a) => spawnSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', ...a], { cwd: dir, encoding: 'utf8' });
  const none = await request(`/api/project/${alpha}/git`);
  assert.equal(none.j.repo, false, 'not a repository yet');
  g('init', '-q', '-b', 'main'); g('add', 'index.html'); g('commit', '-q', '-m', 'First commit');
  fs.appendFileSync(path.join(dir, 'index.html'), '\n<p>changed line</p>');
  const st = await request(`/api/project/${alpha}/git`);
  assert.equal(st.j.repo, true);
  assert.equal(st.j.branch, 'main');
  assert.ok(st.j.files.some(f => f.path === 'index.html' && f.status === 'modified'));
  assert.ok(st.j.files.some(f => f.path === 'site/index.html' && f.status === 'new'));
  assert.equal(st.j.commits[0].subject, 'First commit');
  const diff = await request(`/api/project/${alpha}/git/diff?path=index.html`);
  assert.ok(diff.j.text.includes('+<p>changed line</p>'));
  const commit = await request(`/api/project/${alpha}/git/diff?commit=${st.j.commits[0].hash}`);
  assert.ok(commit.j.text.includes('First commit') && commit.j.text.includes('+<!doctype html>'));
  for (const q of ['path=../outside.txt', 'path=--output=x', 'commit=HEAD;rm', 'path=C:/x', '']) {
    assert.equal((await request(`/api/project/${alpha}/git/diff?${q}`)).status, 400, q);
  }
  fs.rmSync(path.join(dir, '.git'), { recursive: true, force: true }); // the later tests expect no repository
});

test('logout: the control and product cookies become invalid together', async () => {
  assert.equal((await request('/api/logout', { body: {} })).status, 200);
  assert.equal((await request('/api/projects')).status, 401);
  assert.equal((await request(`/p/${alpha}/index.html`, { base: P, withCookie: false, headers: { Cookie: productCookie } })).status, 401);
});

test('--reset-password logs out every device on a running server too and restarts the server', async () => {
  const login = await request('/api/login', { body: { password: PASSWORD }, withCookie: false });
  cookie = login.headers.get('set-cookie').split(';')[0];
  assert.equal((await request('/api/projects')).status, 200);
  const exited = new Promise(resolve => server.on('exit', resolve));
  const r = spawnSync(process.execPath, [path.join(ROOT, 'server.mjs'), '--reset-password'], { env: env(), encoding: 'utf8', timeout: 20000 });
  assert.match(r.stdout, /was restarted/);
  await exited; // the old process (with its sessions in memory) closed
  let d = null;
  for (let i = 0; i < 40 && !d; i++) { try { d = (await request('/api/status')).j; } catch { await new Promise(c => setTimeout(c, 250)); } }
  assert.equal(d?.setUp, false, 'no password in the new process');
  assert.equal((await request('/api/projects')).status, 401, 'the device from before the reset was logged out');
});

test('--stop shuts the running server down', async () => {
  // The detached process restarted in the previous test.
  const r = spawnSync(process.execPath, [path.join(ROOT, 'server.mjs'), '--stop'], { env: env(), encoding: 'utf8', timeout: 20000 });
  assert.match(r.stdout, /stopped/);
  await assert.rejects(fetch(`${C}/api/status`), 'the server closed');
  assert.match(spawnSync(process.execPath, [path.join(ROOT, 'server.mjs'), '--stop'], { env: env(), encoding: 'utf8' }).stdout, /not running/);
});
