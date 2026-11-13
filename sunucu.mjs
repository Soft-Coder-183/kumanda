#!/usr/bin/env node
// Kumanda: yerel Claude Code'u ve proje ürünlerini her cihazdan kullanmak için iki küçük HTTP sunucusu.
//   kumanda (7777): arayüz + API. Sohbet, izinler, proje/ürün listeleri.
//   ürün    (7778): proje klasörlerindeki ürün dosyalarını AYRI bir kökenden sunar; böylece bir ürün
//                   sayfasındaki betik kumanda API'sine (yani Claude'a) erişemez.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { ayar, ayarIzle, ayarKaydet, ayarYukle, atomikYaz, KOK, VERI } from './src/ayar.mjs';
import { HttpHata, Yonlendirici, cerezler, cerezYaz, dosyaGonder, duzMetin, istekBilgisi, json, jsonOku, yonlendir } from './src/http.mjs';
import * as kimlik from './src/kimlik.mjs';
import { guvenliYol, oturumDosyasi, oturumlariListele, projeBul, projeGizle, projeleriListele, urunGizle, urunleriListele } from './src/projeler.mjs';
import { MODELLER, MODLAR, bildirimciAyarla, gecmisOku, gonder, hepsiniKapat, kosuBul, kosuListesi } from './src/oturumlar.mjs';
import * as bildirim from './src/bildirim.mjs';

const SURUM = JSON.parse(fs.readFileSync(path.join(KOK, 'package.json'), 'utf8')).version;
const WEB = path.join(KOK, 'web');
const YEREL_ANAHTAR_DOSYA = path.join(VERI, 'yerel-anahtar');
const yerelAdres = () => `http://127.0.0.1:${ayar.kumandaPort}`;

// ───────────── komut satırı ─────────────
const bayrak = process.argv[2];
if (bayrak === '--arkaplan') {
  // Penceresiz, bu terminalden bağımsız bir kopya başlat (oturum açılışındaki kısayol bunu kullanır).
  const gunluk = path.join(VERI, 'gunluk.txt');
  try { if (fs.statSync(gunluk).size > 2e6) fs.renameSync(gunluk, gunluk + '.eski'); } catch { /* yok */ }
  const cikti = fs.openSync(gunluk, 'a');
  spawn(process.execPath, [import.meta.filename], { detached: true, windowsHide: true, stdio: ['ignore', cikti, cikti], cwd: KOK }).unref();
  process.exit(0);
} else if (bayrak === '--durdur' || bayrak === '--durum') {
  try {
    if (bayrak === '--durdur') {
      const r = await fetch(`${yerelAdres()}/api/yerel/kapat`, { method: 'POST', headers: { 'X-Kumanda': '1', 'X-Yerel-Anahtar': fs.readFileSync(YEREL_ANAHTAR_DOSYA, 'utf8') } });
      console.log(r.ok ? 'Kumanda durduruldu.' : `Durdurulamadı (${r.status}).`);
    } else {
      const d = await (await fetch(`${yerelAdres()}/api/durum`)).json();
      console.log(`Kumanda ${d.surum} çalışıyor: ${yerelAdres()}  (şifre ${d.kurulu ? 'belirlenmiş' : 'BELİRLENMEMİŞ'})`);
    }
  } catch { console.log('Kumanda çalışmıyor.'); process.exitCode = bayrak === '--durum' ? 1 : 0; }
  process.exit();
} else if (bayrak === '--portlar') {
  console.log(`${ayar.kumandaPort} ${ayar.urunPort}`); // kurulum betikleri için
  process.exit(0);
} else if (bayrak === '--sifre-sifirla') {
  kimlik.sifreSifirla();
  console.log(`Şifre ve bütün cihaz oturumları silindi. Yeni şifreyi bu bilgisayardan belirle: ${yerelAdres()}`);
  process.exit(0);
}

// ───────────── ortak ─────────────
const KUMANDA_CEREZ = 'kumanda_o', URUN_CEREZ = 'kumanda_u', SON_CEREZ = 'kumanda_son';
const GUVENLIK = {
  'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin', 'X-Frame-Options': 'DENY',
  'Content-Security-Policy': "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
};

