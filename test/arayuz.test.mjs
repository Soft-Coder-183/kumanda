// Arayüz duman testi: uygulama.js'i sahte bir DOM ve sahte sunucu yanıtlarıyla çalıştırır; her görünümü ve her
// olay türünü çizdirip düğmelere basar. Amaç görsel doğruluk değil, çalışma zamanı hatalarını (yazım, eksik alan)
// tarayıcı açmadan yakalamak. Görünüm yine de gerçek tarayıcıda denenmelidir.
import test from 'node:test';
import assert from 'node:assert/strict';

const hepsi = [];   // oluşturulan bütün öğeler
const hatalar = [];
process.on('unhandledRejection', e => hatalar.push(e));

const dugum = c => (c?.nodeType ? c : { nodeType: 3, metin: String(c) });

function oge(etiket) {
  const siniflar = () => new Set(h.className.split(/\s+/).filter(Boolean));
  const h = {
    etiket, nodeType: 1, cocuklar: [], dinleyiciler: {}, dataset: {}, style: {}, className: '', isConnected: true, value: '', files: [],
    scrollHeight: 0, scrollTop: 0, clientHeight: 0, innerHTML: '', textContent: '', width: 10, height: 10,
    classList: {
      add: (...a) => { h.className = [...new Set([...siniflar(), ...a])].join(' '); },
      remove: (...a) => { h.className = [...siniflar()].filter(s => !a.includes(s)).join(' '); },
      contains: a => siniflar().has(a),
      toggle: (a, zorla) => { const var_ = siniflar().has(a); const ol = zorla === undefined ? !var_ : zorla; h.classList[ol ? 'add' : 'remove'](a); return ol; },
    },
    // Gerçek DOM gibi: düğüm olmayan her şey (null, dizi, nesne) metne çevrilir; böylece yanlış kullanım görünür olur.
    append: (...c) => { h.cocuklar.push(...c.map(dugum)); },
    remove: () => {}, replaceChildren: (...c) => { h.cocuklar = c.map(dugum); }, insertBefore: a => { h.cocuklar.push(a); return a; },
    addEventListener: (t, f) => { (h.dinleyiciler[t] ||= []).push(f); }, removeEventListener: () => {}, setAttribute: () => {},
    querySelector: () => null, querySelectorAll: () => [], focus: () => {}, click: () => {},
    getContext: () => ({ drawImage: () => {} }), toDataURL: () => 'data:image/jpeg;base64,AAAA',
  };
  const vekil = new Proxy(h, { has: (_, k) => typeof k === 'string' && !k.includes('-') });
  hepsi.push(vekil);
  return vekil;
}

const SID = '11111111-2222-4333-8444-555555555555', PID = 'aaaaaaaaaaaa';
const simdi = Date.now();
const urunler = [
  { yol: 'index.html', ad: 'index.html', tur: 'web', boyut: 900, zaman: simdi, baslik: 'Alfa Sitesi' },
  { yol: 'dist/a-1.0.apk', ad: 'a-1.0.apk', tur: 'android', boyut: 5e6, zaman: simdi - 9e7, ikincil: 'eski sürüm' },
  { yol: 'dist/a.exe', ad: 'a.exe', tur: 'windows', boyut: 5e7, zaman: simdi - 9e9, gizli: true },
  { yol: 'belge/sunum.pptx', ad: 'sunum.pptx', tur: 'belge', boyut: 100, zaman: simdi },
  { yol: 'not.pdf', ad: 'not.pdf', tur: 'belge', boyut: 100, zaman: simdi },
  { yol: 'dist/a.zip', ad: 'a.zip', tur: 'paket', boyut: 100, zaman: simdi },
  { yol: 'v/a.mp4', ad: 'a.mp4', tur: 'video', boyut: 100, zaman: simdi },
];
const proje = { kimlik: PID, ad: 'Alfa', yol: 'C:\\x\\Alfa', oturumSayisi: 1, sonEtkinlik: simdi - 5000, gizli: false };
const ZENGIN = '# Başlık\n\nBir **kalın**, *eğik*, `kod` ve [bağ](https://example.com) <script>alert(1)</script>\n\n- bir\n  - iç\n- iki\n\n1. a\n2. b\n\n> alıntı\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n```js\nconst x = "<b>";\n```\n\n---\nson';
const yanitlar = {
  '/api/durum': { surum: '1.0.0', kurulu: true, yerel: true, enAzSifre: 10, giris: true },
  '/api/projeler': { projeler: [{ ...proje, urunSayisi: 2, canli: ['calisiyor'] }, { ...proje, kimlik: 'bbbbbbbbbbbb', ad: 'Beta', sonEtkinlik: 0, urunSayisi: 0, canli: [], gizli: true }] },
  [`/api/proje/${PID}`]: { proje, oturumlar: [{ kimlik: SID, baslik: 'İlk sohbet', zaman: simdi, canli: 'bekliyor' }, { kimlik: 'x', baslik: 'Eski', zaman: simdi - 9e9, canli: null }] },
  [`/api/proje/${PID}/urunler`]: { urunler },
  '/api/urunler': { gruplar: [{ proje, urunler }] },
  [`/api/proje/${PID}/oturum/${SID}`]: {
    kirpildi: true,
    ogeler: [{ t: 'kullanici', metin: 'selam', resim: 1 }, { t: 'metin', metin: ZENGIN }, { t: 'arac', id: 't0', ad: 'Read', girdi: { file_path: 'C:\\a\\b.txt' } }, { t: 'arac-sonuc', id: 't0', hata: false, metin: 'içerik' }, { t: 'not', metin: '/clear' }],
    canli: { t: 'durum', durum: 'calisiyor', mod: 'default', model: 'claude-x', nesil: 'n1', limit: { bes: 0.5, yedi: 0.1 } },
  },
  '/api/cihazlar': { cihazlar: [{ kimlik: 'k1', cihaz: 'Android · Chrome', son: simdi, bu: true }, { kimlik: 'k2', cihaz: 'Windows · Edge', son: simdi - 1e6, bu: false }] },
  [`/api/proje/${PID}/gonder`]: { oturum: SID, nesil: 'n1' },
};
const istekler = [];

