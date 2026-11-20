// Projeleri bulur (kök klasörlerin alt klasörleri + Claude Code'un daha önce çalıştığı klasörler)
// ve her projedeki ürünleri (çalıştırılabilir/açılabilir çıktı dosyalarını) tarar.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { ayar, ayarKaydet, ayarYukle } from './ayar.mjs';

export const CLAUDE_DIZIN = process.env.KUMANDA_CLAUDE_DIZIN || path.join(os.homedir(), '.claude');
export const CLAUDE_PROJELER = path.join(CLAUDE_DIZIN, 'projects');

const kucuk = yol => path.resolve(yol).toLowerCase();
export const projeKimligi = yol => crypto.createHash('sha1').update(kucuk(yol)).digest('hex').slice(0, 12);
const icinde = (ust, alt) => { const u = kucuk(ust), a = kucuk(alt); return a !== u && a.startsWith(u + path.sep); };

async function parcaOku(dosya, bas, uzunluk) {
  const el = await fsp.open(dosya, 'r');
  try {
    const tampon = Buffer.alloc(uzunluk);
    const { bytesRead } = await el.read(tampon, 0, uzunluk, bas);
    return tampon.subarray(0, bytesRead).toString('utf8');
  } finally { await el.close(); }
}

// ---------- Claude Code kayıtları (~/.claude/projects) ----------
const cwdOnbellek = new Map(); // kayıt dizini → çalışma klasörü

async function cwdBul(dosya, boyut) {
  for (const bas of [0, Math.max(0, boyut - 262144)]) {
    const m = /"cwd":"((?:[^"\\]|\\.)*)"/.exec(await parcaOku(dosya, bas, 262144));
    if (m) { try { return JSON.parse(`"${m[1]}"`); } catch { /* sürdür */ } }
  }
  return null;
}

const kayitAdi = yol => path.resolve(yol).replace(/[^a-zA-Z0-9]/g, '-').toLowerCase();
let kayitAdlari = new Set(); // oturumu olmasa da Claude Code'un tanıdığı klasörler (ör. yalnızca hafızası olanlar)

/** küçük harfli yol → { yol, dizinler[], son (ms), sayi } */
async function kayitlariOku() {
  const sonuc = new Map();
  let girdiler;
  try { girdiler = await fsp.readdir(CLAUDE_PROJELER, { withFileTypes: true }); } catch { return sonuc; }
  kayitAdlari = new Set(girdiler.filter(g => g.isDirectory()).map(g => g.name.toLowerCase()));
  await Promise.all(girdiler.filter(g => g.isDirectory()).map(async g => {
    const dizin = path.join(CLAUDE_PROJELER, g.name);
    let adlar;
    try { adlar = (await fsp.readdir(dizin)).filter(f => f.endsWith('.jsonl')); } catch { return; }
    if (!adlar.length) return;
    const dosyalar = (await Promise.all(adlar.map(async f => {
      try { const s = await fsp.stat(path.join(dizin, f)); return { f, m: s.mtimeMs, b: s.size }; } catch { return null; }
    }))).filter(Boolean).sort((a, b) => b.m - a.m);
    if (!dosyalar.length) return;
    let cwd = cwdOnbellek.get(dizin);
    if (cwd === undefined) {
      cwd = null;
      for (const d of dosyalar.slice(0, 3)) { cwd = await cwdBul(path.join(dizin, d.f), d.b); if (cwd) break; }
      if (cwd) cwdOnbellek.set(dizin, cwd);
    }
    if (!cwd) return;
    const anahtar = kucuk(cwd);
    const k = sonuc.get(anahtar) || { yol: path.resolve(cwd), dizinler: [], son: 0, sayi: 0 };
    k.dizinler.push(dizin); k.son = Math.max(k.son, dosyalar[0].m); k.sayi += dosyalar.length;
    sonuc.set(anahtar, k);
  }));
  return sonuc;
}