function urunKokeni(bilgi) {
  const ozel = ayar.kamu?.[bilgi.host];
  if (ozel) return String(ozel).replace(/\/$/, '');
  // Tailscale serve/funnel düzeni: 443 → kumanda, 8443 → ürün (uzak-kur.ps1 böyle kurar).
  if (bilgi.https && !bilgi.port) return `https://${bilgi.hostAdi}:8443`;
  return `${bilgi.https ? 'https' : 'http'}://${bilgi.hostAdi}:${ayar.urunPort}`;
}

/** Tarayıcıdan gelen API isteği gerçekten kumanda arayüzünden mi? (ürün sayfaları ve başka siteler reddedilir) */
function kokenUygun(req) {
  const site = req.headers['sec-fetch-site'];
  if (site && site !== 'same-origin' && site !== 'none') return false;
  const koken = req.headers.origin;
  if (koken) { try { if (new URL(koken).host !== req.headers.host) return false; } catch { return false; } }
  return true;
}

async function projeAl(kimligi) {
  const p = await projeBul(kimligi);
  if (!p) throw new HttpHata(404, 'Proje bulunamadı');
  return p;
}
function kosuAl(oturum) {
  const k = kosuBul(oturum);
  if (!k) throw new HttpHata(404, 'Bu oturum şu an çalışmıyor');
  return k;
}
const projeOzeti = p => ({ kimlik: p.kimlik, ad: p.ad, yol: p.yol, oturumSayisi: p.oturumSayisi, sonEtkinlik: p.sonEtkinlik, gizli: p.gizli });

// ───────────── API ─────────────
const api = new Yonlendirici();
const acik = { acik: true };

api.ekle('GET', '/api/durum', ({ req, res, bilgi }) => json(res, 200, {
  surum: SURUM, kurulu: kimlik.sifreVar(), yerel: bilgi.yerel, enAzSifre: kimlik.EN_AZ_SIFRE,
  giris: Boolean(kimlik.oturumBul(cerezler(req)[KUMANDA_CEREZ], 'kumanda')),
}), acik);

function girisYap(req, res, bilgi) {
  const jeton = kimlik.oturumAc('kumanda', kimlik.cihazAdi(req.headers['user-agent']));
  json(res, 200, { tamam: true }, { 'Set-Cookie': cerezYaz(KUMANDA_CEREZ, jeton, { guvenli: bilgi.https }) });
}

api.ekle('POST', '/api/kurulum', async ({ req, res, bilgi }) => {
  if (kimlik.sifreVar()) throw new HttpHata(409, 'Şifre zaten belirlenmiş');
  // İlk şifre yalnızca bilgisayarın başından konabilir; tünelden gelen kimse sistemi sahiplenemez.
  if (!bilgi.yerel) throw new HttpHata(403, 'İlk şifre yalnızca bilgisayarın kendisinden (localhost) belirlenebilir');
  const { sifre } = await jsonOku(req, 4096);
  try { await kimlik.sifreBelirle(sifre); } catch (e) { throw new HttpHata(400, e.message); }
  girisYap(req, res, bilgi);
}, acik);

api.ekle('POST', '/api/giris', async ({ req, res, bilgi }) => {
  if (!kimlik.sifreVar()) throw new HttpHata(409, 'Önce bilgisayardan şifre belirlenmeli');
  const izin = kimlik.girisIzni(bilgi.istemci);
  if (!izin.izin) throw new HttpHata(429, `Çok fazla hatalı deneme. ${Math.ceil(izin.bekle / 60)} dakika sonra yeniden dene.`);
  const { sifre } = await jsonOku(req, 4096);
  if (!(await kimlik.sifreDogrula(sifre))) {
    kimlik.girisBasarisiz(bilgi.istemci);
    throw new HttpHata(401, 'Şifre yanlış');
  }
  kimlik.girisBasarili(bilgi.istemci);
  girisYap(req, res, bilgi);
}, acik);

