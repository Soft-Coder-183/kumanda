// Kumanda arayüzü: bağımlılıksız, derleme adımı olmayan tek sayfa uygulaması.
const uyg = document.getElementById('uyg');

// ───────── yardımcılar ─────────
function h(etiket, oz, ...cocuklar) {
  const e = document.createElement(etiket);
  for (const [k, v] of Object.entries(oz || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'html') e.innerHTML = v;
    else if (k === 'dataset') Object.assign(e.dataset, v);
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k in e) e[k] = v;
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of cocuklar.flat(Infinity)) if (c != null && c !== false) e.append(c.nodeType ? c : document.createTextNode(String(c)));
  return e;
}

class ApiHata extends Error { constructor(kod, mesaj) { super(mesaj); this.kod = kod; } }

// crypto.randomUUID yalnızca güvenli bağlamda var (localhost/https); yoksa aynı biçimi getRandomValues ile üret.
const kimlikUret = () => crypto.randomUUID?.()
  || '10000000-1000-4000-8000-100000000000'.replace(/[018]/g, c => (c ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (c / 4)))).toString(16));

async function api(yol, govde) {
  const r = await fetch(yol, govde === undefined ? {} : {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Kumanda': '1' }, body: JSON.stringify(govde),
  });
  let j = {};
  try { j = await r.json(); } catch { /* gövdesiz yanıt */ }
  if (r.status === 401 && !/^\/api\/(giris|sifre|kurulum)/.test(yol)) { girisGoster(); throw new ApiHata(401, 'Giriş gerekli'); }
  if (!r.ok) throw new ApiHata(r.status, j.hata || `Hata (${r.status})`);
  return j;
}

let seritSayaci;
function bildir(mesaj) {
  document.querySelector('.bildirim-seridi')?.remove();
  const e = h('div', { class: 'bildirim-seridi', role: 'status' }, mesaj);
  document.body.append(e);
  clearTimeout(seritSayaci);
  seritSayaci = setTimeout(() => e.remove(), 3500);
}

const kac = s => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function goreliZaman(ms) {
  if (!ms) return '';
  const fark = Date.now() - ms;
  if (fark < 60e3) return 'şimdi';
  if (fark < 3600e3) return `${Math.floor(fark / 60e3)} dk önce`;
  if (fark < 86400e3) return `${Math.floor(fark / 3600e3)} sa önce`;
  if (fark < 7 * 86400e3) return `${Math.floor(fark / 86400e3)} gün önce`;
  return new Date(ms).toLocaleDateString('tr-TR', { day: 'numeric', month: 'short', year: fark > 300 * 86400e3 ? 'numeric' : undefined });
}
function boyutYaz(b) {
  if (b < 1024) return `${b} B`;
  if (b < 1048576) return `${Math.round(b / 1024)} KB`;
  return `${(b / 1048576).toFixed(b < 10485760 ? 1 : 0)} MB`;
}
function sureYaz(ms) {
  if (!ms) return '';
  const sn = Math.round(ms / 1000);
  return sn < 60 ? `${sn} sn` : `${Math.floor(sn / 60)} dk ${sn % 60} sn`;
}

// ───────── küçük Markdown çevirici (önce kaçış, sonra biçim: HTML enjeksiyonu olmaz) ─────────
function satirIci(s) {
  const kodlar = [];
  s = s.replace(/`([^`\n]+)`/g, (_, k) => { kodlar.push(k); return `\u0000${kodlar.length - 1}\u0000`; });
  s = kac(s);
  s = s.replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, (_, t, u) => `<a href="${u}" target="_blank" rel="noopener noreferrer">${t}</a>`);
  s = s.replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, (_, o, u) => `${o}<a href="${u}" target="_blank" rel="noopener noreferrer">${u}</a>`);
  s = s.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*\w])\*([^*\s][^*\n]*)\*(?!\w)/g, '$1<em>$2</em>')
    .replace(/~~([^~\n]+)~~/g, '<del>$1</del>');
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${kac(kodlar[i])}</code>`);
}
const girinti = s => /^\s*/.exec(s)[0].replace(/\t/g, '  ').length;
const MADDE = /^\s*([-*+]|\d+[.)])\s+(.*)$/;
const hucreler = s => s.trim().replace(/^\||\|$/g, '').split('|').map(x => x.trim());

