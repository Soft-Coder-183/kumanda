// Uçtan uca testler: gerçek sunucu süreci + sahte Claude (kullanım kotası harcamaz).
// Çalıştır: npm test
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import http from 'node:http';
import { spawn, spawnSync } from 'node:child_process';

const KOK = path.resolve(import.meta.dirname, '..');
const gecici = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'kumanda-test-'));
const veri = path.join(gecici, 'veri'), claudeDizin = path.join(gecici, 'claude'), projeler = path.join(gecici, 'projeler');
const SIFRE = 'deneme-sifresi-123';
let K, U, sunucu, cerez = '', alfa, oturum, nesil;

const bosPort = () => new Promise(coz => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => coz(p)); }); });
const yazDosya = (yol, icerik) => { fs.mkdirSync(path.dirname(yol), { recursive: true }); fs.writeFileSync(yol, icerik); };
// KUMANDA_DOGRUDAN: --arkaplan WMI yerine doğrudan başlatsın (WMI ile başlayan süreç bu ortam değişkenlerini devralmaz).
const ortam = () => ({ ...process.env, KUMANDA_DOGRUDAN: '1', KUMANDA_VERI: veri, KUMANDA_CLAUDE_DIZIN: claudeDizin, KUMANDA_CLAUDE: JSON.stringify([process.execPath, path.join(KOK, 'test', 'sahte-claude.mjs')]) });

async function iste(yol, { govde, baslik = {}, cerezli = true, taban = K, yontem } = {}) {
  const r = await fetch(taban + yol, {
    method: yontem || (govde === undefined ? 'GET' : 'POST'), redirect: 'manual',
    headers: { ...(govde === undefined ? {} : { 'Content-Type': 'application/json', 'X-Kumanda': '1' }), ...(cerezli && cerez ? { Cookie: cerez } : {}), ...baslik },
    body: govde === undefined ? undefined : JSON.stringify(govde),
  });
  const metin = await r.text();
  let j = null;
  try { j = JSON.parse(metin); } catch { /* json değil */ }
  return { kod: r.status, j, metin, baslik: r.headers };
}

/** SSE akışını `kosul` sağlanana kadar okur; görülen olayları döndürür. */
async function akis(sonra, kosul, { yanEtki, sure = 8000 } = {}) {
  const denetim = new AbortController();
  const zaman = setTimeout(() => denetim.abort(), sure);
  const olaylar = [];
  try {
    const r = await fetch(`${K}/api/oturum/${oturum}/akis${sonra ? `?sonra=${encodeURIComponent(sonra)}` : ''}`, { headers: { Cookie: cerez }, signal: denetim.signal });
    assert.equal(r.status, 200);
    let tampon = '';
    for await (const parca of r.body) {
      tampon += Buffer.from(parca).toString('utf8');
      let i;
      while ((i = tampon.indexOf('\n\n')) >= 0) {
        const blok = tampon.slice(0, i); tampon = tampon.slice(i + 2);
        const satir = blok.split('\n').find(s => s.startsWith('data: '));
        if (!satir) continue;
        const o = JSON.parse(satir.slice(6));
        olaylar.push(o);
        await yanEtki?.(o, olaylar);
        if (kosul(o, olaylar)) { denetim.abort(); return olaylar; }
      }
    }
  } catch (e) { if (e.name !== 'AbortError') throw e; }
  finally { clearTimeout(zaman); }
  if (!olaylar.some(o => kosul(o, olaylar))) assert.fail(`Akış koşulu sağlanmadı. Görülenler: ${olaylar.map(o => o.t).join(',')}`);
  return olaylar;
}
const gonder = (metin, ek = {}) => iste(`/api/proje/${alfa}/gonder`, { govde: { oturum, metin, ...ek } });
const sonucMu = o => o.t === 'sonuc';