api.ekle('POST', '/api/cikis', ({ req, res, bilgi }) => {
  kimlik.oturumKapat(cerezler(req)[KUMANDA_CEREZ]);
  json(res, 200, { tamam: true }, { 'Set-Cookie': cerezYaz(KUMANDA_CEREZ, '', { sil: true, guvenli: bilgi.https }) });
});

api.ekle('POST', '/api/sifre', async ({ req, res, bilgi }) => {
  const izin = kimlik.girisIzni(bilgi.istemci);
  if (!izin.izin) throw new HttpHata(429, 'Çok fazla hatalı deneme. Daha sonra yeniden dene.');
  const { eski, yeni } = await jsonOku(req, 4096);
  if (!(await kimlik.sifreDogrula(eski))) { kimlik.girisBasarisiz(bilgi.istemci); throw new HttpHata(401, 'Eski şifre yanlış'); }
  try { await kimlik.sifreBelirle(yeni); } catch (e) { throw new HttpHata(400, e.message); }
  json(res, 200, { tamam: true });
});

api.ekle('GET', '/api/cihazlar', ({ res, oturum }) => json(res, 200, { cihazlar: kimlik.cihazListesi(oturum.anahtar) }));
api.ekle('POST', '/api/cihazlar/kapat', async ({ req, res, oturum }) => {
  const { kimlik: kisa, digerleri } = await jsonOku(req, 4096);
  if (digerleri) {
    for (const c of kimlik.cihazListesi(oturum.anahtar)) if (!c.bu) kimlik.cihazKapat(kimlik.cihazAnahtari(c.kimlik));
  } else {
    const anahtar = typeof kisa === 'string' && kisa.length === 16 ? kimlik.cihazAnahtari(kisa) : null;
    if (!anahtar) throw new HttpHata(404, 'Cihaz bulunamadı');
    kimlik.cihazKapat(anahtar);
  }
  json(res, 200, { tamam: true });
});

api.ekle('GET', '/api/projeler', async ({ res, url }) => {
  const projeler = await projeleriListele({ gizliler: url.searchParams.has('gizliler') });
  const canli = kosuListesi();
  const liste = await Promise.all(projeler.map(async p => {
    const urunler = await urunleriListele(p);
    return { ...projeOzeti(p), urunSayisi: urunler.filter(u => !u.ikincil).length, canli: canli.filter(k => k.proje === p.kimlik).map(k => k.durum) };
  }));
  json(res, 200, { projeler: liste });
});

api.ekle('GET', '/api/urunler', async ({ res }) => {
  const projeler = await projeleriListele();
  const gruplar = [];
  for (const p of projeler) {
    const urunler = await urunleriListele(p);
    if (urunler.length) gruplar.push({ proje: projeOzeti(p), urunler });
  }
  json(res, 200, { gruplar });
});

api.ekle('POST', '/api/proje-ekle', async ({ req, res }) => {
  const { yol } = await jsonOku(req, 4096);
  if (typeof yol !== 'string' || !path.isAbsolute(yol) || !fs.existsSync(yol) || !fs.statSync(yol).isDirectory()) {
    throw new HttpHata(400, 'Bu bilgisayarda böyle bir klasör yok (tam yol yazılmalı)');
  }
  ayarYukle();
  if (!ayar.ekProjeler.some(y => path.resolve(y).toLowerCase() === path.resolve(yol).toLowerCase())) ayar.ekProjeler.push(path.resolve(yol));
  ayarKaydet();
  const p = (await projeleriListele({ taze: true, gizliler: true })).find(x => x.yol.toLowerCase() === path.resolve(yol).toLowerCase());
  json(res, 200, { proje: p ? projeOzeti(p) : null });
});

api.ekle('GET', '/api/proje/:pid', async ({ res, p }) => {
  const proje = await projeAl(p.pid);
  const canli = new Map(kosuListesi().filter(k => k.proje === proje.kimlik).map(k => [k.oturum, k.durum]));
  const oturumlar = (await oturumlariListele(proje)).map(o => ({ kimlik: o.kimlik, baslik: o.baslik, zaman: o.zaman, canli: canli.get(o.kimlik) || null }));
  // Henüz transkripti yazılmamış yeni canlı oturumlar da listede görünsün.
  for (const [oturum, durum] of canli) if (!oturumlar.some(o => o.kimlik === oturum)) oturumlar.unshift({ kimlik: oturum, baslik: 'Yeni sohbet', zaman: Date.now(), canli: durum });
  json(res, 200, { proje: projeOzeti(proje), oturumlar });
});

