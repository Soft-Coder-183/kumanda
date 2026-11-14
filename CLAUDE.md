# Kumanda

Eren'in bilgisayarındaki Claude Code'u ve bütün projelerinin ürünlerini (HTML, APK, EXE, ZIP, video, belge) telefondan ya da başka
bir bilgisayardan kullanmasını sağlayan yerel sunucu + web arayüzü. Bağımlılıksız Node.js (22+), derleme adımı yok. Sunucu yalnızca
`127.0.0.1`'i dinler; uzaktan erişim Tailscale yönlendirmesiyle gelir. Durum: 1.0.0 (2026-11-13), yerel kullanım denendi, uzak erişim
ve arayüzün gerçek tarayıcıdaki görünümü henüz denenmedi. Ayrıntılar: `PROJE_DEVIR.md` (gerektiğinde ilgili bölümü oku).

## Komutlar
- Kurulum / yeniden başlatma: `.\kur.ps1` (otomatik başlatma kısayolu + sunucuyu yeni kodla başlatır)
- Çalıştırma (ön planda, geliştirirken): `node sunucu.mjs`; arka planda: `node sunucu.mjs --arkaplan`
- Durum / durdurma: `node sunucu.mjs --durum`, `node sunucu.mjs --durdur`
- Test: `npm test` (gerçek sunucu süreci + `test/sahte-claude.mjs`; Claude kotası harcamaz, kendi geçici portlarını ve veri klasörünü kullanır)
- Derleme: `DERLE.md` (tek komut: `.\derle.ps1`). Çıktı: çalışan sunucu, http://127.0.0.1:7777
- Uzak erişim: `.\uzak-kur.ps1` (`-Herkese`, `-Kapat`)

## Düzen
- `sunucu.mjs`: giriş noktası; komut satırı bayrakları, API yolları, kumanda (7777) ve ürün (7778) sunucuları
- `src/oturumlar.mjs`: Claude Code süreçleri (stream-json protokolü, izin aktarma, olay günlüğü, transkript okuma)
- `src/projeler.mjs`: proje keşfi, oturum listesi, ürün taraması, güvenli yol çözümü
- `src/kimlik.mjs`: şifre (scrypt), cihaz oturumları, giriş sınırı, ürün kökeni biletleri
- `src/bildirim.mjs`: Web Push (içeriksiz itme); `src/http.mjs`: HTTP yardımcıları; `src/ayar.mjs`: ayar dosyası
- `web/`: arayüz (`uygulama.js`, `stil.css`, `sw.js`); derlenmez, olduğu gibi sunulur
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
- Ürünler her zaman ayrı kökenden (ürün portu) sunulur; kumanda kökeninden proje dosyası sunan bir yol eklenmez.
- Şifre, jeton, anahtar depoya ya da belgelere yazılmaz; testler kendi geçici veri klasörünü kullanır (`KUMANDA_VERI`).
- Gerçek Claude ile deneme kota harcar: önce `npm test`, gerçek deneme yalnızca protokol değişikliklerinde ve `haiku` ile.
- Çalışan sunucu kod değişikliğini kendiliğinden almaz; değişiklikten sonra `.\kur.ps1` (ya da `--durdur` + `--arkaplan`).
- Claude Code sürümü değişince stream-json protokolü değişebilir: `PROJE_DEVIR.md` → "Claude Code protokolü".

## Commit ve sürüm
- Sürümün tek kaynağı `package.json` → `version` (arayüz ve `--durum` oradan okur). Notlar: `notlar/vX.Y.Z.md`.
- Depo yerel (uzak depo yok). Commit'e dosyalar adıyla eklenir (G2); mesaj Türkçe, tek konu (G6).
- Her işten sonra bu dosya ve `PROJE_DEVIR.md` güncellenir (devret).

## Devir belgesinde
- Mimari, Güvenlik modeli: kimlik, köken, tünel ya da ürün sunumuna dokunmadan önce
- Claude Code protokolü: `src/oturumlar.mjs`'e dokunmadan ya da Claude Code güncellenince
- Ürün taraması: hangi dosyanın ürün sayıldığı, "ikincil" kuralları
- Geliştirme ortamı ve tuzaklar, Açık işler: yeni işe başlamadan önce