// ---------- proje listesi ----------
let projeOnbellek = { zaman: 0, liste: [] };

async function klasorMu(yol) { try { return (await fsp.stat(yol)).isDirectory(); } catch { return false; } }

export async function projeleriListele({ taze = false, gizliler = false } = {}) {
  if (!taze && Date.now() - projeOnbellek.zaman < 8000) return gizliler ? projeOnbellek.liste : projeOnbellek.liste.filter(p => !p.gizli);
  const kayitlar = await kayitlariOku();
  const ev = kucuk(os.homedir());
  const geciciMi = a => a.includes(`${path.sep}appdata${path.sep}local${path.sep}temp${path.sep}`) || a.startsWith(kucuk(os.tmpdir()));
  const kayitli = yol => kayitlar.has(kucuk(yol)) || kayitAdlari.has(kayitAdi(yol));
  const adaylar = new Map(); // küçük yol → { yol, kok }

  for (const kok of ayar.kokler) {
    let girdiler;
    try { girdiler = await fsp.readdir(kok, { withFileTypes: true }); } catch { continue; }
    for (const g of girdiler) {
      if (!g.isDirectory() || g.name.startsWith('.')) continue;
      const yol = path.join(kok, g.name);
      adaylar.set(kucuk(yol), { yol, kok });
      // Bir alt düzey: kap klasörlerin ("Games", "Pocket Apps") içindeki, Claude Code'un tanıdığı projeler.
      let altlar = [];
      try { altlar = await fsp.readdir(yol, { withFileTypes: true }); } catch { /* okunamadı */ }
      for (const a of altlar) {
        if (!a.isDirectory() || a.name.startsWith('.') || a.name === 'node_modules') continue;
        const altYol = path.join(yol, a.name);
        if (kayitli(altYol)) adaylar.set(kucuk(altYol), { yol: altYol, kok });
      }
    }
  }
  for (const yol of ayar.ekProjeler) if (await klasorMu(yol)) adaylar.set(kucuk(yol), { yol: path.resolve(yol), kok: null });
  for (const [anahtar, k] of kayitlar) {
    if (adaylar.has(anahtar)) continue;
    if (anahtar === ev || geciciMi(anahtar) || anahtar.includes(`${path.sep}.claude`) || anahtar.includes('~')) continue;
    if (!(await klasorMu(k.yol))) continue;
    adaylar.set(anahtar, { yol: k.yol, kok: ayar.kokler.find(kk => icinde(kk, k.yol)) || null });
  }
  // Kendi kaydı olmayan ama içinde kayıtlı projeler bulunan klasörler yalnızca kaptır ("Games", "Pocket Apps").
  for (const [anahtar, a] of [...adaylar]) {
    if (kayitli(a.yol)) continue;
    if ([...adaylar.values()].some(b => icinde(a.yol, b.yol))) adaylar.delete(anahtar);
  }

  const liste = [...adaylar.entries()].map(([anahtar, a]) => {
    const k = kayitlar.get(anahtar);
    const kimlik = projeKimligi(a.yol);
    return {
      kimlik,
      ad: a.kok ? path.relative(a.kok, a.yol).split(path.sep).join(' / ') : path.basename(a.yol),
      yol: a.yol,
      kayitDizinleri: k?.dizinler || [],
      oturumSayisi: k?.sayi || 0,
      sonEtkinlik: k?.son || 0,
      gizli: ayar.gizliProjeler.includes(kimlik),
    };
  }).sort((x, y) => (y.sonEtkinlik - x.sonEtkinlik) || x.ad.localeCompare(y.ad, 'tr'));

  projeOnbellek = { zaman: Date.now(), liste };
  return gizliler ? liste : liste.filter(p => !p.gizli);
}

export async function projeBul(kimlik) {
  let p = (await projeleriListele({ gizliler: true })).find(x => x.kimlik === kimlik);
  if (!p) p = (await projeleriListele({ taze: true, gizliler: true })).find(x => x.kimlik === kimlik);
  return p || null;
}