function md(kaynak) {
  const satirlar = String(kaynak).replace(/\r/g, '').split('\n');
  const cikti = [], paragraf = [];
  const bosalt = () => { if (paragraf.length) { cikti.push(`<p>${paragraf.map(satirIci).join('<br>')}</p>`); paragraf.length = 0; } };
  let i = 0;
  while (i < satirlar.length) {
    const s = satirlar[i];
    let m;
    if ((m = /^\s*(```|~~~)/.exec(s))) {
      bosalt();
      const kod = [];
      for (i++; i < satirlar.length && !satirlar[i].trimStart().startsWith(m[1]); i++) kod.push(satirlar[i]);
      i++;
      cikti.push(`<pre><code>${kac(kod.join('\n'))}</code></pre>`);
    } else if (!s.trim()) { bosalt(); i++; }
    else if ((m = /^(#{1,6})\s+(.*)$/.exec(s))) {
      bosalt();
      const d = Math.min(m[1].length, 4);
      cikti.push(`<h${d}>${satirIci(m[2])}</h${d}>`); i++;
    } else if (/^\s*([-*_])\s*(\1\s*){2,}$/.test(s)) { bosalt(); cikti.push('<hr>'); i++; }
    else if (/^\s*>/.test(s)) {
      bosalt();
      const al = [];
      for (; i < satirlar.length && /^\s*>/.test(satirlar[i]); i++) al.push(satirlar[i].replace(/^\s*>\s?/, ''));
      cikti.push(`<blockquote>${md(al.join('\n'))}</blockquote>`);
    } else if (s.includes('|') && i + 1 < satirlar.length && /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(satirlar[i + 1])) {
      bosalt();
      const bas = hucreler(s);
      const govde = [];
      for (i += 2; i < satirlar.length && satirlar[i].includes('|') && satirlar[i].trim(); i++) govde.push(hucreler(satirlar[i]));
      cikti.push(`<div class="tablo-sar"><table><thead><tr>${bas.map(x => `<th>${satirIci(x)}</th>`).join('')}</tr></thead><tbody>${
        govde.map(r => `<tr>${r.map(x => `<td>${satirIci(x)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`);
    } else if (MADDE.test(s)) {
      bosalt();
      const taban = girinti(s), sirali = /^\s*\d/.test(s), ogeler = [];
      const ayniTur = x => MADDE.test(x) && /^\s*\d/.test(x) === sirali; // "-" listesi ile "1." listesi ayrı listelerdir
      while (i < satirlar.length) {
        const x = satirlar[i];
        if (!x.trim()) {
          const y = satirlar[i + 1];
          if (y && y.trim() && (girinti(y) > taban || (ayniTur(y) && girinti(y) === taban))) { ogeler.at(-1)?.push(''); i++; continue; }
          break;
        }
        const lm = MADDE.exec(x);
        if (lm && girinti(x) <= taban + 1) { if (girinti(x) < taban || !ayniTur(x)) break; ogeler.push([lm[2]]); i++; }
        else if (girinti(x) > taban && ogeler.length) { ogeler.at(-1).push(x); i++; }
        else break;
      }
      const li = ogeler.map(o => {
        const ek = o.slice(1);
        const enAz = Math.min(...ek.filter(x => x.trim()).map(girinti), 99);
        return `<li>${satirIci(o[0])}${ek.some(x => x.trim()) ? md(ek.map(x => x.slice(Math.min(enAz, x.length - x.trimStart().length))).join('\n')) : ''}</li>`;
      });
      cikti.push(sirali ? `<ol>${li.join('')}</ol>` : `<ul>${li.join('')}</ul>`);
    } else { paragraf.push(s); i++; }
  }
  bosalt();
  return cikti.join('');
}

// ───────── cihaz ve ürün uyumu ─────────
const ua = navigator.userAgent;
const CIHAZ = /Android/.test(ua) ? 'android' : (/iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) ? 'ios'
  : /Windows/.test(ua) ? 'windows' : 'diger';
const DOKUNMATIK = matchMedia('(pointer: coarse)').matches;
const TUR_ADI = { web: 'WEB', android: 'APK', windows: 'EXE', paket: 'ZIP', video: 'VİD' };
const turAdi = u => TUR_ADI[u.tur] || u.ad.split('.').pop().toUpperCase().slice(0, 4);

function urunEylemi(u) {
  const pdf = /\.pdf$/i.test(u.ad);
  switch (u.tur) {
    case 'web': return { ad: 'Aç', uyumlu: true };
    case 'video': return { ad: 'İzle', uyumlu: true };
    case 'belge': return pdf ? { ad: 'Aç', uyumlu: true } : { ad: 'İndir', uyumlu: true, indir: true };
    case 'android': return CIHAZ === 'android' ? { ad: 'Yükle', uyumlu: true, indir: true } : { ad: 'İndir', uyumlu: false, indir: true, not: 'Yalnızca Android' };
    case 'windows': return CIHAZ === 'windows' ? { ad: 'İndir', uyumlu: true, indir: true } : { ad: 'İndir', uyumlu: false, indir: true, not: 'Yalnızca Windows' };
    default: return { ad: 'İndir', uyumlu: true, indir: true };
  }
}

const sohbetAdi = o => o?.baslik || 'Başlıksız sohbet';

function urunKarti(pid, u, yenile) {
  const e = urunEylemi(u);
  const adres = `/ac?p=${pid}&y=${encodeURIComponent(u.yol)}${e.indir ? '&indir=1' : ''}`;
  const klasor = u.yol.includes('/') ? u.yol.slice(0, u.yol.lastIndexOf('/')) : '';
  return h('div', { class: `urun${u.gizli ? ' soluk' : ''}` },
    h('div', { class: 'bas' },
      h('div', { class: 'tur' }, turAdi(u)),
      h('div', { style: 'min-width:0' },
        h('div', { class: 'ad' }, u.baslik || u.ad),
        h('div', { class: 'yol' }, u.baslik ? u.yol : (klasor || 'proje kökü')))),
    h('div', { class: 'alt' },
      h('span', { class: 'rozet' }, boyutYaz(u.boyut)),
      h('span', { class: 'rozet' }, goreliZaman(u.zaman)),
      e.not && h('span', { class: 'rozet uyari' }, e.not),
      u.ikincil && h('span', { class: 'rozet' }, u.ikincil),
      h('span', { class: 'bos' }),
      h('button', { class: 'dugme duz kucuk', title: u.gizli ? 'Yeniden göster' : 'Listeden gizle', onclick: async e => {
        const b = e.currentTarget; // await'ten sonra currentTarget boşalır
        b.disabled = true; // seri basışta aynı karta iki kez gitmesin
        try { await api(`/api/proje/${pid}/urun-gizle`, { yol: u.yol, gizli: !u.gizli }); yenile(); } catch (x) { bildir(x.message); b.disabled = false; }
      } }, u.gizli ? 'Göster' : 'Gizle'),
      h('a', { class: `dugme kucuk${e.uyumlu ? ' ana' : ''}`, href: adres, target: '_blank', rel: 'noopener' }, e.ad)));
}

// Açık bırakılan "Diğer dosyalar" / "Gizlediklerin" kutuları: liste yeniden çizilince (ör. "Göster"den sonra) kapanmasınlar.
const acikKutular = new Set();

/** Birden çok ürünü tek istekle gösterir/gizler. */
async function topluGizle(pid, yollar, gizli, yenile, dugme) {
  if (dugme) dugme.disabled = true;
  try { await api(`/api/proje/${pid}/urun-gizle`, { yollar, gizli }); yenile(); }
  catch (x) { bildir(x.message); if (dugme) dugme.disabled = false; }
}
const hepsiniGosterDugmesi = (pid, gizliler, yenile, metin = `Hepsini göster (${gizliler.length})`) =>
  h('button', { class: 'dugme kucuk', type: 'button', title: 'Gizlenen ürünlerin hepsini yeniden listeye al',
    onclick: e => topluGizle(pid, gizliler.map(u => u.yol), false, yenile, e.currentTarget) }, metin);

/** `anahtar`: kutuların açık/kapalı durumunun hatırlandığı ad (aynı sayfada her grup için ayrı). */
function urunIzgarasi(pid, urunler, yenile, anahtar = pid) {
  const asil = urunler.filter(u => !u.ikincil && !u.gizli);
  const ikincil = urunler.filter(u => u.ikincil && !u.gizli);
  const gizli = urunler.filter(u => u.gizli);
  const kutu = (ozet, liste, sinif, ust) => {
    if (!liste.length) return null;
    const k = `${anahtar}|${sinif}`;
    const d = h('details', { class: `diger ${sinif}`, open: acikKutular.has(k), ontoggle: () => (d.open ? acikKutular.add(k) : acikKutular.delete(k)) },
      h('summary', {}, ozet), ust, h('div', { class: 'urunler' }, liste.map(u => urunKarti(pid, u, yenile))));
    return d;
  };
  // Her zaman yalnızca DOM öğelerinden oluşan bir dizi döner (replaceChildren'e yayılarak verilir).
  return [
    asil.length ? h('div', { class: 'urunler' }, asil.map(u => urunKarti(pid, u, yenile))) : null,
    kutu(`Diğer dosyalar (${ikincil.length}): kopyalar, eski sürümler, kaynak dosyaları`, ikincil, 'ikincil'),
    kutu(`Gizlediklerin (${gizli.length}): "Göster" ile geri gelir`, gizli, 'gizlenen',
      gizli.length > 1 && h('div', { class: 'kutu-arac' }, hepsiniGosterDugmesi(pid, gizli, yenile))),
  ].filter(Boolean);
}

/** Yeniden çizerken kaydırma yerini korur (liste değişse de okuduğun yerde kalırsın). */
function yerindeCiz(kap, ...dugumler) {
  const kaydir = kap.closest?.('.kaydir');
  const yer = kaydir?.scrollTop;
  kap.replaceChildren(...dugumler);
  if (kaydir && yer) kaydir.scrollTop = yer;
}

/** Ürünleri, onları üreten sohbete göre gruplar: en son ürün çıkaran sohbet üstte, hiçbir sohbete bağlanamayanlar en altta. */
function oturumGruplari(pid, urunler, oturumlar, yenile) {
  const gruplar = new Map();
  for (const u of urunler) {
    const k = u.oturum || '';
    if (!gruplar.has(k)) gruplar.set(k, []);
    gruplar.get(k).push(u);
  }
  const sira = [...gruplar.entries()].sort(([a, x], [b, y]) =>
    (a === '') - (b === '') || Math.max(...y.map(u => u.zaman)) - Math.max(...x.map(u => u.zaman)));
  return sira.map(([sid, liste]) => h('section', { class: 'oturum-grubu' },
    sid
      ? h('a', { class: 'oturum-bas', href: `#/p/${pid}/s/${sid}` },
        h('span', { class: 'ad' }, sohbetAdi(oturumlar[sid])),
        h('span', { class: 'sonuk kucuk' }, `${goreliZaman(Math.max(...liste.map(u => u.zaman)))} · sohbete git ›`))
      : h('div', { class: 'oturum-bas' },
        h('span', { class: 'ad' }, 'Bir sohbete bağlanamayanlar'),
        h('span', { class: 'sonuk kucuk' }, 'Claude Code dışında ya da çok önce değişmiş dosyalar')),
    urunIzgarasi(pid, liste, yenile, `${pid}|${sid || '-'}`)));
}

// ───────── giriş / ilk kurulum ─────────
let durumBilgisi = null;

function girisGoster() {
  aktif?.kapat?.();
  aktif = null;
  uyg.className = '';
  const kurulum = !durumBilgisi?.kurulu;
  const hata = h('div', { class: 'hata-metni', role: 'alert' });
  const sifre = h('input', { type: 'password', autocomplete: kurulum ? 'new-password' : 'current-password', required: true, id: 'sifre' });
  const tekrar = kurulum ? h('input', { type: 'password', autocomplete: 'new-password', required: true, id: 'tekrar' }) : null;
  const dugme = h('button', { class: 'dugme ana', type: 'submit' }, kurulum ? 'Şifreyi belirle' : 'Giriş yap');
  let icerik;
  if (kurulum && !durumBilgisi?.yerel) {
    icerik = h('p', {}, 'Kumanda henüz kurulmamış. Güvenlik için ilk şifre yalnızca bilgisayarın kendisinden belirlenebilir: bilgisayarında ',
      h('b', {}, 'http://127.0.0.1:7777'), ' adresini aç.');
  } else {
    icerik = h('form', { onsubmit: async e => {
      e.preventDefault();
      hata.textContent = '';
      if (kurulum && sifre.value !== tekrar.value) { hata.textContent = 'Şifreler aynı değil'; return; }
      dugme.disabled = true;
      try { await api(kurulum ? '/api/kurulum' : '/api/giris', { sifre: sifre.value }); location.reload(); }
      catch (x) { hata.textContent = x.message; dugme.disabled = false; }
    } },
      kurulum && h('p', { class: 'sonuk' }, `Bu şifre, bilgisayarında Claude Code çalıştırma yetkisi verir. En az ${durumBilgisi.enAzSifre} karakter; uzun ve başka yerde kullanmadığın bir şifre seç.`),
      h('label', { for: 'sifre' }, 'Şifre'), sifre,
      kurulum && [h('label', { for: 'tekrar' }, 'Şifre (tekrar)'), tekrar],
      dugme, hata);
  }
  uyg.replaceChildren(h('div', { class: 'kaydir' }, h('div', { class: 'giris' },
    h('h1', {}, 'Kumanda'), h('p', { class: 'sonuk' }, kurulum ? 'İlk kurulum' : 'Bilgisayarındaki Claude Code ve ürünlerin'), icerik)));
  sifre.focus?.();
}

// ───────── iskelet ve yönlendirme ─────────
let projeler = [];
let aktif = null; // etkin görünüm (kapat() ile temizlenir)
let yan, ana, listeEl, aramaEl, gezgin, agacEl, gezginAdEl;

// ───────── düzen: sol bar (projeler) ve gezgin (dosyalar) ─────────
// Masaüstünde ikisi de kenarından sürüklenerek genişler/daralır; eşiğin altına sürüklenince kapanır. ☰ ve Dosyalar
// düğmeleri (Ctrl+B, Ctrl+Shift+E) açıp kapatır. Telefonda ikisi de soldan açılan çekmecedir: sağa kaydır → projeler,
// sola kaydır ya da dışına dokun → kapanır.
const masaustu = () => matchMedia('(min-width: 900px)').matches;
const KAPANMA_ESIGI = 150, EN_DAR = 190;
const duzen = { yanGen: 300, yanKapali: false, gezginGen: 270, gezginAcik: false };
try { Object.assign(duzen, JSON.parse(localStorage.getItem('kumanda.duzen')) || {}); } catch { /* bozuk ya da yok */ }
const duzenKaydet = () => { try { localStorage.setItem('kumanda.duzen', JSON.stringify(duzen)); } catch { /* özel pencere */ } };
let gezginPid = null; // gezginin gösterdiği proje (yalnızca proje sayfalarında)

function duzenUygula() {
  const enGenis = Math.max(260, Math.round(innerWidth * 0.5));
  duzen.yanGen = Math.min(Math.max(duzen.yanGen, EN_DAR), enGenis);
  duzen.gezginGen = Math.min(Math.max(duzen.gezginGen, EN_DAR), enGenis);
  const gezginGorunur = duzen.gezginAcik && Boolean(gezginPid);
  uyg.classList.toggle('yan-kapali', duzen.yanKapali);
  uyg.classList.toggle('gezgin-acik', gezginGorunur);
  if (!gezginPid) uyg.classList.remove('gezgin-cekmece');
  uyg.style.setProperty('--yan-gen', duzen.yanKapali ? '0px' : `${duzen.yanGen}px`);
  uyg.style.setProperty('--gezgin-gen', gezginGorunur ? `${duzen.gezginGen}px` : '0px');
  for (const d of document.querySelectorAll('.gezgin-dugme')) d.classList.toggle('etkin', gezginGorunur || uyg.classList.contains('gezgin-cekmece'));
}

function cekmeceleriKapat() { uyg.classList.remove('yan-cekmece', 'gezgin-cekmece'); duzenUygula(); }

function yanDegistir() {
  if (masaustu()) { duzen.yanKapali = !duzen.yanKapali; duzenKaydet(); duzenUygula(); return; }
  const ac = !uyg.classList.contains('yan-cekmece');
  cekmeceleriKapat();
  if (ac && uyg.classList.contains('ana-acik')) uyg.classList.add('yan-cekmece');
}

function gezginDegistir() {
  if (!gezginPid) return;
  if (masaustu()) { duzen.gezginAcik = !duzen.gezginAcik; duzenKaydet(); }
  else {
    const ac = !uyg.classList.contains('gezgin-cekmece');
    uyg.classList.remove('yan-cekmece');
    uyg.classList.toggle('gezgin-cekmece', ac);
  }
  if (gezginGorunur()) agacTazele(); // her açılışta güncel klasör içeriği
  duzenUygula();
}

/** Kenar tutamacı: sürükleyerek genişlik ayarlar, eşiğin altında paneli kapatır. */
function tutamac(sinif, { baslangic, ayarla }) {
  return h('div', { class: sinif, role: 'separator', 'aria-orientation': 'vertical', title: 'Sürükle: genişlet / daralt / kapat',
    onpointerdown: e => {
      if (e.button !== 0) return;
      e.preventDefault();
      const x0 = e.clientX, g0 = baslangic();
      uyg.classList.add('surukleniyor');
      const hareket = ev => { ayarla(g0 + ev.clientX - x0); duzenUygula(); };
      const birak = () => {
        uyg.classList.remove('surukleniyor');
        removeEventListener('pointermove', hareket); removeEventListener('pointerup', birak); removeEventListener('pointercancel', birak);
        duzenKaydet();
      };
      addEventListener('pointermove', hareket); addEventListener('pointerup', birak); addEventListener('pointercancel', birak);
    } });
}

function iskelet() {
  uyg.className = '';
  aramaEl = h('input', { type: 'search', placeholder: 'Proje ara', 'aria-label': 'Proje ara', oninput: projeleriCiz });
  listeEl = h('div', { class: 'liste' });
  const yanAyarla = g => { duzen.yanKapali = g < KAPANMA_ESIGI; if (!duzen.yanKapali) duzen.yanGen = g; };
  yan = h('aside', { id: 'yan' },
    h('div', { class: 'ust' },
      h('div', { class: 'baslik' }, h('h1', {}, 'Kumanda')),
      h('a', { class: 'dugme kucuk', href: '#/urunler' }, 'Ürünler'),
      h('a', { class: 'dugme simge duz', href: '#/ayarlar', title: 'Ayarlar', 'aria-label': 'Ayarlar' }, '⚙'),
      h('button', { class: 'dugme simge duz yan-kapat', type: 'button', title: 'Proje listesini kapat (Ctrl+B)', 'aria-label': 'Proje listesini kapat', onclick: yanDegistir }, '«')),
    h('div', { class: 'ara' }, aramaEl),
    h('div', { class: 'kaydir' }, listeEl),
    tutamac('tutamac', { baslangic: () => duzen.yanGen, ayarla: yanAyarla }));
  agacEl = h('div', { class: 'agac', role: 'tree', 'aria-label': 'Proje dosyaları' });
  gezginAdEl = h('div', { class: 'gezgin-ad' });
  gezgin = h('aside', { id: 'gezgin' },
    h('div', { class: 'gezgin-bas' },
      h('div', { class: 'gezgin-baslik' }, h('div', { class: 'etiket' }, 'Dosyalar'), gezginAdEl),
      h('button', { class: 'dugme simge duz kucuk', type: 'button', title: 'Yenile', 'aria-label': 'Dosyaları yenile', onclick: agacTazele }, '⟳'),
      h('button', { class: 'dugme simge duz kucuk', type: 'button', title: 'Klasörlerin hepsini daralt', 'aria-label': 'Hepsini daralt', onclick: () => { acikKlasorler.delete(gezginPid); agacCiz(); } }, '⊟'),
      h('button', { class: 'dugme simge duz kucuk', type: 'button', title: 'Kapat (Ctrl+Shift+E)', 'aria-label': 'Dosyaları kapat', onclick: gezginDegistir }, '×')),
    h('div', { class: 'kaydir' }, agacEl),
    tutamac('tutamac', { baslangic: () => duzen.gezginGen, ayarla: g => { duzen.gezginAcik = g >= KAPANMA_ESIGI; if (duzen.gezginAcik) duzen.gezginGen = g; } }));
  ana = h('main', { id: 'ana' });
  // Kapalı sol bar, ekranın sol kenarından sürüklenerek yeniden açılır.
  const kenar = tutamac('kenar-tutamac', { baslangic: () => 0, ayarla: yanAyarla });
  uyg.replaceChildren(yan, gezgin, ana, kenar, h('div', { class: 'perde', onclick: cekmeceleriKapat }));
  duzenUygula();
  dokunmaKaydirmasi();
}

/** Telefonda yatay kaydırma: sağa → proje listesi çekmecesi, sola → açık çekmeceyi kapat. */
function dokunmaKaydirmasi() {
  let bas = null;
  const yatayKayar = el => {
    for (; el && el !== uyg && el.nodeType === 1; el = el.parentElement) {
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return true;
      if (el.scrollWidth > el.clientWidth + 2 && /auto|scroll/.test(getComputedStyle(el).overflowX)) return true;
    }
    return false;
  };
  uyg.addEventListener('touchstart', e => {
    bas = e.touches.length === 1 && !masaustu() ? { x: e.touches[0].clientX, y: e.touches[0].clientY, hedef: e.target } : null;
  }, { passive: true });
  uyg.addEventListener('touchend', e => {
    if (!bas) return;
    const t = e.changedTouches[0], dx = t.clientX - bas.x, dy = t.clientY - bas.y, hedef = bas.hedef;
    bas = null;
    if (Math.abs(dx) < 70 || Math.abs(dx) < Math.abs(dy) * 1.8 || yatayKayar(hedef)) return;
    const cekmece = uyg.classList.contains('yan-cekmece') || uyg.classList.contains('gezgin-cekmece');
    if (dx < 0 && cekmece) cekmeceleriKapat();
    else if (dx > 0 && !cekmece && uyg.classList.contains('ana-acik')) uyg.classList.add('yan-cekmece');
  }, { passive: true });
}

// ───────── gezgin: proje dosyaları (VS Code'un gezgini gibi; yalnızca okuma) ─────────
const agacOnbellek = new Map(); // `${pid}|${klasör}` → { girdiler, kesildi } | { yukleniyor } | { hata }
const acikKlasorler = new Map(); // pid → Set(klasör yolu)
let seciliDosya = '';
const gezginGorunur = () => Boolean(gezginPid) && (masaustu() ? duzen.gezginAcik : uyg.classList.contains('gezgin-cekmece'));
const dosyaAdresi = (pid, yol) => `#/p/${pid}/d/${encodeURIComponent(yol)}`;

const SIMGE = [
  [/\.(m?jsx?|cjs)$/i, 'JS', 'sari'], [/\.(tsx?|mts|cts)$/i, 'TS', 'mavi'], [/\.(json|jsonc|webmanifest)$/i, '{}', 'sari'],
  [/\.(html?|xml|vue|svelte)$/i, '<>', 'turuncu'], [/\.(css|scss|sass|less)$/i, '#', 'mavi'], [/\.(md|markdown)$/i, 'M↓', 'mavi'],
  [/\.(py|pyw|ipynb)$/i, 'PY', 'mavi'], [/\.(ps1|psm1|psd1)$/i, 'PS', 'mavi'], [/\.(sh|bash|zsh|bat|cmd)$/i, '$', 'yesil'],
  [/\.(png|jpe?g|gif|webp|svg|ico|bmp|avif)$/i, '▣', 'mor'], [/\.(apk|aab)$/i, 'AP', 'yesil'], [/\.(exe|msi|dll)$/i, 'EX', 'kirmizi'],
  [/\.(zip|7z|rar|gz|tgz)$/i, 'ZP', 'turuncu'], [/\.(ya?ml|toml|ini|cfg|conf|env|properties|gradle|kts)$/i, '⚙', 'soluk'],
  [/\.(c|h|cpp|hpp|cc|cs|java|kt|go|rs|swift|dart|php|rb|lua|sql)$/i, '</>', 'mor'], [/\.(mp4|mov|webm|mkv|mp3|wav)$/i, '▶', 'mor'],
  [/\.(txt|log|csv)$/i, '≡', 'soluk'], [/\.pdf$/i, 'PDF', 'kirmizi'],
];
function dosyaSimgesi(ad) {
  const s = SIMGE.find(([r]) => r.test(ad));
  return h('span', { class: `dsimge ${s ? s[2] : 'soluk'}`, 'aria-hidden': 'true' }, s ? s[1] : '•');
}

async function klasorYukle(pid, yol) {
  const k = `${pid}|${yol}`;
  if (agacOnbellek.get(k)?.yukleniyor) return;
  agacOnbellek.set(k, { yukleniyor: true });
  try {
    const v = await api(`/api/proje/${pid}/dosyalar?yol=${encodeURIComponent(yol)}`);
    agacOnbellek.set(k, { girdiler: v.girdiler || [], kesildi: Boolean(v.kesildi) });
  } catch (x) { agacOnbellek.set(k, { hata: x.kod === 404 ? 'Klasör bulunamadı' : x.message }); }
  if (pid === gezginPid) agacCiz();
}

function agacTazele() {
  if (!gezginPid) return;
  for (const k of [...agacOnbellek.keys()]) if (k.startsWith(`${gezginPid}|`) && !agacOnbellek.get(k).yukleniyor) agacOnbellek.delete(k);
  agacCiz();
}

function klasorDegistir(yol) {
  if (!acikKlasorler.has(gezginPid)) acikKlasorler.set(gezginPid, new Set());
  const acik = acikKlasorler.get(gezginPid);
  if (acik.has(yol)) acik.delete(yol); else acik.add(yol);
  agacCiz();
}

function agacCiz() {
  if (!agacEl) return;
  if (!gezginPid) { agacEl.replaceChildren(); return; }
  const pid = gezginPid;
  gezginAdEl.textContent = projeAdi(pid) || 'Proje';
  if (!gezginGorunur()) return; // kapalıyken ağ isteği yapma
  const acik = acikKlasorler.get(pid) || new Set();
  const satirlar = [];
  const bilgi = (metin, d) => h('div', { class: 'agac-bilgi', style: `padding-left:${26 + d * 14}px` }, metin);
  const gez = (klasor, d) => {
    const k = agacOnbellek.get(`${pid}|${klasor}`);
    if (!k) { klasorYukle(pid, klasor); satirlar.push(bilgi('Yükleniyor…', d)); return; }
    if (k.yukleniyor) { satirlar.push(bilgi('Yükleniyor…', d)); return; }
    if (k.hata) { satirlar.push(bilgi(k.hata, d)); return; }
    if (!k.girdiler.length) satirlar.push(bilgi(d ? 'boş' : 'Bu klasör boş', d));
    for (const g of k.girdiler) {
      const ac = g.klasor && acik.has(g.yol);
      const ortak = { class: `agac-satir${g.klasor ? ' klasor' : ''}${!g.klasor && g.yol === seciliDosya ? ' secili' : ''}`,
        style: `padding-left:${6 + d * 14}px`, title: g.yol, role: 'treeitem' };
      satirlar.push(g.klasor
        ? h('button', { ...ortak, type: 'button', 'aria-expanded': ac ? 'true' : 'false', onclick: () => klasorDegistir(g.yol) },
          h('span', { class: 'ok' }, ac ? '▾' : '▸'), h('span', { class: 'ad' }, g.ad))
        : h('a', { ...ortak, href: dosyaAdresi(pid, g.yol) },
          h('span', { class: 'ok' }), dosyaSimgesi(g.ad), h('span', { class: 'ad' }, g.ad)));
      if (ac) gez(g.yol, d + 1);
    }
    if (k.kesildi) satirlar.push(bilgi('… çok fazla girdi; ilk 3000 gösteriliyor', d));
  };
  gez('', 0);
  agacEl.replaceChildren(...satirlar);
}

/** Yönlendirmede çağrılır: gezginin projesi ve seçili dosya (dosyanın klasörleri açılır, VS Code'daki gibi). */
function gezginAyarla(pid, dosya) {
  gezginPid = pid;
  seciliDosya = dosya || '';
  if (pid && dosya) {
    if (!acikKlasorler.has(pid)) acikKlasorler.set(pid, new Set());
    const parcalar = dosya.split('/');
    for (let i = 1; i < parcalar.length; i++) acikKlasorler.get(pid).add(parcalar.slice(0, i).join('/'));
  }
  duzenUygula();
  agacCiz();
}

async function projeleriYenile() {
  try { projeler = (await api('/api/projeler')).projeler; projeleriCiz(); } catch { /* giriş ekranı gösterildi ya da ağ yok */ }
}

function projeleriCiz() {
  if (!listeEl) return;
  const ara = aramaEl.value.trim().toLocaleLowerCase('tr');
  const secili = /^#\/p\/([0-9a-f]+)/.exec(location.hash)?.[1];
  const gorunen = projeler.filter(p => !ara || p.ad.toLocaleLowerCase('tr').includes(ara));
  listeEl.replaceChildren(...gorunen.map(p => {
    const durum = p.canli.includes('bekliyor') ? 'bekliyor' : p.canli.includes('calisiyor') ? 'calisiyor' : p.canli.length ? 'hazir' : '';
    const bilgi = [p.sonEtkinlik ? goreliZaman(p.sonEtkinlik) : 'henüz sohbet yok', p.urunSayisi ? `${p.urunSayisi} ürün` : null].filter(Boolean).join(' · ');
    return h('a', { class: `satir${p.kimlik === secili ? ' secili' : ''}`, href: `#/p/${p.kimlik}` },
      h('span', { class: `nokta ${durum}`, title: durum === 'bekliyor' ? 'Yanıtını bekliyor' : durum === 'calisiyor' ? 'Çalışıyor' : '' }),
      h('div', { class: 'govde' }, h('div', { class: 'ad' }, p.ad), h('div', { class: 'bilgi' }, bilgi)));
  }));
  if (!gorunen.length) listeEl.append(h('div', { class: 'bos-durum' }, ara ? 'Eşleşen proje yok' : 'Proje bulunamadı'));
  if (gezginPid) gezginAdEl.textContent = projeAdi(gezginPid) || 'Proje';
}

const projeAdi = pid => projeler.find(p => p.kimlik === pid)?.ad || '';

/** `pid` verilirse sağda gezgin (Dosyalar) düğmesi olur. */
function ustCubuk({ baslik, alt, geri = '#/', sag = [], pid }) {
  return h('div', { class: 'ust' },
    h('a', { class: 'dugme simge duz geri', href: geri, 'aria-label': 'Geri' }, '‹'),
    h('button', { class: 'dugme simge duz yan-dugme', type: 'button', title: 'Proje listesi (Ctrl+B)', 'aria-label': 'Proje listesini aç/kapat', onclick: yanDegistir }, '☰'),
    h('div', { class: 'baslik' }, typeof baslik === 'string' ? h('h1', {}, baslik) : baslik, alt && (typeof alt === 'string' ? h('div', { class: 'alt' }, alt) : alt)),
    sag,
    pid && h('button', { class: `dugme simge duz gezgin-dugme${gezginGorunur() ? ' etkin' : ''}`, type: 'button', title: 'Proje dosyaları (Ctrl+Shift+E)',
      'aria-label': 'Proje dosyalarını aç/kapat', onclick: gezginDegistir }, h('span', { class: 'klasor-simge', 'aria-hidden': 'true' })));
}

function yonlendir() {
  aktif?.kapat?.();
  aktif = null;
  const p = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  uyg.classList.toggle('ana-acik', p.length > 0);
  uyg.classList.remove('yan-cekmece', 'gezgin-cekmece'); // telefonda çekmeceden seçim yapıldı: kapansın
  let dosya = '';
  if (p[0] === 'p' && p[1] && p[2] === 'd') { try { dosya = decodeURIComponent(p.slice(3).join('/')); } catch { dosya = ''; } }
  gezginAyarla(p[0] === 'p' && p[1] ? p[1] : null, dosya);
  if (p[0] === 'p' && p[1]) {
    if (p[2] === 's' && p[3]) aktif = sohbetGorunumu(p[1], p[3]);
    else if (p[2] === 'yeni') aktif = sohbetGorunumu(p[1], null);
    else if (p[2] === 'd' && dosya) aktif = dosyaGorunumu(p[1], dosya);
    else aktif = projeSayfasi(p[1], p[2] === 'urunler' ? 'urunler' : 'sohbetler');
  } else if (p[0] === 'urunler') aktif = tumUrunler();
  else if (p[0] === 'ayarlar') aktif = ayarlarSayfasi();
  else ana.replaceChildren(h('div', { class: 'orta sonuk' }, 'Soldan bir proje seç ya da Ürünler\'e bak.'));
  projeleriCiz();
}

// ───────── proje sayfası ─────────
function projeSayfasi(pid, sekme) {
  const govde = h('div', { class: 'ic' }, h('div', { class: 'bos-durum' }, 'Yükleniyor…'));
  const baslik = h('h1', {}, projeAdi(pid) || 'Proje');
  const alt = h('div', { class: 'alt' });
  ana.replaceChildren(
    ustCubuk({ baslik, alt, pid, sag: [h('a', { class: 'dugme ana kucuk', href: `#/p/${pid}/yeni` }, 'Yeni sohbet')] }),
    h('div', { class: 'sekmeler' },
      h('a', { class: `sekme${sekme === 'sohbetler' ? ' secili' : ''}`, href: `#/p/${pid}` }, 'Sohbetler'),
      h('a', { class: `sekme${sekme === 'urunler' ? ' secili' : ''}`, href: `#/p/${pid}/urunler` }, 'Ürünler')),
    h('div', { class: 'kaydir' }, govde));
  let iptal = false;

  async function yukle(taze) {
    try {
      if (sekme === 'sohbetler') {
        const v = await api(`/api/proje/${pid}`);
        if (iptal) return;
        baslik.textContent = v.proje.ad; alt.textContent = v.proje.yol;
        govde.replaceChildren(
          v.oturumlar.length ? h('div', { class: 'liste', style: 'padding:0' }, v.oturumlar.map(o => h('a', { class: 'satir', href: `#/p/${pid}/s/${o.kimlik}` },
            h('span', { class: `nokta ${o.canli || ''}` }),
            h('div', { class: 'govde' }, h('div', { class: 'ad' }, o.baslik), h('div', { class: 'bilgi' }, goreliZaman(o.zaman))),
            o.canli === 'bekliyor' && h('span', { class: 'rozet uyari' }, 'yanıt bekliyor'),
            o.canli === 'calisiyor' && h('span', { class: 'rozet vurgu' }, 'çalışıyor'))))
            : h('div', { class: 'bos-durum' }, 'Bu projede henüz sohbet yok. "Yeni sohbet" ile başla.'),
          h('div', { style: 'margin-top:18px;text-align:center' },
            h('button', { class: 'dugme duz kucuk sonuk', onclick: async () => {
              try { await api(`/api/proje/${pid}/gizle`, { gizli: true }); bildir('Proje gizlendi (Ayarlar\'dan geri alınır)'); await projeleriYenile(); location.hash = '#/'; } catch (x) { bildir(x.message); }
            } }, 'Bu projeyi listeden gizle')));
      } else {
        const v = await api(`/api/proje/${pid}/urunler?gizliler${taze ? '&taze' : ''}`);
        if (iptal) return;
        const gizliler = v.urunler.filter(u => u.gizli);
        yerindeCiz(govde,
          h('div', { class: 'arac-cubugu' },
            h('span', { class: 'sonuk kucuk', style: 'flex:1' }, v.urunler.length ? 'Her ürün, onu son değiştiren sohbetin altında' : ''),
            gizliler.length > 0 && hepsiniGosterDugmesi(pid, gizliler, () => yukle(false), `Gizlenenlerin hepsini göster (${gizliler.length})`),
            h('button', { class: 'dugme kucuk', onclick: () => yukle(true) }, 'Yeniden tara')),
          ...(v.urunler.length ? oturumGruplari(pid, v.urunler, v.oturumlar || {}, () => yukle(false))
            : [h('div', { class: 'bos-durum' }, 'Bu projede ürün bulunamadı (HTML, APK, EXE, ZIP, video, belge).')]));
      }
    } catch (x) { if (!iptal && x.kod !== 401) govde.replaceChildren(h('div', { class: 'bos-durum' }, x.message)); }
  }
  yukle(false);
  return { kapat() { iptal = true; } };
}

// ───────── tüm ürünler ─────────
function tumUrunler() {
  const govde = h('div', { class: 'ic' }, h('div', { class: 'bos-durum' }, 'Projeler taranıyor…'));
  ana.replaceChildren(ustCubuk({ baslik: 'Ürünler', alt: 'Bütün projelerin çıktıları' }), h('div', { class: 'kaydir' }, govde));
  let iptal = false;
  async function yukle() {
    try {
      const v = await api('/api/urunler?gizliler');
      if (iptal) return;
      // Proje başlığı altında, projenin Ürünler sekmesindeki gibi sohbetlere ayrılmış.
      yerindeCiz(govde, ...(v.gruplar.length ? v.gruplar.map(g => h('section', { class: 'proje-grubu' },
        h('div', { class: 'proje-grubu-bas' },
          h('h2', {}, h('a', { href: `#/p/${g.proje.kimlik}/urunler`, style: 'color:inherit;text-decoration:none' }, `${g.proje.ad} ›`)),
          g.urunler.some(u => u.gizli) && hepsiniGosterDugmesi(g.proje.kimlik, g.urunler.filter(u => u.gizli), yukle, `Gizlenenleri göster (${g.urunler.filter(u => u.gizli).length})`)),
        oturumGruplari(g.proje.kimlik, g.urunler, g.oturumlar || {}, yukle)))
        : [h('div', { class: 'bos-durum' }, 'Hiçbir projede ürün bulunamadı.')]));
    } catch (x) { if (!iptal && x.kod !== 401) govde.replaceChildren(h('div', { class: 'bos-durum' }, x.message)); }
  }
  yukle();
  return { kapat() { iptal = true; } };
}

// ───────── dosya görüntüleyici ─────────
// Sözdizimi renklendirme: her dil için sıralı kurallar tek bir düzenli ifadede birleşir; eşleşen grup sınıfı verir.
// Çıktı yalnızca h() ile kurulan <span>'lardır (metin hiçbir zaman HTML olarak yorumlanmaz).
const KURAL = {
  cYorum: /\/\/[^\n]*|\/\*[\s\S]*?(?:\*\/|$)/, blokYorum: /\/\*[\s\S]*?(?:\*\/|$)/, diyezYorum: /#[^\n]*/,
  htmlYorum: /<!--[\s\S]*?(?:-->|$)/, psYorum: /<#[\s\S]*?(?:#>|$)/, sqlYorum: /--[^\n]*/, iniYorum: /(?:^|(?<=\n))[ \t]*;[^\n]*/,
  batYorum: /(?:^|(?<=\n))[ \t]*(?:@?rem\b|::)[^\n]*/i,
  dizgi: /"(?:[^"\\\n]|\\.)*"?|'(?:[^'\\\n]|\\.)*'?/, ciftDizgi: /"(?:[^"\\\n]|\\.)*"?/, sablon: /`(?:[^`\\]|\\[\s\S])*`?/,
  ucluDizgi: /"""[\s\S]*?(?:"""|$)|'''[\s\S]*?(?:'''|$)/, ozDizgi: /(?<==\s*)(?:"[^"]*"|'[^']*')/,
  jsonAnahtar: /"(?:[^"\\\n]|\\.)*"(?=\s*:)/, cssOzellik: /(?<=[{;]\s*)-{0,2}[a-zA-Z][\w-]*(?=\s*:)/, cssDeger: /#[\da-fA-F]{3,8}\b|@[\w-]+|!important/,
  yamlAnahtar: /(?:^|(?<=\n))[ \t]*(?:- )?[\w.$-]+(?=[ \t]*:)/, iniAnahtar: /(?:^|(?<=\n))[ \t]*[\w.$-]+(?=[ \t]*=)/, iniBolum: /(?:^|(?<=\n))[ \t]*\[[^\]\n]*\]/,
  etiket: /<\/?[A-Za-z][\w:.-]*|\/?>/, oznitelik: /[A-Za-z_:@][\w:.-]*(?==)/,
  degisken: /\$\{?[\w:@#?*!-]+\}?/, batDegisken: /%[\w~:]+%?/, onIslemci: /(?:^|(?<=\n))[ \t]*#[ \t]*\w+/, susleyici: /@[\w.]+/,
  sayi: /\b(?:0[xX][\da-fA-F_]+|\d[\d_]*(?:\.\d+)?(?:[eE][+-]?\d+)?)\b/, kelime: /[A-Za-z_$][\w$]*/,
  mdBaslik: /(?:^|(?<=\n))#{1,6} [^\n]*/, mdKod: /(?:^|(?<=\n))```[\s\S]*?(?:\n```|$)|`[^`\n]+`/, mdVurgu: /\*\*[^*\n]+\*\*|__[^_\n]+__/, mdBag: /\[[^\]\n]*\]\([^)\n]*\)/,
};
const kume = s => new Set(s.split(' '));
const SOZ = {
  js: kume('break case catch class const continue debugger default delete do else export extends finally for from function if import in instanceof let new of return static super switch this throw try typeof var void while with yield async await as interface type enum implements private protected public readonly declare namespace abstract keyof satisfies get set'),
  py: kume('and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield match case self cls'),
  ps: kume('begin break catch class continue data do dynamicparam else elseif end exit filter finally for foreach from function if in param process return switch throw trap try until using var while workflow'),
  c: kume('auto break case char const continue default do double else enum extern float for goto if int long register return short signed sizeof static struct switch typedef union unsigned void volatile while class public private protected internal namespace using new delete virtual override template typename bool package import func go defer chan map range type var fn let mut impl trait pub use mod match loop where crate self Self val fun when object interface extends implements final abstract string async await this super throw throws try catch finally in is as out ref sealed data suspend'),
  sh: kume('if then else elif fi for while until do done case esac in function return local export readonly set unset shift source exit'),
  sql: kume('select from where and or not insert into values update set delete create table drop alter add index primary key foreign references join left right inner outer on group by order having limit offset as distinct union all null is in like between exists case when then else end default unique view'),
  bat: kume('if else goto call set echo exit for in do not exist defined errorlevel setlocal endlocal shift pushd popd start'),
};
const SABITLER = kume('true false null undefined NaN Infinity None True False nil $true $false $null');
const dil = (parcalar, soz = null, buyukKucuk = false) => ({
  re: new RegExp(parcalar.map(([r]) => `(${r.source})`).join('|'), `g${parcalar.some(([r]) => r.flags.includes('i')) ? 'i' : ''}`),
  siniflar: parcalar.map(([, s]) => s), soz, buyukKucuk,
});
const K = KURAL;
const DILLER = {
  js: dil([[K.cYorum, 'yorum'], [K.sablon, 'dizgi'], [K.dizgi, 'dizgi'], [K.sayi, 'sayi'], [K.kelime, 'kelime']], SOZ.js),
  json: dil([[K.cYorum, 'yorum'], [K.jsonAnahtar, 'ozellik'], [K.ciftDizgi, 'dizgi'], [K.sayi, 'sayi'], [K.kelime, 'kelime']], new Set()),
  css: dil([[K.blokYorum, 'yorum'], [K.dizgi, 'dizgi'], [K.cssOzellik, 'ozellik'], [K.cssDeger, 'anahtar'], [K.sayi, 'sayi']]),
  html: dil([[K.htmlYorum, 'yorum'], [K.etiket, 'etiket'], [K.oznitelik, 'ozellik'], [K.ozDizgi, 'dizgi']]),
  py: dil([[K.diyezYorum, 'yorum'], [K.ucluDizgi, 'dizgi'], [K.dizgi, 'dizgi'], [K.susleyici, 'islev'], [K.sayi, 'sayi'], [K.kelime, 'kelime']], SOZ.py),
  ps: dil([[K.psYorum, 'yorum'], [K.diyezYorum, 'yorum'], [K.dizgi, 'dizgi'], [K.degisken, 'degisken'], [K.sayi, 'sayi'], [K.kelime, 'kelime']], SOZ.ps, true),
  sh: dil([[K.diyezYorum, 'yorum'], [K.dizgi, 'dizgi'], [K.degisken, 'degisken'], [K.sayi, 'sayi'], [K.kelime, 'kelime']], SOZ.sh),
  bat: dil([[K.batYorum, 'yorum'], [K.ciftDizgi, 'dizgi'], [K.batDegisken, 'degisken'], [K.sayi, 'sayi'], [K.kelime, 'kelime']], SOZ.bat, true),
  c: dil([[K.cYorum, 'yorum'], [K.onIslemci, 'anahtar'], [K.sablon, 'dizgi'], [K.dizgi, 'dizgi'], [K.susleyici, 'islev'], [K.sayi, 'sayi'], [K.kelime, 'kelime']], SOZ.c),
  sql: dil([[K.sqlYorum, 'yorum'], [K.blokYorum, 'yorum'], [K.dizgi, 'dizgi'], [K.sayi, 'sayi'], [K.kelime, 'kelime']], SOZ.sql, true),
  yaml: dil([[K.diyezYorum, 'yorum'], [K.yamlAnahtar, 'ozellik'], [K.dizgi, 'dizgi'], [K.sayi, 'sayi'], [K.kelime, 'kelime']], new Set()),
  ini: dil([[K.diyezYorum, 'yorum'], [K.iniYorum, 'yorum'], [K.iniBolum, 'etiket'], [K.iniAnahtar, 'ozellik'], [K.dizgi, 'dizgi'], [K.sayi, 'sayi']]),
  md: dil([[K.htmlYorum, 'yorum'], [K.mdKod, 'dizgi'], [K.mdBaslik, 'anahtar'], [K.mdVurgu, 'tip'], [K.mdBag, 'islev']]),
};
const UZANTI_DIL = {
  js: 'js', mjs: 'js', cjs: 'js', jsx: 'js', ts: 'js', tsx: 'js', mts: 'js', cts: 'js', json: 'json', jsonc: 'json', webmanifest: 'json',
  css: 'css', scss: 'css', sass: 'css', less: 'css', html: 'html', htm: 'html', xml: 'html', svg: 'html', vue: 'html', svelte: 'html', xaml: 'html', csproj: 'html', plist: 'html',
  py: 'py', pyw: 'py', ps1: 'ps', psm1: 'ps', psd1: 'ps', sh: 'sh', bash: 'sh', zsh: 'sh', bat: 'bat', cmd: 'bat',
  c: 'c', h: 'c', cpp: 'c', hpp: 'c', cc: 'c', cs: 'c', java: 'c', kt: 'c', kts: 'c', go: 'c', rs: 'c', swift: 'c', dart: 'c', gradle: 'c', groovy: 'c', php: 'c', scala: 'c',
  sql: 'sql', yml: 'yaml', yaml: 'yaml', toml: 'ini', ini: 'ini', cfg: 'ini', conf: 'ini', properties: 'ini', env: 'ini', md: 'md', markdown: 'md',
};
const dilBul = ad => (/^(makefile|dockerfile)$/i.test(ad) ? 'sh' : UZANTI_DIL[ad.toLowerCase().split('.').pop()] || null);
const RENK_SINIRI = 400000; // bundan büyük metin renklendirilmeden gösterilir (telefonda donmasın)

/** Metni satırlara böler; her satır [sınıf | null, parça] dizisidir. */
function vurgula(metin, dilAdi) {
  const satirlar = [[]];
  const ekle = (sinif, parca) => parca.split('\n').forEach((x, i) => {
    if (i) satirlar.push([]);
    if (!x) return;
    const satir = satirlar.at(-1), son = satir.at(-1);
    if (son && son[0] === sinif) son[1] += x; else satir.push([sinif, x]);
  });
  const d = DILLER[dilAdi];
  if (!d || metin.length > RENK_SINIRI) { ekle(null, metin); return satirlar; }
  const re = d.re;
  re.lastIndex = 0;
  let son = 0, m;
  while ((m = re.exec(metin))) {
    if (!m[0]) { re.lastIndex++; continue; }
    if (m.index > son) ekle(null, metin.slice(son, m.index));
    let i = 1;
    while (m[i] === undefined) i++;
    let sinif = d.siniflar[i - 1];
    if (sinif === 'kelime') {
      const k = d.buyukKucuk ? m[0].toLowerCase() : m[0];
      sinif = d.soz?.has(k) ? 'anahtar' : SABITLER.has(m[0]) || SABITLER.has(k) ? 'sabit'
        : /^\s*\(/.test(metin.slice(re.lastIndex, re.lastIndex + 12)) ? 'islev' : /^[A-Z][a-z]/.test(m[0]) && !d.buyukKucuk ? 'tip' : null;
    }
    ekle(sinif, m[0]);
    son = re.lastIndex;
  }
  ekle(null, metin.slice(son));
  return satirlar;
}

function kodGorunumu(metin, dilAdi) {
  const satirlar = vurgula(metin, dilAdi);
  if (satirlar.length > 1 && !satirlar.at(-1).length) satirlar.pop(); // sondaki satır sonu boş satır sayılmasın
  return h('pre', { class: 'kod-gorunum', style: `--hane:${String(satirlar.length).length}` },
    satirlar.map(s => h('span', { class: 'ks' }, s.map(([sinif, parca]) => (sinif ? h('span', { class: `s-${sinif}` }, parca) : parca)))));
}

function dosyaGorunumu(pid, yol) {
  const ad = yol.split('/').pop();
  const govde = h('div', { class: 'dosya-govde' }, h('div', { class: 'bos-durum' }, 'Yükleniyor…'));
  const bilgiEl = h('div', { class: 'dosya-cubugu' });
  const ac = `/ac?p=${pid}&y=${encodeURIComponent(yol)}`;
  ana.replaceChildren(
    ustCubuk({ baslik: ad, alt: [projeAdi(pid), ...yol.split('/').slice(0, -1)].filter(Boolean).join(' › '), geri: `#/p/${pid}`, pid,
      sag: [h('a', { class: 'dugme kucuk', href: ac, target: '_blank', rel: 'noopener', title: 'Tarayıcıda ayrı sekmede aç (ürün olarak)' }, 'Aç'),
        h('a', { class: 'dugme kucuk', href: `${ac}&indir=1`, target: '_blank', rel: 'noopener', title: 'Bu cihaza indir' }, 'İndir')] }),
    bilgiEl, h('div', { class: 'kaydir' }, govde));
  let iptal = false;
  let sar = localStorage.getItem('kumanda.satirSar') === '1';

  (async () => {
    let v;
    try { v = await api(`/api/proje/${pid}/dosya?yol=${encodeURIComponent(yol)}`); }
    catch (x) { if (!iptal && x.kod !== 401) govde.replaceChildren(h('div', { class: 'bos-durum' }, x.kod === 404 ? 'Dosya bulunamadı (silinmiş ya da gizli bir klasörde olabilir).' : x.message)); return; }
    if (iptal) return;
    const rozetler = [h('span', { class: 'rozet' }, boyutYaz(v.boyut)), h('span', { class: 'rozet' }, goreliZaman(v.zaman))];
    if (v.tur === 'resim') {
      bilgiEl.replaceChildren(...rozetler);
      govde.replaceChildren(h('div', { class: 'dosya-resim' }, h('img', { src: `data:${v.mime};base64,${v.veri}`, alt: v.ad })));
      return;
    }
    if (v.tur !== 'metin') {
      bilgiEl.replaceChildren(...rozetler);
      govde.replaceChildren(h('div', { class: 'bos-durum' }, `${v.neden || 'Bu dosya metin değil'}; burada gösterilemiyor. "Aç" ya da "İndir" ile kullanabilirsin.`));
      return;
    }
    const dilAdi = dilBul(v.ad);
    const markdown = dilAdi === 'md';
    let onizleme = markdown;
    const icerik = h('div', {});
    const ciz = () => {
      icerik.replaceChildren(onizleme ? h('div', { class: 'ileti claude md-onizleme', html: md(v.metin) }) : kodGorunumu(v.metin, dilAdi));
      icerik.classList.toggle('sar', sar);
    };
    const secim = (etiket, acik, degis) => h('button', { class: `dugme duz kucuk${acik() ? ' etkin' : ''}`, type: 'button', 'aria-pressed': acik() ? 'true' : 'false',
      onclick: e => { degis(); e.currentTarget.classList.toggle('etkin', acik()); e.currentTarget.setAttribute('aria-pressed', acik() ? 'true' : 'false'); ciz(); } }, etiket);
    const satirSayisi = v.metin ? v.metin.split('\n').length - (v.metin.endsWith('\n') ? 1 : 0) : 0;
    bilgiEl.replaceChildren(...[...rozetler, h('span', { class: 'rozet' }, `${satirSayisi} satır`),
      v.kesildi && h('span', { class: 'rozet uyari' }, 'ilk 1 MB gösteriliyor'),
      h('span', { class: 'bos' }),
      markdown && secim('Önizleme', () => onizleme, () => { onizleme = !onizleme; }),
      secim('Satır kaydır', () => sar, () => { sar = !sar; try { localStorage.setItem('kumanda.satirSar', sar ? '1' : '0'); } catch { /* yok */ } })].filter(Boolean));
    govde.replaceChildren(icerik);
    ciz();
  })();
  return { kapat() { iptal = true; } };
}

// ───────── sohbet ─────────
const MOD_ADI = { default: 'Her şeyi sor', acceptEdits: 'Düzenlemelere izin', auto: 'Otomatik', plan: 'Plan modu', bypassPermissions: 'Hepsine izin (riskli)' };
// Seçiciler telefonda dar: varsayılan seçenek tek kelime (ayrıntı title/aria-label'da).
const MODEL_ADI = { '': 'Model', fable: 'Fable', opus: 'Opus', sonnet: 'Sonnet', haiku: 'Haiku' };
const EFOR_ADI = { '': 'Effort', low: 'Effort: düşük', medium: 'Effort: orta', high: 'Effort: yüksek', xhigh: 'Effort: çok yüksek', max: 'Effort: en yüksek' };

function aracOzeti(ad, g = {}) {
  const dosya = y => String(y || '').split(/[\\/]/).pop();
  const ilk = s => String(s || '').split('\n')[0];
  switch (ad) {
    case 'Bash': case 'PowerShell': return ilk(g.command);
    case 'Read': case 'Write': case 'Edit': case 'MultiEdit': case 'NotebookEdit': return dosya(g.file_path || g.notebook_path);
    case 'Glob': return g.pattern || '';
    case 'Grep': return `${g.pattern || ''}${g.path ? `  ·  ${dosya(g.path)}` : ''}`;
    case 'WebFetch': return g.url || '';
    case 'WebSearch': case 'ToolSearch': return g.query || '';
    case 'Task': case 'Agent': return g.description || '';
    case 'Skill': return g.skill || '';
    case 'TodoWrite': return `${g.todos?.length || 0} görev`;
    case 'AskUserQuestion': return g.questions?.[0]?.question || '';
    case 'ExitPlanMode': return 'Plan onayı';
    default: return ilk(Object.values(g).find(v => typeof v === 'string') || '');
  }
}

function aracAyrinti(ad, g = {}) {
  const blok = (etiket, metin, sinif = '') => [h('div', { class: 'etiket' }, etiket), h('pre', { class: `blok ${sinif}` }, metin)];
  if ((ad === 'Bash' || ad === 'PowerShell') && g.command) return blok('Komut', g.command);
  if (ad === 'Edit' && typeof g.old_string === 'string') {
    return [h('div', { class: 'etiket' }, g.file_path || 'Düzenleme'),
      h('pre', { class: 'blok' },
        h('span', { class: 'fark-eksi' }, g.old_string.split('\n').map(s => `- ${s}`).join('\n')), '\n',
        h('span', { class: 'fark-arti' }, String(g.new_string ?? '').split('\n').map(s => `+ ${s}`).join('\n')))];
  }
  if (ad === 'Write' && typeof g.content === 'string') return blok(g.file_path || 'Dosya', g.content);
  if (ad === 'ExitPlanMode' && typeof g.plan === 'string') return [h('div', { class: 'ileti claude', html: md(g.plan) })];
  return blok('Girdi', JSON.stringify(g, null, 2));
}

async function resimHazirla(dosya) {
  // Telefon fotoğrafları büyük olur: uzun kenarı 1568 pikselde tutup JPEG'e çevir.
  const bit = await createImageBitmap(dosya);
  const oran = Math.min(1, 1568 / Math.max(bit.width, bit.height));
  const tuval = h('canvas', { width: Math.round(bit.width * oran), height: Math.round(bit.height * oran) });
  tuval.getContext('2d').drawImage(bit, 0, 0, tuval.width, tuval.height);
  const url = tuval.toDataURL('image/jpeg', 0.86);
  return { tur: 'image/jpeg', veri: url.slice(url.indexOf(',') + 1), url };
}

function sohbetGorunumu(pid, sid) {
  let kaynak = null, isaret = '', canli = null, etkinlik = '', kapandi = false, kuyruk = null;
  let yazilanEl = null, yazilanMetin = '', cizim = 0, gizliSayaci = 0;
  const araclar = new Map(), izinler = new Map(), yanSorular = new Map(), ekler = [];
  let mod = localStorage.getItem('kumanda.mod') || 'acceptEdits';
  let model = localStorage.getItem('kumanda.model') || '';
  let efor = localStorage.getItem('kumanda.efor') || '';

  const baslikEl = h('h1', {}, sid ? 'Sohbet' : 'Yeni sohbet');
  const akisEl = h('div', { class: 'sohbet' });
  const kaydirEl = h('div', { class: 'kaydir' }, akisEl);
  const durumEl = h('div', { class: 'durum-cubugu' });
  const eklerEl = h('div', { class: 'ekler' });
  const alan = h('textarea', { rows: 1, placeholder: 'Claude\'a yaz… (/btw ile yan soru)','aria-label': 'İstem' });
  const dosyaGirdi = h('input', { type: 'file', accept: 'image/*', multiple: true, hidden: true });
  const modSec = h('select', { 'aria-label': 'İzin modu' }, Object.entries(MOD_ADI).map(([d, a]) => h('option', { value: d }, a)));
  const modelSec = h('select', { 'aria-label': 'Model', title: 'Model ("Model" = Claude Code ayarındaki varsayılan)' }, Object.entries(MODEL_ADI).map(([d, a]) => h('option', { value: d }, a)));
  const eforSec = h('select', { 'aria-label': 'Effort (düşünme derinliği)', title: 'Effort ("Effort" = Claude Code ayarındaki varsayılan). Düşük: hızlı ve az kota, en yüksek: en derin ve en çok kota' },
    Object.entries(EFOR_ADI).map(([d, a]) => h('option', { value: d }, a)));
  const durdurDugme = h('button', { class: 'dugme kucuk tehlike', type: 'button', hidden: true, onclick: () => api(`/api/oturum/${sid}/kes`, {}).catch(x => bildir(x.message)) }, 'Durdur');
  const gonderDugme = h('button', { class: 'dugme ana kucuk', type: 'submit' }, 'Gönder');
  modSec.value = mod; modelSec.value = model; eforSec.value = efor;

  const form = h('form', { class: 'yazma', onsubmit: e => { e.preventDefault(); gonder(); } },
    h('div', { class: 'yazma-ic' }, eklerEl, alan,
      h('div', { class: 'yazma-alt' },
        h('button', { class: 'dugme duz kucuk', type: 'button', title: 'Resim ekle', 'aria-label': 'Resim ekle', onclick: () => dosyaGirdi.click() }, '＋'),
        dosyaGirdi, modSec, modelSec, eforSec, h('span', { class: 'bos' }), durdurDugme, gonderDugme)));

  // Bu sohbetin ürettiği/değiştirdiği ürünler (sohbet bitince yeniden taranır; yoksa gizli kalır).
  const urunPanel = h('details', { class: 'sohbet-urunleri', hidden: true });
  let urunSayaci = 0;
  async function urunleriYukle(taze) {
    if (!sid || kapandi) return;
    try {
      const v = await api(`/api/proje/${pid}/urunler?oturum=${sid}${taze ? '&taze' : ''}`);
      if (kapandi) return;
      const acik = urunPanel.open;
      urunPanel.replaceChildren(h('summary', {}, `Bu sohbetin ürünleri (${v.urunler.length})`),
        h('div', { class: 'sohbet-urunleri-ic' }, ...urunIzgarasi(pid, v.urunler, () => urunleriYukle(false), `${pid}|s:${sid}`)));
      urunPanel.open = acik;
      urunPanel.hidden = !v.urunler.length;
    } catch { /* ağ hatası: panel olduğu gibi kalsın */ }
  }
  const urunleriTazele = () => { clearTimeout(urunSayaci); urunSayaci = setTimeout(() => urunleriYukle(true), 1500); };

  ana.replaceChildren(ustCubuk({ baslik: baslikEl, alt: projeAdi(pid), geri: `#/p/${pid}`, pid }), urunPanel, kaydirEl, durumEl, form);

  // ── görüntü ──
  const dipte = () => kaydirEl.scrollHeight - kaydirEl.scrollTop - kaydirEl.clientHeight < 120;
  function ekle(el) {
    const yapis = dipte();
    if (yazilanEl && yazilanEl.isConnected) akisEl.insertBefore(el, yazilanEl); else akisEl.append(el);
    if (yapis) kaydirEl.scrollTop = kaydirEl.scrollHeight;
    return el;
  }

  function aracCiz(o) {
    const durum = h('span', { class: 'arac-durum bekle' }, '…');
    const ic = h('div', { class: 'arac-ic' }, aracAyrinti(o.ad, o.girdi));
    const el = h('details', { class: 'arac' },
      h('summary', {}, h('span', { class: 'arac-ad' }, o.ad), h('span', { class: 'arac-oz' }, aracOzeti(o.ad, o.girdi)), durum), ic);
    araclar.set(o.id, { el, ic, durum });
    ekle(el);
  }
  function aracSonuc(o) {
    const a = araclar.get(o.id);
    if (!a) return;
    a.durum.className = `arac-durum ${o.hata ? 'hata' : 'tamam'}`;
    a.durum.textContent = o.hata ? '✕' : '✓';
    if (o.metin) a.ic.append(h('div', { class: 'etiket' }, o.hata ? 'Hata' : 'Sonuç'), h('pre', { class: `blok${o.hata ? ' hata' : ''}` }, o.metin));
  }
  function bekleyenAraclariKapat() {
    for (const a of araclar.values()) if (a.durum.classList.contains('bekle')) { a.durum.className = 'arac-durum'; a.durum.textContent = ''; }
  }

  function izinCiz(o) {
    const yanitla = async govde => {
      try { await api(`/api/oturum/${sid}/izin`, { istek: o.istek, ...govde }); } catch (x) { bildir(x.message); }
    };
    let el;
    if (o.ad === 'AskUserQuestion' && Array.isArray(o.girdi?.questions)) {
      const secimler = o.girdi.questions.map(() => ({ secili: new Set(), diger: '' }));
      const gonderD = h('button', { class: 'dugme ana', disabled: true, onclick: () => {
        const yanitlar = {};
        o.girdi.questions.forEach((s, i) => { yanitlar[s.question] = [...secimler[i].secili, secimler[i].diger.trim()].filter(Boolean).join(', '); });
        yanitla({ karar: 'izin', yanitlar });
      } }, 'Yanıtla');
      const denetle = () => { gonderD.disabled = !secimler.every(s => s.secili.size || s.diger.trim()); };
      el = h('div', { class: 'izin soru' },
        o.girdi.questions.map((s, i) => {
          const dugmeler = (s.options || []).map(sec => h('button', { class: 'secenek', type: 'button', onclick: e => {
            const b = e.currentTarget, kume = secimler[i].secili;
            if (s.multiSelect) { kume.has(sec.label) ? kume.delete(sec.label) : kume.add(sec.label); b.classList.toggle('secili'); }
            else { kume.clear(); kume.add(sec.label); dugmeler.forEach(d => d.classList.toggle('secili', d === b)); }
            denetle();
          } }, h('b', {}, sec.label), sec.description && h('span', {}, sec.description)));
          return h('div', { style: 'display:grid;gap:8px' },
            h('div', { class: 'izin-bas' }, s.header && h('span', { class: 'rozet vurgu' }, s.header), s.question),
            h('div', { class: 'secenekler' }, dugmeler),
            h('input', { type: 'text', placeholder: 'Başka bir yanıt yaz…', 'aria-label': 'Başka yanıt', oninput: e => { secimler[i].diger = e.target.value; denetle(); } }));
        }),
        h('div', { class: 'dugmeler' }, gonderD, h('button', { class: 'dugme', onclick: () => yanitla({ karar: 'red', mesaj: 'Kullanıcı soruyu yanıtlamadan geçti.' }) }, 'Geç')));
    } else {
      const plan = o.ad === 'ExitPlanMode';
      el = h('div', { class: 'izin' },
        h('div', { class: 'izin-bas' }, plan ? 'Plan onayı' : 'İzin gerekiyor', h('span', { class: 'rozet uyari' }, o.ad)),
        aracAyrinti(o.ad, o.girdi),
        o.aciklama && !plan && h('div', { class: 'kucuk sonuk' }, o.aciklama),
        h('div', { class: 'dugmeler' },
          h('button', { class: 'dugme ana', onclick: () => yanitla({ karar: 'izin' }) }, plan ? 'Planı onayla' : 'İzin ver'),
          o.hep && !plan && h('button', { class: 'dugme', onclick: () => yanitla({ karar: 'hep' }) }, 'Hep izin ver'),
          h('button', { class: 'dugme tehlike', onclick: () => yanitla({ karar: 'red' }) }, 'Reddet')));
    }
    izinler.set(o.istek, el);
    ekle(el);
  }
  function izinBitir(o) {
    const el = izinler.get(o.istek);
    if (!el) return;
    izinler.delete(o.istek);
    const sonuc = { izin: 'İzin verildi', hep: 'Hep izin verildi', red: 'Reddedildi', iptal: 'İptal edildi' }[o.karar] || o.karar;
    el.classList.add('bitti');
    el.querySelectorAll('.dugmeler, .secenekler, input').forEach(x => x.remove());
    el.append(h('div', { class: 'kucuk sonuk' }, sonuc));
  }

  // /btw yan sorusu: her kimliğin tek kartı vardır; geçmiş, canlı akış ve POST yanıtı aynı kartın içini yeniler.
  // Gelme sırası ne olursa olsun yanıtlanmış kart "bekliyor"a dönmez.
  function yanSoruCiz(o) {
    const eski = yanSorular.get(o.id);
    if (eski && o.bekliyor && !eski.bekliyor) return;
    const kart = eski?.kart || h('div', { class: 'yan-soru' });
    kart.classList.toggle('bekliyor', Boolean(o.bekliyor));
    const govde = o.bekliyor ? h('div', { class: 'kucuk sonuk' }, 'Yanıtlanıyor… (sohbet bundan etkilenmez)')
      : o.hata ? h('div', { class: 'yan-hata' }, o.hata)
        : typeof o.yanit === 'string' ? h('div', { class: 'ileti claude yan-yanit', html: md(o.yanit) })
          : h('div', { class: 'kucuk sonuk' }, 'Terminalden soruldu. Claude Code yan soruların yanıtını kaydetmiyor.');
    kart.replaceChildren(
      h('div', { class: 'yan-bas' }, h('span', { class: 'rozet vurgu' }, '/btw'),
        o.kaynak === 'terminal' && h('span', { class: 'rozet' }, 'terminal'),
        o.z && h('span', { class: 'kucuk sonuk' }, new Date(o.z).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }))),
      h('div', { class: 'yan-metin' }, o.soru), govde);
    yanSorular.set(o.id, { kart, bekliyor: Boolean(o.bekliyor) });
    if (!eski) ekle(kart);
  }

  async function yanSoruGonder(soru) {
    if (!soru) { bildir('Kullanım: /btw <sorun>'); return; }
    if (!sid) { bildir('Yan soru için önce sohbeti başlat'); return; }
    const o = { id: kimlikUret(), z: Date.now(), soru, kaynak: 'kumanda', bekliyor: true };
    alan.value = ''; boyutla();
    if (ekler.length) bildir('Yan soruya resim eklenmez; resimler yazma alanında duruyor');
    yanSoruCiz(o);
    kaydirEl.scrollTop = kaydirEl.scrollHeight;
    try { yanSoruCiz(await api(`/api/proje/${pid}/oturum/${sid}/yan-soru`, { id: o.id, soru, model: modelSec.value, efor: eforSec.value })); }
    catch (x) { if (x.kod !== 401) yanSoruCiz({ ...o, bekliyor: false, hata: x.message }); }
  }

  function ogeCiz(o) {
    switch (o.t) {
      case 'btw': yanSoruCiz(o); break;
      case 'kullanici':
        ekle(h('div', { class: 'ileti kullanici' }, o.metin, o.resim ? h('div', { class: 'kucuk sonuk' }, `${o.resim} resim eklendi`) : null));
        kaydirEl.scrollTop = kaydirEl.scrollHeight;
        break;
      case 'metin':
        if (yazilanEl) { yazilanEl.remove(); yazilanEl = null; yazilanMetin = ''; }
        ekle(h('div', { class: 'ileti claude', html: md(o.metin) }));
        break;
      case 'arac': aracCiz(o); break;
      case 'arac-sonuc': aracSonuc(o); break;
      case 'izin': izinCiz(o); break;
      case 'izin-yanit': izinBitir(o); break;
      case 'not': ekle(h('div', { class: 'ileti not' }, o.metin)); break;
      case 'hata': ekle(h('div', { class: 'ileti hata' }, o.metin)); break;
      case 'sonuc':
        bekleyenAraclariKapat();
        if (o.hata) ekle(h('div', { class: 'ileti hata' }, o.hata));
        else if (!o.kesildi) ekle(h('div', { class: 'ileti sonuc' }, ['Tamamlandı', sureYaz(o.sure)].filter(Boolean).join(' · ')));
        break;
      default: break;
    }
  }

  function yaz(o) {
    if (!yazilanEl || yazilanEl.dataset.b !== String(o.b)) {
      yazilanEl?.remove();
      yazilanMetin = '';
      yazilanEl = null;
      yazilanEl = ekle(h('div', { class: 'ileti claude imlec', dataset: { b: String(o.b) } }));
    }
    yazilanMetin = o.tam != null ? o.tam : yazilanMetin + o.ek;
    if (!cizim) cizim = setTimeout(() => {
      cizim = 0;
      if (!yazilanEl) return;
      const yapis = dipte();
      yazilanEl.innerHTML = md(yazilanMetin);
      if (yapis) kaydirEl.scrollTop = kaydirEl.scrollHeight;
    }, 60);
  }

  function durumCiz() {
    const d = canli?.durum;
    const calisiyor = d === 'calisiyor' || d === 'bekliyor';
    durdurDugme.hidden = !calisiyor;
    const sol = d === 'calisiyor' ? `${etkinlik || 'Çalışıyor'}…` : d === 'bekliyor' ? 'Yanıtını bekliyor' : d === 'hazir' ? 'Hazır' : '';
    const l = canli?.limit;
    const sag = [canli?.model?.replace(/^claude-/, ''), l?.bes != null ? `5 sa %${Math.round(l.bes * 100)}` : null, l?.yedi != null ? `hafta %${Math.round(l.yedi * 100)}` : null].filter(Boolean).join(' · ');
    durumEl.replaceChildren(d && d !== 'kapali' ? h('span', { class: `nokta ${d}` }) : '', h('span', {}, sol), h('span', { class: 'bos' }), h('span', {}, sag));
    if (canli?.mod && d !== 'kapali' && modSec.value !== canli.mod) modSec.value = canli.mod;
    // Başka bir cihazdan değiştirildiyse göster (yalnızca açık süreçte; kapalıysa sıradaki istem bu cihazın seçimiyle açılır).
    if (canli && d !== 'kapali' && typeof canli.efor === 'string' && eforSec.value !== canli.efor) eforSec.value = canli.efor;
  }

  // ── akış ──
  function olay(o) {
    if (kuyruk) { kuyruk.push(o); return; }
    switch (o.t) {
      case 'durum':
        canli = o; if (o.durum !== 'calisiyor') etkinlik = '';
        durumCiz();
        if (o.durum === 'kapali') { akisKapat(); bekleyenAraclariKapat(); }
        break;
      case 'yenile': gecmisYukle(); break;
      case 'yaz': yaz(o); break;
      case 'etkinlik': etkinlik = o.ne; durumCiz(); break;
      case 'limit': if (canli) { canli.limit = o.limit; durumCiz(); } break;
      default:
        if ((o.t === 'sonuc' || o.t === 'izin') && document.hidden) document.title = '● Kumanda';
        if (o.t === 'sonuc') urunleriTazele();
        ogeCiz(o);
    }
  }

  function akisKapat() { kaynak?.close(); kaynak = null; }
  function akisAc() {
    if (kapandi || kaynak || !sid) return;
    const k = new EventSource(`/api/oturum/${sid}/akis${isaret ? `?sonra=${encodeURIComponent(isaret)}` : ''}`);
    kaynak = k;
    k.onmessage = e => { if (e.lastEventId) isaret = e.lastEventId; olay(JSON.parse(e.data)); };
    k.onerror = () => {
      // Kalıcı kapanma: koşu artık yok (sunucu yeniden başlamış olabilir). Geçmişi transkriptten tazele.
      if (k.readyState === EventSource.CLOSED && kaynak === k) { kaynak = null; isaret = ''; gecmisYukle(); }
    };
  }

  async function gecmisYukle() {
    if (!sid || kuyruk) return;
    kuyruk = [];
    try {
      const v = await api(`/api/proje/${pid}/oturum/${sid}`);
      if (kapandi) return;
      araclar.clear(); izinler.clear(); yanSorular.clear(); yazilanEl = null; yazilanMetin = '';
      akisEl.replaceChildren();
      if (v.kirpildi) akisEl.append(h('div', { class: 'ileti not' }, 'Daha eski iletiler gösterilmiyor'));
      for (const o of v.ogeler) ogeCiz(o);
      bekleyenAraclariKapat();
      canli = v.canli;
      durumCiz();
      kaydirEl.scrollTop = kaydirEl.scrollHeight;
    } catch (x) {
      if (x.kod === 404) akisEl.replaceChildren(h('div', { class: 'bos-durum' }, 'Bu sohbet bulunamadı.'));
      else if (x.kod !== 401) bildir(x.message);
    } finally {
      const bekleyen = kuyruk || [];
      kuyruk = null;
      for (const o of bekleyen) olay(o);
      if (canli && canli.durum !== 'kapali') akisAc();
    }
  }

  async function gonder() {
    const metin = alan.value.trim();
    if (!metin && !ekler.length) return;
    const btw = /^\/btw(?:\s+([\s\S]*))?$/i.exec(metin);
    if (btw) { yanSoruGonder((btw[1] || '').trim()); return; }
    gonderDugme.disabled = true;
    try {
      const r = await api(`/api/proje/${pid}/gonder`, { oturum: sid, metin, resimler: ekler.map(e => ({ tur: e.tur, veri: e.veri })), mod, model, efor: eforSec.value });
      alan.value = ''; ekler.length = 0; ekleriCiz(); boyutla();
      if (!sid) { sid = r.oturum; history.replaceState(null, '', `#/p/${pid}/s/${sid}`); baslikEl.textContent = metin.slice(0, 60) || 'Sohbet'; }
      if (r.nesil !== canli?.nesil) { akisKapat(); isaret = ''; }
      akisAc();
    } catch (x) { if (x.kod !== 401) bildir(x.message); }
    finally { gonderDugme.disabled = false; }
  }

  // ── yazma alanı ──
  function boyutla() { alan.style.height = 'auto'; alan.style.height = `${Math.min(alan.scrollHeight, innerHeight * 0.4)}px`; }
  function ekleriCiz() {
    eklerEl.replaceChildren(...ekler.map((e, i) => h('div', { class: 'ek' }, h('img', { src: e.url, alt: 'Eklenen resim' }),
      h('button', { type: 'button', 'aria-label': 'Resmi kaldır', onclick: () => { ekler.splice(i, 1); ekleriCiz(); } }, '×'))));
  }
  async function resimEkle(dosyalar) {
    for (const d of dosyalar) {
      if (!d.type.startsWith('image/') || ekler.length >= 8) continue;
      try { ekler.push(await resimHazirla(d)); } catch { bildir('Resim okunamadı'); }
    }
    ekleriCiz();
  }
  alan.addEventListener('input', boyutla);
  alan.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && !DOKUNMATIK) { e.preventDefault(); gonder(); }
  });
  alan.addEventListener('paste', e => {
    const resimler = [...(e.clipboardData?.files || [])].filter(f => f.type.startsWith('image/'));
    if (resimler.length) { e.preventDefault(); resimEkle(resimler); }
  });
  dosyaGirdi.addEventListener('change', () => { resimEkle([...dosyaGirdi.files]); dosyaGirdi.value = ''; });
  modSec.addEventListener('change', async () => {
    mod = modSec.value; localStorage.setItem('kumanda.mod', mod);
    if (sid && canli && canli.durum !== 'kapali') { try { await api(`/api/oturum/${sid}/mod`, { mod }); } catch (x) { bildir(x.message); modSec.value = canli.mod; } }
  });
  modelSec.addEventListener('change', async () => {
    model = modelSec.value; localStorage.setItem('kumanda.model', model);
    if (sid && canli && canli.durum !== 'kapali') { try { await api(`/api/oturum/${sid}/mod`, { model }); } catch (x) { bildir(x.message); } }
  });
  eforSec.addEventListener('change', async () => {
    efor = eforSec.value; localStorage.setItem('kumanda.efor', efor);
    if (sid && canli && canli.durum !== 'kapali') {
      try { await api(`/api/oturum/${sid}/mod`, { efor }); bildir(canli.durum === 'calisiyor' ? 'Effort sıradaki adımdan itibaren geçerli' : 'Effort değişti'); }
      catch (x) { bildir(x.message); eforSec.value = canli.efor ?? ''; }
    }
  });

  // Sekme gizlenince akışı bırak: sunucu "izleyen yok" bilir ve telefona bildirim yollar. Dönünce kaldığı yerden sürer.
  const gorunurluk = () => {
    clearTimeout(gizliSayaci);
    if (document.hidden) gizliSayaci = setTimeout(akisKapat, 15000);
    else { document.title = 'Kumanda'; if (canli && canli.durum !== 'kapali') akisAc(); }
  };
  document.addEventListener('visibilitychange', gorunurluk);

  if (sid) {
    gecmisYukle();
    urunleriYukle(false);
    api(`/api/proje/${pid}`).then(v => { const o = v.oturumlar.find(x => x.kimlik === sid); if (o && !kapandi) baslikEl.textContent = o.baslik; }).catch(() => {});
  } else {
    akisEl.append(h('div', { class: 'bos-durum' }, `${projeAdi(pid) || 'Bu proje'} klasöründe yeni bir Claude Code sohbeti. Ne yapılsın?`));
    if (!DOKUNMATIK) alan.focus();
  }
  durumCiz();

  return { kapat() { kapandi = true; akisKapat(); clearTimeout(gizliSayaci); clearTimeout(cizim); clearTimeout(urunSayaci); document.removeEventListener('visibilitychange', gorunurluk); } };
}

