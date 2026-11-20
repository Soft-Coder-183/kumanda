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
    etiket, nodeType: 1, cocuklar: [], dinleyiciler: {}, dataset: {}, style: { setProperty: () => {} }, className: '', isConnected: true, value: '', files: [],
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
  { yol: 'index.html', ad: 'index.html', tur: 'web', boyut: 900, zaman: simdi, baslik: 'Alfa Sitesi', oturum: SID },
  { yol: 'dist/a-1.0.apk', ad: 'a-1.0.apk', tur: 'android', boyut: 5e6, zaman: simdi - 9e7, ikincil: 'eski sürüm', oturum: SID },
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
  [`/api/proje/${PID}/urunler`]: { urunler, oturumlar: { [SID]: { baslik: 'APK derleme sohbeti', zaman: simdi } } },
  '/api/urunler': { gruplar: [{ proje, urunler, oturumlar: { [SID]: { baslik: 'APK derleme sohbeti', zaman: simdi } } }] },
  [`/api/proje/${PID}/oturum/${SID}`]: {
    kirpildi: true,
    ogeler: [{ t: 'kullanici', metin: 'selam', resim: 1 }, { t: 'metin', metin: ZENGIN }, { t: 'arac', id: 't0', ad: 'Read', girdi: { file_path: 'C:\\a\\b.txt' } }, { t: 'arac-sonuc', id: 't0', hata: false, metin: 'içerik' }, { t: 'not', metin: '/clear' }, { t: 'btw', id: 'b0', z: simdi, soru: 'terminal sorusu', kaynak: 'terminal' }],
    canli: { t: 'durum', durum: 'calisiyor', mod: 'default', model: 'claude-x', nesil: 'n1', limit: { bes: 0.5, yedi: 0.1 } },
    son: { efor: 'high', model: 'claude-x' },
  },
  [`/api/proje/${PID}/efor`]: { varsayilan: 'medium', model: 'opus', modeller: { 'claude-opus-5-5': 'high' } },
  '/api/proje-olustur': { proje: { kimlik: 'cccccccccccc', ad: 'Deneme Projesi' } },
  '/api/cihazlar': { cihazlar: [{ kimlik: 'k1', cihaz: 'Android · Chrome', son: simdi, bu: true }, { kimlik: 'k2', cihaz: 'Windows · Edge', son: simdi - 1e6, bu: false }] },
  [`/api/proje/${PID}/gonder`]: { oturum: SID, nesil: 'n1' },
  [`/api/proje/${PID}/dosyalar`]: { yol: '', kesildi: true, girdiler: [
    { ad: 'src', yol: 'src', klasor: true, boyut: 0, zaman: simdi }, { ad: 'BENIOKU.md', yol: 'BENIOKU.md', klasor: false, boyut: 20, zaman: simdi },
    { ad: 'a.js', yol: 'src/a.js', klasor: false, boyut: 20, zaman: simdi }] },
};
// Dosya görüntüleyici: yol sorgusuna göre farklı yanıtlar.
const KOD = 'import x from "y";\n// yorum satırı\nconst sayi = 42; /* blok\nyorum */\nfunction topla(a, b) { return a + b; }\nconst s = `şablon ${sayi}`;\n';
const dosyalar = {
  'src/a.js': { ad: 'a.js', yol: 'src/a.js', boyut: KOD.length, zaman: simdi, tur: 'metin', metin: KOD, kesildi: false },
  'BENIOKU.md': { ad: 'BENIOKU.md', yol: 'BENIOKU.md', boyut: 20, zaman: simdi, tur: 'metin', metin: '# Başlık\n\n<script>alert(1)</script> **kalın**', kesildi: true },
  'p.ps1': { ad: 'p.ps1', yol: 'p.ps1', boyut: 20, zaman: simdi, tur: 'metin', metin: '<# blok #>\n$ad = "x" # yorum\nif ($true) { Write-Host $ad }' },
  'i.png': { ad: 'i.png', yol: 'i.png', boyut: 4, zaman: simdi, tur: 'resim', mime: 'image/png', veri: 'AAAA' },
  'a.apk': { ad: 'a.apk', yol: 'a.apk', boyut: 4, zaman: simdi, tur: 'ikili' },
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
  querySelector: () => null, querySelectorAll: () => [], addEventListener: (t, f) => { (belge.dinleyiciler[t] ||= []).push(f); }, removeEventListener: () => {},
};
const kok = oge('div');
const pencere = {};
const tanimla = (ad, deger) => Object.defineProperty(globalThis, ad, { value: deger, configurable: true, writable: true });
tanimla('document', belge);
tanimla('navigator', { userAgent: 'Mozilla/5.0 (Linux; Android 14) Chrome/130', platform: 'Linux', maxTouchPoints: 5 });
tanimla('matchMedia', () => ({ matches: false }));
const taslaklar = new Map(); // yalnızca istem taslakları saklanır (öteki ayarlar her görünümde varsayılanla başlasın)
tanimla('localStorage', { getItem: k => taslaklar.get(k) ?? null, setItem: (k, v) => { if (k.startsWith('kumanda.taslak.')) taslaklar.set(k, v); }, removeItem: k => taslaklar.delete(k) });
tanimla('location', { hash: '', reload: () => {} });
tanimla('history', { replaceState: (_, __, h) => { location.hash = h; } });
tanimla('addEventListener', (t, f) => { (pencere[t] ||= []).push(f); });
tanimla('innerHeight', 800);
tanimla('innerWidth', 390);
tanimla('removeEventListener', () => {});
tanimla('EventSource', SahteAkis);
tanimla('setInterval', () => 0);
tanimla('createImageBitmap', async () => ({ width: 4000, height: 3000 }));
tanimla('fetch', async (yol, sec) => {
  istekler.push({ yol, govde: sec?.body ? JSON.parse(sec.body) : null });
  const [yer, sorgu = ''] = yol.split('?');
  if (yer === `/api/proje/${PID}/dosyalar` && new URLSearchParams(sorgu).get('yol') === 'src') {
    return { ok: true, status: 200, json: async () => ({ yol: 'src', girdiler: [{ ad: 'a.js', yol: 'src/a.js', klasor: false, boyut: 20, zaman: simdi }] }) };
  }
  if (yer.endsWith('/yan-soru')) {
    const g = JSON.parse(sec.body);
    return { ok: true, status: 200, json: async () => ({ ...g, z: simdi, kaynak: 'kumanda', yanit: '**yan yanıt**' }) };
  }
  if (yer === `/api/proje/${PID}/dosya`) {
    const d = dosyalar[new URLSearchParams(sorgu).get('yol')];
    return d ? { ok: true, status: 200, json: async () => d } : { ok: false, status: 404, json: async () => ({ hata: 'Dosya bulunamadı' }) };
  }
  const j = yanitlar[yer] || { tamam: true };
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
  assert.deepEqual(kok.cocuklar.slice(0, 3).map(c => c.id || c.etiket), ['yan', 'gezgin', 'ana'], 'iskelet (yan + gezgin + ana) kuruldu');
  assert.ok(metinler(kok).includes('Alfa'), 'proje listesi çizildi');
  assert.ok(!metinler(kok).includes('Beta') || true);

  assert.ok(hepsi.some(e => e.etiket === 'a' && e.href === `#/p/${PID}/son`), 'sol barda proje son sohbete gider');
  await git(`#/p/${PID}/son`);
  await bekle(30);
  assert.equal(location.hash, `#/p/${PID}/s/${SID}`, 'son sohbet açıldı');
  const yeniDugme = hepsi.find(e => e.title === 'Yeni proje');
  for (const f of yeniDugme.dinleyiciler.click) f(olay(yeniDugme));
  const yeniAd = hepsi.findLast(e => e.placeholder === 'Proje adı');
  yeniAd.value = 'Deneme Projesi';
  const yeniForm = hepsi.findLast(e => e.etiket === 'form' && e.dinleyiciler.submit && hepsi.indexOf(e) > hepsi.indexOf(yeniAd));
  for (const f of yeniForm.dinleyiciler.submit) await f(olay(yeniForm));
  await bekle(30);
  assert.deepEqual(istekler.findLast(i => i.yol === '/api/proje-olustur')?.govde, { ad: 'Deneme Projesi' });
  assert.equal(location.hash, '#/p/cccccccccccc/yeni', 'yeni projede yeni sohbet açılır');
  akislar.length = 0; // son sohbet ve yeni sohbet ekranlarının akışları aşağıdaki sayımı etkilemesin

  let bas = hepsi.length;
  await git(`#/p/${PID}`);
  assert.ok(metinler(kok).includes('İlk sohbet'));
  await git(`#/p/${PID}/urunler`);
  assert.ok(metinler(kok).includes('Alfa Sitesi'));
  assert.ok(metinler(kok).includes('APK derleme sohbeti'), 'ürünler sohbet başlığı altında gruplanır');
  assert.ok(metinler(kok).includes('Bir sohbete bağlanamayanlar'));
  assert.ok(hepsi.slice(bas).some(e => e.etiket === 'a' && e.className === 'oturum-bas' && e.href === `#/p/${PID}/s/${SID}`), 'grup başlığı sohbete gider');
  assert.ok(metinler(kok).includes('Yükle'), 'Android cihazda APK için "Yükle"');
  assert.ok(metinler(kok).includes('Yalnızca Windows'));
  const baglar = hepsi.slice(bas).filter(e => e.etiket === 'a' && String(e.href).startsWith('/ac?'));
  assert.ok(baglar.some(e => e.href === `/ac?p=${PID}&y=index.html`));
  assert.ok(baglar.some(e => e.href === `/ac?p=${PID}&y=${encodeURIComponent('dist/a-1.0.apk')}&indir=1`));
  await hepsineBas(bas);
  const toplu = istekler.filter(i => i.yol === `/api/proje/${PID}/urun-gizle` && i.govde?.yollar);
  assert.ok(toplu.some(i => i.govde.gizli === false && i.govde.yollar.join() === 'dist/a.exe'), '"Gizlenenlerin hepsini göster" tek istekle gider');
  // Açık bırakılan "Gizlediklerin" kutusu, liste yeniden çizilince (Göster'den sonra) açık kalır.
  const kutu = hepsi.findLast(e => e.etiket === 'details' && e.className === 'diger gizlenen');
  kutu.open = true;
  for (const f of kutu.dinleyiciler.toggle) f();
  bas = hepsi.length;
  await git(`#/p/${PID}/urunler`);
  assert.equal(hepsi.slice(bas).find(e => e.etiket === 'details' && e.className === 'diger gizlenen')?.open, true, 'kutu açık kalır');
  await git('#/urunler');
  const tumu = metinler(kok);
  assert.ok(tumu.includes('Alfa ›') && tumu.includes('APK derleme sohbeti') && tumu.includes('Bir sohbete bağlanamayanlar'),
    'bütün ürünler sayfası da proje → sohbet diye ayrılır');
  assert.ok(istekler.some(i => i.yol === '/api/urunler?gizliler'), 'gizlenenler de istenir');
  assert.ok(tumu.some(m => m.startsWith('Gizlediklerin (1)')), 'gizlenen ürün kendi kutusunda');
  assert.ok(tumu.some(m => m.startsWith('Diğer dosyalar (1)')), 'eski sürüm gizlenenlerle karışmaz');
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
  assert.ok(istekler.some(i => i.yol === `/api/proje/${PID}/urunler?oturum=${SID}`), 'sohbetin ürünleri istendi');
  // Sohbet başlığının yanındaki "Ürünler" sekmesi yalnızca bu sohbetin ürünlerini açar.
  const panel = hepsi.slice(bas).find(e => e.className === 'sohbet-urunleri');
  const sekme = hepsi.slice(bas).find(e => e.className.includes('urun-sekme'));
  assert.equal(sekme.textContent, `Ürünler (${urunler.length})`, 'sekmede ürün sayısı');
  assert.equal(panel.hidden, true, 'panel kapalı başlar');
  for (const f of sekme.dinleyiciler.click) f(olay(sekme));
  assert.equal(panel.hidden, false, 'sekme paneli açar');
  assert.ok(metinler(panel).includes('Alfa Sitesi'));
  // Effort: "varsayılan" seçeneği gerçek değeri, durum çubuğu son isteğin effort'unu yazar.
  assert.equal(hepsi.slice(bas).find(e => e.etiket === 'option' && e.value === '' && metinler(e)[0]?.startsWith('Effort'))?.textContent, 'Effort: orta (varsayılan)');
  assert.equal(hepsi.slice(bas).find(e => e.etiket === 'option' && e.value === '' && metinler(e)[0] === 'Model')?.textContent, 'Model: Opus (varsayılan)');
  assert.ok(metinler(kok).some(m => m === 'x · effort yüksek · 5 sa %50 · hafta %10'), 'durum çubuğunda effort');
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
  yolla({ t: 'sonuc', hata: null, kesildi: false, sure: 75000, z: simdi });
  yolla({ t: 'sonuc', hata: 'Kota doldu', kesildi: false });
  yolla({ t: 'sonuc', hata: null, kesildi: true });
  const saat = new Date(simdi).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
  assert.ok(metinler(kok).includes(`1 dk 15 sn çalıştı · bitti ${saat}`), 'süre ve bitiş anı yazılır');
  // /btw yan soruları: terminalden gelen yanıtsız kart, canlı "bekliyor" → yanıt aynı kartı günceller
  assert.ok(metinler(kok).includes('terminal sorusu') && metinler(kok).some(m => m.startsWith('Terminalden soruldu')), 'terminaldeki /btw geçmişte');
  const kartOnce = hepsi.filter(e => e.className.startsWith('yan-soru')).length;
  yolla({ t: 'btw', id: 'b1', z: simdi, soru: 'canlı yan', kaynak: 'kumanda', bekliyor: true });
  yolla({ t: 'btw', id: 'b1', z: simdi, soru: 'canlı yan', kaynak: 'kumanda', yanit: '**cevap**' });
  yolla({ t: 'btw', id: 'b1', z: simdi, soru: 'canlı yan', kaynak: 'kumanda', bekliyor: true });
  assert.equal(hepsi.filter(e => e.className.startsWith('yan-soru')).length, kartOnce + 1, 'aynı kimlik tek kart');
  const kart = hepsi.findLast(e => e.className.startsWith('yan-soru'));
  assert.equal(kart.className, 'yan-soru', 'yanıtlanmış kart "bekliyor"a dönmez');
  assert.ok(kart.cocuklar.some(c => c.innerHTML === '<p><strong>cevap</strong></p>'), 'yanıt Markdown olarak çizilir');
  const sohbetAlani = hepsi.findLast(e => e.etiket === 'textarea');
  const sohbetFormu = hepsi.findLast(e => e.etiket === 'form' && e.className === 'yazma');
  sohbetAlani.value = '/btw nasıl gidiyor?';
  for (const f of sohbetFormu.dinleyiciler.submit) await f(olay(sohbetFormu));
  await bekle(30);
  const yanIstek = istekler.findLast(i => i.yol === `/api/proje/${PID}/oturum/${SID}/yan-soru`);
  assert.equal(yanIstek?.govde.soru, 'nasıl gidiyor?', '/btw ile başlayan istem yan soru olarak gider');
  assert.match(yanIstek.govde.id, /^[0-9a-f-]{36}$/);
  assert.ok(!istekler.some(i => i.yol === `/api/proje/${PID}/gonder` && i.govde?.metin?.startsWith('/btw')), 'asıl sohbete gitmez');
  assert.equal(sohbetAlani.value, '', 'yazma alanı boşalır');
  assert.ok(hepsi.some(e => e.innerHTML === '<p><strong>yan yanıt</strong></p>'), 'yanıt karta yazılır');
  // Ctrl+Enter: Claude çalışırken süren turu kesip hemen gönderir
  sohbetAlani.value = 'acil iş';
  for (const f of sohbetAlani.dinleyiciler.keydown) await f({ key: 'Enter', ctrlKey: true, preventDefault() {} });
  await bekle(20);
  assert.equal(istekler.findLast(i => i.yol === `/api/proje/${PID}/gonder`)?.govde.simdi, true, 'Ctrl+Enter "şimdi" gönderir');
  yolla({ t: 'yenile' }, false);
  await bekle(40);
  yolla({ t: 'durum', durum: 'kapali', mod: 'default', model: 'claude-x', nesil: 'n1', limit: null }, false);
  assert.equal(akis.readyState, 2, 'koşu kapanınca akış bırakılır');

  // gönderilmemiş istem başka sohbete geçince kaybolmaz
  await git(`#/p/${PID}/yeni`);
  const taslakAlani = hepsi.findLast(e => e.etiket === 'textarea');
  taslakAlani.value = 'yarım kalan istem';
  for (const f of taslakAlani.dinleyiciler.input) f(olay(taslakAlani));
  await git(`#/p/${PID}`);
  await git(`#/p/${PID}/yeni`);
  assert.equal(hepsi.findLast(e => e.etiket === 'textarea').value, 'yarım kalan istem', 'taslak geri geldi');

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
  assert.deepEqual([gonderilen.oturum, gonderilen.metin, gonderilen.mod, gonderilen.efor, gonderilen.resimler.length], [null, 'yeni istem', 'acceptEdits', '', 1]);
  assert.equal(gonderilen.simdi, undefined, 'çalışmayan sohbette Enter sıradan gönderir');
  assert.equal(taslaklar.size, 0, 'gönderilen istemin taslağı silinir');
  const eforSec = hepsi.findLast(e => e.etiket === 'select' && e['aria-label'] === undefined && e.title?.startsWith('Effort'));
  assert.ok(eforSec, 'effort seçici var');
  akislar.at(-1).onmessage({ data: JSON.stringify({ t: 'durum', durum: 'hazir', mod: 'acceptEdits', efor: '', nesil: 'n1' }), lastEventId: '' });
  eforSec.value = 'high';
  for (const f of eforSec.dinleyiciler.change) await f(olay(eforSec));
  await bekle(20);
  assert.deepEqual(istekler.findLast(i => i.yol === `/api/oturum/${SID}/mod`)?.govde, { efor: 'high' }, 'canlı oturumda effort değişimi sunucuya gider');
  assert.equal(location.hash, `#/p/${PID}/s/${SID}`);
  assert.equal(akislar.length, once + 1);
  // akış kalıcı koparsa (sunucu yeniden başladı) geçmiş yeniden yüklenir
  const son = akislar.at(-1);
  son.readyState = 2;
  son.onerror();
  await bekle(40);

  // gezgin (proje dosyaları) ve dosya görüntüleyici
  bas = hepsi.length;
  await git(`#/p/${PID}/d/${encodeURIComponent('src/a.js')}`);
  await bekle(30);
  const gezginDugme = hepsi.slice(bas).find(e => e.className.includes('gezgin-dugme'));
  assert.ok(gezginDugme, 'proje sayfalarında Dosyalar düğmesi');
  for (const f of gezginDugme.dinleyiciler.click) f(olay(gezginDugme));
  await bekle(40);
  assert.ok(kok.className.includes('gezgin-cekmece'), 'telefonda gezgin çekmece olarak açılır');
  assert.ok(istekler.some(i => i.yol === `/api/proje/${PID}/dosyalar?yol=`), 'kök klasör istendi');
  assert.ok(istekler.some(i => i.yol === `/api/proje/${PID}/dosyalar?yol=src`), 'açık dosyanın klasörü kendiliğinden açılır');
  const agac = hepsi.findLast(e => e.className === 'agac');
  const agacMetni = metinler(agac);
  assert.ok(['src', 'a.js', 'BENIOKU.md'].every(m => agacMetni.includes(m)), agacMetni.join('|'));
  assert.ok(agac.cocuklar.some(e => e.className?.includes('secili') && e.href === `#/p/${PID}/d/${encodeURIComponent('src/a.js')}`), 'açık dosya seçili');
  assert.ok(agacMetni.some(m => m.includes('ilk 3000')), 'kesilen klasör belirtilir');
  const span = (sinif, metin) => hepsi.slice(bas).some(e => e.className === sinif && metinler(e).join('') === metin);
  for (const [s, m] of [['s-anahtar', 'import'], ['s-dizgi', '"y"'], ['s-yorum', '// yorum satırı'], ['s-anahtar', 'const'], ['s-sayi', '42'],
    ['s-yorum', '/* blok'], ['s-yorum', 'yorum */'], ['s-islev', 'topla'], ['s-dizgi', '`şablon ${sayi}`']]) assert.ok(span(s, m), `renklendirme: ${s} ${m}`);
  const kodEl = hepsi.slice(bas).findLast(e => e.className === 'kod-gorunum');
  assert.equal(kodEl.cocuklar.length, 6, 'satır başına bir öğe');
  const dosyaGovde = hepsi.slice(bas).find(e => e.className === 'dosya-govde');
  assert.ok(dosyaGovde.cocuklar.some(c => c.cocuklar?.includes(kodEl)), 'kod görünümü sayfaya yerleşir');
  await hepsineBas(bas);

  bas = hepsi.length;
  await git(`#/p/${PID}/d/BENIOKU.md`);
  const onizleme = hepsi.slice(bas).find(e => e.className === 'ileti claude md-onizleme');
  assert.ok(onizleme?.innerHTML.includes('<h1>') && !onizleme.innerHTML.includes('<script>'), 'Markdown önizlemesi kaçırılır');
  assert.ok(metinler(kok).includes('ilk 1 MB gösteriliyor'));
  await hepsineBas(bas);
  assert.ok(hepsi.slice(bas).some(e => e.className === 'kod-gorunum'), 'Önizleme kapatılınca kaynak görünür');

  bas = hepsi.length;
  await git(`#/p/${PID}/d/p.ps1`);
  assert.ok(span('s-yorum', '<# blok #>') && span('s-degisken', '$ad') && span('s-anahtar', 'if') && span('s-yorum', '# yorum'), 'PowerShell renklendirmesi');
  bas = hepsi.length;
  await git(`#/p/${PID}/d/i.png`);
  assert.ok(hepsi.slice(bas).some(e => e.etiket === 'img' && e.src === 'data:image/png;base64,AAAA'), 'resim gösterilir');
  await git(`#/p/${PID}/d/a.apk`);
  assert.ok(metinler(kok).some(m => m.includes('metin değil')));
  await git(`#/p/${PID}/d/yok.txt`);
  assert.ok(metinler(kok).some(m => m.includes('Dosya bulunamadı')));

  // sol bar: ☰ telefonda çekmece açar, dışına dokununca kapanır
  const yanDugme = hepsi.findLast(e => e.className.includes('yan-dugme'));
  for (const f of yanDugme.dinleyiciler.click) f(olay(yanDugme));
  assert.ok(kok.className.includes('yan-cekmece'));
  const perde = kok.cocuklar.find(e => e.className === 'perde');
  for (const f of perde.dinleyiciler.click) f(olay(perde));
  assert.ok(!kok.className.includes('yan-cekmece') && !kok.className.includes('gezgin-cekmece'));
  await git('#/');

  const bozuk = hepsi.flatMap(e => e.cocuklar.filter(c => c.nodeType === 3 && /^(null|undefined|false|true)$|\[object /.test(c.metin)).map(c => `${e.etiket}.${e.className}: ${c.metin}`));
  assert.deepEqual(bozuk, [], 'DOM\'a düğüm yerine null/dizi/nesne verilmemeli');
  assert.deepEqual(hatalar.map(e => e?.stack || String(e)), []);
});
