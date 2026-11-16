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
      h('button', { class: 'dugme duz kucuk', title: u.gizli ? 'Yeniden göster' : 'Listeden gizle', onclick: async () => {
        try { await api(`/api/proje/${pid}/urun-gizle`, { yol: u.yol, gizli: !u.gizli }); yenile(); } catch (x) { bildir(x.message); }
      } }, u.gizli ? 'Göster' : 'Gizle'),
      h('a', { class: `dugme kucuk${e.uyumlu ? ' ana' : ''}`, href: adres, target: '_blank', rel: 'noopener' }, e.ad)));
}

function urunIzgarasi(pid, urunler, yenile) {
  const asil = urunler.filter(u => !u.ikincil && !u.gizli);
  const ikincil = urunler.filter(u => u.ikincil && !u.gizli);
  const gizli = urunler.filter(u => u.gizli);
  const kutu = (ozet, liste, sinif) => liste.length ? h('details', { class: `diger ${sinif}` },
    h('summary', {}, ozet), h('div', { class: 'urunler' }, liste.map(u => urunKarti(pid, u, yenile)))) : null;
  // Her zaman yalnızca DOM öğelerinden oluşan bir dizi döner (replaceChildren'e yayılarak verilir).
  return [
    asil.length ? h('div', { class: 'urunler' }, asil.map(u => urunKarti(pid, u, yenile))) : null,
    kutu(`Diğer dosyalar (${ikincil.length}): kopyalar, eski sürümler, kaynak dosyaları`, ikincil, 'ikincil'),
    kutu(`Gizlediklerin (${gizli.length}): "Göster" ile geri gelir`, gizli, 'gizlenen'),
  ].filter(Boolean);
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
    urunIzgarasi(pid, liste, yenile)));
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
let yan, ana, listeEl, aramaEl;

function iskelet() {
  uyg.className = '';
  aramaEl = h('input', { type: 'search', placeholder: 'Proje ara', 'aria-label': 'Proje ara', oninput: projeleriCiz });
  listeEl = h('div', { class: 'liste' });
  yan = h('aside', { id: 'yan' },
    h('div', { class: 'ust' },
      h('div', { class: 'baslik' }, h('h1', {}, 'Kumanda')),
      h('a', { class: 'dugme kucuk', href: '#/urunler' }, 'Ürünler'),
      h('a', { class: 'dugme simge duz', href: '#/ayarlar', title: 'Ayarlar', 'aria-label': 'Ayarlar' }, '⚙')),
    h('div', { class: 'ara' }, aramaEl),
    h('div', { class: 'kaydir' }, listeEl));
  ana = h('main', { id: 'ana' });
  uyg.replaceChildren(yan, ana);
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
}

const projeAdi = pid => projeler.find(p => p.kimlik === pid)?.ad || '';

function ustCubuk({ baslik, alt, geri = '#/', sag = [] }) {
  return h('div', { class: 'ust' },
    h('a', { class: 'dugme simge duz geri', href: geri, 'aria-label': 'Geri' }, '‹'),
    h('div', { class: 'baslik' }, typeof baslik === 'string' ? h('h1', {}, baslik) : baslik, alt && (typeof alt === 'string' ? h('div', { class: 'alt' }, alt) : alt)),
    sag);
}

function yonlendir() {
  aktif?.kapat?.();
  aktif = null;
  const p = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  uyg.classList.toggle('ana-acik', p.length > 0);
  if (p[0] === 'p' && p[1]) {
    if (p[2] === 's' && p[3]) aktif = sohbetGorunumu(p[1], p[3]);
    else if (p[2] === 'yeni') aktif = sohbetGorunumu(p[1], null);
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
    ustCubuk({ baslik, alt, sag: [h('a', { class: 'dugme ana kucuk', href: `#/p/${pid}/yeni` }, 'Yeni sohbet')] }),
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
        govde.replaceChildren(
          h('div', { style: 'display:flex;align-items:center;gap:8px;margin-bottom:12px' },
            h('span', { class: 'sonuk kucuk', style: 'flex:1' }, v.urunler.length ? 'Her ürün, onu son değiştiren sohbetin altında' : ''),
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
      govde.replaceChildren(...(v.gruplar.length ? v.gruplar.map(g => h('section', { class: 'proje-grubu' },
        h('h2', {}, h('a', { href: `#/p/${g.proje.kimlik}/urunler`, style: 'color:inherit;text-decoration:none' }, `${g.proje.ad} ›`)),
        oturumGruplari(g.proje.kimlik, g.urunler, g.oturumlar || {}, yukle)))
        : [h('div', { class: 'bos-durum' }, 'Hiçbir projede ürün bulunamadı.')]));
    } catch (x) { if (!iptal && x.kod !== 401) govde.replaceChildren(h('div', { class: 'bos-durum' }, x.message)); }
  }
  yukle();
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
  const araclar = new Map(), izinler = new Map(), ekler = [];
  let mod = localStorage.getItem('kumanda.mod') || 'acceptEdits';
  let model = localStorage.getItem('kumanda.model') || '';
  let efor = localStorage.getItem('kumanda.efor') || '';

  const baslikEl = h('h1', {}, sid ? 'Sohbet' : 'Yeni sohbet');
  const akisEl = h('div', { class: 'sohbet' });
  const kaydirEl = h('div', { class: 'kaydir' }, akisEl);
  const durumEl = h('div', { class: 'durum-cubugu' });
  const eklerEl = h('div', { class: 'ekler' });
  const alan = h('textarea', { rows: 1, placeholder: 'Claude\'a yaz…', 'aria-label': 'İstem' });
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
        h('div', { class: 'sohbet-urunleri-ic' }, ...urunIzgarasi(pid, v.urunler, () => urunleriYukle(false))));
      urunPanel.open = acik;
      urunPanel.hidden = !v.urunler.length;
    } catch { /* ağ hatası: panel olduğu gibi kalsın */ }
  }
  const urunleriTazele = () => { clearTimeout(urunSayaci); urunSayaci = setTimeout(() => urunleriYukle(true), 1500); };

  ana.replaceChildren(ustCubuk({ baslik: baslikEl, alt: projeAdi(pid), geri: `#/p/${pid}` }), urunPanel, kaydirEl, durumEl, form);

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

  function ogeCiz(o) {
    switch (o.t) {
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
      araclar.clear(); izinler.clear(); yazilanEl = null; yazilanMetin = '';
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
