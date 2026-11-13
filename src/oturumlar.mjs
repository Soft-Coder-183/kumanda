// Claude Code süreçlerini yönetir. Her canlı oturum için bir `claude -p` süreci stream-json ile açık tutulur:
// istemler stdin'e yazılır, yanıtlar/araç çağrıları/izin istekleri stdout'tan okunup sade "öğe"lere çevrilir.
// İstemci koparsa süreç çalışmaya devam eder; olay günlüğü yeniden bağlanana kaldığı yerden oynatılır.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { ayar } from './ayar.mjs';
import { kayitDizini, oturumDosyasi, kullaniciMetni } from './projeler.mjs';

export const MODLAR = ['default', 'acceptEdits', 'auto', 'plan', 'bypassPermissions'];
export const MODELLER = ['', 'fable', 'opus', 'sonnet', 'haiku'];
const MOD_BAYRAGI = { default: 'manual' }; // CLI bayrağında "default"un adı "manual"

const kisalt = (s, n) => (s.length > n ? `${s.slice(0, n)}… (+${s.length - n} karakter)` : s);
const girdiKisalt = girdi => (girdi && typeof girdi === 'object'
  ? JSON.parse(JSON.stringify(girdi, (_, v) => (typeof v === 'string' ? kisalt(v, 6000) : v)))
  : girdi);

function sonucMetni(icerik) {
  if (typeof icerik === 'string') return icerik;
  if (!Array.isArray(icerik)) return '';
  return icerik.map(b => (b.type === 'text' ? b.text : b.type === 'image' ? '[resim]' : '')).filter(Boolean).join('\n');
}

// Kullanıcı rolüyle gelen ama kullanıcının yazmadığı iletiler (beceri içerikleri, sistem notları).
const GIZLI = /^\s*(<local-command|<command-message>|<system-reminder>|<task-notification>|<bash-|<user-prompt-submit-hook>|Caveat:|Base directory for this skill:)/;

