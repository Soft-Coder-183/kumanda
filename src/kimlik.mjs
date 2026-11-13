// Kimlik: tek şifre (scrypt), cihaz oturumları (çerez), giriş deneme sınırı, ürün kökeni için tek kullanımlık bilet.
import crypto from 'node:crypto';
import path from 'node:path';
import { promisify } from 'node:util';
import { ayar, ayarKaydet, ayarYukle, atomikYaz, jsonOkuDosya, VERI } from './ayar.mjs';

const scrypt = promisify(crypto.scrypt);
const SCRYPT = { N: 2 ** 15, r: 8, p: 1, maxmem: 128 * 1024 * 1024 };
const CIHAZ_DOSYA = path.join(VERI, 'cihazlar.json');
const OMUR = 30 * 86400e3;
export const EN_AZ_SIFRE = 10;

const ozetle = s => crypto.createHash('sha256').update(s).digest('hex');
const rastgele = (n = 32) => crypto.randomBytes(n).toString('base64url');

// ---- şifre ----
export const sifreVar = () => Boolean(ayar.sifre?.ozet);

export async function sifreBelirle(sifre) {
  if (typeof sifre !== 'string' || sifre.length < EN_AZ_SIFRE) throw new Error(`Şifre en az ${EN_AZ_SIFRE} karakter olmalı`);
  const tuz = crypto.randomBytes(16).toString('hex');
  const ozet = (await scrypt(sifre.normalize('NFKC'), tuz, 64, SCRYPT)).toString('hex');
  ayarYukle();
  ayar.sifre = { tuz, ozet };
  ayarKaydet();
}

export async function sifreDogrula(sifre) {
  if (!sifreVar() || typeof sifre !== 'string') return false;
  const aday = await scrypt(sifre.normalize('NFKC'), ayar.sifre.tuz, 64, SCRYPT);
  const gercek = Buffer.from(ayar.sifre.ozet, 'hex');
  return aday.length === gercek.length && crypto.timingSafeEqual(aday, gercek);
}

export function sifreSifirla() {
  ayarYukle();
  ayar.sifre = null;
  ayarKaydet();
  cihazlar = {};
  cihazKaydet();
}

// ---- giriş deneme sınırı ----
const PENCERE = 15 * 60e3, ESIK = 5, GENEL_PENCERE = 3600e3, GENEL_ESIK = 40;
const denemeler = new Map(); // istemci → [zaman]
let genel = [];

export function girisIzni(istemci, simdi = Date.now()) {
  genel = genel.filter(z => simdi - z < GENEL_PENCERE);
  if (genel.length >= GENEL_ESIK) return { izin: false, bekle: Math.ceil((genel[0] + GENEL_PENCERE - simdi) / 1000) };
  const liste = (denemeler.get(istemci) || []).filter(z => simdi - z < PENCERE);
  denemeler.set(istemci, liste);
  if (liste.length >= ESIK) return { izin: false, bekle: Math.ceil((liste[0] + PENCERE - simdi) / 1000) };
  return { izin: true, kalan: ESIK - liste.length };
}
export function girisBasarisiz(istemci, simdi = Date.now()) {
  genel.push(simdi);
  denemeler.set(istemci, [...(denemeler.get(istemci) || []), simdi]);
}
export function girisBasarili(istemci) { denemeler.delete(istemci); }

// ---- cihaz oturumları ----
let cihazlar = jsonOkuDosya(CIHAZ_DOSYA, {}); // sha256(jeton) → { tur, olusturma, son, cihaz, ebeveyn }
let kayitBekliyor = null;
function cihazKaydet() { atomikYaz(CIHAZ_DOSYA, JSON.stringify(cihazlar)); }
function cihazKaydetGecikmeli() {
  if (kayitBekliyor) return;
  kayitBekliyor = setTimeout(() => { kayitBekliyor = null; cihazKaydet(); }, 5000);
  kayitBekliyor.unref();
}

export function cihazAdi(ua = '') {
  const s = /Android/.test(ua) ? 'Android' : /iPhone|iPad|iPod/.test(ua) ? 'iOS' : /Windows/.test(ua) ? 'Windows'
    : /Mac OS X/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : 'Bilinmeyen';
  const t = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome'
    : /Safari\//.test(ua) ? 'Safari' : 'tarayıcı';
  return `${s} · ${t}`;
}

/** tur: 'kumanda' (asıl oturum) ya da 'urun' (ürün kökenindeki çerez; ebeveyni kapanınca o da kapanır). */
export function oturumAc(tur, cihaz, ebeveyn = null) {
  const jeton = rastgele();
  cihazlar[ozetle(jeton)] = { tur, olusturma: Date.now(), son: Date.now(), cihaz, ebeveyn };
  cihazKaydet();
  return jeton;
}

export function oturumBul(jeton, tur) {
  if (!jeton) return null;
  const anahtar = ozetle(jeton);
  const k = cihazlar[anahtar];
  if (!k || k.tur !== tur) return null;
  const simdi = Date.now();
  if (simdi - k.son > OMUR) { delete cihazlar[anahtar]; cihazKaydetGecikmeli(); return null; }
  if (k.ebeveyn && !cihazlar[k.ebeveyn]) { delete cihazlar[anahtar]; cihazKaydetGecikmeli(); return null; }
  if (simdi - k.son > 60e3) { k.son = simdi; cihazKaydetGecikmeli(); }
  return { ...k, anahtar };
}

function anahtarSil(anahtar) {
  delete cihazlar[anahtar];
  for (const [a, k] of Object.entries(cihazlar)) if (k.ebeveyn === anahtar) delete cihazlar[a];
}
export function oturumKapat(jeton) { if (jeton) { anahtarSil(ozetle(jeton)); cihazKaydet(); } }
export function cihazKapat(anahtar) { anahtarSil(anahtar); cihazKaydet(); }
export function hepsiniKapat() { cihazlar = {}; cihazKaydet(); }

export function cihazListesi(benimAnahtar) {
  return Object.entries(cihazlar).filter(([, k]) => k.tur === 'kumanda')
    .map(([a, k]) => ({ kimlik: a.slice(0, 16), cihaz: k.cihaz, olusturma: k.olusturma, son: k.son, bu: a === benimAnahtar }))
    .sort((x, y) => y.son - x.son);
}
export function cihazAnahtari(kisa) { return Object.keys(cihazlar).find(a => a.startsWith(kisa)); }

// ---- ürün kökenine geçiş bileti (tek kullanımlık, 60 sn) ----
const biletler = new Map();
export function biletVer(ebeveynAnahtar) {
  const simdi = Date.now();
  for (const [b, k] of biletler) if (simdi - k.zaman > 60e3) biletler.delete(b);
  const bilet = rastgele(24);
  biletler.set(bilet, { ebeveyn: ebeveynAnahtar, zaman: simdi });
  return bilet;
}
export function biletKullan(bilet) {
  const k = biletler.get(bilet);
  if (!k) return null;
  biletler.delete(bilet);
  if (Date.now() - k.zaman > 60e3 || !cihazlar[k.ebeveyn]) return null;
  return k;
}
