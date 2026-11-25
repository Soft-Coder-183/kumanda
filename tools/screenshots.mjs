// Makes the README screenshots: starts a separate Kumanda instance in a temporary folder with demo data (fake projects,
// fake chats, fake Claude) and takes phone and desktop screenshots in a real Chrome. Does not touch real data.
//   npm i --no-save playwright-core   (or KUMANDA_PLAYWRIGHT=<a folder that has playwright-core>)
//   node tools/screenshots.mjs [output folder = docs]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

const ROOT = path.resolve(import.meta.dirname, '..');
const OUT = path.resolve(process.argv[2] || path.join(ROOT, 'docs'));
const pw = process.env.KUMANDA_PLAYWRIGHT
  ? createRequire(path.join(process.env.KUMANDA_PLAYWRIGHT, 'x.js'))('playwright-core')
  : await import('playwright-core').catch(() => { console.error('playwright-core not found: npm i --no-save playwright-core'); process.exit(1); });

const temp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'kumanda-demo-'));
const data = path.join(temp, 'data'), claude = path.join(temp, 'claude'), projects = path.join(temp, 'Projects');
const CP = 7797, PP = 7798;
const write = (file, content) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, content); };
const now = Date.now(), min = 60e3, day = 86400e3;

// ── demo projects and products ──
const product = (project, relative, content, at) => {
  const file = path.join(projects, project, relative);
  write(file, content);
  fs.utimesSync(file, new Date(at), new Date(at));
};
const html = title => `<!doctype html><meta charset="utf-8"><title>${title}</title><h1>${title}</h1>`;
product('Weather', 'index.html', html('Weather'), now - 12 * min);
product('Weather', 'dist/Weather-1.3.0.apk', Buffer.alloc(4.2e6), now - 14 * min);
product('Weather', 'dist/Weather-1.2.0.apk', Buffer.alloc(4.1e6), now - 2 * day);
product('Weather', 'dist/Weather-setup.exe', Buffer.alloc(31e6), now - 2 * day - 5 * min);
product('Weather', 'docs/demo.mp4', Buffer.alloc(2.3e6), now - 2 * day - 9 * min);
product('Notebook', 'dist/index.html', html('Notebook'), now - 3 * day);
product('Notebook', 'dist/Notebook-1.0.0-win-x64.zip', Buffer.alloc(18e6), now - 3 * day - 2 * min);
product('Personal Site', 'index.html', html('Personal Site'), now - 9 * day);
fs.mkdirSync(path.join(projects, 'Course Notes'), { recursive: true });
// source files for the explorer
const source = (relative, content) => write(path.join(projects, 'Weather', relative), content);
source('src/screens/home.js', `// Home screen: today's weather and the 7-day forecast.
import { getForecast } from '../data/forecast.js';

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Draws the card of one day. */
function dayCard(day) {
  const card = document.createElement('div');
  card.className = 'day';
  card.textContent = \`\${DAY_NAMES[new Date(day.date).getDay()]} \${day.high}° / \${day.low}°\`;
  return card;
}

export async function homeScreen(root) {
  const data = await getForecast({ city: 'Istanbul', days: 7 });
  showToday(data);
  showWeek(data.daily.slice(0, 7));
  if (data.alert) root.prepend(alertBanner(data.alert)); /* storm, snow etc. */
  return true;
}
`);
source('src/data/forecast.js', 'export async function getForecast({ city, days }) {\n  const r = await fetch(`/api/forecast?city=${encodeURIComponent(city)}&days=${days}`);\n  return r.json();\n}\n');
source('src/style.css', '.day { display: flex; gap: 8px; padding: 12px; border-radius: 12px; background: #eef4ff; }\n');
source('README.md', '# Weather\n\nA **7-day** weather forecast for Android and Windows.\n\n- `npm run build:android` → `dist/*.apk`\n');
source('package.json', '{\n  "name": "weather",\n  "version": "1.3.0",\n  "private": true\n}\n');
source('build.ps1', '# Builds the APK and the installer\n$version = (Get-Content package.json | ConvertFrom-Json).version\nnpm run build:android\nWrite-Host "Version $version ready"\n');