api.ekle('POST', '/api/proje/:pid/gizle', async ({ req, res, p }) => {
  const proje = await projeAl(p.pid);
  projeGizle(proje.kimlik, Boolean((await jsonOku(req, 4096)).gizli));
  json(res, 200, { tamam: true });
});

api.ekle('GET', '/api/proje/:pid/urunler', async ({ res, p, url }) => {
  const proje = await projeAl(p.pid);
  json(res, 200, { urunler: await urunleriListele(proje, { taze: url.searchParams.has('taze'), gizliler: url.searchParams.has('gizliler') }) });
});

api.ekle('POST', '/api/proje/:pid/urun-gizle', async ({ req, res, p }) => {
  const proje = await projeAl(p.pid);
  const { yol, gizli } = await jsonOku(req, 4096);
  if (typeof yol !== 'string') throw new HttpHata(400, 'Yol gerekli');
  urunGizle(proje, yol, Boolean(gizli));
  json(res, 200, { tamam: true });
});

api.ekle('GET', '/api/proje/:pid/oturum/:sid', async ({ res, p }) => {
  const proje = await projeAl(p.pid);
  const k = kosuBul(p.sid);
  const dosya = await oturumDosyasi(proje, p.sid);
  if (!dosya && !k) throw new HttpHata(404, 'Oturum bulunamadı');
  const gecmis = dosya ? await gecmisOku(dosya, k ? k.gecmisSinir : Infinity) : { ogeler: [], kirpildi: false };
  json(res, 200, { ...gecmis, canli: k ? k.anlik() : null });
});

const RESIM_TURLERI = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
api.ekle('POST', '/api/proje/:pid/gonder', async ({ req, res, p }) => {
  const proje = await projeAl(p.pid);
  const g = await jsonOku(req);
  const metin = typeof g.metin === 'string' ? g.metin.trim() : '';
  const resimler = Array.isArray(g.resimler) ? g.resimler.slice(0, 8) : [];
  for (const r of resimler) {
    if (!r || !RESIM_TURLERI.has(r.tur) || typeof r.veri !== 'string' || r.veri.length > 7e6 || /[^A-Za-z0-9+/=]/.test(r.veri)) throw new HttpHata(400, 'Geçersiz resim');
  }
  if (!metin && !resimler.length) throw new HttpHata(400, 'Boş istem');
  if (g.oturum != null && !/^[0-9a-f-]{36}$/i.test(g.oturum)) throw new HttpHata(400, 'Geçersiz oturum');
  if (g.mod != null && !MODLAR.includes(g.mod)) throw new HttpHata(400, 'Geçersiz mod');
  if (g.model != null && !MODELLER.includes(g.model)) throw new HttpHata(400, 'Geçersiz model');
  let k;
  try { k = await gonder(proje, { oturum: g.oturum || null, metin, resimler, mod: g.mod, model: g.model }); }
  catch (e) { throw new HttpHata(e.message === 'Oturum bulunamadı' ? 404 : 500, e.message); }
  json(res, 200, { oturum: k.oturum, nesil: k.nesil });
});

api.ekle('GET', '/api/oturum/:sid/akis', ({ req, res, p, url }) => {
  const k = kosuAl(p.sid);
  res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', 'X-Accel-Buffering': 'no', Connection: 'keep-alive' });
  res.write('retry: 2000\n\n');
  k.abone(res, req.headers['last-event-id'] || url.searchParams.get('sonra') || '');
  const nabiz = setInterval(() => res.write(': nabız\n\n'), 20000);
  res.on('close', () => clearInterval(nabiz));
});

api.ekle('POST', '/api/oturum/:sid/izin', async ({ req, res, p }) => {
  const k = kosuAl(p.sid);
  const g = await jsonOku(req, 200000);
  if (!['izin', 'hep', 'red'].includes(g.karar)) throw new HttpHata(400, 'Geçersiz karar');
  if (!k.izinYanitla(String(g.istek), g)) throw new HttpHata(409, 'Bu istek artık beklemiyor');
  json(res, 200, { tamam: true });
});

