// Settings and secrets do NOT live in the project folder but in %LOCALAPPDATA%\Kumanda, so neither the product server
// nor a git commit can leak the password hash or the device sessions.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export const ROOT = path.resolve(import.meta.dirname, '..');
export const DATA = process.env.KUMANDA_DATA
  || path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), '.kumanda'), 'Kumanda');
fs.mkdirSync(DATA, { recursive: true });

const FILE = path.join(DATA, 'config.json');

const defaults = () => ({
  controlPort: 7777,
  productPort: 7778,
  listen: '127.0.0.1',           // this computer only; remote access comes through the tunnel (remote-setup.ps1)
  roots: [path.dirname(ROOT)],   // folders whose subfolders count as projects
  extraProjects: [],             // single project folders outside the roots
  hiddenProjects: [],            // project ids
  hiddenProducts: {},            // project id → [relative path]
  publicOrigins: {},             // control host → product origin (custom tunnel mapping; not needed for Tailscale)
  claude: null,                  // path to claude.exe or [command, ...args]; empty means "claude" from PATH
  vscode: null,                  // path to Code.exe; empty means found on PATH or in the usual install folders
  idleCloseMinutes: 20,          // an idle Claude process is closed after this many minutes
  pushContact: 'mailto:kumanda@example.com',
  password: null,                // { salt, hash } (scrypt)
});

export const config = defaults();

export function atomicWrite(file, text) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, file);
}

export function readJsonFile(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

export function loadConfig() {
  const fresh = { ...defaults(), ...readJsonFile(FILE, {}) };
  for (const k of Object.keys(config)) delete config[k];
  Object.assign(config, fresh);
  return config;
}

export function saveConfig() {
  atomicWrite(FILE, JSON.stringify(config, null, 2));
}

// ── one-time migration of the data folder written by Kumanda < 2.0 (Turkish file and field names) ──
const LEGACY_CONFIG_KEYS = {
  kumandaPort: 'controlPort', urunPort: 'productPort', dinle: 'listen', kokler: 'roots', ekProjeler: 'extraProjects',
  gizliProjeler: 'hiddenProjects', gizliUrunler: 'hiddenProducts', kamu: 'publicOrigins', claude: 'claude',
  bosKapanmaDk: 'idleCloseMinutes', bildirimIletisim: 'pushContact', sifre: 'password',
};

function migrateLegacyData() {
  const legacy = name => path.join(DATA, name);
  const moveJson = (from, to, convert) => {
    if (!fs.existsSync(legacy(from)) || fs.existsSync(legacy(to))) return;
    const old = readJsonFile(legacy(from), null);
    if (old) atomicWrite(legacy(to), JSON.stringify(convert(old), null, 2));
    fs.renameSync(legacy(from), `${legacy(from)}.migrated`);
  };
  moveJson('ayar.json', 'config.json', old => {
    const out = {};
    for (const [k, v] of Object.entries(old)) if (LEGACY_CONFIG_KEYS[k]) out[LEGACY_CONFIG_KEYS[k]] = v;
    if (old.sifre) out.password = old.sifre.ozet ? { salt: old.sifre.tuz, hash: old.sifre.ozet } : null;
    return out;
  });
  const KIND = { kumanda: 'control', urun: 'product' };
  moveJson('cihazlar.json', 'devices.json', old => Object.fromEntries(Object.entries(old).map(([key, d]) => [key, {
    kind: KIND[d.tur] || d.tur, created: d.olusturma, lastSeen: d.son, device: d.cihaz, parent: d.ebeveyn ?? null,
  }])));
  moveJson('bildirim.json', 'push.json', old => ({
    privateKey: old.ozel, publicKey: old.acik,
    subscribers: Object.fromEntries(Object.entries(old.aboneler || {}).map(([e, s]) => [e, { device: s.cihaz, time: s.zaman }])),
  }));
  for (const [from, to] of [['gunluk.txt', 'server.log'], ['yerel-anahtar', 'local-key']]) {
    if (fs.existsSync(legacy(from)) && !fs.existsSync(legacy(to))) fs.renameSync(legacy(from), legacy(to));
  }
  if (fs.existsSync(legacy('limit.json')) && readJsonFile(legacy('limit.json'), {})?.bes !== undefined) fs.rmSync(legacy('limit.json'));
  if (fs.existsSync(legacy('yan-sorular')) && !fs.existsSync(legacy('btw'))) {
    fs.mkdirSync(legacy('btw'));
    for (const f of fs.readdirSync(legacy('yan-sorular'))) {
      const lines = fs.readFileSync(path.join(legacy('yan-sorular'), f), 'utf8').split('\n').filter(Boolean).map(line => {
        try {
          const o = JSON.parse(line);
          return JSON.stringify({ id: o.id, at: o.z, question: o.soru, answer: o.yanit, error: o.hata, source: o.kaynak, model: o.model });
        } catch { return null; }
      }).filter(Boolean);
      fs.writeFileSync(path.join(legacy('btw'), f), lines.join('\n') + (lines.length ? '\n' : ''));
    }
    fs.renameSync(legacy('yan-sorular'), legacy('yan-sorular.migrated'));
  }
}

migrateLegacyData();
loadConfig();
if (!fs.existsSync(FILE)) saveConfig();

// If another process (the install script, --reset-password) changes the file, the running server sees it.
export function watchConfig() {
  fs.watchFile(FILE, { interval: 3000 }, () => loadConfig()).unref();
}