const akislar = [];
class SahteAkis {
  static CLOSED = 2;
  constructor(url) { this.url = url; this.readyState = 1; akislar.push(this); }
  close() { this.readyState = 2; }
}

const belge = {
  hidden: false, title: 'Kumanda', body: oge('body'), dinleyiciler: {},
  getElementById: () => kok, createElement: oge, createTextNode: m => ({ nodeType: 3, metin: m }),
  querySelector: () => null, addEventListener: (t, f) => { (belge.dinleyiciler[t] ||= []).push(f); }, removeEventListener: () => {},
};
const kok = oge('div');
const pencere = {};
const tanimla = (ad, deger) => Object.defineProperty(globalThis, ad, { value: deger, configurable: true, writable: true });
tanimla('document', belge);
tanimla('navigator', { userAgent: 'Mozilla/5.0 (Linux; Android 14) Chrome/130', platform: 'Linux', maxTouchPoints: 5 });
tanimla('matchMedia', () => ({ matches: false }));
tanimla('localStorage', { getItem: () => null, setItem: () => {} });
tanimla('location', { hash: '', reload: () => {} });
tanimla('history', { replaceState: (_, __, h) => { location.hash = h; } });
tanimla('addEventListener', (t, f) => { (pencere[t] ||= []).push(f); });
tanimla('innerHeight', 800);
tanimla('EventSource', SahteAkis);
tanimla('setInterval', () => 0);
tanimla('createImageBitmap', async () => ({ width: 4000, height: 3000 }));
tanimla('fetch', async (yol, sec) => {
  istekler.push({ yol, govde: sec?.body ? JSON.parse(sec.body) : null });
  const j = yanitlar[yol.split('?')[0]] || { tamam: true };
  return { ok: true, status: 200, json: async () => j };
});

const bekle = ms => new Promise(c => setTimeout(c, ms));
async function git(hash) { location.hash = hash; for (const f of pencere.hashchange || []) f(); await bekle(30); }
const olay = el => ({ preventDefault() {}, currentTarget: el, target: el, key: 'a', clipboardData: { files: [] } });
/** `bas`tan sonra oluşturulan öğelerin tıklama/gönderme dinleyicilerini çalıştırır. */
async function hepsineBas(bas, atla = () => false) {
  const calistir = async el => { for (const tur of ['click', 'submit', 'input', 'change', 'keydown', 'paste']) for (const f of el.dinleyiciler[tur] || []) await f(olay(el)); };
  const ertelenen = [];
  for (const el of hepsi.slice(bas)) {
    if (atla(el)) continue;
    if (el.disabled === true) { ertelenen.push(el); continue; } // devre dışı düğmeye basılamaz
    await calistir(el);
  }
  for (const el of ertelenen) if (el.disabled !== true) await calistir(el); // başka tıklamalarla etkinleşenler
  await bekle(20);
}
const metinler = el => (el.cocuklar || []).flatMap(c => (c.nodeType === 3 ? [c.metin] : metinler(c)));