/** Bir transkript ya da akış satırını arayüzün gösterdiği sade öğelere çevirir. */
export function cevir(s) {
  if (!s || s.isSidechain || s.parent_tool_use_id || s.isMeta || s.isCompactSummary) return [];
  const icerik = s.message?.content;
  const ogeler = [];
  if (s.type === 'assistant' && Array.isArray(icerik)) {
    for (const b of icerik) {
      if (b.type === 'text' && b.text.trim()) ogeler.push({ t: 'metin', metin: b.text });
      else if (b.type === 'tool_use') ogeler.push({ t: 'arac', id: b.id, ad: b.name, girdi: girdiKisalt(b.input) });
    }
  } else if (s.type === 'user') {
    if (Array.isArray(icerik) && icerik.some(b => b.type === 'tool_result')) {
      for (const b of icerik) {
        if (b.type === 'tool_result') ogeler.push({ t: 'arac-sonuc', id: b.tool_use_id, hata: Boolean(b.is_error), metin: kisalt(sonucMetni(b.content), 6000) });
      }
    } else {
      const metin = kullaniciMetni(icerik).trim();
      const resim = Array.isArray(icerik) ? icerik.filter(b => b.type === 'image').length : 0;
      const komut = /<command-name>([^<]+)<\/command-name>/.exec(metin);
      if (komut) ogeler.push({ t: 'not', metin: komut[1].trim() });
      else if (/^\[Request interrupted/.test(metin)) ogeler.push({ t: 'not', metin: 'Durduruldu' });
      else if ((metin || resim) && !GIZLI.test(metin)) ogeler.push({ t: 'kullanici', metin, resim });
    }
  } else if (s.type === 'system' && s.subtype === 'compact_boundary') {
    ogeler.push({ t: 'not', metin: 'Bağlam sıkıştırıldı' });
  }
  const z = s.timestamp ? Date.parse(s.timestamp) : 0;
  if (z) for (const o of ogeler) o.z = z;
  return ogeler;
}

const GECMIS_BAYT = 4 * 1024 * 1024, GECMIS_OGE = 400;

/** Transkript dosyasının `sinir` baytına kadarki kısmından son öğeleri okur. */
export async function gecmisOku(dosya, sinir = Infinity) {
  let boyut;
  try { boyut = (await fsp.stat(dosya)).size; } catch { return { ogeler: [], kirpildi: false }; }
  const son = Math.min(boyut, sinir);
  const bas = Math.max(0, son - GECMIS_BAYT);
  if (son <= 0) return { ogeler: [], kirpildi: false };
  const el = await fsp.open(dosya, 'r');
  let metin;
  try {
    const tampon = Buffer.alloc(son - bas);
    const { bytesRead } = await el.read(tampon, 0, son - bas, bas);
    metin = tampon.subarray(0, bytesRead).toString('utf8');
  } finally { await el.close(); }
  const satirlar = metin.split('\n');
  if (bas > 0) satirlar.shift(); // ilk satır yarım olabilir
  let ogeler = [];
  for (const satir of satirlar) {
    if (!satir.includes('"type":"user"') && !satir.includes('"type":"assistant"') && !satir.includes('compact_boundary')) continue;
    try { ogeler.push(...cevir(JSON.parse(satir))); } catch { /* yarım ya da bozuk satır */ }
  }
  const kirpildi = bas > 0 || ogeler.length > GECMIS_OGE;
  if (ogeler.length > GECMIS_OGE) ogeler = ogeler.slice(-GECMIS_OGE);
  return { ogeler, kirpildi };
}

function claudeKomutu() {
  const c = process.env.KUMANDA_CLAUDE ? JSON.parse(process.env.KUMANDA_CLAUDE) : ayar.claude;
  if (Array.isArray(c) && c.length) return [c[0], c.slice(1)];
  return [typeof c === 'string' && c ? c : 'claude', []];
}

const kosular = new Map(); // oturum kimliği → Kosu
let bildirimci = () => {};
export function bildirimciAyarla(f) { bildirimci = f; }

class Kosu {
  constructor(proje, oturum, { devam, mod, model, sinir }) {
    this.proje = proje;
    this.oturum = oturum;
    this.nesil = crypto.randomBytes(4).toString('hex');
    this.mod = MODLAR.includes(mod) ? mod : 'acceptEdits';
    this.istenenModel = MODELLER.includes(model) ? model : '';
    this.model = null;
    this.gecmisSinir = sinir;   // transkriptin bu bayta kadarki kısmı "geçmiş"; sonrası aşağıdaki olay günlüğünde
    this.olaylar = [];
    this.sira = 0;
    this.taban = 0;             // günlük en son bu sıra numarasında sıfırlandı
    this.dinleyiciler = new Set();
    this.bekleyen = new Map();  // izin isteği kimliği → istek
    this.kontrol = new Map();   // bizim gönderdiğimiz kontrol isteği → geri çağrı
    this.acikTur = 0;
    this.yazilan = null;        // akmakta olan metin bloğu { b, metin }
    this.blok = 0;
    this.limit = null;
    this.sonMetin = '';
    this.kapali = false;
    this.kapanma = 0;
    this.sonEtkinlik = Date.now();
    this.hataCikti = '';
    this.#baslat(devam);
  }

  get durum() {
    if (this.kapali) return 'kapali';
    if (this.bekleyen.size) return 'bekliyor';
    return this.acikTur > 0 ? 'calisiyor' : 'hazir';
  }

  anlik() {
    return { t: 'durum', durum: this.durum, mod: this.mod, model: this.model, istenenModel: this.istenenModel, limit: this.limit, nesil: this.nesil };
  }

  #baslat(devam) {
    const [komut, on] = claudeKomutu();
    const arg = [...on, '-p', '--output-format', 'stream-json', '--input-format', 'stream-json', '--verbose',
      '--include-partial-messages', '--permission-prompt-tool', 'stdio', '--allow-dangerously-skip-permissions',
      '--permission-mode', MOD_BAYRAGI[this.mod] || this.mod,
      ...(devam ? ['--resume', this.oturum] : ['--session-id', this.oturum]),
      ...(this.istenenModel ? ['--model', this.istenenModel] : [])];
    const surec = spawn(komut, arg, { cwd: this.proje.yol, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    this.surec = surec;
    surec.stdout.setEncoding('utf8');
    surec.stderr.setEncoding('utf8');
    let tampon = '';
    surec.stdout.on('data', veri => {
      tampon += veri;
      let i;
      while ((i = tampon.indexOf('\n')) >= 0) {
        const satir = tampon.slice(0, i); tampon = tampon.slice(i + 1);
        if (!satir.trim()) continue;
        let m;
        try { m = JSON.parse(satir); } catch { continue; }
        try { this.#satir(m); } catch (e) { console.error('[kosu] satır işlenemedi:', e); }
      }
    });
    surec.stderr.on('data', veri => { this.hataCikti = (this.hataCikti + veri).slice(-2000); });
    surec.stdin.on('error', () => {});
    surec.on('error', e => this.#kapandi(`Claude Code başlatılamadı: ${e.message}`));
    surec.on('exit', kod => this.#kapandi(kod && this.acikTur > 0 ? (this.hataCikti.trim() || `Claude Code beklenmedik biçimde kapandı (kod ${kod})`) : null));
  }

  #kapandi(hata) {
    if (this.kapali) return;
    for (const istek of [...this.bekleyen.keys()]) this.#izinKapat(istek, 'iptal');
    if (hata) this.#yayinla({ t: 'hata', metin: kisalt(hata, 1500) });
    this.kapali = true;
    this.kapanma = Date.now();
    this.acikTur = 0;
    this.yazilan = null;
    this.#gecici(this.anlik());
  }

  #yaz(nesne) {
    if (!this.kapali && this.surec.stdin.writable) this.surec.stdin.write(JSON.stringify(nesne) + '\n');
  }

  #dagit(o) {
    const veri = `${o.n ? `id: ${this.nesil}:${o.n}\n` : ''}data: ${JSON.stringify(o)}\n\n`;
    for (const res of this.dinleyiciler) res.write(veri);
  }
  /** Kalıcı olay: günlüğe girer, yeniden bağlanan istemciye tekrar oynatılır. */
  #yayinla(o) {
    o.n = ++this.sira;
    if (!o.z) o.z = Date.now();
    this.olaylar.push(o);
    this.#dagit(o);
  }
  /** Geçici olay: yalnızca o an bağlı olanlara gider (akan metin parçaları, durum). */
  #gecici(o) { this.#dagit(o); }

  #satir(m) {
    this.sonEtkinlik = Date.now();
    switch (m.type) {
      case 'system':
        if (m.subtype === 'init') {
          this.model = m.model || this.model;
          if (MODLAR.includes(m.permissionMode)) this.mod = m.permissionMode;
          this.#gecici(this.anlik());
        } else if (m.subtype === 'compact_boundary') this.#yayinla({ t: 'not', metin: 'Bağlam sıkıştırıldı' });
        else if (m.subtype === 'status' && m.status === 'compacting') this.#gecici({ t: 'etkinlik', ne: 'Bağlam sıkıştırılıyor' });
        break;
      case 'stream_event': {
        if (m.parent_tool_use_id) break;
        const e = m.event || {};
        if (e.type === 'content_block_start') {
          const tur = e.content_block?.type;
          if (tur === 'text') this.yazilan = { b: ++this.blok, metin: '' };
          else if (tur === 'tool_use') this.#gecici({ t: 'etkinlik', ne: `${e.content_block.name} hazırlanıyor` });
          else if (tur === 'thinking') this.#gecici({ t: 'etkinlik', ne: 'Düşünüyor' });
        } else if (e.type === 'content_block_delta' && e.delta?.type === 'text_delta' && this.yazilan) {
          this.yazilan.metin += e.delta.text;
          this.#gecici({ t: 'yaz', b: this.yazilan.b, ek: e.delta.text });
        }
        break;
      }
      case 'assistant':
      case 'user':
        for (const o of cevir(m)) {
          if (o.t === 'kullanici') continue; // kullanıcının istemini gönderirken biz yayınladık
          if (o.t === 'metin') { o.b = this.yazilan?.b; this.yazilan = null; this.sonMetin = o.metin; }
          delete o.z;
          this.#yayinla(o);
        }
        break;
      case 'control_request': this.#istek(m); break;
      case 'control_response': {
        const r = m.response || {};
        const geri = this.kontrol.get(r.request_id);
        this.kontrol.delete(r.request_id);
        geri?.(r);
        break;
      }
      case 'control_cancel_request': this.#izinKapat(m.request_id, 'iptal'); break;
      case 'result': {
        this.acikTur = Math.max(0, this.acikTur - 1);
        this.yazilan = null;
        for (const istek of [...this.bekleyen.keys()]) this.#izinKapat(istek, 'iptal');
        const kesildi = this.kesmeIstendi && m.subtype !== 'success';
        this.kesmeIstendi = false;
        const hata = m.is_error && !kesildi ? kisalt(String(m.result || m.subtype || 'Hata'), 1500) : null;
        this.#yayinla({ t: 'sonuc', hata, kesildi, sure: m.duration_ms, maliyet: m.total_cost_usd });
        this.#gecici(this.anlik());
        if (!kesildi) this.#bildir(hata ? 'hata' : 'bitti', hata || this.sonMetin);
        break;
      }
      case 'rate_limit_event': {
        const b = m.rate_limit_info || {};
        const p = b.unifiedWindows || {};
        this.limit = { durum: b.status, bes: p.five_hour?.utilization ?? null, yedi: p.seven_day?.utilization ?? null, sifirlanma: b.resetsAt || null };
        this.#gecici({ t: 'limit', limit: this.limit });
        break;
      }
      default: break;
    }
  }

  #bildir(tur, metin) {
    if (this.dinleyiciler.size === 0) bildirimci({ tur, proje: this.proje, oturum: this.oturum, metin: kisalt(String(metin || '').replace(/\s+/g, ' '), 140) });
  }

  #istek(m) {
    const r = m.request || {};
    if (r.subtype !== 'can_use_tool') {
      this.#yaz({ type: 'control_response', response: { subtype: 'error', request_id: m.request_id, error: 'Kumanda bu isteği desteklemiyor' } });
      return;
    }
    this.bekleyen.set(m.request_id, r);
    this.#yayinla({
      t: 'izin', istek: m.request_id, arac: r.tool_use_id, ad: r.tool_name, girdi: girdiKisalt(r.input),
      aciklama: r.decision_reason || r.description || null, hep: Boolean(r.permission_suggestions?.length),
    });
    this.#gecici(this.anlik());
    this.#bildir('izin', r.tool_name === 'AskUserQuestion' ? 'Claude bir soru soruyor' : `${r.tool_name} için izin bekliyor`);
  }

  #izinKapat(istek, karar) {
    if (!this.bekleyen.delete(istek)) return;
    this.#yayinla({ t: 'izin-yanit', istek, karar });
  }

  /** karar: 'izin' | 'hep' (kuralı kalıcı kaydet) | 'red'. yanitlar: AskUserQuestion için { soru: yanıt }. */
  izinYanitla(istek, { karar, yanitlar, mesaj } = {}) {
    const r = this.bekleyen.get(istek);
    if (!r) return false;
    let yanit;
    if (karar === 'red') {
      yanit = { behavior: 'deny', message: (typeof mesaj === 'string' && mesaj.trim()) || 'Kullanıcı bu işlemi reddetti.' };
    } else {
      const girdi = r.tool_name === 'AskUserQuestion' && yanitlar && typeof yanitlar === 'object' ? { ...r.input, answers: yanitlar } : r.input;
      yanit = { behavior: 'allow', updatedInput: girdi };
      if (karar === 'hep' && r.permission_suggestions?.length) yanit.updatedPermissions = r.permission_suggestions;
    }
    this.#yaz({ type: 'control_response', response: { subtype: 'success', request_id: istek, response: yanit } });
    this.#izinKapat(istek, karar === 'red' ? 'red' : karar === 'hep' ? 'hep' : 'izin');
    this.#gecici(this.anlik());
    return true;
  }

  #kontrolGonder(istek) {
    return new Promise(coz => {
      const kimlik = crypto.randomUUID();
      const sure = setTimeout(() => { this.kontrol.delete(kimlik); coz({ subtype: 'error', error: 'Yanıt gelmedi' }); }, 8000);
      this.kontrol.set(kimlik, r => { clearTimeout(sure); coz(r); });
      this.#yaz({ type: 'control_request', request_id: kimlik, request: istek });
    });
  }

  gonder(metin, resimler = []) {
    if (this.kapali) throw new Error('Süreç kapalı');
    if (this.acikTur === 0 && this.olaylar.length > 3000) this.#yenidenTemellen();
    const icerik = [
      ...resimler.map(r => ({ type: 'image', source: { type: 'base64', media_type: r.tur, data: r.veri } })),
      ...(metin ? [{ type: 'text', text: metin }] : []),
    ];
    this.acikTur++;
    this.sonEtkinlik = Date.now();
    this.#yayinla({ t: 'kullanici', metin, resim: resimler.length });
    this.#yaz({ type: 'user', message: { role: 'user', content: icerik } });
    this.#gecici(this.anlik());
  }

  /** Günlük çok büyüdüyse: bitmiş turlar zaten transkriptte, günlüğü boşaltıp istemcilere geçmişi yeniden yüklet. */
  #yenidenTemellen() {
    try {
      this.gecmisSinir = fs.statSync(path.join(kayitDizini(this.proje), `${this.oturum}.jsonl`)).size;
      this.olaylar = [];
      this.taban = this.sira;
      this.#gecici({ t: 'yenile' });
    } catch { /* dosya yoksa günlük kalsın */ }
  }

  async kes() {
    if (this.kapali || this.acikTur === 0) return;
    this.kesmeIstendi = true;
    await this.#kontrolGonder({ subtype: 'interrupt' });
  }

  async modAyarla(mod) {
    if (!MODLAR.includes(mod)) throw new Error('Geçersiz mod');
    if (mod === this.mod) return;
    const r = await this.#kontrolGonder({ subtype: 'set_permission_mode', mode: mod });
    if (r.subtype !== 'success') throw new Error(r.error || 'Mod değiştirilemedi');
    this.mod = mod;
    this.#gecici(this.anlik());
  }

  async modelAyarla(model) {
    if (!MODELLER.includes(model)) throw new Error('Geçersiz model');
    if (model === this.istenenModel) return;
    const r = await this.#kontrolGonder({ subtype: 'set_model', model: model || 'default' });
    if (r.subtype !== 'success') throw new Error(r.error || 'Model değiştirilemedi');
    this.istenenModel = model;
    if (r.response?.model) this.model = r.response.model;
    this.#gecici(this.anlik());
  }

  abone(res, isaret) {
    // isaret: "<nesil>:<sıra>" (istemcinin gördüğü son kalıcı olay). Başka nesilden ya da günlük sıfırlanmadan
    // önceki bir işaretse istemcinin görüntüsü eskidir: geçmişi yeniden yükletip günlüğü baştan oynat.
    const [nesil, n] = String(isaret || '').split(':');
    let sonra = nesil === this.nesil ? Number(n) || 0 : -1;
    const yaz = o => res.write(`${o.n ? `id: ${this.nesil}:${o.n}\n` : ''}data: ${JSON.stringify(o)}\n\n`);
    yaz(this.anlik());
    if (sonra < this.taban) { if (isaret) yaz({ t: 'yenile' }); sonra = 0; }
    for (const o of this.olaylar) if (o.n > sonra) yaz(o);
    if (this.yazilan?.metin) yaz({ t: 'yaz', b: this.yazilan.b, tam: this.yazilan.metin });
    this.dinleyiciler.add(res);
    res.on('close', () => this.dinleyiciler.delete(res));
  }

  kapat() {
    if (this.kapali) return;
    try { this.surec.stdin.end(); } catch { /* zaten kapalı */ }
    setTimeout(() => { if (!this.kapali) this.surec.kill(); }, 5000).unref();
  }
}