// ── demo chats (in the Claude Code transcript format) ──
const chatFiles = new Map(); // chat id → transcript file
function chat(project, title, steps) {
  const cwd = path.join(projects, project);
  const id = crypto.randomUUID();
  const lines = [{ type: 'ai-title', aiTitle: title }];
  for (const [at, type, content] of steps) lines.push({ type, message: { role: type, content }, cwd, sessionId: id, timestamp: new Date(at).toISOString() });
  const file = path.join(claude, 'projects', cwd.replace(/[^a-zA-Z0-9]/g, '-'), `${id}.jsonl`);
  write(file, lines.map(s => JSON.stringify(s)).join('\n') + '\n');
  chatFiles.set(id, file);
  const last = new Date(steps.at(-1)[0]);
  fs.utimesSync(file, last, last); // "last activity" is read from the file time
  return id;
}
const text = t => [{ type: 'text', text: t }];
const tool = (id, name, input) => [{ type: 'tool_use', id, name, input }];
const result = (id, t) => [{ type: 'tool_result', tool_use_id: id, content: t }];
const t0 = now - 20 * min;
const mainChat = chat('Weather', 'Weekly forecast screen', [
  [t0, 'user', 'Add a 7-day forecast to the home screen, then build the APK.'],
  [t0 + min, 'assistant', text('`getForecast()` already fetches the forecast data; I am wiring the screen to it.')],
  [t0 + 2 * min, 'assistant', tool('t1', 'Edit', { file_path: 'src/screens/home.js', old_string: 'showToday(data);', new_string: 'showToday(data);\nshowWeek(data.daily.slice(0, 7));' })],
  [t0 + 2 * min, 'user', result('t1', 'File updated')],
  [t0 + 5 * min, 'assistant', tool('t2', 'Bash', { command: 'npm test', description: 'Run the tests' })],
  [t0 + 6 * min, 'user', result('t2', '✓ 24 tests passed')],
  [t0 + 6 * min, 'assistant', tool('t3', 'Bash', { command: '.\\build.ps1', description: 'Build the APK' })],
  [t0 + 8 * min, 'user', result('t3', 'wrote dist/Weather-1.3.0.apk')],
  [t0 + 8 * min, 'assistant', text('## Done\n\nThe home screen now has a **7-day forecast**.\n\n| Day | Icon | High / low |\n|---|---|---|\n| Today | sunny | 18° / 9° |\n| Tomorrow | rainy | 14° / 8° |\n\n- The tests pass (24/24).\n- APK: `dist/Weather-1.3.0.apk`; you can install it on your phone from the **Products** tab in Kumanda.')],
]);
const iconChat = chat('Weather', 'Android icon and Windows installer', [
  [now - 2 * day - 20 * min, 'user', 'Make an icon for the app and build a Windows installer too.'],
  [now - 2 * day - 4 * min, 'assistant', text('The icon is added, `dist/Weather-setup.exe` is ready.')],
]);
chat('Notebook', 'Working offline', [
  [now - 3 * day - 10 * min, 'user', 'Make the notebook open without internet too.'],
  [now - 3 * day, 'assistant', text('A service worker is added; the site now opens offline.')],
]);

// ── the demo Kumanda ──
write(path.join(data, 'config.json'), JSON.stringify({ controlPort: CP, productPort: PP, roots: [projects] }));
const server = spawn(process.execPath, [path.join(ROOT, 'server.mjs')], {
  stdio: ['ignore', 'pipe', 'inherit'],
  env: { ...process.env, KUMANDA_DATA: data, KUMANDA_CLAUDE_DIR: claude, KUMANDA_DIRECT: '1', KUMANDA_CLAUDE: JSON.stringify([process.execPath, path.join(ROOT, 'test', 'fake-claude.mjs')]),
    KUMANDA_VSCODE: JSON.stringify([process.execPath, path.join(ROOT, 'test', 'fake-vscode.mjs')]) },
});
await new Promise((resolve, reject) => { server.stdout.on('data', d => String(d).includes('is running') && resolve()); server.on('exit', () => reject(new Error('the server did not start'))); });
const C = `http://127.0.0.1:${CP}`;
const wait = ms => new Promise(c => setTimeout(c, ms));