api.ekle('POST', '/api/oturum/:sid/kes', async ({ res, p }) => { await kosuAl(p.sid).kes(); json(res, 200, { tamam: true }); });
api.ekle('POST', '/api/oturum/:sid/kapat', ({ res, p }) => { kosuAl(p.sid).kapat(); json(res, 200, { tamam: true }); });
api.ekle('POST', '/api/oturum/:sid/mod', async ({ req, res, p }) => {
  const k = kosuAl(p.sid);
  const g = await jsonOku(req, 4096);
  try {
    if (g.mod != null) await k.modAyarla(g.mod);
    if (g.model != null) await k.modelAyarla(g.model);
  } catch (e) { throw new HttpHata(400, e.message); }
  json(res, 200, k.anlik());
});

api.ekle('GET', '/api/kosular', ({ res }) => json(res, 200, { kosular: kosuListesi() }));

// bildirimler
api.ekle('GET', '/api/bildirim/anahtar', ({ res }) => json(res, 200, { anahtar: bildirim.acikAnahtar(), abone: bildirim.aboneSayisi() }));
api.ekle('POST', '/api/bildirim/abone', async ({ req, res, oturum }) => {
  const { ucNokta } = await jsonOku(req, 8192);
  try { bildirim.aboneEkle(oturum.anahtar, String(ucNokta)); } catch (e) { throw new HttpHata(400, e.message); }
  json(res, 200, { tamam: true });
});
api.ekle('POST', '/api/bildirim/abonelik-sil', async ({ req, res }) => {
  bildirim.aboneSil(String((await jsonOku(req, 8192)).ucNokta));
  json(res, 200, { tamam: true });
});
api.ekle('GET', '/api/bildirim/son', ({ res }) => json(res, 200, { bildirim: bildirim.sonBildirim() }));
api.ekle('POST', '/api/bildirim/dene', async ({ res }) => {
  const sonuclar = await bildirim.bildir({ baslik: 'Kumanda', govde: 'Bildirimler çalışıyor.', url: '/', etiket: 'deneme' }, cihazGecerli);
  json(res, 200, { sonuclar });
});

api.ekle('POST', '/api/yerel/kapat', ({ req, res, bilgi }) => {
  const anahtar = String(req.headers['x-yerel-anahtar'] || '');
  if (!bilgi.yerel || anahtar.length !== yerelAnahtar.length || !crypto.timingSafeEqual(Buffer.from(anahtar), Buffer.from(yerelAnahtar))) throw new HttpHata(403, 'Yalnızca bu bilgisayardan');
  json(res, 200, { tamam: true });
  setTimeout(kapan, 100);
}, acik);

const cihazGecerli = anahtar => kimlik.cihazListesi().some(c => anahtar.startsWith(c.kimlik));
bildirimciAyarla(({ tur, proje, oturum, metin }) => {
  const baslik = tur === 'izin' ? `${proje.ad}: izin bekliyor` : tur === 'hata' ? `${proje.ad}: hata` : `${proje.ad}: Claude bitirdi`;
  bildirim.bildir({ baslik, govde: metin, url: `/#/p/${proje.kimlik}/s/${oturum}`, etiket: oturum }, cihazGecerli).catch(() => {});
});

// ───────────── kumanda sunucusu ─────────────
const STATIK = new Set(['/index.html', '/uygulama.js', '/stil.css', '/sw.js', '/manifest.webmanifest', '/ikon-192.png', '/ikon-512.png', '/ikon.svg']);