before(async () => {
  const [kp, up] = [await bosPort(), await bosPort()];
  K = `http://127.0.0.1:${kp}`; U = `http://127.0.0.1:${up}`;
  yazDosya(path.join(veri, 'ayar.json'), JSON.stringify({ kumandaPort: kp, urunPort: up, kokler: [projeler] }));
  yazDosya(path.join(projeler, 'Alfa', 'index.html'), '<!doctype html><title>Alfa Sitesi</title><h1>alfa</h1>');
  yazDosya(path.join(projeler, 'Alfa', 'site', 'index.html'), '<title>Site</title><script src="/varlik.js"></script>');
  yazDosya(path.join(projeler, 'Alfa', 'site', 'varlik.js'), 'console.log("varlık")');
  yazDosya(path.join(projeler, 'Alfa', 'dist', 'uyg-1.0.0.apk'), 'eski-apk');
  yazDosya(path.join(projeler, 'Alfa', 'dist', 'uyg-1.10.0.apk'), 'yeni-apk-icerik');
  yazDosya(path.join(projeler, 'Alfa', 'node_modules', 'x', 'index.html'), '<title>bağımlılık</title>');
  yazDosya(path.join(projeler, 'Alfa', '.gizli', 'sir.txt'), 'sır');
  yazDosya(path.join(projeler, 'Alfa', 'kaynak', 'index.html'), '<div id="app"></div><script type="module" src="/src/main.ts"></script>');
  yazDosya(path.join(gecici, 'disarida.txt'), 'proje dışı');
  fs.mkdirSync(path.join(projeler, 'Beta'), { recursive: true });
  fs.mkdirSync(path.join(projeler, 'Kap', 'Ic'), { recursive: true });
  fs.mkdirSync(path.join(claudeDizin, 'projects', path.join(projeler, 'Kap', 'Ic').replace(/[^a-zA-Z0-9]/g, '-')), { recursive: true });

  sunucu = spawn(process.execPath, [path.join(KOK, 'sunucu.mjs')], { env: ortam(), stdio: ['ignore', 'pipe', 'pipe'] });
  let cikti = '';
  sunucu.stderr.on('data', d => { cikti += d; });
  await new Promise((coz, reddet) => {
    sunucu.stdout.on('data', d => { cikti += d; if (cikti.includes('çalışıyor')) coz(); });
    sunucu.on('exit', kod => reddet(new Error(`Sunucu başlamadı (${kod}): ${cikti}`)));
    setTimeout(() => reddet(new Error(`Sunucu zaman aşımı: ${cikti}`)), 8000);
  });
});