// ───────── ayarlar ─────────
function b64Coz(s) {
  const ham = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(ham, c => c.charCodeAt(0));
}

async function bildirimAc() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    throw new Error(CIHAZ === 'ios' ? 'iPhone\'da önce Paylaş → "Ana Ekrana Ekle" ile kur, sonra oradan aç.' : 'Bu tarayıcı ya da adres (https gerekir) bildirimleri desteklemiyor.');
  }
  if (await Notification.requestPermission() !== 'granted') throw new Error('Bildirim izni verilmedi');
  const kayit = await navigator.serviceWorker.ready;
  const { anahtar } = await api('/api/bildirim/anahtar');
  const abonelik = await kayit.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64Coz(anahtar) });
  await api('/api/bildirim/abone', { ucNokta: abonelik.endpoint });
}

function ayarlarSayfasi() {
  const govde = h('div', { class: 'ic' });
  ana.replaceChildren(ustCubuk({ baslik: 'Ayarlar', alt: `Kumanda ${durumBilgisi?.surum || ''}` }), h('div', { class: 'kaydir' }, govde));
  let iptal = false;

  async function ciz() {
    let cihazlar = [], gizliProjeler = [], abone = false;
    try {
      cihazlar = (await api('/api/cihazlar')).cihazlar;
      gizliProjeler = (await api('/api/projeler?gizliler')).projeler.filter(p => p.gizli);
      const kayit = await navigator.serviceWorker?.getRegistration();
      abone = Boolean(await kayit?.pushManager?.getSubscription());
    } catch (x) { if (x.kod === 401) return; }
    if (iptal) return;

    const eski = h('input', { type: 'password', autocomplete: 'current-password', placeholder: 'Şimdiki şifre' });
    const yeni = h('input', { type: 'password', autocomplete: 'new-password', placeholder: `Yeni şifre (en az ${durumBilgisi.enAzSifre} karakter)` });
    const klasor = h('input', { type: 'text', placeholder: 'C:\\Users\\…\\Proje klasörü', autocapitalize: 'off', spellcheck: false });

    govde.replaceChildren(
      h('h2', {}, 'Bildirimler'),
      h('div', { class: 'kart' },
        h('p', { style: 'margin-top:0' }, 'Claude işini bitirdiğinde ya da izin beklediğinde, sayfa açık değilken bu cihaza bildirim gelir.'),
        h('div', { class: 'dugmeler' },
          abone
            ? h('button', { class: 'dugme', onclick: async () => {
              try {
                const s = await (await navigator.serviceWorker.getRegistration()).pushManager.getSubscription();
                await api('/api/bildirim/abonelik-sil', { ucNokta: s.endpoint }); await s.unsubscribe(); ciz();
              } catch (x) { bildir(x.message); }
            } }, 'Bu cihazda kapat')
            : h('button', { class: 'dugme ana', onclick: async () => { try { await bildirimAc(); bildir('Bildirimler açıldı'); ciz(); } catch (x) { bildir(x.message); } } }, 'Bu cihazda aç'),
          abone && h('button', { class: 'dugme', onclick: async () => { try { await api('/api/bildirim/dene', {}); bildir('Deneme bildirimi gönderildi'); } catch (x) { bildir(x.message); } } }, 'Deneme gönder')),
        h('p', { class: 'kucuk sonuk', style: 'margin-bottom:0' }, 'Telefonda tarayıcı menüsünden "Ana ekrana ekle" ile uygulama gibi kurabilirsin. iPhone\'da bildirimler yalnızca böyle kurulunca çalışır.')),

      h('h2', {}, 'Giriş yapmış cihazlar'),
      h('div', { class: 'kart' },
        cihazlar.map(c => h('div', { class: 'ayar-satiri' },
          h('div', { class: 'govde' }, h('div', {}, c.cihaz, c.bu && h('span', { class: 'rozet vurgu', style: 'margin-left:6px' }, 'bu cihaz')),
            h('div', { class: 'kucuk sonuk' }, `Son görülme ${goreliZaman(c.son)}`)),
          !c.bu && h('button', { class: 'dugme kucuk tehlike', onclick: async () => { try { await api('/api/cihazlar/kapat', { kimlik: c.kimlik }); ciz(); } catch (x) { bildir(x.message); } } }, 'Çıkar'))),
        h('div', { class: 'dugmeler', style: 'margin-top:10px' },
          cihazlar.length > 1 && h('button', { class: 'dugme', onclick: async () => { try { await api('/api/cihazlar/kapat', { digerleri: true }); ciz(); } catch (x) { bildir(x.message); } } }, 'Diğer cihazların hepsini çıkar'),
          h('button', { class: 'dugme tehlike', onclick: async () => { try { await api('/api/cikis', {}); } finally { location.reload(); } } }, 'Çıkış yap'))),

      h('h2', {}, 'Şifre'),
      h('form', { class: 'kart', style: 'display:grid;gap:8px', onsubmit: async e => {
        e.preventDefault();
        try { await api('/api/sifre', { eski: eski.value, yeni: yeni.value }); eski.value = yeni.value = ''; bildir('Şifre değişti'); } catch (x) { bildir(x.message); }
      } }, eski, yeni, h('div', {}, h('button', { class: 'dugme', type: 'submit' }, 'Şifreyi değiştir'))),

      h('h2', {}, 'Projeler'),
      h('div', { class: 'kart' },
        h('p', { class: 'kucuk sonuk', style: 'margin-top:0' }, 'Proje klasörlerinin dışındaki bir klasörü de proje olarak ekleyebilirsin (bilgisayardaki tam yol).'),
        h('form', { style: 'display:flex;gap:8px', onsubmit: async e => {
          e.preventDefault();
          try { await api('/api/proje-ekle', { yol: klasor.value.trim() }); klasor.value = ''; bildir('Proje eklendi'); projeleriYenile(); } catch (x) { bildir(x.message); }
        } }, klasor, h('button', { class: 'dugme', type: 'submit' }, 'Ekle')),
        gizliProjeler.length ? [h('div', { class: 'etiket', style: 'margin-top:14px' }, 'Gizlenen projeler'),
          gizliProjeler.map(p => h('div', { class: 'ayar-satiri' }, h('div', { class: 'govde' }, p.ad),
            h('button', { class: 'dugme kucuk', onclick: async () => { try { await api(`/api/proje/${p.kimlik}/gizle`, { gizli: false }); projeleriYenile(); ciz(); } catch (x) { bildir(x.message); } } }, 'Göster')))] : null));
  }
  ciz();
  return { kapat() { iptal = true; } };
}