async function kumandaIstek(req, res) {
  const url = new URL(req.url, 'http://x');
  const yol = url.pathname;
  const bilgi = istekBilgisi(req);
  for (const [k, v] of Object.entries(GUVENLIK)) res.setHeader(k, v);

  if (yol.startsWith('/api/')) {
    if (!kokenUygun(req)) return json(res, 403, { hata: 'Köken reddedildi' });
    if (req.method !== 'GET' && req.headers['x-kumanda'] !== '1') return json(res, 403, { hata: 'Eksik başlık' });
    const e = api.bul(req.method, yol);
    if (!e) return json(res, 404, { hata: 'Bulunamadı' });
    if (e.yontemYok) return json(res, 405, { hata: 'Yöntem desteklenmiyor' });
    let oturum = null;
    if (!e.secenek.acik) {
      oturum = kimlik.oturumBul(cerezler(req)[KUMANDA_CEREZ], 'kumanda');
      if (!oturum) return json(res, 401, { hata: 'Giriş gerekli' });
    }
    return e.isleyici({ req, res, p: e.p, url, bilgi, oturum });
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') return duzMetin(res, 405, 'Yöntem desteklenmiyor');

  if (yol === '/ac') {
    // Ürünü aç: tek kullanımlık biletle ürün kökenine geç (orada kendi çerezi kurulur).
    const oturum = kimlik.oturumBul(cerezler(req)[KUMANDA_CEREZ], 'kumanda');
    if (!oturum) return yonlendir(res, '/');
    const proje = await projeBul(url.searchParams.get('p') || '');
    const goreli = url.searchParams.get('y') || '';
    if (!proje || !guvenliYol(proje, goreli)) return duzMetin(res, 404, 'Ürün bulunamadı');
    const hedef = `/p/${proje.kimlik}/${goreli.split('/').map(encodeURIComponent).join('/')}${url.searchParams.has('indir') ? '?indir=1' : ''}`;
    return yonlendir(res, `${urunKokeni(bilgi)}/_ac?b=${kimlik.biletVer(oturum.anahtar)}&git=${encodeURIComponent(hedef)}`);
  }

  const dosya = yol === '/' ? '/index.html' : yol;
  if (!STATIK.has(dosya)) return duzMetin(res, 404, 'Bulunamadı');
  return dosyaGonder(req, res, path.join(WEB, dosya), dosya === '/sw.js' ? { baslik: { 'Service-Worker-Allowed': '/' } } : {});
}

// ───────────── ürün sunucusu ─────────────
const INDIRILEN = new Set(['.apk', '.exe', '.msi', '.zip']);
const URUN_YOLU = /^\/p\/([0-9a-f]{12})\/(.*)$/;
/** 'a/b/c.html' → 'a/b', 'a/b/' → 'a/b', 'c.html' → '' */
const klasorAdi = goreli => {
  if (goreli.endsWith('/')) return goreli.replace(/\/+$/, '');
  const k = path.posix.dirname(goreli);
  return k === '.' || k === '/' ? '' : k;
};

async function urunDosyasiBul(proje, goreli) {
  let hedef = guvenliYol(proje, goreli);
  if (!hedef) return null;
  try {
    if (fs.statSync(hedef).isDirectory()) hedef = path.join(hedef, 'index.html');
    return fs.statSync(hedef).isFile() ? hedef : null;
  } catch { return null; }
}

async function urunIstek(req, res) {
  const url = new URL(req.url, 'http://x');
  let yol;
  try { yol = decodeURIComponent(url.pathname); } catch { return duzMetin(res, 400, 'Geçersiz adres'); }
  const bilgi = istekBilgisi(req);
  res.setHeader('X-Robots-Tag', 'noindex');
  if (req.method !== 'GET' && req.method !== 'HEAD') return duzMetin(res, 405, 'Yöntem desteklenmiyor');

  if (yol === '/_ac') {
    const bilet = kimlik.biletKullan(url.searchParams.get('b') || '');
    const git = url.searchParams.get('git') || '';
    if (!bilet || !git.startsWith('/p/')) return duzMetin(res, 403, 'Bağlantının süresi dolmuş. Ürünü Kumanda\'dan yeniden aç.');
    const jeton = kimlik.oturumAc('urun', kimlik.cihazAdi(req.headers['user-agent']), bilet.ebeveyn);
    return yonlendir(res, git, { 'Set-Cookie': cerezYaz(URUN_CEREZ, jeton, { guvenli: bilgi.https }) });
  }

  const c = cerezler(req);
  if (!kimlik.oturumBul(c[URUN_CEREZ], 'urun')) return duzMetin(res, 401, 'Bu ürünü görmek için Kumanda\'ya giriş yapıp ürünü oradan aç.');

  let proje = null, dosya = null;
  const m = URUN_YOLU.exec(yol);
  if (m) {
    proje = await projeBul(m[1]);
    if (proje) dosya = await urunDosyasiBul(proje, m[2]);
  } else {
    // Kök-mutlak yol ("/assets/a.js"): derlenmiş siteler böyle ister. İsteği yapan ürün sayfasının
    // (Referer, yoksa son açılan ürün) klasöründen başlayıp proje köküne doğru ara.
    let kimligi = null, taban = '';
    try {
      const r = URUN_YOLU.exec(decodeURIComponent(new URL(req.headers.referer).pathname));
      if (r) { kimligi = r[1]; taban = klasorAdi(r[2]); }
    } catch { /* Referer yok */ }
    if (!kimligi && /^[0-9a-f]{12}:/.test(c[SON_CEREZ] || '')) { kimligi = c[SON_CEREZ].slice(0, 12); taban = c[SON_CEREZ].slice(13); }
    proje = kimligi ? await projeBul(kimligi) : null;
    for (let t = taban, i = 0; proje && !dosya && i < 12; t = klasorAdi(t), i++) {
      dosya = await urunDosyasiBul(proje, path.posix.join(t, yol));
      if (!t) break;
    }
  }
  if (!proje || !dosya) return duzMetin(res, 404, 'Bulunamadı');

  const uzanti = path.extname(dosya).toLowerCase();
  const baslik = {};
  if (m && (uzanti === '.html' || uzanti === '.htm')) baslik['Set-Cookie'] = cerezYaz(SON_CEREZ, `${proje.kimlik}:${klasorAdi(m[2])}`, { gun: 1, guvenli: bilgi.https });
  return dosyaGonder(req, res, dosya, { indir: url.searchParams.has('indir') || INDIRILEN.has(uzanti), baslik });
}

// ───────────── başlat ─────────────
const sar = isleyici => async (req, res) => {
  try { await isleyici(req, res); } catch (e) {
    if (!(e instanceof HttpHata)) console.error(new Date().toISOString(), req.method, req.url, e);
    if (res.headersSent) return res.destroy();
    json(res, e instanceof HttpHata ? e.kod : 500, { hata: e instanceof HttpHata ? e.message : 'Sunucu hatası' });
  }
};

const yerelAnahtar = crypto.randomBytes(24).toString('hex');
const kumandaSunucu = http.createServer(sar(kumandaIstek));
const urunSunucu = http.createServer(sar(urunIstek));

function kapan() {
  hepsiniKapat();
  kumandaSunucu.close(); urunSunucu.close();
  kumandaSunucu.closeAllConnections(); urunSunucu.closeAllConnections();
  setTimeout(() => process.exit(0), 1500).unref();
}

const dinle = (sunucu, port) => new Promise((coz, reddet) => {
  sunucu.once('error', reddet);
  sunucu.listen(port, ayar.dinle, () => { sunucu.off('error', reddet); coz(); });
});

try {
  await dinle(kumandaSunucu, ayar.kumandaPort);
  await dinle(urunSunucu, ayar.urunPort);
} catch (e) {
  console.error(e.code === 'EADDRINUSE' ? `Port kullanımda (${e.port}): Kumanda zaten çalışıyor olabilir.` : e);
  process.exit(e.code === 'EADDRINUSE' ? 0 : 1);
}
atomikYaz(YEREL_ANAHTAR_DOSYA, yerelAnahtar);
ayarIzle();
process.on('SIGINT', kapan);
process.on('SIGTERM', kapan);
console.log(`${new Date().toISOString()} Kumanda ${SURUM} çalışıyor: http://${ayar.dinle === '0.0.0.0' ? 'localhost' : ayar.dinle}:${ayar.kumandaPort}  (ürünler: ${ayar.urunPort})`);
if (!kimlik.sifreVar()) console.log(`Şifre belirlenmemiş. Bu bilgisayardan aç ve belirle: ${yerelAdres()}`);
