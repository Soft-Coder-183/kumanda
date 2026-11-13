// Bağımlılıksız küçük HTTP yardımcıları.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

const MIME = {
  '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8', '.map': 'application/json',
  '.txt': 'text/plain; charset=utf-8', '.md': 'text/plain; charset=utf-8', '.csv': 'text/csv; charset=utf-8',
  '.xml': 'application/xml', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.ico': 'image/x-icon', '.avif': 'image/avif',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.otf': 'font/otf',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime', '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.wasm': 'application/wasm', '.pdf': 'application/pdf',
  '.apk': 'application/vnd.android.package-archive', '.exe': 'application/vnd.microsoft.portable-executable',
  '.msi': 'application/x-msi', '.zip': 'application/zip',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};
export const mime = dosya => MIME[path.extname(dosya).toLowerCase()] || 'application/octet-stream';

export class HttpHata extends Error {
  constructor(kod, mesaj) { super(mesaj); this.kod = kod; }
}

export async function govdeOku(req, sinir = 30e6) {
  const parcalar = [];
  let toplam = 0;
  for await (const p of req) {
    toplam += p.length;
    if (toplam > sinir) throw new HttpHata(413, 'İstek çok büyük');
    parcalar.push(p);
  }
  return Buffer.concat(parcalar);
}

export async function jsonOku(req, sinir) {
  const govde = await govdeOku(req, sinir);
  if (!govde.length) return {};
  try { return JSON.parse(govde.toString('utf8')); } catch { throw new HttpHata(400, 'Geçersiz JSON'); }
}

export function json(res, kod, veri, baslik = {}) {
  const govde = JSON.stringify(veri);
  res.writeHead(kod, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...baslik });
  res.end(govde);
}

export function duzMetin(res, kod, m, baslik = {}) {
  res.writeHead(kod, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', ...baslik });
  res.end(m);
}

export function yonlendir(res, hedef, baslik = {}) {
  res.writeHead(302, { Location: hedef, 'Cache-Control': 'no-store', ...baslik });
  res.end();
}

export function cerezler(req) {
  const sonuc = {};
  for (const parca of (req.headers.cookie || '').split(';')) {
    const i = parca.indexOf('=');
    if (i > 0) sonuc[parca.slice(0, i).trim()] = decodeURIComponent(parca.slice(i + 1).trim());
  }
  return sonuc;
}

export function cerezYaz(ad, deger, { gun = 30, guvenli = false, sil = false } = {}) {
  const parcalar = [`${ad}=${sil ? '' : encodeURIComponent(deger)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax',
    `Max-Age=${sil ? 0 : gun * 86400}`];
  if (guvenli) parcalar.push('Secure');
  return parcalar.join('; ');
}

const yerelAd = ad => ad === 'localhost' || ad === '127.0.0.1' || ad === '[::1]';

/** İsteğin dışarıdan nasıl göründüğü: tünel arkasında mı, hangi host, https mi. */
export function istekBilgisi(req) {
  const host = req.headers.host || '';
  let adres;
  try { adres = new URL(`http://${host}`); } catch { adres = new URL('http://gecersiz'); }
  const vekilli = Boolean(req.headers['x-forwarded-for'] || req.headers.forwarded || req.headers['cf-connecting-ip']);
  const uzak = req.socket.remoteAddress || '';
  const dongu = uzak === '127.0.0.1' || uzak === '::1' || uzak === '::ffff:127.0.0.1';
  const https = (req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https'
    || (vekilli && !adres.port && !yerelAd(adres.hostname));
  return {
    host, hostAdi: adres.hostname, port: adres.port, https,
    // "Bu bilgisayarın başında": tünelden gelmeyen, localhost adına yapılmış döngü bağlantısı.
    yerel: dongu && !vekilli && yerelAd(adres.hostname),
    istemci: vekilli ? String(req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for']).split(',')[0].trim() : uzak,
  };
}

/** Dosyayı Range / ETag / HEAD desteğiyle gönderir. */
export async function dosyaGonder(req, res, dosya, { indir = false, onbellek = 'no-cache', baslik = {} } = {}) {
  let st;
  try { st = await fsp.stat(dosya); } catch { return duzMetin(res, 404, 'Bulunamadı'); }
  if (!st.isFile()) return duzMetin(res, 404, 'Bulunamadı');
  const etag = `"${st.size.toString(36)}-${Math.floor(st.mtimeMs).toString(36)}"`;
  const ortak = {
    'Content-Type': mime(dosya), 'Accept-Ranges': 'bytes', ETag: etag, 'Cache-Control': onbellek,
    'Last-Modified': st.mtime.toUTCString(), 'X-Content-Type-Options': 'nosniff', ...baslik,
  };
  if (indir) {
    const ad = path.basename(dosya);
    ortak['Content-Disposition'] = `attachment; filename="${ad.replace(/[^\x20-\x7e]|["\\]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(ad)}`;
  }
  if (req.headers['if-none-match'] === etag && !req.headers.range) { res.writeHead(304, ortak); return res.end(); }

  let bas = 0, son = st.size - 1, kod = 200;
  const aralik = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
  if (aralik && st.size > 0) {
    if (aralik[1] === '' && aralik[2] !== '') { bas = Math.max(0, st.size - Number(aralik[2])); }
    else { bas = Number(aralik[1]); if (aralik[2] !== '') son = Math.min(son, Number(aralik[2])); }
    if (!(bas <= son) || bas >= st.size) {
      res.writeHead(416, { 'Content-Range': `bytes */${st.size}` }); return res.end();
    }
    kod = 206;
    ortak['Content-Range'] = `bytes ${bas}-${son}/${st.size}`;
  }
  ortak['Content-Length'] = st.size === 0 ? 0 : son - bas + 1;
  res.writeHead(kod, ortak);
  if (req.method === 'HEAD' || st.size === 0) return res.end();
  const akis = fs.createReadStream(dosya, { start: bas, end: son });
  akis.on('error', () => res.destroy());
  akis.pipe(res);
}

/** '/api/proje/:id/urunler' biçiminde desenlerle basit yönlendirici. */
export class Yonlendirici {
  #yollar = [];
  ekle(yontem, desen, isleyici, secenek = {}) {
    const adlar = [];
    const ifade = new RegExp('^' + desen.replace(/:(\w+)/g, (_, ad) => { adlar.push(ad); return '([^/]+)'; }) + '$');
    this.#yollar.push({ yontem, ifade, adlar, isleyici, secenek });
  }
  bul(yontem, yol) {
    let yolVar = false;
    for (const y of this.#yollar) {
      const m = y.ifade.exec(yol);
      if (!m) continue;
      yolVar = true;
      if (y.yontem !== yontem) continue;
      const p = {};
      y.adlar.forEach((ad, i) => { p[ad] = decodeURIComponent(m[i + 1]); });
      return { isleyici: y.isleyici, secenek: y.secenek, p };
    }
    return yolVar ? { yontemYok: true } : null;
  }
}