const browser = await pw.chromium.launch({ channel: 'chrome', headless: true });
fs.mkdirSync(OUT, { recursive: true });
const saved = [];
try {
  const phone = await browser.newContext({
    viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: 'light', locale: 'en-US',
    userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36',
  });
  const s = await phone.newPage();
  const errors = [];
  s.on('pageerror', e => errors.push(e.message));
  s.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  const shoot = async name => { const file = path.join(OUT, `${name}.png`); await s.screenshot({ path: file }); saved.push(file); };

  // First setup: the demo instance gets a random password (only in this temporary instance).
  await s.goto(C);
  const password = crypto.randomBytes(12).toString('hex');
  await s.fill('#password', password); await s.fill('#repeat', password);
  await s.click('button[type=submit]');
  await s.waitForSelector('.row');
  await wait(300);
  await shoot('phone-projects');

  // Choosing a project opens its latest chat; the back arrow goes to the project's chats tab.
  await s.click('text=Weather');
  await s.waitForSelector('table');
  if (!/\/s\/[0-9a-f-]{36}$/.test(s.url())) errors.push(`choosing a project did not open the latest chat: ${s.url()}`);
  await s.click('#main .back');
  await s.waitForSelector('a.tab.selected >> text=Chats');
  await s.waitForSelector('text=Weekly forecast screen');
  await s.click('a.tab >> text=Products');
  await s.waitForSelector('.session-group');
  await wait(300);
  await shoot('phone-products');

  const weather = (await (await s.request.get(`${C}/api/projects`)).json()).projects.find(p => p.name === 'Weather').id;
  await s.goto(`${C}/#/p/${weather}/s/${mainChat}`);
  await s.waitForSelector('table');
  await s.fill('textarea', 'Ask for a permission. command: npm run build:android');
  await s.click('button[type=submit]');
  await s.waitForSelector('.permission:not(.done)');
  await wait(400);
  await s.evaluate(() => { const k = document.querySelector('#main .scroll'); k.scrollTop = k.scrollHeight; });
  await shoot('phone-permission');
  await s.click('.permission >> text=Allow');
  await s.waitForSelector('text=The command ran.');
  const chatUrl = s.url();
  // The last request's effort in the status bar (the fake Claude writes an api-request to the transcript).
  await s.waitForSelector('.status-bar >> text=/effort /');
  // The "Products" tab next to the title opens only this chat's products; the composer stays visible.
  await s.click('.products-tab');
  await s.waitForSelector('.chat-products:not([hidden]) .product');
  if (!(await s.isVisible('textarea'))) errors.push('the composer is not visible while the products panel is open');
  if (process.env.KUMANDA_EXTRA_SHOTS) await s.screenshot({ path: path.join(process.env.KUMANDA_EXTRA_SHOTS, 'chat-products.png') });
  await s.click('.products-tab');
  // /btw side question: the card is "pending" first, then answered; no prompt goes to the chat itself.
  await s.fill('textarea', '/btw Which files did you change?');
  await s.click('button[type=submit]');
  await s.waitForSelector('.btw:not(.pending) .btw-answer >> text=Side reply');
  if (await s.$('.msg.user >> text=/btw')) errors.push('/btw went to the chat itself');
  if (process.env.KUMANDA_EXTRA_SHOTS) await s.screenshot({ path: path.join(process.env.KUMANDA_EXTRA_SHOTS, 'btw.png') });
  // An unsent prompt is still there after going to another page and back.
  await s.fill('textarea', 'a half-written prompt');
  await s.goto(`${C}/#/`);
  await s.waitForSelector('.row');
  await s.goto(chatUrl);
  await s.waitForSelector('table');
  if (await s.inputValue('textarea') !== 'a half-written prompt') errors.push('the draft did not come back');
  await s.fill('textarea', '');

  // All products: project → chat groups; a product is hidden and moves to the "Hidden by you" box.
  await s.goto(`${C}/#/products`);
  await s.waitForSelector('.project-group');
  await s.locator('.product', { hasText: 'Weather-setup.exe' }).getByText('Hide', { exact: true }).click();
  await s.waitForSelector('details.hidden-box');
  await s.click('details.hidden-box > summary');
  await wait(300);
  await shoot('phone-all-products');
  // Hide a second product too: when one comes back with "Show" the box must stay open; "Show hidden" takes the rest.
  await s.locator('.product', { hasText: 'demo.mp4' }).getByText('Hide', { exact: true }).click();
  await s.waitForSelector('details.hidden-box[open] >> text=demo.mp4');
  await s.locator('details.hidden-box .product', { hasText: 'Weather-setup.exe' }).getByText('Show', { exact: true }).click();
  await s.waitForSelector('details.hidden-box > summary >> text=Hidden by you (1)'); // (waitForFunction runs into the CSP)
  if (!(await s.$('details.hidden-box[open]'))) errors.push('the Hidden by you box closed after "Show"');
  await s.getByText('Show hidden (1)').click();
  await s.waitForSelector('details.hidden-box', { state: 'detached' });

  // The file explorer on the phone (a drawer) and closing it by swiping left; swiping right opens the project list.
  await s.goto(`${C}/#/p/${weather}/f/${encodeURIComponent('src/screens/home.js')}`);
  await s.waitForSelector('.code-view .s-keyword');
  await s.click('.explorer-button');
  await s.waitForSelector('#explorer .tree-row.selected');
  await wait(300);
  await shoot('phone-files');
  const swipe = async (x0, x1) => s.evaluate(([a, b]) => {
    const t = (x, type) => new TouchEvent(type, { bubbles: true, touches: type === 'touchend' ? [] : [new Touch({ identifier: 1, target: document.querySelector('#main'), clientX: x, clientY: 400 })],
      changedTouches: [new Touch({ identifier: 1, target: document.querySelector('#main'), clientX: x, clientY: 400 })] });
    const target = document.querySelector('#main .top');
    target.dispatchEvent(t(a, 'touchstart')); target.dispatchEvent(t(b, 'touchend'));
  }, [x0, x1]);
  await swipe(300, 80);
  if (await s.$('#app.explorer-drawer')) errors.push('swiping left did not close the explorer');
  await swipe(60, 300);
  if (!(await s.$('#app.side-drawer'))) errors.push('swiping right did not open the project list');
  await s.click('.backdrop', { position: { x: 380, y: 400 } });

  const desktop = await browser.newContext({ viewport: { width: 1280, height: 800 }, colorScheme: 'dark', locale: 'en-US', storageState: await phone.storageState() });
  const m = await desktop.newPage();
  m.on('pageerror', e => errors.push(e.message));
  await m.goto(chatUrl);
  await m.waitForSelector('table');
  await wait(500);
  const file1 = path.join(OUT, 'desktop-chat.png'); await m.screenshot({ path: file1 }); saved.push(file1);
  // After picking an effort the focus goes back to the prompt, so Enter sends it instead of reopening the menu
  // (on touch screens the focus is not moved, so the keyboard does not pop up).
  await m.selectOption('.effort-select', 'high');
  if (!(await m.evaluate(() => document.activeElement?.tagName === 'TEXTAREA'))) errors.push('after picking an effort the prompt did not get the focus back');
  await m.keyboard.type('effort check');
  await m.keyboard.press('Enter');
  await m.waitForSelector('.msg.claude >> text=effort: high');
  await m.selectOption('.effort-select', '');
  // The mouse wheel scrolls the chat (the chat area must stay a bounded scroll box), and the chat opens at the end.
  const before = await m.evaluate(() => document.querySelector('#main .scroll').scrollTop);
  if (before < 50) errors.push(`the chat did not open at the end (scrollTop ${before})`);
  await m.mouse.move(700, 300); await m.mouse.wheel(0, -600); await wait(300);
  const after = await m.evaluate(() => document.querySelector('#main .scroll').scrollTop);
  if (!(after < before)) errors.push(`the mouse wheel did not scroll the chat (${before} → ${after})`);
  await m.waitForSelector('.jump-bottom:not([hidden])');
  // Search everything (Ctrl+K), the chat menu, the Changes tab and the shortcut list open and close.
  await m.keyboard.press('Control+k');
  await m.waitForSelector('.palette input');
  await m.keyboard.type('note');
  await m.waitForSelector('.palette-item >> text=Notebook');
  if (process.env.KUMANDA_EXTRA_SHOTS) await m.screenshot({ path: path.join(process.env.KUMANDA_EXTRA_SHOTS, 'palette.png') });
  await m.keyboard.press('Escape');
  if (await m.$('.palette')) errors.push('Esc did not close the search');
  await m.click('.chat-menu');
  await m.waitForSelector('.menu >> text=Export as Markdown');
  if (process.env.KUMANDA_EXTRA_SHOTS) await m.screenshot({ path: path.join(process.env.KUMANDA_EXTRA_SHOTS, 'chat-menu.png') });
  await m.keyboard.press('Escape');
  await m.click('#main .composer button[title="Saved prompts"]');
  await m.waitForSelector('.menu >> text=Continue.');
  await m.keyboard.press('Escape');
  // "/" at the start of the prompt opens the list of skills and commands; Esc closes it without stopping anything.
  await m.click('#main .composer textarea');
  await m.keyboard.type('/co');
  await m.waitForSelector('.slash-menu:not([hidden]) .slash-item >> text=/compact');
  if (process.env.KUMANDA_EXTRA_SHOTS) await m.screenshot({ path: path.join(process.env.KUMANDA_EXTRA_SHOTS, 'slash.png') });
  await m.keyboard.press('Escape');
  if (await m.$('.slash-menu:not([hidden])')) errors.push('Esc did not close the "/" menu');
  await m.fill('#main .composer textarea', '');
  // A chat going on outside Kumanda (terminal, VS Code): lines added to its transcript show up without reopening it.
  await m.goto(`${C}/#/p/${weather}/s/${iconChat}`);
  await m.waitForSelector('.msg.claude >> text=The icon is added');
  const line = (type, content) => JSON.stringify({ type, message: { role: type, content }, timestamp: new Date().toISOString() }) + '\n';
  fs.appendFileSync(chatFiles.get(iconChat), line('user', [{ type: 'text', text: '<system-reminder>note</system-reminder>' }, { type: 'text', text: 'Typed in VS Code' }])
    + line('assistant', [{ type: 'text', text: 'Followed from elsewhere' }]));
  await m.waitForSelector('.msg.user >> text=Typed in VS Code', { timeout: 10000 });
  await m.waitForSelector('.msg.claude >> text=Followed from elsewhere', { timeout: 10000 });
  await m.goto(`${C}/#/p/${weather}/changes`);
  await m.waitForSelector('#main .empty, #main .git-badge');
  if (process.env.KUMANDA_EXTRA_SHOTS) await m.screenshot({ path: path.join(process.env.KUMANDA_EXTRA_SHOTS, 'changes.png') });
  await m.goto(chatUrl);
  await m.waitForSelector('table');
  await m.keyboard.press('Escape');
  await m.click('body', { position: { x: 700, y: 20 } });
  await m.keyboard.press('?');
  await m.waitForSelector('.shortcuts');
  await m.keyboard.press('Escape');

  // Desktop: the project list is narrowed from its edge, the explorer opens, the file shows highlighted.
  await m.goto(`${C}/#/p/${weather}/f/${encodeURIComponent('src/screens/home.js')}`);
  await m.waitForSelector('.code-view .s-keyword');
  if (!(await m.$('#app.explorer-open'))) await m.click('.explorer-button');
  await m.waitForSelector('#explorer .tree-row.selected');
  const grip = await m.$('#side .handle');
  const box = await grip.boundingBox();
  await m.mouse.move(box.x + 4, 300); await m.mouse.down(); await m.mouse.move(250, 300, { steps: 5 }); await m.mouse.up();
  const width = await m.evaluate(() => document.querySelector('#side').getBoundingClientRect().width);
  if (Math.abs(width - 250) > 6) errors.push(`dragging did not make the sidebar 250 px (${width})`);
  await wait(300);
  const file2 = path.join(OUT, 'desktop-files.png'); await m.screenshot({ path: file2 }); saved.push(file2);
  // From a file the labelled back arrow returns to the chat; in the chat it says "Chats" and goes to the project's chat list.
  await m.click('#main .back >> text=Back to chat');
  await m.waitForSelector('#main .back >> text=Chats');
  if (!/\/s\/[0-9a-f-]{36}$/.test(m.url())) errors.push(`"Back to chat" did not return to the chat: ${m.url()}`);
  await m.click('#main .back');
  await m.waitForSelector('a.tab.selected >> text=Chats');
  await m.goto(`${C}/#/p/${weather}/f/${encodeURIComponent('src/screens/home.js')}`);
  await m.waitForSelector('.code-view .s-keyword');
  await m.mouse.move(250, 300); await m.mouse.down(); await m.mouse.move(40, 300, { steps: 5 }); await m.mouse.up();
  if (!(await m.$('#app.side-closed'))) errors.push('dragging below the threshold did not close the sidebar');
  await m.click('.side-button');
  if (await m.$('#app.side-closed')) errors.push('☰ did not open the sidebar');
  await m.keyboard.press('Control+b');
  if (!(await m.$('#app.side-closed'))) errors.push('Ctrl+B did not close the sidebar');
  await m.keyboard.press('Control+b');
  await m.goto(`${C}/#/p/${weather}/f/README.md`);
  await m.waitForSelector('.md-preview h1');
  // New project: ＋ in the sidebar → name → the new chat screen of the project (after the screenshots, so the list does not change).
  await m.click('#side [title="New project"]');
  await m.fill('.new-project input', 'New Test');
  await m.click('.new-project button[type=submit]');
  await m.waitForURL(/\/new$/);
  await m.waitForSelector('#side .row >> text=New Test');

  if (errors.length) { console.error('Page errors:\n' + errors.join('\n')); process.exitCode = 1; }
} finally {
  await browser.close();
  server.kill();
  await wait(500);
  fs.rmSync(temp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
console.log(saved.map(k => path.relative(ROOT, k)).join('\n'));
