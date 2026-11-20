# Kumanda

Eren'in bilgisayarındaki Claude Code'u ve bütün projelerinin ürünlerini (HTML, APK, EXE, ZIP, video, belge) telefondan ya da başka
bir bilgisayardan kullanmasını sağlayan yerel sunucu + web arayüzü. Bağımlılıksız Node.js (22+), derleme adımı yok. Sunucu yalnızca
`127.0.0.1`'i dinler; uzaktan erişim Tailscale yönlendirmesiyle gelir (kurulu, yalnızca kendi ağ). Herkese açık depo (MIT):
https://github.com/Soft-Coder-183/kumanda. Durum: 1.3.0 (2026-11-20); gerçek telefondan kullanım ajan tarafından denenmedi. Ayrıntılar: `PROJE_DEVIR.md` (gerektiğinde ilgili bölümü oku).

## Komutlar
- Kurulum / yeniden başlatma: `.\kur.ps1` (otomatik başlatma kısayolu + sunucuyu yeni kodla başlatır)
- Çalıştırma (ön planda, geliştirirken): `node sunucu.mjs`; arka planda: `node sunucu.mjs --arkaplan`
- Durum / durdurma: `node sunucu.mjs --durum`, `node sunucu.mjs --durdur`
- Test: `npm test` (gerçek sunucu süreci + `test/sahte-claude.mjs`; Claude kotası harcamaz, kendi geçici portlarını ve veri klasörünü kullanır)
- Derleme: `DERLE.md` (tek komut: `.\derle.ps1`). Çıktı: çalışan sunucu, http://127.0.0.1:7777
- Uzak erişim: `.\uzak-kur.ps1` (`-Herkese`, `-Kapat`)
- README görüntüleri: `node araclar/ekran-goruntuleri.mjs` (playwright-core gerekir: `npm i --no-save playwright-core` ya da
  `KUMANDA_PLAYWRIGHT=<playwright-core bulunan klasör>`); tanıtım verisiyle, gerçek veriye dokunmaz. Arayüz değişince yenile.

