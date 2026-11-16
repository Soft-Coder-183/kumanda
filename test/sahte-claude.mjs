// Testler için sahte Claude Code: gerçek CLI'nin stream-json protokolünü (2.1.x'te gözlenen biçimiyle) taklit eder.
// İstem içindeki anahtar sözcüğe göre davranır: "izin" → araç izni ister, "soru" → AskUserQuestion,
// "uzun" → yavaş akan uzun yanıt (kesme denemesi), aksi halde kısa yanıt.
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';

const arg = process.argv.slice(2);
const deger = ad => { const i = arg.indexOf(ad); return i >= 0 ? arg[i + 1] : null; };
const oturum = deger('--resume') || deger('--session-id');
let mod = deger('--permission-mode') === 'manual' ? 'default' : deger('--permission-mode');
let efor = deger('--effort') || 'ayar';
const kayitDizini = path.join(process.env.KUMANDA_CLAUDE_DIZIN, 'projects', process.cwd().replace(/[^a-zA-Z0-9]/g, '-'));
const transkript = path.join(kayitDizini, `${oturum}.jsonl`);
fs.mkdirSync(kayitDizini, { recursive: true });

const yaz = o => process.stdout.write(JSON.stringify(o) + '\n');
const kaydet = o => fs.appendFileSync(transkript, JSON.stringify({ ...o, cwd: process.cwd(), sessionId: oturum, timestamp: new Date().toISOString() }) + '\n');
const bekle = ms => new Promise(c => setTimeout(c, ms));
const bekleyenYanit = new Map();
let kesildi = false, sayac = 0;

function asistan(icerik) {
  const m = { type: 'assistant', message: { role: 'assistant', content: icerik }, parent_tool_use_id: null, session_id: oturum };
  yaz(m); kaydet(m);
}
function aracSonucu(id, metin, hata = false) {
  const m = { type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: metin, is_error: hata }] }, parent_tool_use_id: null, session_id: oturum };
  yaz(m); kaydet(m);
}
async function metinAkit(metin, gecikme = 0) {
  yaz({ type: 'stream_event', event: { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }, parent_tool_use_id: null });
  for (const parca of metin.match(/.{1,8}/gs) || []) {
    if (kesildi) return false;
    yaz({ type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: parca } }, parent_tool_use_id: null });
    if (gecikme) await bekle(gecikme);
  }
  asistan([{ type: 'text', text: metin }]);
  return true;
}
function izinIste(ad, girdi, ek = {}) {
  const istek = `istek-${++sayac}`;
  const id = `toolu_${sayac}`;
  asistan([{ type: 'tool_use', id, name: ad, input: girdi }]);
  yaz({ type: 'control_request', request_id: istek, request: { subtype: 'can_use_tool', tool_name: ad, input: girdi, tool_use_id: id, ...ek } });
  return new Promise(coz => bekleyenYanit.set(istek, yanit => coz({ id, yanit })));
}

async function tur(metin) {
  kesildi = false;
  yaz({ type: 'system', subtype: 'init', session_id: oturum, model: 'claude-sahte', permissionMode: mod, cwd: process.cwd() });
  yaz({ type: 'rate_limit_event', rate_limit_info: { status: 'allowed', unifiedWindows: { five_hour: { utilization: 0.25 }, seven_day: { utilization: 0.1 } } } });
  kaydet({ type: 'user', message: { role: 'user', content: metin } });
  if (metin.includes('izin')) {
    const { id, yanit } = await izinIste('Bash', { command: 'echo merhaba', description: 'Selam ver' },
      { decision_reason: 'Bu komut onay gerektirir', permission_suggestions: [{ type: 'addRules', rules: [{ toolName: 'Bash', ruleContent: 'echo merhaba' }], behavior: 'allow', destination: 'localSettings' }] });
    if (yanit.behavior === 'allow') { aracSonucu(id, 'merhaba'); await metinAkit(yanit.updatedPermissions ? 'Komut çalıştı (kural kaydedildi).' : 'Komut çalıştı.'); }
    else { aracSonucu(id, yanit.message, true); await metinAkit('Komut reddedildi.'); }
  } else if (metin.includes('soru')) {
    const { id, yanit } = await izinIste('AskUserQuestion', { questions: [{ question: 'Çay mı kahve mi?', header: 'İçecek', multiSelect: false, options: [{ label: 'Çay', description: 'Demli' }, { label: 'Kahve', description: 'Sade' }] }] });
    const secim = yanit.updatedInput?.answers?.['Çay mı kahve mi?'] || '(yanıtsız)';
    aracSonucu(id, `Yanıt: ${secim}`);
    await metinAkit(`Seçimin: ${secim}`);
  } else if (metin.includes('uzun')) {
    if (!(await metinAkit('kelime '.repeat(400), 25))) {
      const m = { type: 'user', message: { role: 'user', content: [{ type: 'text', text: '[Request interrupted by user]' }] }, parent_tool_use_id: null, session_id: oturum };
      yaz(m); kaydet(m);
      yaz({ type: 'result', subtype: 'error_during_execution', is_error: true, duration_ms: 5, session_id: oturum });
      return;
    }
  } else await metinAkit(`Yanıt: **${metin}** (mod: ${mod}, efor: ${efor})`);
  yaz({ type: 'result', subtype: 'success', is_error: false, duration_ms: 1234, total_cost_usd: 0.01, result: 'tamam', session_id: oturum });
}

let sira = Promise.resolve();
readline.createInterface({ input: process.stdin }).on('line', satir => {
  if (!satir.trim()) return;
  const m = JSON.parse(satir);
  if (m.type === 'user') {
    const metin = m.message.content.filter(b => b.type === 'text').map(b => b.text).join('\n');
    sira = sira.then(() => tur(metin));
  } else if (m.type === 'control_response') {
    const geri = bekleyenYanit.get(m.response.request_id);
    bekleyenYanit.delete(m.response.request_id);
    geri?.(m.response.response);
  } else if (m.type === 'control_request') {
    const r = m.request;
    if (r.subtype === 'interrupt') kesildi = true;
    if (r.subtype === 'set_permission_mode') mod = r.mode;
    if (r.subtype === 'apply_flag_settings' && 'effortLevel' in (r.settings || {})) efor = r.settings.effortLevel ?? 'ayar'; // null = kullanıcı ayarı
    if (r.subtype === 'set_permission_mode' && r.mode === 'bypassPermissions' && !arg.includes('--allow-dangerously-skip-permissions')) {
      yaz({ type: 'control_response', response: { subtype: 'error', request_id: m.request_id, error: 'bypass kapalı' } });
    } else yaz({ type: 'control_response', response: { subtype: 'success', request_id: m.request_id, response: r.subtype === 'set_model' ? { model: `claude-${r.model}` } : {} } });
  }
}).on('close', () => sira.then(() => process.exit(0)));
