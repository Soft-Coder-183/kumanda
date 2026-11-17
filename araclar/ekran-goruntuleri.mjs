// README ekran görüntülerini üretir: geçici klasörde tanıtım verisiyle (sahte projeler, sahte sohbetler, sahte Claude)
// ayrı bir Kumanda örneği açar ve gerçek Chrome'da telefon ve masaüstü görüntüleri alır. Gerçek veriye dokunmaz.
//   npm i --no-save playwright-core   (ya da KUMANDA_PLAYWRIGHT=<playwright-core bulunan bir klasör>)
//   node araclar/ekran-goruntuleri.mjs [çıktı klasörü = belgeler]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

const KOK = path.resolve(import.meta.dirname, '..');
const CIKTI = path.resolve(process.argv[2] || path.join(KOK, 'belgeler'));
const pw = process.env.KUMANDA_PLAYWRIGHT
  ? createRequire(path.join(process.env.KUMANDA_PLAYWRIGHT, 'x.js'))('playwright-core')
  : await import('playwright-core').catch(() => { console.error('playwright-core bulunamadı: npm i --no-save playwright-core'); process.exit(1); });

const gecici = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'kumanda-tanitim-'));
const veri = path.join(gecici, 'veri'), claude = path.join(gecici, 'claude'), projeler = path.join(gecici, 'Projeler');
const KP = 7797, UP = 7798;
const yaz = (yol, icerik) => { fs.mkdirSync(path.dirname(yol), { recursive: true }); fs.writeFileSync(yol, icerik); };
const simdi = Date.now(), dk = 60e3, sa = 3600e3, gun = 86400e3;

// ── tanıtım projeleri ve ürünleri ──
const urun = (proje, goreli, icerik, zaman) => {
  const dosya = path.join(projeler, proje, goreli);
  yaz(dosya, icerik);
  fs.utimesSync(dosya, new Date(zaman), new Date(zaman));
};
const html = baslik => `<!doctype html><meta charset="utf-8"><title>${baslik}</title><h1>${baslik}</h1>`;
urun('Hava Durumu', 'index.html', html('Hava Durumu'), simdi - 12 * dk);
urun('Hava Durumu', 'dist/HavaDurumu-1.3.0.apk', Buffer.alloc(4.2e6), simdi - 14 * dk);
urun('Hava Durumu', 'dist/HavaDurumu-1.2.0.apk', Buffer.alloc(4.1e6), simdi - 2 * gun);
urun('Hava Durumu', 'dist/HavaDurumu-kurulum.exe', Buffer.alloc(31e6), simdi - 2 * gun - 5 * dk);
urun('Hava Durumu', 'belgeler/tanitim.mp4', Buffer.alloc(2.3e6), simdi - 2 * gun - 9 * dk);
urun('Not Defteri', 'dist/index.html', html('Not Defteri'), simdi - 3 * gun);
urun('Not Defteri', 'dist/NotDefteri-1.0.0-win-x64.zip', Buffer.alloc(18e6), simdi - 3 * gun - 2 * dk);
urun('Kişisel Site', 'index.html', html('Kişisel Site'), simdi - 9 * gun);
fs.mkdirSync(path.join(projeler, 'Ders Notları'), { recursive: true });
// gezgin için kaynak dosyalar
const kaynak = (goreli, icerik) => yaz(path.join(projeler, 'Hava Durumu', goreli), icerik);
kaynak('src/ekranlar/ana.js', `// Ana ekran: bugünün havası ve 7 günlük tahmin.
import { tahminGetir } from '../veri/tahmin.js';

const GUN_ADLARI = ['Paz', 'Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt'];

/** Bir günün kartını çizer. */
function gunKarti(gun) {
  const kart = document.createElement('div');
  kart.className = 'gun';
  kart.textContent = \`\${GUN_ADLARI[new Date(gun.tarih).getDay()]} \${gun.enYuksek}° / \${gun.enDusuk}°\`;
  return kart;
}

export async function anaEkran(kok) {
  const veri = await tahminGetir({ sehir: 'İstanbul', gun: 7 });
  gosterBugun(veri);
  gosterHafta(veri.gunluk.slice(0, 7));
  if (veri.uyari) kok.prepend(uyariSeridi(veri.uyari)); /* fırtına, kar vb. */
  return true;
}
`);
kaynak('src/veri/tahmin.js', 'export async function tahminGetir({ sehir, gun }) {\n  const r = await fetch(`/api/tahmin?sehir=${encodeURIComponent(sehir)}&gun=${gun}`);\n  return r.json();\n}\n');
kaynak('src/stil.css', '.gun { display: flex; gap: 8px; padding: 12px; border-radius: 12px; background: #eef4ff; }\n');
kaynak('README.md', '# Hava Durumu\n\nAndroid ve Windows için **7 günlük** hava tahmini.\n\n- `npm run build:android` → `dist/*.apk`\n');
kaynak('package.json', '{\n  "name": "hava-durumu",\n  "version": "1.3.0",\n  "private": true\n}\n');
kaynak('derle.ps1', '# APK ve kurulum dosyasını üretir\n$surum = (Get-Content package.json | ConvertFrom-Json).version\nnpm run build:android\nWrite-Host "Sürüm $surum hazır"\n');