## Düzen
- `sunucu.mjs`: giriş noktası; komut satırı bayrakları, API yolları, kumanda (7777) ve ürün (7778) sunucuları
- `src/oturumlar.mjs`: Claude Code süreçleri (stream-json protokolü, izin aktarma, olay günlüğü, transkript okuma)
- `src/projeler.mjs`: proje keşfi, oturum listesi, ürün taraması, güvenli yol çözümü
- `src/yansoru.mjs`: `/btw` yan soruları (çatallanmış, kaydedilmeyen, araçsız `claude -p`; saklama; history.jsonl'deki terminal soruları)
- `src/kimlik.mjs`: şifre (scrypt), cihaz oturumları, giriş sınırı, ürün kökeni biletleri
- `src/bildirim.mjs`: Web Push (içeriksiz itme); `src/http.mjs`: HTTP yardımcıları; `src/ayar.mjs`: ayar dosyası
- `web/`: arayüz (`uygulama.js`: görünümler, düzen/gezgin, dosya görüntüleyici ve sözdizimi renklendirici; `stil.css`, `sw.js`);
  derlenmez, olduğu gibi sunulur
- `test/`: `kumanda.test.mjs` (sunucu uçtan uca), `arayuz.test.mjs` (sahte DOM duman testi), `sahte-claude.mjs`
- Gizli veriler depoda değil: `%LOCALAPPDATA%\Kumanda\` (ayar, şifre özeti, cihaz oturumları, bildirim anahtarı, günlük)

## Kod kuralları
- Adlar ve yorumlar Türkçe (ASCII'ye indirgenmiş tanımlayıcılar: `oturum`, `urun`, `gonder`). ES modülleri, `node:` içe aktarmaları.
- Dış bağımlılık eklenmez (ne sunucuda ne arayüzde); gereken şey Node'un yerleşikleriyle yazılır.
- Arayüzde HTML yalnızca `h()` ile ya da `md()` çıktısı olarak üretilir; `md()` önce kaçırır, sonra biçimler. Ham metin `innerHTML`'e verilmez.
- DOM'a (`replaceChildren`, `append`) yalnızca düğüm verilir; `null`/dizi verilmez (`h()` bunları kendi içinde ayıklar).
- `.ps1` dosyaları UTF-8 **BOM'lu** kalmalı (Windows PowerShell 5.1 BOM'suz dosyada Türkçe harfleri bozar).

## Kurallar
- **Bu sistem bilgisayarda komut çalıştırma yetkisi verir.** Kimlik, köken ve yol denetimlerini gevşeten değişiklik yapılmadan önce
  `PROJE_DEVIR.md` → "Güvenlik modeli" okunur; her güvenlik kuralının testi `test/kumanda.test.mjs`'te durur ve silinmez.
- Sunucu varsayılan olarak yalnızca `127.0.0.1`'i dinler; bunu ya da "ilk şifre yalnızca yerelden" kuralını değiştirme.
- Ürünler her zaman ayrı kökenden (ürün portu) sunulur; kumanda kökeninden proje dosyası **belge olarak** sunan bir yol eklenmez.
  Dosya gezgini (`/api/proje/:pid/dosya`) içeriği yalnızca JSON içinde döner ve arayüz onu metin olarak çizer (`h()`/`md()`);
  dosya içeriği hiçbir zaman `innerHTML`'e, `iframe`'e ya da kumanda kökeninde açılan bir sayfaya verilmez.
- Şifre, jeton, anahtar depoya ya da belgelere yazılmaz; testler kendi geçici veri klasörünü kullanır (`KUMANDA_VERI`).
- Gerçek Claude ile deneme kota harcar: önce `npm test`, gerçek deneme yalnızca protokol değişikliklerinde ve `haiku` ile.
- Çalışan sunucu kod değişikliğini kendiliğinden almaz; değişiklikten sonra `.\kur.ps1` (ya da `--durdur` + `--arkaplan`).
- Claude Code sürümü değişince stream-json protokolü değişebilir: `PROJE_DEVIR.md` → "Claude Code protokolü".

## Commit ve sürüm
- Sürümün tek kaynağı `package.json` → `version` (arayüz ve `--durum` oradan okur). Notlar: `notlar/vX.Y.Z.md`.
- Depo herkese açık (`origin` = GitHub, `main`'de çalışılır, push serbest). Commit'e dosyalar adıyla eklenir (G2); push'tan önce
  yeni dosyalarda kişisel veri/sır denetimi (Tailscale adresi, kullanıcı yolları, transkript parçası girmez). Mesaj Türkçe, tek konu (G6).
- Yayın: `package.json` sürümü → not tamam → commit → `git tag -a vX.Y.Z -m "Kumanda X.Y.Z"` → push → `gh release create vX.Y.Z
  --notes-file notlar/vX.Y.Z.md` (dosya eklenmez). Yayımlanmış etiket taşınmaz.
- README kullanıcıya dönük ve Türkçe; özellik ya da komut değişince güncellenir.
- Her işten sonra bu dosya ve `PROJE_DEVIR.md` güncellenir (devret).

## Devir belgesinde
- Mimari, Güvenlik modeli: kimlik, köken, tünel ya da ürün sunumuna dokunmadan önce
- Claude Code protokolü: `src/oturumlar.mjs`'e dokunmadan ya da Claude Code güncellenince
- /btw yan soruları: `src/yansoru.mjs`'e ya da sohbet geçmişinin birleştirilmesine dokunmadan önce
- Ürün taraması: hangi dosyanın ürün sayıldığı, "ikincil" kuralları
- Dosya gezgini ve düzen: gezgine, dosya görüntüleyiciye, renklendiriciye ya da kenar çubuklarına dokunmadan önce
- Geliştirme ortamı ve tuzaklar, Açık işler: yeni işe başlamadan önce