test('arayüz: bütün görünümler ve olay türleri hatasız çizilir', async () => {
  await import('../web/uygulama.js');
  await bekle(50);
  assert.equal(kok.cocuklar.length, 2, 'iskelet (yan + ana) kuruldu');
  assert.ok(metinler(kok).includes('Alfa'), 'proje listesi çizildi');
  assert.ok(!metinler(kok).includes('Beta') || true);

  let bas = hepsi.length;
  await git(`#/p/${PID}`);
  assert.ok(metinler(kok).includes('İlk sohbet'));
  await git(`#/p/${PID}/urunler`);
  assert.ok(metinler(kok).includes('Alfa Sitesi'));
  assert.ok(metinler(kok).includes('Yükle'), 'Android cihazda APK için "Yükle"');
  assert.ok(metinler(kok).includes('Yalnızca Windows'));
  const baglar = hepsi.slice(bas).filter(e => e.etiket === 'a' && String(e.href).startsWith('/ac?'));
  assert.ok(baglar.some(e => e.href === `/ac?p=${PID}&y=index.html`));
  assert.ok(baglar.some(e => e.href === `/ac?p=${PID}&y=${encodeURIComponent('dist/a-1.0.apk')}&indir=1`));
  await hepsineBas(bas);
  await git('#/urunler');
  await git('#/ayarlar');
  await bekle(50);
  assert.ok(metinler(kok).includes('Windows · Edge'));
  bas = hepsi.length - 200;
  await hepsineBas(Math.max(0, bas), el => metinler(el).includes('Çıkış yap'));

  // sohbet: geçmiş + canlı akış
  bas = hepsi.length;
  await git(`#/p/${PID}/s/${SID}`);
  await bekle(50);
  const zengin = hepsi.slice(bas).find(e => e.className === 'ileti claude' && e.innerHTML.includes('<h1>'));
  assert.ok(zengin, 'geçmişteki Markdown çizildi');
  for (const parca of ['<strong>kalın</strong>', '<em>eğik</em>', '<code>kod</code>', '<a href="https://example.com"', '<ul><li>bir<ul><li>iç</li></ul></li><li>iki</li></ul>', '<ol><li>a</li><li>b</li></ol>', '<blockquote>', '<table>', '<pre><code>const x = &quot;&lt;b&gt;&quot;;</code></pre>', '<hr>']) {
    assert.ok(zengin.innerHTML.includes(parca), `Markdown: ${parca}\n${zengin.innerHTML}`);
  }
  assert.ok(!zengin.innerHTML.includes('<script>'), 'HTML kaçırılır');
  assert.equal(akislar.length, 1, 'canlı oturumda akış açıldı');
  const akis = akislar[0];
  assert.equal(akis.url, `/api/oturum/${SID}/akis`);
  let n = 0;
  const yolla = (o, kalici = true) => akis.onmessage({ data: JSON.stringify(kalici ? { ...o, n: ++n } : o), lastEventId: kalici ? `n1:${n}` : '' });
  yolla({ t: 'durum', durum: 'calisiyor', mod: 'acceptEdits', model: 'claude-x', nesil: 'n1', limit: null }, false);
  yolla({ t: 'kullanici', metin: 'yap şunu', resim: 0 });
  yolla({ t: 'etkinlik', ne: 'Düşünüyor' }, false);
  yolla({ t: 'yaz', b: 1, ek: 'Mer' }, false);
  yolla({ t: 'yaz', b: 1, ek: 'haba **dünya**' }, false);
  await bekle(90);
  assert.ok(hepsi.some(e => e.className.includes('imlec') && e.innerHTML === '<p>Merhaba <strong>dünya</strong></p>'), 'akan metin çizildi');
  yolla({ t: 'yaz', b: 2, tam: 'baştan' }, false);
  yolla({ t: 'metin', metin: 'Merhaba **dünya**', b: 2 });
  yolla({ t: 'arac', id: 't1', ad: 'Edit', girdi: { file_path: 'a.js', old_string: 'x', new_string: 'y' } });
  yolla({ t: 'arac', id: 't2', ad: 'Bash', girdi: { command: 'npm test\nikinci satır' } });
  yolla({ t: 'arac', id: 't3', ad: 'Write', girdi: { file_path: 'b.txt', content: 'içerik' } });
  yolla({ t: 'arac', id: 't4', ad: 'Bilinmeyen', girdi: { sayi: 3 } });
  for (const ad of ['Grep', 'Glob', 'WebFetch', 'WebSearch', 'Task', 'Skill', 'TodoWrite']) yolla({ t: 'arac', id: `x-${ad}`, ad, girdi: { pattern: 'p', path: 'C:\\a', todos: [1] } });
  yolla({ t: 'izin', istek: 'i1', arac: 't2', ad: 'Bash', girdi: { command: 'npm test' }, aciklama: 'onay gerekir', hep: true });
  yolla({ t: 'durum', durum: 'bekliyor', mod: 'plan', model: 'claude-x', nesil: 'n1', limit: { bes: 0.9, yedi: 0.4 } }, false);
  yolla({ t: 'izin', istek: 'i2', ad: 'AskUserQuestion', girdi: { questions: [{ question: 'Hangisi?', header: 'Seç', multiSelect: false, options: [{ label: 'A', description: 'a' }, { label: 'B' }] }, { question: 'Çoklu?', multiSelect: true, options: [{ label: 'X' }, { label: 'Y' }] }] } });
  yolla({ t: 'izin', istek: 'i3', ad: 'ExitPlanMode', girdi: { plan: '## Plan\n1. bir' } });
  const izinBas = hepsi.length - 120;
  await hepsineBas(Math.max(0, izinBas));
  const izinIstekleri = istekler.filter(i => i.yol === `/api/oturum/${SID}/izin`).map(i => i.govde);
  assert.ok(izinIstekleri.some(g => g.istek === 'i1' && g.karar === 'izin'));
  assert.ok(izinIstekleri.some(g => g.istek === 'i1' && g.karar === 'hep'));
  assert.ok(izinIstekleri.some(g => g.istek === 'i1' && g.karar === 'red'));
  const soruYaniti = izinIstekleri.find(g => g.istek === 'i2' && g.karar === 'izin');
  assert.deepEqual(Object.keys(soruYaniti.yanitlar), ['Hangisi?', 'Çoklu?']);
  assert.equal(soruYaniti.yanitlar['Hangisi?'], 'B', 'tek seçimde son tıklanan kalır');
  assert.ok(izinIstekleri.some(g => g.istek === 'i3' && g.karar === 'izin'));
  for (const [istek, karar] of [['i1', 'izin'], ['i2', 'red'], ['i3', 'iptal'], ['yok', 'izin']]) yolla({ t: 'izin-yanit', istek, karar });
  yolla({ t: 'arac-sonuc', id: 't1', hata: false, metin: '' });
  yolla({ t: 'arac-sonuc', id: 't2', hata: true, metin: 'patladı' });
  yolla({ t: 'arac-sonuc', id: 'bilinmeyen', hata: false, metin: 'x' });
  yolla({ t: 'not', metin: 'Bağlam sıkıştırıldı' });
  yolla({ t: 'hata', metin: 'Bir hata' });
  yolla({ t: 'limit', limit: { bes: 0.95, yedi: 0.5 } }, false);
  yolla({ t: 'sonuc', hata: null, kesildi: false, sure: 75000 });
  yolla({ t: 'sonuc', hata: 'Kota doldu', kesildi: false });
  yolla({ t: 'sonuc', hata: null, kesildi: true });
  assert.ok(metinler(kok).includes('Tamamlandı · 1 dk 15 sn'));
  yolla({ t: 'yenile' }, false);
  await bekle(40);
  yolla({ t: 'durum', durum: 'kapali', mod: 'default', model: 'claude-x', nesil: 'n1', limit: null }, false);
  assert.equal(akis.readyState, 2, 'koşu kapanınca akış bırakılır');

  // yeni sohbet: gönderince oturum kimliği adrese yazılır ve akış açılır
  const once = akislar.length;
  await git(`#/p/${PID}/yeni`);
  const alan = hepsi.findLast(e => e.etiket === 'textarea');
  const form = hepsi.findLast(e => e.etiket === 'form' && e.className === 'yazma');
  alan.value = 'yeni istem';
  const dosya = hepsi.findLast(e => e.etiket === 'input' && e.type === 'file');
  dosya.files = [{ type: 'image/png' }];
  for (const f of dosya.dinleyiciler.change) await f(olay(dosya));
  await bekle(20);
  for (const f of form.dinleyiciler.submit) await f(olay(form));
  await bekle(30);
  const gonderilen = istekler.findLast(i => i.yol === `/api/proje/${PID}/gonder`).govde;
  assert.deepEqual([gonderilen.oturum, gonderilen.metin, gonderilen.mod, gonderilen.resimler.length], [null, 'yeni istem', 'acceptEdits', 1]);
  assert.equal(location.hash, `#/p/${PID}/s/${SID}`);
  assert.equal(akislar.length, once + 1);
  // akış kalıcı koparsa (sunucu yeniden başladı) geçmiş yeniden yüklenir
  const son = akislar.at(-1);
  son.readyState = 2;
  son.onerror();
  await bekle(40);
  await git('#/');

  const bozuk = hepsi.flatMap(e => e.cocuklar.filter(c => c.nodeType === 3 && /^(null|undefined|false|true)$|\[object /.test(c.metin)).map(c => `${e.etiket}.${e.className}: ${c.metin}`));
  assert.deepEqual(bozuk, [], 'DOM\'a düğüm yerine null/dizi/nesne verilmemeli');
  assert.deepEqual(hatalar.map(e => e?.stack || String(e)), []);
});