// ── tanıtım sohbetleri (Claude Code transkript biçiminde) ──
function sohbet(proje, baslik, adimlar) {
  const cwd = path.join(projeler, proje);
  const kimlik = crypto.randomUUID();
  const satirlar = [{ type: 'ai-title', aiTitle: baslik }];
  for (const [z, tur, icerik] of adimlar) satirlar.push({ type: tur, message: { role: tur, content: icerik }, cwd, sessionId: kimlik, timestamp: new Date(z).toISOString() });
  const dosya = path.join(claude, 'projects', cwd.replace(/[^a-zA-Z0-9]/g, '-'), `${kimlik}.jsonl`);
  yaz(dosya, satirlar.map(s => JSON.stringify(s)).join('\n') + '\n');
  const son = new Date(adimlar.at(-1)[0]);
  fs.utimesSync(dosya, son, son); // "son etkinlik" dosya zamanından okunur
  return kimlik;
}
const metin = t => [{ type: 'text', text: t }];
const arac = (id, name, input) => [{ type: 'tool_use', id, name, input }];
const sonuc = (id, t) => [{ type: 'tool_result', tool_use_id: id, content: t }];
const t0 = simdi - 20 * dk;
const anaSohbet = sohbet('Hava Durumu', 'Haftalık tahmin ekranı', [
  [t0, 'user', 'Ana ekrana 7 günlük tahmin ekle, sonra APK\'yı derle.'],
  [t0 + dk, 'assistant', metin('Tahmin verisini zaten çeken `tahminGetir()` var; ekranı ona bağlıyorum.')],
  [t0 + 2 * dk, 'assistant', arac('t1', 'Edit', { file_path: 'src/ekranlar/ana.js', old_string: 'gosterBugun(veri);', new_string: 'gosterBugun(veri);\ngosterHafta(veri.gunluk.slice(0, 7));' })],
  [t0 + 2 * dk, 'user', sonuc('t1', 'Dosya güncellendi')],
  [t0 + 5 * dk, 'assistant', arac('t2', 'Bash', { command: 'npm test', description: 'Testleri çalıştır' })],
  [t0 + 6 * dk, 'user', sonuc('t2', '✓ 24 test geçti')],
  [t0 + 6 * dk, 'assistant', arac('t3', 'Bash', { command: '.\\derle.ps1', description: 'APK derle' })],
  [t0 + 8 * dk, 'user', sonuc('t3', 'dist/HavaDurumu-1.3.0.apk yazıldı')],
  [t0 + 8 * dk, 'assistant', metin('## Tamam\n\nAna ekranda artık **7 günlük tahmin** var.\n\n| Gün | Simge | En yüksek / en düşük |\n|---|---|---|\n| Bugün | güneşli | 18° / 9° |\n| Yarın | yağmurlu | 14° / 8° |\n\n- Testler geçti (24/24).\n- APK: `dist/HavaDurumu-1.3.0.apk`, Kumanda\'nın **Ürünler** sekmesinden telefona yükleyebilirsin.')],
]);
sohbet('Hava Durumu', 'Android simgesi ve Windows kurulumu', [
  [simdi - 2 * gun - 20 * dk, 'user', 'Uygulamaya simge yap, Windows kurulum dosyası da çıkar.'],
  [simdi - 2 * gun - 4 * dk, 'assistant', metin('Simge eklendi, `dist/HavaDurumu-kurulum.exe` hazır.')],
]);
sohbet('Not Defteri', 'Çevrimdışı çalışma', [
  [simdi - 3 * gun - 10 * dk, 'user', 'Not defteri internetsiz de açılsın.'],
  [simdi - 3 * gun, 'assistant', metin('Servis çalışanı eklendi; site artık çevrimdışı açılıyor.')],
]);

