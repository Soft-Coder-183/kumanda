// Web Push (VAPID) ile telefona "bitti / izin bekliyor" bildirimi.
// Bildirim İÇERİKSİZ gönderilir: itme servisine (Google/Mozilla/Apple) yalnızca "uyan" sinyali gider;
// metni servis çalışanı (sw.js) kendi çereziyle /api/bildirim/son adresinden alır. Böylece şifreleme
// kütüphanesi gerekmez ve bildirim metni üçüncü taraflardan geçmez.
import crypto from 'node:crypto';
import path from 'node:path';
import { ayar, atomikYaz, jsonOkuDosya, VERI } from './ayar.mjs';

const DOSYA = path.join(VERI, 'bildirim.json');
let veri = jsonOkuDosya(DOSYA, null);
if (!veri?.ozel) {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const jwk = publicKey.export({ format: 'jwk' });
  veri = {
    ozel: privateKey.export({ type: 'pkcs8', format: 'pem' }),
    acik: Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x, 'base64url'), Buffer.from(jwk.y, 'base64url')]).toString('base64url'),
    aboneler: {}, // uç nokta → { cihaz, zaman }
  };
  kaydet();
}
function kaydet() { atomikYaz(DOSYA, JSON.stringify(veri)); }

export const acikAnahtar = () => veri.acik;

export function aboneEkle(cihaz, ucNokta) {
  let adres;
  try { adres = new URL(ucNokta); } catch { throw new Error('Geçersiz abonelik'); }
  if (adres.protocol !== 'https:') throw new Error('Geçersiz abonelik');
  veri.aboneler[ucNokta] = { cihaz, zaman: Date.now() };
  kaydet();
}
export function aboneSil(ucNokta) { if (veri.aboneler[ucNokta]) { delete veri.aboneler[ucNokta]; kaydet(); } }
export const aboneSayisi = () => Object.keys(veri.aboneler).length;

let son = null;
export const sonBildirim = () => son;

async function it(ucNokta) {
  const adres = new URL(ucNokta);
  const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
  const govde = `${b64({ typ: 'JWT', alg: 'ES256' })}.${b64({ aud: adres.origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: ayar.bildirimIletisim })}`;
  const imza = crypto.sign('sha256', Buffer.from(govde), { key: veri.ozel, dsaEncoding: 'ieee-p1363' }).toString('base64url');
  const yanit = await fetch(ucNokta, {
    method: 'POST',
    headers: { TTL: '3600', Urgency: 'high', 'Content-Length': '0', Authorization: `vapid t=${govde}.${imza}, k=${veri.acik}` },
    signal: AbortSignal.timeout(10000),
  });
  if (yanit.status === 404 || yanit.status === 410) aboneSil(ucNokta); // abonelik iptal edilmiş
  return yanit.status;
}

/** cihazGecerli: oturumu kapatılmış cihazların aboneliklerini ayıklamak için. */
export async function bildir(bildirim, cihazGecerli = () => true) {
  son = { ...bildirim, zaman: Date.now() };
  const sonuclar = [];
  for (const [ucNokta, a] of Object.entries(veri.aboneler)) {
    if (!cihazGecerli(a.cihaz)) { aboneSil(ucNokta); continue; }
    sonuclar.push(it(ucNokta).catch(e => `hata: ${e.message}`));
  }
  return Promise.all(sonuclar);
}