// ───────── başlat ─────────
async function baslat() {
  try { durumBilgisi = await (await fetch('/api/durum')).json(); }
  catch { uyg.replaceChildren(h('div', { class: 'orta sonuk' }, 'Kumanda\'ya ulaşılamıyor. Bilgisayar açık ve bağlı mı?')); setTimeout(baslat, 4000); return; }
  if (!durumBilgisi.kurulu || !durumBilgisi.giris) return girisGoster();
  iskelet();
  addEventListener('hashchange', yonlendir);
  // VS Code kısayolları: Ctrl+B proje listesi, Ctrl+Shift+E dosyalar.
  document.addEventListener('keydown', e => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
    const tus = String(e.key).toLowerCase();
    if (tus === 'b' && !e.shiftKey) { e.preventDefault(); yanDegistir(); }
    else if (tus === 'e' && e.shiftKey && gezginPid) { e.preventDefault(); gezginDegistir(); }
  });
  let boyutSayaci = 0;
  addEventListener('resize', () => { clearTimeout(boyutSayaci); boyutSayaci = setTimeout(() => { duzenUygula(); agacCiz(); }, 150); });
  yonlendir();
  await projeleriYenile();
  setInterval(() => { if (!document.hidden) projeleriYenile(); }, 20000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) projeleriYenile(); });
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
    navigator.serviceWorker.addEventListener('message', e => { if (typeof e.data?.git === 'string') location.hash = e.data.git.replace(/^\/?#?/, '#'); });
  }
}
baslat();