// ── tanıtım Kumanda'sı ──
yaz(path.join(veri, 'ayar.json'), JSON.stringify({ kumandaPort: KP, urunPort: UP, kokler: [projeler] }));
const sunucu = spawn(process.execPath, [path.join(KOK, 'sunucu.mjs')], {
  stdio: ['ignore', 'pipe', 'inherit'],
  env: { ...process.env, KUMANDA_VERI: veri, KUMANDA_CLAUDE_DIZIN: claude, KUMANDA_DOGRUDAN: '1', KUMANDA_CLAUDE: JSON.stringify([process.execPath, path.join(KOK, 'test', 'sahte-claude.mjs')]) },
});
await new Promise((coz, reddet) => { sunucu.stdout.on('data', d => String(d).includes('çalışıyor') && coz()); sunucu.on('exit', () => reddet(new Error('sunucu açılmadı'))); });
const K = `http://127.0.0.1:${KP}`;
const bekle = ms => new Promise(c => setTimeout(c, ms));

const tarayici = await pw.chromium.launch({ channel: 'chrome', headless: true });
fs.mkdirSync(CIKTI, { recursive: true });
const kaydedilen = [];
try {
  const telefon = await tarayici.newContext({
    viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: 'light', locale: 'tr-TR',
    userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36',
  });
  const s = await telefon.newPage();
  const hatalar = [];
  s.on('pageerror', e => hatalar.push(e.message));
  s.on('console', m => { if (m.type() === 'error') hatalar.push(m.text()); });
  const cek = async ad => { const yol = path.join(CIKTI, `${ad}.png`); await s.screenshot({ path: yol }); kaydedilen.push(yol); };

  // İlk kurulum: tanıtım örneğine rastgele bir şifre konur (yalnızca bu geçici örnekte).
  await s.goto(K);
  const sifre = crypto.randomBytes(12).toString('hex');
  await s.fill('#sifre', sifre); await s.fill('#tekrar', sifre);
  await s.click('button[type=submit]');
  await s.waitForSelector('.satir');
  await bekle(300);
  await cek('telefon-projeler');

  await s.click('text=Hava Durumu');
  await s.waitForSelector('text=Haftalık tahmin ekranı');
  await s.click('text=Ürünler >> nth=-1');
  await s.waitForSelector('.oturum-grubu');
  await bekle(300);
  await cek('telefon-urunler');

  await s.goto(`${K}/#/p/${(await (await s.request.get(`${K}/api/projeler`)).json()).projeler.find(p => p.ad === 'Hava Durumu').kimlik}/s/${anaSohbet}`);
  await s.waitForSelector('table');
  await s.fill('textarea', 'Bir izin iste. komut: npm run build:android');
  await s.click('button[type=submit]');
  await s.waitForSelector('.izin:not(.bitti)');
  await bekle(400);
  await s.evaluate(() => { const k = document.querySelector('#ana .kaydir'); k.scrollTop = k.scrollHeight; });
  await cek('telefon-izin');
  await s.click('.izin >> text=İzin ver');
  await s.waitForSelector('text=Komut çalıştı.');
  const sohbetAdresi = s.url();

  // Bütün ürünler: proje → sohbet grupları; bir ürün gizlenir ve "Gizlediklerin" kutusuna geçer.
  await s.goto(`${K}/#/urunler`);
  await s.waitForSelector('.proje-grubu');
  await s.locator('.urun', { hasText: 'HavaDurumu-kurulum.exe' }).getByText('Gizle', { exact: true }).click();
  await s.waitForSelector('details.gizlenen');
  await s.click('details.gizlenen > summary');
  await bekle(300);
  await cek('telefon-tum-urunler');
  // İkinci ürünü de gizle: "Göster" ile biri geri alınınca kutu açık kalmalı, "Hepsini göster" kalanları alır.
  await s.locator('.urun', { hasText: 'tanitim.mp4' }).getByText('Gizle', { exact: true }).click();
  await s.waitForSelector('details.gizlenen[open] >> text=tanitim.mp4');
  await s.locator('details.gizlenen .urun', { hasText: 'HavaDurumu-kurulum.exe' }).getByText('Göster', { exact: true }).click();
  await s.waitForSelector('details.gizlenen > summary >> text=Gizlediklerin (1)'); // (waitForFunction CSP'ye takılır)
  if (!(await s.$('details.gizlenen[open]'))) hatalar.push('"Göster"den sonra Gizlediklerin kutusu kapandı');
  await s.getByText('Gizlenenleri göster (1)').click();
  await s.waitForSelector('details.gizlenen', { state: 'detached' });

  // Telefonda dosya gezgini (çekmece) ve sola kaydırarak kapatma; sağa kaydırınca proje listesi.
  const hava = (await (await s.request.get(`${K}/api/projeler`)).json()).projeler.find(p => p.ad === 'Hava Durumu').kimlik;
  await s.goto(`${K}/#/p/${hava}/d/${encodeURIComponent('src/ekranlar/ana.js')}`);
  await s.waitForSelector('.kod-gorunum .s-anahtar');
  await s.click('.gezgin-dugme');
  await s.waitForSelector('#gezgin .agac-satir.secili');
  await bekle(300);
  await cek('telefon-dosyalar');
  const kaydir = async (x0, x1) => s.evaluate(([a, b]) => {
    const t = (x, tur) => new TouchEvent(tur, { bubbles: true, touches: tur === 'touchend' ? [] : [new Touch({ identifier: 1, target: document.querySelector('#ana'), clientX: x, clientY: 400 })],
      changedTouches: [new Touch({ identifier: 1, target: document.querySelector('#ana'), clientX: x, clientY: 400 })] });
    const hedef = document.querySelector('#ana .ust');
    hedef.dispatchEvent(t(a, 'touchstart')); hedef.dispatchEvent(t(b, 'touchend'));
  }, [x0, x1]);
  await kaydir(300, 80);
  if (await s.$('#uyg.gezgin-cekmece')) hatalar.push('sola kaydırma gezgini kapatmadı');
  await kaydir(60, 300);
  if (!(await s.$('#uyg.yan-cekmece'))) hatalar.push('sağa kaydırma proje listesini açmadı');
  await s.click('.perde', { position: { x: 380, y: 400 } });

  const masaustu = await tarayici.newContext({ viewport: { width: 1280, height: 800 }, colorScheme: 'dark', locale: 'tr-TR', storageState: await telefon.storageState() });
  const m = await masaustu.newPage();
  m.on('pageerror', e => hatalar.push(e.message));
  await m.goto(sohbetAdresi);
  await m.waitForSelector('table');
  await bekle(500);
  const yol = path.join(CIKTI, 'masaustu-sohbet.png'); await m.screenshot({ path: yol }); kaydedilen.push(yol);

  // Masaüstü: proje listesi kenarından daraltılır, gezgin açılır, dosya renklendirilmiş görünür.
  await m.goto(`${K}/#/p/${hava}/d/${encodeURIComponent('src/ekranlar/ana.js')}`);
  await m.waitForSelector('.kod-gorunum .s-anahtar');
  if (!(await m.$('#uyg.gezgin-acik'))) await m.click('.gezgin-dugme');
  await m.waitForSelector('#gezgin .agac-satir.secili');
  const tut = await m.$('#yan .tutamac');
  const kutu = await tut.boundingBox();
  await m.mouse.move(kutu.x + 4, 300); await m.mouse.down(); await m.mouse.move(250, 300, { steps: 5 }); await m.mouse.up();
  const gen = await m.evaluate(() => document.querySelector('#yan').getBoundingClientRect().width);
  if (Math.abs(gen - 250) > 6) hatalar.push(`sürükleyince sol bar 250 px olmadı (${gen})`);
  await bekle(300);
  const yol2 = path.join(CIKTI, 'masaustu-dosyalar.png'); await m.screenshot({ path: yol2 }); kaydedilen.push(yol2);
  await m.mouse.move(250, 300); await m.mouse.down(); await m.mouse.move(40, 300, { steps: 5 }); await m.mouse.up();
  if (!(await m.$('#uyg.yan-kapali'))) hatalar.push('eşiğin altına sürükleyince sol bar kapanmadı');
  await m.click('.yan-dugme');
  if (await m.$('#uyg.yan-kapali')) hatalar.push('☰ sol barı açmadı');
  await m.keyboard.press('Control+b');
  if (!(await m.$('#uyg.yan-kapali'))) hatalar.push('Ctrl+B sol barı kapatmadı');
  await m.keyboard.press('Control+b');
  await m.goto(`${K}/#/p/${hava}/d/README.md`);
  await m.waitForSelector('.md-onizleme h1');

  if (hatalar.length) { console.error('Sayfa hataları:\n' + hatalar.join('\n')); process.exitCode = 1; }
} finally {
  await tarayici.close();
  sunucu.kill();
  await bekle(500);
  fs.rmSync(gecici, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
console.log(kaydedilen.map(k => path.relative(KOK, k)).join('\n'));