after(() => {
  sunucu?.kill();
  fs.rmSync(gecici, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

test('ilk kurulum yalnızca yerelden ve yeterli uzunlukta şifreyle', async () => {
  const d = await iste('/api/durum');
  assert.deepEqual([d.j.kurulu, d.j.yerel, d.j.giris], [false, true, false]);
  assert.equal((await iste('/api/kurulum', { govde: { sifre: SIFRE }, baslik: { 'X-Forwarded-For': '8.8.8.8' } })).kod, 403, 'tünelden kurulum reddedilmeli');
  // fetch Host başlığını değiştirtmez; DNS yeniden bağlama saldırısını ham istekle taklit et.
  const yabanciHost = await new Promise(coz => {
    const istek = http.request(`${K}/api/kurulum`, { method: 'POST', headers: { Host: 'kotu.example', 'Content-Type': 'application/json', 'X-Kumanda': '1' } }, r => { r.resume(); coz(r.statusCode); });
    istek.end(JSON.stringify({ sifre: SIFRE }));
  });
  assert.equal(yabanciHost, 403, 'yabancı Host ile kurulum reddedilmeli');
  assert.equal((await iste('/api/kurulum', { govde: { sifre: 'kisa' } })).kod, 400);
  const r = await iste('/api/kurulum', { govde: { sifre: SIFRE } });
  assert.equal(r.kod, 200);
  cerez = r.baslik.get('set-cookie').split(';')[0];
  assert.match(r.baslik.get('set-cookie'), /HttpOnly/);
  assert.equal((await iste('/api/kurulum', { govde: { sifre: SIFRE } })).kod, 409, 'ikinci kurulum reddedilmeli');
  assert.equal(JSON.parse(fs.readFileSync(path.join(veri, 'ayar.json'), 'utf8')).sifre.ozet.length, 128, 'şifre düz metin saklanmaz');
});

test('giriş: yanlış şifre sayılır, beşinciden sonra kilitlenir; doğru şifre çerez verir', async () => {
  const kotu = { 'X-Forwarded-For': '9.9.9.9' };
  for (let i = 0; i < 5; i++) assert.equal((await iste('/api/giris', { govde: { sifre: 'yanlis-sifre-000' }, baslik: kotu, cerezli: false })).kod, 401);
  assert.equal((await iste('/api/giris', { govde: { sifre: SIFRE }, baslik: kotu, cerezli: false })).kod, 429, 'kilitliyken doğru şifre de reddedilir');
  const r = await iste('/api/giris', { govde: { sifre: SIFRE }, baslik: { 'X-Forwarded-For': '7.7.7.7' }, cerezli: false });
  assert.equal(r.kod, 200);
  assert.ok(r.baslik.get('set-cookie').includes('kumanda_o='));
});

test('API çerezsiz, yabancı kökenden ya da özel başlıksız kullanılamaz', async () => {
  assert.equal((await iste('/api/projeler', { cerezli: false })).kod, 401);
  assert.equal((await iste('/api/projeler', { baslik: { Origin: U } })).kod, 403, 'ürün kökeninden istek');
  assert.equal((await iste('/api/projeler', { baslik: { 'Sec-Fetch-Site': 'same-site' } })).kod, 403);
  assert.equal((await iste('/api/cikis', { yontem: 'POST' })).kod, 403, 'X-Kumanda başlığı yok');
  assert.equal((await iste('/api/projeler', { baslik: { Origin: K, 'Sec-Fetch-Site': 'same-origin' } })).kod, 200);
});

test('projeler: kök altındakiler ve kap klasörün içindeki tanınan proje', async () => {
  const { j } = await iste('/api/projeler');
  const adlar = j.projeler.map(p => p.ad).sort();
  assert.deepEqual(adlar, ['Alfa', 'Beta', 'Kap / Ic']);
  alfa = j.projeler.find(p => p.ad === 'Alfa').kimlik;
  assert.equal(j.projeler.find(p => p.ad === 'Alfa').urunSayisi, 3);
});

test('ürünler: başlık okunur, eski sürüm ikincildir, bağımlılık/kaynak/gizli klasörler taranmaz', async () => {
  const { j } = await iste(`/api/proje/${alfa}/urunler`);
  const yollar = Object.fromEntries(j.urunler.map(u => [u.yol, u]));
  assert.deepEqual(Object.keys(yollar).sort(), ['dist/uyg-1.0.0.apk', 'dist/uyg-1.10.0.apk', 'index.html', 'site/index.html']);
  assert.equal(yollar['index.html'].baslik, 'Alfa Sitesi');
  assert.equal(yollar['dist/uyg-1.0.0.apk'].ikincil, 'eski sürüm');
  assert.equal(yollar['dist/uyg-1.10.0.apk'].ikincil, undefined);
  await iste(`/api/proje/${alfa}/urun-gizle`, { govde: { yol: 'site/index.html', gizli: true } });
  assert.equal((await iste(`/api/proje/${alfa}/urunler`)).j.urunler.length, 3);
  assert.equal((await iste(`/api/proje/${alfa}/urunler?gizliler`)).j.urunler.find(u => u.yol === 'site/index.html').gizli, true);
  await iste(`/api/proje/${alfa}/urun-gizle`, { govde: { yol: 'site/index.html', gizli: false } });
});

let urunCerez = '';
test('ürün sunucusu: biletle giriş, dosya sunma, proje dışına çıkamama', async () => {
  const urun = (yol, baslik = {}) => iste(yol, { taban: U, cerezli: false, baslik: { ...(urunCerez ? { Cookie: urunCerez } : {}), ...baslik } });
  assert.equal((await urun(`/p/${alfa}/index.html`)).kod, 401, 'çerezsiz ürün açılmaz');
  assert.equal((await iste(`/ac?p=${alfa}&y=index.html`, { cerezli: false })).kod, 302);
  assert.equal((await iste(`/ac?p=${alfa}&y=index.html`, { cerezli: false })).baslik.get('location'), '/', 'girişsiz /ac ana sayfaya döner');

  const ac = await iste(`/ac?p=${alfa}&y=${encodeURIComponent('dist/uyg-1.10.0.apk')}&indir=1`);
  const hedef = ac.baslik.get('location');
  assert.ok(hedef.startsWith(`${U}/_ac?b=`), hedef);
  const gecis = await fetch(hedef, { redirect: 'manual' });
  assert.equal(gecis.status, 302);
  urunCerez = gecis.headers.get('set-cookie').split(';')[0];
  assert.ok(urunCerez.startsWith('kumanda_u='));
  assert.equal((await fetch(hedef, { redirect: 'manual' })).status, 403, 'bilet tek kullanımlık');

  const apk = await urun(gecis.headers.get('location'));
  assert.equal(apk.kod, 200);
  assert.equal(apk.metin, 'yeni-apk-icerik');
  assert.equal(apk.baslik.get('content-type'), 'application/vnd.android.package-archive');
  assert.match(apk.baslik.get('content-disposition'), /attachment/);

  const sayfa = await urun(`/p/${alfa}/index.html`);
  assert.equal(sayfa.kod, 200);
  assert.match(sayfa.metin, /alfa/);
  assert.equal((await urun(`/p/${alfa}/site/`)).kod, 200, 'klasör isteği index.html verir');
  assert.equal((await urun(`/p/${alfa}/index.html`, { Range: 'bytes=0-4' })).kod, 206);
  assert.equal((await urun('/varlik.js', { Referer: `${U}/p/${alfa}/site/index.html` })).metin, 'console.log("varlık")', 'kök-mutlak yol Referer klasöründen çözülür');
  assert.equal((await urun(`/p/${alfa}/.gizli/sir.txt`)).kod, 404);
  assert.equal((await urun(`/p/${alfa}/yok.html`)).kod, 404);

  // fetch "../" içeren yolu kendisi sadeleştirir; ham istekle dene.
  const ham = yol => new Promise(coz => http.get(`${U}${yol}`, { headers: { Cookie: urunCerez } }, r => { r.resume(); coz(r.statusCode); }));
  assert.equal(await ham(`/p/${alfa}/%2e%2e/%2e%2e/disarida.txt`), 404);
  assert.equal(await ham(`/p/${alfa}/..%5c..%5cdisarida.txt`), 404);
  assert.equal(await ham(`/p/${alfa}/site/../../../disarida.txt`), 404);
});

test('sohbet: istem gider, yanıt akar, tur biter', async () => {
  assert.equal((await gonder('x', { efor: 'cok' })).kod, 400, 'geçersiz effort');
  const r = await gonder('merhaba dünya', { mod: 'default', efor: 'low' });
  assert.equal(r.kod, 200);
  ({ oturum, nesil } = r.j);
  assert.match(oturum, /^[0-9a-f-]{36}$/);
  const olaylar = await akis('', sonucMu);
  assert.equal(olaylar[0].t, 'durum');
  assert.equal(olaylar.find(o => o.t === 'kullanici').metin, 'merhaba dünya');
  assert.equal(olaylar.find(o => o.t === 'metin').metin, 'Yanıt: **merhaba dünya** (mod: default, efor: low)', 'effort süreç açılırken --effort ile verilir');
  assert.equal(olaylar[0].efor, 'low');
  assert.equal(olaylar.at(-1).hata, null);
  const liste = await iste(`/api/proje/${alfa}`);
  assert.equal(liste.j.oturumlar[0].kimlik, oturum);
  assert.equal(liste.j.oturumlar[0].canli, 'hazir');
  assert.equal(liste.j.oturumlar[0].baslik, 'merhaba dünya');
});

test('izin isteği: izin ver / hep izin ver / reddet', async () => {
  for (const [karar, beklenen] of [['izin', 'Komut çalıştı.'], ['hep', 'Komut çalıştı (kural kaydedildi).'], ['red', 'Komut reddedildi.']]) {
    await gonder(`izin dene ${karar}`);
    const olaylar = await akis(`${nesil}:0`, (o, hepsi) => sonucMu(o) && hepsi.some(x => x.t === 'kullanici' && x.metin === `izin dene ${karar}`), {
      yanEtki: async (o, hepsi) => {
        if (o.t !== 'izin' || hepsi.some(x => x.t === 'izin-yanit' && x.istek === o.istek)) return;
        assert.equal(o.ad, 'Bash');
        assert.equal(o.girdi.command, 'echo merhaba');
        assert.equal(o.hep, true);
        const y = await iste(`/api/oturum/${oturum}/izin`, { govde: { istek: o.istek, karar } });
        assert.ok([200, 409].includes(y.kod));
      },
    });
    const sonMetin = olaylar.filter(o => o.t === 'metin').at(-1).metin;
    assert.equal(sonMetin, beklenen);
    assert.equal(olaylar.filter(o => o.t === 'izin-yanit').at(-1).karar, karar);
  }
});

test('Claude\'un sorusu yanıtlanır', async () => {
  await gonder('bir soru sor');
  const olaylar = await akis(`${nesil}:0`, (o, hepsi) => sonucMu(o) && hepsi.some(x => x.t === 'metin' && x.metin.startsWith('Seçimin')), {
    yanEtki: async (o, hepsi) => {
      if (o.t === 'izin' && o.ad === 'AskUserQuestion' && !hepsi.some(x => x.t === 'izin-yanit' && x.istek === o.istek)) {
        await iste(`/api/oturum/${oturum}/izin`, { govde: { istek: o.istek, karar: 'izin', yanitlar: { 'Çay mı kahve mi?': 'Çay' } } });
      }
    },
  });
  assert.equal(olaylar.filter(o => o.t === 'metin').at(-1).metin, 'Seçimin: Çay');
});

test('durdurma ve kaldığı yerden yeniden bağlanma', async () => {
  await gonder('uzun bir yanıt yaz');
  let kesildi = false, sonSira = 0;
  const olaylar = await akis(`${nesil}:0`, (o, hepsi) => sonucMu(o) && hepsi.some(x => x.t === 'yaz'), {
    yanEtki: async (o, hepsi) => {
      if (o.n) sonSira = o.n;
      if (o.t === 'yaz' && !kesildi && hepsi.filter(x => x.t === 'yaz').length >= 3) { kesildi = true; await iste(`/api/oturum/${oturum}/kes`, { govde: {} }); }
    },
  });
  assert.equal(olaylar.at(-1).kesildi, true);
  assert.equal(olaylar.at(-1).hata, null);
  assert.ok(olaylar.some(o => o.t === 'not' && o.metin === 'Durduruldu'));

  await gonder('kısa');
  const devam = await akis(`${nesil}:${sonSira}`, sonucMu);
  assert.ok(devam.filter(o => o.n).every(o => o.n > sonSira), 'yalnızca kaçırılan olaylar gelir');
  assert.equal(devam.find(o => o.t === 'kullanici').metin, 'kısa');
  const yabanci = await akis('baska-nesil:5', o => o.t === 'kullanici');
  assert.equal(yabanci[1].t, 'yenile', 'başka nesilden gelen istemciye geçmişi yenilet');
});

test('mod değişimi çalışan sürece iletilir', async () => {
  const r = await iste(`/api/oturum/${oturum}/mod`, { govde: { mod: 'plan' } });
  assert.equal(r.j.mod, 'plan');
  assert.equal((await iste(`/api/oturum/${oturum}/mod`, { govde: { mod: 'olmayan' } })).kod, 400);
  await gonder('mod denemesi');
  const olaylar = await akis(`${nesil}:0`, (o, hepsi) => sonucMu(o) && hepsi.some(x => x.t === 'metin' && x.metin.includes('mod denemesi')));
  assert.match(olaylar.filter(o => o.t === 'metin').at(-1).metin, /mod: plan/);
});

test('effort çalışan oturumda değişir ve varsayılana döner', async () => {
  const r = await iste(`/api/oturum/${oturum}/mod`, { govde: { efor: 'max' } });
  assert.equal(r.j.efor, 'max');
  assert.equal((await iste(`/api/oturum/${oturum}/mod`, { govde: { efor: 'cok' } })).kod, 400);
  const son = async metin => {
    await gonder(metin);
    const olaylar = await akis(`${nesil}:0`, (o, hepsi) => sonucMu(o) && hepsi.some(x => x.t === 'metin' && x.metin.includes(metin)));
    return olaylar.filter(o => o.t === 'metin').at(-1).metin;
  };
  assert.match(await son('effort bir'), /efor: max/);
  await gonder('effort iki', { efor: 'xhigh' }); // istemle birlikte gelen effort da uygulanır
  assert.match((await akis(`${nesil}:0`, (o, hepsi) => sonucMu(o) && hepsi.some(x => x.t === 'metin' && x.metin.includes('effort iki')))).filter(o => o.t === 'metin').at(-1).metin, /efor: xhigh/);
  assert.equal((await iste(`/api/oturum/${oturum}/mod`, { govde: { efor: '' } })).j.efor, '');
  assert.match(await son('effort üç'), /efor: ayar/, 'boş seçim kullanıcının Claude Code ayarına döndürür');
});

test('süreç kapanınca geçmiş transkriptten okunur; yeni istem oturumu sürdürür', async () => {
  const canliyken = await iste(`/api/proje/${alfa}/oturum/${oturum}`);
  assert.equal(canliyken.j.ogeler.length, 0, 'canlı koşuda geçmiş, koşudan önceki kısımdır');
  assert.equal(canliyken.j.canli.durum, 'hazir');
  await iste(`/api/oturum/${oturum}/kapat`, { govde: {} });
  await akis('', o => o.t === 'durum' && o.durum === 'kapali');
  const eskiNesil = nesil;
  const r = await gonder('devam ediyoruz');
  assert.equal(r.j.oturum, oturum);
  nesil = r.j.nesil;
  assert.notEqual(nesil, eskiNesil);
  await akis('', sonucMu);
  const gecmis = await iste(`/api/proje/${alfa}/oturum/${oturum}`);
  const metinler = gecmis.j.ogeler.filter(o => o.t === 'kullanici').map(o => o.metin);
  assert.deepEqual(metinler.slice(0, 2), ['merhaba dünya', 'izin dene izin']);
  assert.ok(!metinler.includes('devam ediyoruz'), 'yeni koşunun olayları geçmişte tekrar etmez');
  assert.ok(gecmis.j.ogeler.some(o => o.t === 'arac' && o.ad === 'Bash'));
  assert.ok(gecmis.j.ogeler.some(o => o.t === 'arac-sonuc' && o.metin === 'merhaba'));
  assert.equal((await gonder('', {})).kod, 400);
  assert.equal((await iste(`/api/proje/${alfa}/gonder`, { govde: { oturum: '00000000-0000-4000-8000-000000000000', metin: 'x' } })).kod, 404);
});

test('çıkış: kumanda ve ürün çerezleri birlikte geçersizleşir', async () => {
  assert.equal((await iste('/api/cikis', { govde: {} })).kod, 200);
  assert.equal((await iste('/api/projeler')).kod, 401);
  assert.equal((await iste(`/p/${alfa}/index.html`, { taban: U, cerezli: false, baslik: { Cookie: urunCerez } })).kod, 401);
});

test('--sifre-sifirla çalışan sunucuda da bütün cihazları çıkarır ve sunucuyu yeniden başlatır', async () => {
  const giris = await iste('/api/giris', { govde: { sifre: SIFRE }, cerezli: false });
  cerez = giris.baslik.get('set-cookie').split(';')[0];
  assert.equal((await iste('/api/projeler')).kod, 200);
  const cikis = new Promise(coz => sunucu.on('exit', coz));
  const r = spawnSync(process.execPath, [path.join(KOK, 'sunucu.mjs'), '--sifre-sifirla'], { env: ortam(), encoding: 'utf8', timeout: 20000 });
  assert.match(r.stdout, /yeniden başlatıldı/);
  await cikis; // eski süreç (bellekteki oturumlarıyla) kapandı
  let d = null;
  for (let i = 0; i < 40 && !d; i++) { try { d = (await iste('/api/durum')).j; } catch { await new Promise(c => setTimeout(c, 250)); } }
  assert.equal(d?.kurulu, false, 'yeni süreçte şifre yok');
  assert.equal((await iste('/api/projeler')).kod, 401, 'sıfırlamadan önceki cihaz çıkarılmış');
});

test('--durdur çalışan sunucuyu kapatır', async () => {
  // Önceki testte yeniden başlatılan, ayrık (detached) süreç.
  const r = spawnSync(process.execPath, [path.join(KOK, 'sunucu.mjs'), '--durdur'], { env: ortam(), encoding: 'utf8', timeout: 20000 });
  assert.match(r.stdout, /durduruldu/);
  await assert.rejects(fetch(`${K}/api/durum`), 'sunucu kapandı');
  assert.match(spawnSync(process.execPath, [path.join(KOK, 'sunucu.mjs'), '--durdur'], { env: ortam(), encoding: 'utf8' }).stdout, /çalışmıyor/);
});