export function projeGizle(kimlik, gizli) {
  ayarYukle();
  ayar.gizliProjeler = ayar.gizliProjeler.filter(k => k !== kimlik);
  if (gizli) ayar.gizliProjeler.push(kimlik);
  ayarKaydet();
  projeOnbellek.zaman = 0;
}

/** Yeni bir oturumun yazılacağı kayıt dizini (Claude Code'un adlandırma kuralı: harf/rakam dışı her şey '-'). */
export function kayitDizini(proje) {
  return path.join(CLAUDE_PROJELER, proje.yol.replace(/[^a-zA-Z0-9]/g, '-'));
}

// ---------- oturum listesi ----------
const baslikOnbellek = new Map(); // dosya → { anahtar, baslik }
const GIZLI_ONEK = /^\s*(<|Caveat:|Base directory for this skill:|\[Request interrupted)/;

export function kullaniciMetni(icerik) {
  if (typeof icerik === 'string') return icerik;
  if (!Array.isArray(icerik)) return '';
  return icerik.filter(b => b.type === 'text').map(b => b.text).join('\n');
}

async function baslikBul(dosya, boyut) {
  const bas = await parcaOku(dosya, 0, 262144);
  const son = boyut > 262144 ? await parcaOku(dosya, Math.max(262144, boyut - 131072), 131072) : '';
  let baslik = null, ilk = null;
  for (const satir of (bas + '\n' + son).split('\n')) {
    if (satir.includes('"type":"ai-title"') || satir.includes('"type":"custom-title"')) {
      try { const o = JSON.parse(satir); baslik = o.customTitle || o.aiTitle || baslik; } catch { /* yarım satır */ }
    } else if (!ilk && satir.includes('"type":"user"')) {
      try {
        const o = JSON.parse(satir);
        if (o.type === 'user' && !o.isMeta && !o.isSidechain) {
          const m = kullaniciMetni(o.message?.content).trim();
          if (m && !GIZLI_ONEK.test(m)) ilk = m.replace(/\s+/g, ' ').slice(0, 90);
        }
      } catch { /* yarım satır */ }
    }
  }
  return baslik || ilk;
}

export async function oturumlariListele(proje, sinir = 80) {
  const hepsi = [];
  const dizinler = new Set([...proje.kayitDizinleri, kayitDizini(proje)]);
  for (const dizin of dizinler) {
    let adlar;
    try { adlar = (await fsp.readdir(dizin)).filter(f => f.endsWith('.jsonl')); } catch { continue; }
    for (const f of adlar) {
      try {
        const dosya = path.join(dizin, f);
        const s = await fsp.stat(dosya);
        hepsi.push({ kimlik: f.slice(0, -6), dosya, zaman: s.mtimeMs, boyut: s.size });
      } catch { /* silinmiş */ }
    }
  }
  hepsi.sort((a, b) => b.zaman - a.zaman);
  const liste = hepsi.slice(0, sinir);
  await Promise.all(liste.map(async o => {
    const anahtar = `${o.zaman}:${o.boyut}`;
    const k = baslikOnbellek.get(o.dosya);
    if (k?.anahtar === anahtar) { o.baslik = k.baslik; return; }
    try { o.baslik = await baslikBul(o.dosya, o.boyut); } catch { o.baslik = null; }
    baslikOnbellek.set(o.dosya, { anahtar, baslik: o.baslik });
  }));
  return liste.filter(o => o.baslik);
}

export async function oturumDosyasi(proje, oturumKimligi) {
  if (!/^[0-9a-f-]{36}$/i.test(oturumKimligi)) return null;
  for (const dizin of new Set([...proje.kayitDizinleri, kayitDizini(proje)])) {
    const dosya = path.join(dizin, `${oturumKimligi}.jsonl`);
    if (fs.existsSync(dosya)) return dosya;
  }
  return null;
}

// ---------- ürünleri üreten oturumu bulma ----------
// Bir ürün, son değiştirildiği ana en yakın etkinliği olan oturuma bağlanır (±ESLESME). Dosya adı aramak yerine zaman
// kullanılır, çünkü derlenen ürünler (APK, EXE, ZIP) Write aracıyla değil derleme komutlarıyla yazılır ve transkriptte
// adları geçmeyebilir. Transkriptler yalnızca sona eklenerek büyür: önbellekte tutulur, büyüyünce yalnızca yeni kısım okunur.
const ESLESME = 20 * 60e3;
const ZAMAN = /"timestamp":"(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z)"/g;
const zamanOnbellek = new Map(); // dosya → { boyut, zamanlar: number[] (sıralı) }

async function zamanlariOku(dosya) {
  let boyut;
  try { boyut = (await fsp.stat(dosya)).size; } catch { return []; }
  const k = zamanOnbellek.get(dosya);
  if (k?.boyut === boyut) return k.zamanlar;
  const buyudu = k && boyut > k.boyut;
  const zamanlar = buyudu ? [...k.zamanlar] : [];
  const el = await fsp.open(dosya, 'r');
  try {
    const PARCA = 8 * 1024 * 1024, ORTUSME = 96; // parça sınırında bölünen damga kaçmasın
    for (let bas = buyudu ? Math.max(0, k.boyut - ORTUSME) : 0; bas < boyut; bas += PARCA - ORTUSME) {
      const tampon = Buffer.alloc(Math.min(PARCA, boyut - bas));
      const { bytesRead } = await el.read(tampon, 0, tampon.length, bas);
      const metin = tampon.subarray(0, bytesRead).toString('latin1'); // damgalar ASCII; çözümleme hızlı ve bölünmez
      for (const m of metin.matchAll(ZAMAN)) zamanlar.push(Date.parse(m[1]));
      if (bytesRead < tampon.length) break;
    }
  } finally { await el.close(); }
  zamanlar.sort((a, b) => a - b);
  zamanOnbellek.set(dosya, { boyut, zamanlar });
  return zamanlar;
}

/** oturum kimliği → sıralı etkinlik zamanları (alt ajanların etkinliği ana oturuma sayılır). */
async function oturumEtkinlikleri(proje) {
  const sonuc = new Map();
  const ekle = (sid, z) => { const l = sonuc.get(sid); if (l) l.push(...z); else sonuc.set(sid, [...z]); };
  for (const dizin of new Set([...proje.kayitDizinleri, kayitDizini(proje)])) {
    let girdiler;
    try { girdiler = await fsp.readdir(dizin, { withFileTypes: true }); } catch { continue; }
    for (const g of girdiler) {
      if (g.isFile() && /^[0-9a-f-]{36}\.jsonl$/i.test(g.name)) ekle(g.name.slice(0, -6), await zamanlariOku(path.join(dizin, g.name)));
      else if (g.isDirectory() && /^[0-9a-f-]{36}$/i.test(g.name)) {
        let altlar = [];
        try { altlar = (await fsp.readdir(path.join(dizin, g.name, 'subagents'))).filter(f => f.endsWith('.jsonl')); } catch { /* alt ajan yok */ }
        for (const f of altlar) ekle(g.name, await zamanlariOku(path.join(dizin, g.name, 'subagents', f)));
      }
    }
  }
  for (const l of sonuc.values()) l.sort((a, b) => a - b);
  return sonuc;
}

function enYakinFark(sirali, t) {
  let a = 0, b = sirali.length - 1;
  if (b < 0) return Infinity;
  while (a < b) { const o = (a + b) >> 1; if (sirali[o] < t) a = o + 1; else b = o; }
  return Math.min(Math.abs(sirali[a] - t), a > 0 ? Math.abs(sirali[a - 1] - t) : Infinity);
}

/** Her ürüne `oturum` (kimlik ya da null) yazar; bağlanan oturumların başlıklarını döndürür. */
export async function urunleriOturumlaraBagla(proje, urunler) {
  const etkinlik = await oturumEtkinlikleri(proje);
  for (const u of urunler) {
    let enIyi = null, fark = ESLESME;
    for (const [sid, zamanlar] of etkinlik) {
      const f = enYakinFark(zamanlar, u.zaman);
      if (f <= fark) { fark = f; enIyi = sid; }
    }
    u.oturum = enIyi;
  }
  const gereken = new Set(urunler.map(u => u.oturum).filter(Boolean));
  const oturumlar = {};
  if (gereken.size) {
    for (const o of await oturumlariListele(proje, 2000)) if (gereken.has(o.kimlik)) oturumlar[o.kimlik] = { baslik: o.baslik, zaman: o.zaman };
    for (const sid of gereken) oturumlar[sid] ||= { baslik: null, zaman: etkinlik.get(sid)?.at(-1) || 0 };
  }
  return oturumlar;
}

// ---------- ürün taraması ----------
const UZANTI = {
  '.html': 'web', '.htm': 'web', '.apk': 'android', '.exe': 'windows', '.msi': 'windows', '.zip': 'paket',
  '.mp4': 'video', '.webm': 'video', '.mov': 'video', '.pdf': 'belge', '.pptx': 'belge', '.docx': 'belge', '.xlsx': 'belge',
};
// Ürün aramaya değmeyen klasörler: bağımlılıklar, sanal ortamlar, test raporları, derleme ara çıktıları, veri dökümleri.
const YOKSAY = new Set(['node_modules', 'venv', 'env', '__pycache__', 'site-packages', 'lib', 'scripts', 'include',
  'intermediates', 'generated', 'tmp', 'temp', 'obj', 'reports', 'report', 'coverage', 'playwright-report',
  'test-results', 'tests', 'test', '__tests__', 'e2e', 'dist-e2e', 'addons', 'vendor', 'third_party', 'fixtures',
  'captures', 'logs', 'dump', 'arsiv', 'arşiv', 'template', 'templates', 'locales', 'resources', 'swiftshader']);
const YARDIMCI_EXE = /^(unins|uninstall|elevate|crashpad|notification_helper|vc_?redist|python|pip|node|ffmpeg|ffprobe|chromedriver|adb|7z|rcedit|squirrel|update|createdump)/i;
const ARTIK = /^(xref-.*\.html|base_library\.zip)$/i; // PyInstaller ara çıktıları
const HTML_SINIR = 6;

const yoksay = ad => ad.startsWith('.') || YOKSAY.has(ad.toLowerCase()) || /-unpacked$/i.test(ad);

async function htmlBilgisi(dosya) {
  let bas;
  try { bas = await parcaOku(dosya, 0, 16384); } catch { return { atla: true }; }
  // Kaynak şablonu (Vite/benzeri): derlenmeden çalışmaz, ürün değildir.
  if (/<script[^>]+src=["']\/?src\//i.test(bas)) return { atla: true };
  const m = /<title[^>]*>([^<]{1,120})<\/title>/i.exec(bas);
  return { baslik: m ? m[1].replace(/\s+/g, ' ').trim() : null };
}

async function tara(proje, altProjeler) {
  const urunler = [];
  let butce = 40000;
  const atlanacak = new Set(altProjeler.map(kucuk));

  async function gez(dizin, derinlik) {
    if (derinlik > 9 || butce <= 0) return;
    let girdiler;
    try { girdiler = await fsp.readdir(dizin, { withFileTypes: true }); } catch { return; }
    butce -= girdiler.length;
    const adaylar = [], altlar = [];
    for (const g of girdiler) {
      if (g.isDirectory()) { if (!yoksay(g.name) && !atlanacak.has(kucuk(path.join(dizin, g.name)))) altlar.push(g.name); }
      else if (g.isFile() && !g.name.startsWith('.')) {
        const tur = UZANTI[path.extname(g.name).toLowerCase()];
        if (tur && !ARTIK.test(g.name)) adaylar.push({ ad: g.name, tur });
      }
    }
    // Çok sayıda HTML içeren klasör veri/rapor dökümüdür: yalnızca index.html (varsa) üründür.
    const htmller = adaylar.filter(a => a.tur === 'web');
    let secilen = adaylar.filter(a => a.tur !== 'web' && !(a.tur === 'windows' && YARDIMCI_EXE.test(a.ad)));
    if (htmller.length <= HTML_SINIR) secilen.push(...htmller);
    else secilen.push(...htmller.filter(h => /^index\.html?$/i.test(h.ad)));

    for (const a of secilen) {
      const dosya = path.join(dizin, a.ad);
      let st;
      try { st = await fsp.stat(dosya); } catch { continue; }
      if (st.size === 0) continue;
      const urun = {
        yol: path.relative(proje.yol, dosya).split(path.sep).join('/'),
        ad: a.ad, tur: a.tur, boyut: st.size, zaman: st.mtimeMs,
      };
      if (a.tur === 'web') {
        const b = await htmlBilgisi(dosya);
        if (b.atla) continue;
        urun.baslik = b.baslik;
      }
      urunler.push(urun);
    }
    for (const alt of altlar) await gez(path.join(dizin, alt), derinlik + 1);
  }

  await gez(proje.yol, 0);

  // Aynı klasörde 3'ten fazla exe varsa (paketlenmiş uygulama klasörü) yalnızca en büyüğü üründür.
  const exeKlasor = new Map();
  for (const u of urunler) if (u.tur === 'windows') {
    const k = path.posix.dirname(u.yol);
    exeKlasor.set(k, [...(exeKlasor.get(k) || []), u]);
  }
  const at = new Set();
  for (const liste of exeKlasor.values()) if (liste.length > 3) {
    liste.sort((a, b) => b.boyut - a.boyut).slice(1).forEach(u => at.add(u));
  }
  const kalan = urunler.filter(u => !at.has(u)).sort((a, b) => b.zaman - a.zaman);
  ikincilleriIsaretle(kalan);
  return kalan;
}

const KAYNAK_KLASOR = new Set(['src', 'assets', 'android', 'ios', 'app', 'public', 'static']);
const CIKTI_KLASOR = new Set(['dist', 'release', 'releases', 'kurulum', 'out', 'paket', 'build']);
const SURUM = /\d+(\.\d+)+/;
const surumAnahtari = ad => ad.replace(SURUM, '#');
const surumKarsilastir = (a, b) => {
  const x = (SURUM.exec(a) || ['0'])[0].split('.').map(Number), y = (SURUM.exec(b) || ['0'])[0].split('.').map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0);
  return 0;
};

/** Asıl ürünleri öne çıkarmak için geri kalanına "ikincil" nedeni yazar (liste yine de eksiksiz kalır). */
function ikincilleriIsaretle(urunler) {
  for (const u of urunler) {
    const klasorler = u.yol.toLowerCase().split('/').slice(0, -1);
    if (u.tur === 'web' && klasorler.some(k => KAYNAK_KLASOR.has(k))) u.ikincil = 'kaynak dosyası';
    else if (u.tur === 'windows' && u.boyut < 1e6) u.ikincil = 'yardımcı dosya';
    else if (u.tur === 'android' && /debug/i.test(u.yol)) u.ikincil = 'debug derlemesi';
    else if (u.tur === 'paket' && klasorler.length && !klasorler.some(k => CIKTI_KLASOR.has(k))) u.ikincil = 'arşiv';
  }
  // Aynı boyuttaki aynı tür dosyalar kopyadır: en sığ yoldaki asıl sayılır.
  const boyutGrubu = new Map();
  for (const u of urunler) {
    const k = `${u.tur}|${u.boyut}`;
    boyutGrubu.set(k, [...(boyutGrubu.get(k) || []), u]);
  }
  for (const grup of boyutGrubu.values()) if (grup.length > 1) {
    const derinlik = u => u.yol.split('/').length + (u.ikincil ? 100 : 0);
    const asil = grup.reduce((a, b) => (derinlik(b) < derinlik(a) ? b : a));
    for (const u of grup) if (u !== asil && !u.ikincil) u.ikincil = 'kopya';
  }
  // Sürüm numarası dışında aynı adlı dosyalardan yalnızca en yeni sürüm asıldır.
  const surumGrubu = new Map();
  for (const u of urunler) if (!u.ikincil && SURUM.test(u.ad)) {
    const k = `${u.tur}|${path.posix.dirname(u.yol)}|${surumAnahtari(u.ad)}`;
    surumGrubu.set(k, [...(surumGrubu.get(k) || []), u]);
  }
  for (const grup of surumGrubu.values()) if (grup.length > 1) {
    const yeni = grup.reduce((a, b) => (surumKarsilastir(b.ad, a.ad) > 0 ? b : a));
    for (const u of grup) if (u !== yeni) u.ikincil = 'eski sürüm';
  }
}

const urunOnbellek = new Map(); // proje kimliği → { zaman, urunler }

export async function urunleriListele(proje, { taze = false, gizliler = false } = {}) {
  let k = urunOnbellek.get(proje.kimlik);
  if (taze || !k || Date.now() - k.zaman > 60e3) {
    const hepsi = await projeleriListele({ gizliler: true });
    const altProjeler = hepsi.filter(p => icinde(proje.yol, p.yol)).map(p => p.yol);
    k = { zaman: Date.now(), urunler: await tara(proje, altProjeler) };
    urunOnbellek.set(proje.kimlik, k);
  }
  const gizli = new Set(ayar.gizliUrunler[proje.kimlik] || []);
  const liste = k.urunler.map(u => ({ ...u, gizli: gizli.has(u.yol) }));
  return gizliler ? liste : liste.filter(u => !u.gizli);
}

/** Bir ya da birkaç ürünü gizler / yeniden gösterir (`yollar` dizi ya da tek yol). */
export function urunGizle(proje, yollar, gizli) {
  ayarYukle();
  const kume = new Set([yollar].flat());
  const liste = (ayar.gizliUrunler[proje.kimlik] || []).filter(y => !kume.has(y));
  if (gizli) liste.push(...kume);
  if (liste.length) ayar.gizliUrunler[proje.kimlik] = liste; else delete ayar.gizliUrunler[proje.kimlik];
  ayarKaydet();
}

/** Proje içindeki göreli yolu güvenle mutlak yola çevirir; proje dışına ya da gizli (.) girdilere çıkışı reddeder. */
export function guvenliYol(proje, goreli) {
  const parcalar = String(goreli).split(/[\\/]+/).filter(Boolean);
  if (parcalar.some(p => p === '..' || p.startsWith('.'))) return null;
  const hedef = path.resolve(proje.yol, ...parcalar);
  if (hedef !== path.resolve(proje.yol) && !icinde(proje.yol, hedef)) return null;
  try {
    // Bağlantılarla (symlink/junction) dışarı çıkışı engelle.
    const gercek = fs.realpathSync(hedef);
    const kok = fs.realpathSync(proje.yol);
    if (gercek !== kok && !icinde(kok, gercek)) return null;
    return gercek;
  } catch { return null; }
}

// ---------- dosya gezgini (yalnızca okuma) ----------
// İçerik kumanda kökenine yalnızca JSON içinde metin (ya da resim için base64) olarak gider; arayüz onu metin olarak
// çizer, hiçbir zaman belge/betik olarak yorumlamaz. Dosyayı tarayıcıda "açmak" yine ürün kökeninden (/ac) yapılır.
const KLASOR_SINIR = 3000, METIN_SINIR = 1e6, RESIM_SINIR = 5e6;
const RESIM_TURU = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
  '.bmp': 'image/bmp', '.ico': 'image/x-icon', '.svg': 'image/svg+xml', '.avif': 'image/avif' };
const IKILI = /\.(exe|dll|apk|aab|zip|7z|rar|gz|tgz|jar|class|so|o|obj|pdb|bin|dat|db|sqlite|mp4|mov|mkv|webm|mp3|wav|ogg|flac|pdf|docx?|xlsx?|pptx?|ttf|otf|woff2?|psd|keystore|jks|msi|iso)$/i;
const adSirala = (a, b) => (b.klasor - a.klasor) || a.ad.localeCompare(b.ad, 'tr', { numeric: true, sensitivity: 'base' });

/** Proje içindeki bir klasörün girdileri: klasörler önce, VS Code gibi ada göre. Gizli (.) girdiler gösterilmez. */
export async function klasorListele(proje, goreli = '') {
  const dizin = guvenliYol(proje, goreli);
  if (!dizin || !(await klasorMu(dizin))) return null;
  const taban = String(goreli).split(/[\\/]+/).filter(Boolean).join('/');
  const girdiler = (await fsp.readdir(dizin, { withFileTypes: true })).filter(g => !g.name.startsWith('.'));
  const kesildi = girdiler.length > KLASOR_SINIR;
  const liste = (await Promise.all(girdiler.slice(0, KLASOR_SINIR).map(async g => {
    const yol = taban ? `${taban}/${g.name}` : g.name;
    let hedef = path.join(dizin, g.name);
    if (g.isSymbolicLink()) { hedef = guvenliYol(proje, yol); if (!hedef) return null; } // dışarı çıkan bağlantılar gösterilmez
    try {
      const s = await fsp.stat(hedef);
      return { ad: g.name, yol, klasor: s.isDirectory(), boyut: s.isDirectory() ? 0 : s.size, zaman: s.mtimeMs };
    } catch { return null; }
  }))).filter(Boolean).sort(adSirala);
  return { yol: taban, girdiler: liste, kesildi };
}

/** Dosyayı görüntülemek için okur: metin (en çok 1 MB), resim (base64, en çok 5 MB) ya da yalnızca bilgi (ikili). */
export async function dosyaOku(proje, goreli) {
  const dosya = guvenliYol(proje, goreli);
  if (!dosya) return null;
  let s;
  try { s = await fsp.stat(dosya); } catch { return null; }
  if (!s.isFile()) return null;
  const bilgi = { ad: path.basename(dosya), yol: String(goreli).split(/[\\/]+/).filter(Boolean).join('/'), boyut: s.size, zaman: s.mtimeMs };
  const uzanti = path.extname(dosya).toLowerCase();
  if (RESIM_TURU[uzanti]) {
    if (s.size > RESIM_SINIR) return { ...bilgi, tur: 'ikili', neden: 'Resim çok büyük' };
    return { ...bilgi, tur: 'resim', mime: RESIM_TURU[uzanti], veri: (await fsp.readFile(dosya)).toString('base64') };
  }
  if (IKILI.test(uzanti)) return { ...bilgi, tur: 'ikili' };
  const el = await fsp.open(dosya, 'r');
  let tampon;
  try {
    tampon = Buffer.alloc(Math.min(s.size, METIN_SINIR));
    tampon = tampon.subarray(0, (await el.read(tampon, 0, tampon.length, 0)).bytesRead);
  } finally { await el.close(); }
  let metin;
  const cift = () => tampon.subarray(2, tampon.length - (tampon.length % 2));
  if (tampon[0] === 0xff && tampon[1] === 0xfe) metin = cift().toString('utf16le'); // Windows PowerShell çıktıları
  else if (tampon[0] === 0xfe && tampon[1] === 0xff) metin = Buffer.from(cift()).swap16().toString('utf16le');
  else {
    if (tampon.subarray(0, 8000).includes(0)) return { ...bilgi, tur: 'ikili' };
    metin = tampon.toString('utf8').replace(/^﻿/, '');
  }
  return { ...bilgi, tur: 'metin', metin, kesildi: s.size > METIN_SINIR };
}