export const kosuBul = oturum => kosular.get(oturum) || null;

export function kosuListesi() {
  return [...kosular.values()].filter(k => !k.kapali)
    .map(k => ({ oturum: k.oturum, proje: k.proje.kimlik, projeAd: k.proje.ad, durum: k.durum }));
}

export async function gonder(proje, { oturum, metin, resimler, mod, model }) {
  let k = oturum ? kosular.get(oturum) : null;
  if (k?.kapali) { kosular.delete(oturum); k = null; }
  if (!k) {
    let devam = false, sinir = 0;
    if (oturum) {
      const dosya = await oturumDosyasi(proje, oturum);
      if (!dosya) throw new Error('Oturum bulunamadı');
      devam = true;
      sinir = (await fsp.stat(dosya)).size;
    } else oturum = crypto.randomUUID();
    k = new Kosu(proje, oturum, { devam, mod, model, sinir });
    kosular.set(oturum, k);
  } else {
    if (mod && mod !== k.mod) await k.modAyarla(mod).catch(() => {});
    if (typeof model === 'string' && model !== k.istenenModel) await k.modelAyarla(model).catch(() => {});
  }
  k.gonder(metin, resimler);
  return k;
}

export function hepsiniKapat() { for (const k of kosular.values()) k.kapat(); }

// Boşta bekleyen süreçleri kapat, kapanmış koşuları bir süre sonra unut.
setInterval(() => {
  const simdi = Date.now();
  for (const [oturum, k] of kosular) {
    if (k.kapali) { if (simdi - k.kapanma > 10 * 60e3 && k.dinleyiciler.size === 0) kosular.delete(oturum); }
    else if (k.durum === 'hazir' && simdi - k.sonEtkinlik > (ayar.bosKapanmaDk || 20) * 60e3) k.kapat();
  }
}, 60e3).unref();
