# Kumanda: Proje Devir Belgesi

Bilgisayardaki Claude Code'u ve proje ürünlerini her cihazdan kullanmak için yerel sunucu + web arayüzü. Bu belge, projeyi devralan
bir ajanın önceki konuşmaları görmeden işe başlayabilmesi için yazıldı.

- **Sahibi:** Eren (Türkçe konuşur). Kendi kullanımı için; depo herkese açık (MIT).
- **Depo:** https://github.com/Soft-Coder-183/kumanda (herkese açık, 2026-11-16). Sürümler GitHub'da etiket + yayın olarak;
  derlenecek bir şey olmadığı için yayına dosya eklenmez (kaynak zip'i yeterli).
- **Durum:** 1.2.0 yayımlandı (2026-11-17). Sunucu ve Claude protokolü gerçek Claude Code 2.1.322 ile denendi. Arayüz başsız
  Chrome'da denendi. Tailscale yönlendirmesi kurulu (yalnızca kendi ağ), https adresi bu bilgisayardan denendi.
  **Ajan tarafından denenmedi:** gerçek telefondan kullanım, telefonda bildirim. Bkz. Açık işler.
- **Devam eden iş:** yok.
- **Kapsam notu:** Bu belge her parçayı saymaz. Kodda burada anlatılmayan bir bölüm görürsen değiştirmeden önce kullanıcıya sor.

## Mimari

```
telefon / başka PC ──https──> Tailscale (serve: 443, 8443) ──> 127.0.0.1:7777 kumanda sunucusu ──stdin/stdout──> claude -p (proje klasöründe)
                                                          └──> 127.0.0.1:7778 ürün sunucusu ──> proje klasörlerindeki dosyalar
```

- **Çalışma biçimi:** Node.js 22+ (yerleşik `http`, `crypto`, `child_process`), dış bağımlılık yok. Arayüz derlemesiz tek sayfa
  (`web/uygulama.js`), canlı akış Server-Sent Events ile.
- **İki sunucu, iki köken (önemli karar):** Ürün HTML'leri kullanıcının/Claude'un ürettiği, CDN betiği de yükleyebilen sayfalardır.
  Kumanda ile aynı kökende sunulsalardı içlerindeki bir betik API'yi (yani bilgisayarda komut çalıştırmayı) kullanabilirdi. Bu yüzden
  ayrı portta sunulurlar; köken port içerdiği için tarayıcı ayırır. Sandbox CSP seçilmedi çünkü ürünlerin `localStorage`'ını bozar.
- **Süreç başına oturum:** Her canlı sohbet için bir `claude -p --input-format stream-json --output-format stream-json` süreci açık
  tutulur; `bosKapanmaDk` (20) dakika boşta kalınca kapatılır, sonraki istemde `--resume` ile yeniden açılır.
- **İstemci kopsa da iş sürer:** Süreç sunucuya bağlıdır; olaylar günlükte tutulur ve yeniden bağlanana kaldığı yerden oynatılır.
- **Gizli veriler proje dışında:** `%LOCALAPPDATA%\Kumanda\`. Neden: ürün sunucusu proje klasörlerini sunar ve Kumanda da bir projedir;
  şifre özeti proje içinde dursaydı sunulabilir ya da commit'lenebilirdi.

## Dosya haritası

| Yol | Görev |
|---|---|
| `sunucu.mjs` | Bayraklar (`--arkaplan`, `--durdur`, `--durum`, `--portlar`, `--sifre-sifirla`), API, `/ac` geçişi, iki sunucu |
| `src/oturumlar.mjs` | `Kosu` sınıfı (süreç + olay günlüğü), `cevir()` (satır → arayüz öğesi), `gecmisOku()` |
| `src/projeler.mjs` | `projeleriListele`, `oturumlariListele`, `urunleriListele` + `ikincilleriIsaretle`, `guvenliYol` |
| `src/yansoru.mjs` | `/btw` yan soruları: çatallanmış, kaydedilmeyen, araçsız Claude çağrısı; saklama; history.jsonl'den terminal soruları |
| `src/kimlik.mjs` | Şifre, `kumanda`/`urun` türü cihaz oturumları, giriş sınırı, biletler |
| `src/bildirim.mjs` | VAPID anahtarı, abonelikler, içeriksiz Web Push |
| `web/uygulama.js` | Bütün arayüz: `h()`, `md()`, düzen (`duzenUygula`, `tutamac`), gezgin (`agacCiz`), görünümler (`projeSayfasi`, `sohbetGorunumu`, `tumUrunler`, `dosyaGorunumu`, `ayarlarSayfasi`), renklendirici (`vurgula`) |
| `web/sw.js` | Yalnızca bildirim için servis çalışanı |
| `araclar/ikon-uret.mjs` | `web/ikon-*.png` üretir (ikon değişirse yeniden çalıştır) |
| `araclar/ekran-goruntuleri.mjs` | README görüntüleri (`belgeler/*.png`): geçici klasörde tanıtım projeleri/sohbetleri + sahte Claude ile ayrı örnek (7797/7798), başsız Chrome; sayfa hatası olursa çıkış kodu 1. Arayüz değişince yeniden çalıştır |
| `README.md`, `LICENSE` | Herkese açık depo yüzü (Türkçe); özellik/komut değişince README de güncellenir |
| `kur.ps1`, `uzak-kur.ps1`, `derle.ps1` | Kurulum/otomatik başlatma, Tailscale, denetle+test+yeniden başlat |

## Özellikler

| Bölüm | Ne yapar |
|---|---|
| Projeler | `ayar.kokler` altındaki klasörler + Claude Code'un tanıdığı klasörler; son etkinliğe göre sıralı, canlı durum noktası |
| Sohbet | Yeni sohbet ya da var olan (terminalde açılmış olanlar dahil) oturuma devam; akan yanıt, araç satırları, resim ekleme; Ctrl+Enter "şimdi gönder"; istem taslağı sohbet başına `localStorage['kumanda.taslak.<pid>.<oturum ya da yeni>']` |
| İzinler | Araç izni kartı (İzin ver / Hep izin ver / Reddet), Claude'un soruları (`AskUserQuestion`), plan onayı; mod ve model seçimi |
| Ürünler | Proje bazında ve toplu liste; web/video/PDF açılır, APK/EXE/ZIP iner; cihaza uyum etiketi; gizleme |
| Bildirim | Sayfa açık değilken "bitti / izin bekliyor" itmesi (cihaz başına Ayarlar'dan açılır) |
| Ayarlar | Cihaz oturumları, şifre değiştirme, kök dışı klasör ekleme, gizlenen projeler |
| Dosyalar | Proje klasörü ağacı (VS Code gezgini gibi) ve salt okunur, renklendirilmiş dosya görüntüleyici |
| Yan sorular | `/btw <soru>`: sohbeti bölmeden yan soru; soru ve yanıt saklanır, terminalde sorulanların soruları da görünür |
| Düzen | Masaüstünde sürüklenerek boyutlanan/kapanan sol bar ve dosyalar paneli; telefonda kaydırmalı çekmeceler |

### Proje keşfi
- Aday: her kökün alt klasörü + bir alt düzeyde Claude Code'un tanıdığı klasörler + `ayar.ekProjeler` + transkriptlerdeki `cwd`'ler.
- "Tanıdığı" = `~/.claude/projects/<kodlanmış yol>` klasörü var (kodlama: harf/rakam dışı her karakter `-`). Kodlama kayıplıdır, geri
  çevrilemez; bu yüzden kök dışı klasörler ancak transkriptinde `cwd` varsa bulunur, yoksa Ayarlar'dan elle eklenir.
- **Yeni proje (1.3.0):** `POST /api/proje-olustur { ad }` `ayar.kokler[0]` altında boş klasör açar (tek parçalı, Windows'ta geçerli
  ad; var olanın üstüne yazmaz, 409). Arayüz: sol bar **＋** → `#/p/<pid>/yeni`. Claude Code kaydı ilk sohbette oluşur.
- **Proje seçince son sohbet (1.3.0):** sol bardaki bağ `#/p/<pid>/son`; `sonSohbeteGit` `/api/proje/:pid`'in ilk oturumuna
  `history.replaceState` ile gider (geri tuşu döngüye girmez), sohbet yoksa sohbetler sekmesi. Sohbetteki geri oku `#/p/<pid>`.
- Kendi kaydı olmayıp içinde aday bulunan klasör kaptır, listelenmez ("Games", "Pocket Apps"). Ev klasörü ve geçici klasörler dışlanır.

### Ürün taraması (`src/projeler.mjs`)
- Uzantıya göre tür: web, android, windows, paket, video, belge. `YOKSAY` klasörleri, `.` ile başlayanlar ve `*-unpacked` gezilmez.
- 6'dan fazla HTML içeren klasör veri dökümü sayılır (yalnızca `index.html` alınır); `/src/` betiği çağıran HTML kaynak şablonudur, atlanır.
- **İkincil** (listede "Diğer dosyalar" altında): kaynak klasöründeki HTML, 1 MB altı exe, debug APK, kök dışı arşiv.
- **Yalnızca son sürüm (1.3.0, kullanıcı isteği):** aynı tür + aynı boyuttaki kopyalar ("kopya") ve sürüm numarası dışında aynı adlı
  dosyaların eskileri ("eski sürüm"; klasör fark etmez) `urunleriTara` sonunda **listeden çıkarılır**. Kumanda sürüm geçmişi
  tutmaz; bunlar diskte gerçekten duran eski derleme dosyalarıdır, silinmez.
- Sonuç proje başına 60 sn önbelleklenir ("Yeniden tara" tazeler). Kullanıcının gizledikleri `ayar.gizliUrunler`'de.

### Ürün → sohbet eşleşmesi (`urunleriOturumlaraBagla`, 2026-11-16)
- Her ürün, dosyanın son değiştirilme anına en yakın etkinliği olan oturuma bağlanır (fark ≤ 20 dk; yoksa `oturum: null`,
  arayüzde "Bir sohbete bağlanamayanlar"). Etkinlik = transkriptteki bütün `"timestamp"` değerleri; `<oturum>/subagents/*.jsonl`
  alt ajan transkriptleri ana oturuma sayılır.
- **Neden dosya adı değil zaman:** APK/EXE/ZIP derleme komutlarıyla yazılır, transkriptte adı geçmeyebilir. Bedeli: aynı projede iki
  sohbet aynı anda çalışırken ürün yanlış sohbete düşebilir; dosyaya sonradan elle dokunulursa o anki sohbete geçer.
- Transkriptler yalnızca sona eklenerek büyür: zaman damgaları dosya başına önbellekte; boyut büyüyünce yalnızca yeni kısım okunur
  (93 MB'lık transkriptle ilk tarama ~0,3 sn, sonrakiler ~10 ms).
- Uçlar: `GET /api/proje/:pid/urunler` → `{ urunler (her biri .oturum), oturumlar: { kimlik: { baslik, zaman } } }`, `?oturum=<kimlik>`
  yalnızca o sohbetin ürünleri; `/api/urunler` her gruba `oturumlar` ekler.
- Arayüz (`oturumGruplari`): proje → Ürünler sekmesi ve üstteki bütün ürünler sayfası (`tumUrunler`, proje başlığı → sohbet
  grupları) aynı gruplamayı kullanır; en son ürün çıkaran sohbet üstte. Sohbet ekranında başlığın yanında **Ürünler (n)** sekmesi
  (1.3.0; önceden üst çubuğun altında katlanır `<details>` vardı, kullanıcı fark etmedi): üst çubuğun altında, en çok 45dvh,
  kendi içinde kayan panel açar, yazma alanı görünür kalır. Açık durumu `acikKutular`'da `<pid>|sekme:<oturum>`. Tur bitince
  1,5 sn sonra yeniden taranır; ürün yoksa panel "henüz ürün yok" der.
- **Gizleme** (`ayar.gizliUrunler`, dosya silinmez): her grupta üç parça: asıl ürünler, "Diğer dosyalar" (ikincil), "Gizlediklerin"
  (Göster ile geri). Bu yüzden iki liste sayfası da `?gizliler` ile ister (`/api/urunler?gizliler` 1.1.1'de eklendi; önceden bütün
  ürünler sayfasında gizlenen ürün tamamen kayboluyordu).
- **Toplu gösterme** (1.2.0): `urun-gizle` tek `yol` ya da `yollar` dizisi alır (en çok 5000). Arayüzde proje Ürünler sekmesinin
  araç çubuğunda ve bütün ürünler sayfasında proje başlığının yanında "Gizlenenlerin hepsini göster"; kutuda 2+ gizli varsa
  kutunun içinde "Hepsini göster".
- **Kutular açık kalır:** `<details>` açık/kapalı durumu modül düzeyindeki `acikKutular` kümesinde (anahtar
  `<pid>|<oturum ya da ->|<ikincil|gizlenen>`, sohbet panelinde `<pid>|s:<oturum>`); yeniden çizim `yerindeCiz()` ile kaydırma
  yerini korur. Önceden her "Göster" bütün listeyi yeniden çizip kutuyu kapatıyordu.

### Düzen: sol bar, gezgin, çekmeceler (1.2.0)
- Masaüstü (≥ 900 px) ızgarası `[#yan | #gezgin | #ana]`; sütun genişlikleri `#uyg` üzerindeki `--yan-gen` / `--gezgin-gen`.
  Her öğe `grid-column` ile sabit sütundadır (biri `display:none` olunca ötekiler kaymasın diye).
- `tutamac()`: kenar tutamacı. Sürükleme `window` üzerindeki pointer olaylarıyla izlenir: panel eşiğin altında gizlenince tutamaç da
  gizlenir, öğeye bağlı yakalama kaybolurdu. `KAPANMA_ESIGI` (150 px) altı kapatır; kapalı sol bar `.kenar-tutamac` ile ekranın sol
  kenarından geri sürüklenir. Durum `localStorage['kumanda.duzen']`'da (cihaz başına).
- Düğmeler: sol barda «, ana üst çubukta ☰ (masaüstünde yalnızca sol bar kapalıyken görünür), `ustCubuk({ pid })` gezgin düğmesi.
  Kısayollar: `Ctrl+B`, `Ctrl+Shift+E`.
- Telefon (< 900 px): `yan-cekmece` / `gezgin-cekmece` sınıflarıyla soldan açılan sabit çekmeceler + `.perde`. Kaydırma
  (`dokunmaKaydirmasi`): ≥ 70 px ve yataylık dikeyin 1,8 katı; yatay kayan bir öğede (kod, tablo, girdi) başlarsa yok sayılır.
  Sağa: proje listesi (yalnızca ana görünüm açıkken); sola: açık çekmece kapanır. Ekranın en sol kenarı Android'in geri
  hareketine ait olduğu için kenardan başlama şartı yok. Her yönlendirmede çekmeceler kapanır.

### Dosya gezgini ve görüntüleyici (1.2.0)
- Uçlar: `GET /api/proje/:pid/dosyalar?yol=<klasör>` → `{ yol, girdiler: [{ ad, yol, klasor, boyut, zaman }], kesildi }` (klasörler
  önce, Türkçe doğal sıra, en çok 3000); `GET /api/proje/:pid/dosya?yol=<dosya>` → `tur: 'metin'` (ilk 1 MB; UTF-8, BOM'lu UTF-16
  çözülür; ilk 8 KB'ta NUL varsa ikili), `'resim'` (base64, ≤ 5 MB, SVG dahil) ya da `'ikili'` (yalnızca bilgi, içerik yok).
- İkisi de `guvenliYol()`'dan geçer: `.` ile başlayan parça (`.env`, `.git`), `..`, mutlak yol, dışarı çıkan bağlantı (junction)
  reddedilir; dışarı çıkan bağlantılar listede de görünmez. Kimlik ve köken denetimi bütün `/api` gibi.
- Arayüz yolu `#/p/<pid>/d/<encodeURIComponent(yol)>`. Gezgin önbelleği `agacOnbellek` (`<pid>|<klasör>`), açık klasörler
  `acikKlasorler`; dosya açılınca üst klasörleri kendiliğinden açılır. Gezgin kapalıyken ağ isteği yapılmaz; her açılışta tazelenir.
- Renklendirici `vurgula()`: dil başına sıralı kurallar (`KURAL`) tek düzenli ifadede birleşir; eşleşen grup sınıfı verir, kelimeler
  anahtar/sabit/işlev/tip diye sınıflanır. Kurallar yakalayan grup **içeremez** (`(?:)` kullan) ve `m` bayrağı kullanılmaz (çok
  satırlı yorumları satır sonunda keser; satır başı için `(?:^|(?<=\n))`). 400 KB üstü renklendirilmez. Satır numaraları CSS sayacı.
- Markdown `md()` ile önizlenir; resim `data:` adresli `<img>`; **Aç / İndir** `/ac` üzerinden ürün kökenine gider.
- Neden VS Code `serve-web` / tüneli değil: yeni bir port, ayrı kimlik ve Tailscale kuralı (ek saldırı yüzeyi) gerekirdi; salt
  okunur görüntüleme mevcut şifre ve köken denetimlerinin arkasında kalıyor. Düzenleme istenirse önce bu karar yeniden tartılmalı.

### Ürün sunumu
- Arayüzdeki bağ `/ac?p=<proje>&y=<yol>` (kumanda kökeni) → tek kullanımlık, 60 sn'lik bilet → ürün kökeninde `/_ac` kendi çerezini
  (`kumanda_u`) kurar → `/p/<proje>/<yol>`. Bilet düzeni iki köken ayrı host'ta olsa da çalışsın diye var.
- Kök-mutlak yollar (`/assets/a.js`) Referer'daki ürün klasöründen, yoksa `kumanda_son` çerezindeki son açılan üründen başlanıp
  proje köküne doğru aranır. İstemci tarafı yönlendirmeli (SPA) siteler ve sunucu isteyen uygulamalar çalışmaz.
- Ürün kökeni adresi `urunKokeni()` ile seçilir: `ayar.kamu[host]` varsa o; https ve portsuz host ise `:8443` (Tailscale düzeni);
  aksi halde aynı host + `urunPort`.

### Canlı akış ve geçmiş
- Kalıcı olaylar sıra numarası (`n`) taşır; SSE `id` alanı `<nesil>:<n>`. Akan metin parçaları (`yaz`), `durum`, `etkinlik`, `limit` geçicidir.
- Görüntü = transkriptin `gecmisSinir` baytına kadarki kısmı (geçmiş) + koşunun olay günlüğü. Böylece aynı ileti iki kez çizilmez.
- Başka nesilden ya da günlük sıfırlanmadan önceki işaretle gelen istemciye `yenile` gönderilir; istemci geçmişi yeniden yükler.
- İstemci sekme gizlenince 15 sn sonra akışı bırakır; sunucu dinleyicisi olmayan koşu için bildirim yollar.
- **Araç grupları (1.3.0):** peş peşe `arac` öğeleri `aracGrubu`'nda toplanır (`ekle(el, true)`; başka her öğe grubu kapatır).
  Tek araçlık grup `.tek` (özet gizli, açık); ikincide kapanır, özet "N adım: Bash ×6 · Edit". Grup durumu `grupDurumu()`.
- **Tur sonları geçmişte (1.3.0):** transkriptte "tur bitti" satırı yok (`system/turn_duration` yalnızca bazı CLI turlarında); `turSonlari()`
  her istemden sonraki son öğeye `{ t: 'sonuc', sure: son − istem, z: son }` ekler. Arayüz "X çalıştı · bitti SS:DD" yazar.
  Transkripti o an terminalde yazılan son tur da "bitti" görünür (bilinen sınır).
- **Kullanım yüzdesi (1.3.0):** `rate_limit_event` yalnızca bir istekten sonra gelir. Son değer `VERI/limit.json`'da
  (`sonLimitAl`), geçmiş ucu `limit` döner; arayüz açık koşunun değeri yoksa onu gösterir, `besSifir`/`yediSifir` (sn) geçmişse
  o pencereyi gizler.

### /btw yan soruları (`src/yansoru.mjs`, 1.3.0)
- **Claude Code bunları saklamaz** (2.1.329'da bakıldı): terminaldeki `/btw <soru>` transkripte hiç girmez (yalnızca argümansız
  `/btw` "Usage" çıktısıyla düşer; `cevir()` bunu gizler), soru yalnızca `~/.claude/history.jsonl`'e (`display`, `timestamp` ms,
  `sessionId`) yazılır, **yanıt hiçbir yere yazılmaz**. Eski yan soruların yanıtları kurtarılamaz.
- Kumanda'dan sorulan: istem `/btw ` ile başlarsa arayüz `POST /api/proje/:pid/oturum/:sid/yan-soru { id, soru, model, efor }` yollar
  (asıl sohbete gitmez). Sunucu `claude -p --output-format json --resume <sid> --fork-session --no-session-persistence --tools ""
  --strict-mcp-config --append-system-prompt <yönerge>` çalıştırır, soruyu stdin'e yazar. Haiku ile denendi: kopya sohbetin
  bağlamını bilir, ne asıl transkript ne yeni transkript ne de history.jsonl değişir. Aynı anda en çok 3, süre 3 dk.
- Saklama: `%LOCALAPPDATA%\Kumanda\yan-sorular\<oturum>.jsonl` (`{ id, z, soru, yanit | hata, kaynak, model }`); bekleyenler bellekte.
- Görüntü: geçmiş ucu yan soruları (kayıtlılar + bekleyenler + history.jsonl'dekiler, `kaynak: 'terminal'`) zamanına göre `t: 'btw'`
  öğesi olarak araya katar (`arayaKat`). Açık koşu varsa `Kosu.sinirZ`'den sonrakiler geçmişe girmez; onlar koşunun olay günlüğüne
  (`yanSoruYayinla`) "bekliyor" ve yanıtlı olarak iki kez düşer. Kimliği istemci üretir; arayüz her kimliğe tek kart çizer, yanıtlı
  kart "bekliyor"a dönmez (geçmiş, akış ve POST yanıtı hangi sırayla gelirse gelsin).
- history.jsonl yalnızca sona eklenerek büyür: yalnızca yeni kısmı okunur (`terminal.okunan`); dosya kısalırsa baştan.

## Güvenlik modeli

Tehdit: bu arayüze erişen kişi bilgisayarda Claude aracılığıyla komut çalıştırabilir. Katmanlar:

1. **Ağ:** sunucu `127.0.0.1`'de. Dışarıdan tek yol `uzak-kur.ps1`'in kurduğu Tailscale yönlendirmesi (varsayılan: yalnızca kendi ağı).
2. **Şifre:** scrypt (N=2^15) özeti. İlk şifre yalnızca "yerel" istekle konur: döngü adresi + `Host` localhost + vekil başlığı yok
   (`istekBilgisi().yerel`). Tünelden gelen ya da DNS yeniden bağlamayla gelen istek sistemi sahiplenemez. Şifresizken `uzak-kur.ps1` çalışmaz.
3. **Giriş sınırı:** istemci başına 15 dk'da 5, toplamda saatte 40 hatalı deneme. Tünel arkasında istemci `X-Forwarded-For`'dan okunur.
4. **Oturum:** `HttpOnly`, `SameSite=Lax` çerez (https'te `Secure`), sunucuda yalnızca SHA-256 özeti, 30 gün kayan ömür.
5. **Köken:** `/api/*` için `Origin` host'u `Host` ile aynı ve `Sec-Fetch-Site` `same-origin` olmalı; GET dışında `X-Kumanda: 1` başlığı
   şart (çapraz kökenden basit istek gönderilemez). Ürün sayfaları ayrı kökendedir, bu denetimden geçemez.
6. **Yol:** `guvenliYol()` `..`, `.` ile başlayan parçaları ve gerçek yolu proje dışına çıkan bağlantıları reddeder.
7. **Dosya içeriği kumanda kökeninde yalnızca veridir:** gezgin uçları içeriği JSON içinde döner (`nosniff`); arayüz onu metin
   düğümü ya da `md()` ile çizer, resmi `data:` adresli `<img>` ile gösterir (SVG `<img>` içinde betik çalıştırmaz). Kumanda
   kökeninde proje dosyası belge olarak açılmaz; "Aç" ürün kökenine gider.
8. **Yan soru (`/btw`) araçsızdır:** `--tools ""` ve `--strict-mcp-config` ile açılır; soru argüman değil stdin'den gider (kabuk
   yok, `spawn` dizisi). Kimlik/köken denetimi bütün `/api` gibi; test `kumanda.test.mjs` → "/btw yan sorusu".

Bilinen sınırlar: çerezler port ayırmaz (aynı host'ta kumanda çerezi ürün portuna da gider ama `HttpOnly`'dir ve ürün sunucusu onu
kullanmaz); bütün ürünler tek kökeni, dolayısıyla `localStorage`'ı paylaşır; `-Herkese` modunda tek koruma şifre ve giriş sınırıdır.

## Claude Code protokolü (2.1.322'de gözlendi, 2026-11-12)

- Başlatma bayrakları `Kosu.#baslat`'ta. `--permission-prompt-tool stdio` **gizli** bir bayraktır (`--help`'te yok); onsuz izin
  istekleri sorulmadan reddedilir. `--allow-dangerously-skip-permissions` olmadan çalışırken `bypassPermissions` moduna geçilemez.
- İzin isteği: stdout'ta `{"type":"control_request","request":{"subtype":"can_use_tool",tool_name,input,permission_suggestions,…}}`.
  Yanıt stdin'e: `{"type":"control_response","response":{"subtype":"success","request_id",…,"response":{"behavior":"allow","updatedInput":…}}}`
  ya da `{"behavior":"deny","message":…}`. "Hep izin ver" = `updatedPermissions: permission_suggestions` (projenin
  `.claude/settings.local.json` dosyasına kural yazar).
- `AskUserQuestion` de `can_use_tool` olarak gelir; yanıt `updatedInput.answers = { "<soru metni>": "<etiket>" }`.
- Bizden giden kontrol istekleri: `interrupt`, `set_permission_mode` (`mode`: `default`/`acceptEdits`/`auto`/`plan`/`bypassPermissions`),
  `set_model`, `apply_flag_settings` (effort için `settings: { effortLevel }`). CLI bayrağında `default`'un adı `manual`'dır.
- **Effort (2026-11-16'da gerçek istekle doğrulandı):** süreç açılırken `--effort`, çalışırken
  `apply_flag_settings { effortLevel: X }`; ikisi de kullanıcının `settings.json`'daki model başına `modelSettings.*.effortLevel`
  ayarını ezer, `effortLevel: null` kullanıcının ayarına döndürür. `set_effort` diye bir istek yok (`unsupported_request`).
  `get_settings`'in "effective" alanı bayrak katmanını güvenilir göstermez; doğrulama transkriptteki `api-request` satırının
  `params.output_config.effort` alanından yapılır.
- **Şu anki effort'un gösterimi (1.3.0):** `sonIstek()` transkriptin son 2 MB'ında geriye doğru son `api-request` satırını
  (`querySource` `sdk` ya da `repl_main_thread`) bulur → `{ efor, model }`. Koşu bunu turun ilk `assistant` satırında ve `result`'ta
  okur, `anlik().son` ile durum çubuğuna yollar; geçmiş ucu da `son` döner. "Varsayılan" seçeneğinin etiketi `GET
  /api/proje/:pid/efor` (`eforAyarlari`: `~/.claude/settings.json` → projenin `.claude/settings.json` → `settings.local.json`;
  `effortLevel`, `model`, `modelSettings.<tam model>.effortLevel`) ile hesaplanır. Ortam değişkeniyle verilen effort görülmez.
- **Şimdi gönder (Ctrl+Enter, 1.3.0):** `gonder` ucunda `simdi: true` ve koşu çalışıyorsa önce `interrupt`, sonra istem. Kesilen
  turun `result`'ı yeni istemin `kullanici` olayından sonra gelebilir. Düz Enter istemi stdin'e yazar; CLI onu sıraya alır.
- `--include-partial-messages` ile her içerik bloğu ayrı `assistant` satırı olarak, metin parçaları `stream_event` olarak gelir.
- Yeni oturumda `--session-id <uuid>` ile kimliği biz veririz; `--resume` aynı kimliği ve aynı transkript dosyasını sürdürür.
- Kısa (8.3) yol içeren çalışma klasöründe (`C:\Users\ADINIZ~1\…` gibi) Claude Code yazmayı "şüpheli yol" diye reddeder; projeler uzun yolla tutulur.
- Protokol değişirse önce `test/sahte-claude.mjs` gerçeğe uydurulur, sonra `oturumlar.mjs`.

## Derleme ve deneme

- **Derleme hattı:** yok; `derle.ps1` denetim + test + `kur.ps1`. Komutlar `DERLE.md`'de.
- **Arka plan başlatma:** `--arkaplan` Windows'ta sunucuyu WMI (`Win32_Process.Create`, gizli pencere) ile `--gunluk` bayrağıyla
  başlatır: süreç başlatan terminalin/VS Code'un/Claude Code'un iş nesnesine girmez, onlar kapanınca ölmez; üst süreci `WmiPrvSE.exe`.
  WMI çıktı yönlendiremez, bu yüzden `--gunluk` kipi `console.*`'ı günlük dosyasına yazar. WMI ile açılan süreç çağıranın ortam
  değişkenlerini **devralmaz**: testler `KUMANDA_DOGRUDAN=1` ile eski (doğrudan `spawn`) yolu kullanır.
- **Deneme düzeni:** `npm test` geçici klasörde gerçek sunucuyu başlatır (`KUMANDA_VERI`, `KUMANDA_CLAUDE_DIZIN`, `KUMANDA_CLAUDE`,
  `KUMANDA_DOGRUDAN` ortam değişkenleriyle), sahte Claude kullanır. `arayuz.test.mjs` arayüzü sahte DOM'da çalıştırır: çalışma zamanı hatalarını yakalar,
  görünümü doğrulamaz.
- **Gerçek Claude ile deneme:** ayrı veri klasörü ve portla ikinci bir örnek başlatılır (`KUMANDA_VERI=<geçici>`, `ayar.json`'da başka
  portlar) ve `haiku` ile denenir; kurulu örneğe ve kullanıcının şifresine dokunulmaz.

## Kurallar

Kurallar, komutlar ve commit/sürüm uygulaması `CLAUDE.md`'dedir (her oturumda yüklenir); burada tekrarlanmaz.

## Geliştirme ortamı ve tuzaklar

- Windows 11, Node 24, Claude Code `~\.local\bin\claude.exe`. Varsayılan kabuk Windows PowerShell 5.1.
- Kabuk betiğiyle (`node -e`, heredoc) dosyaya regex yazınca ters eğik çizgiler kayboldu (2026-11-12); regex içeren düzenlemeler
  doğrudan düzenleme aracıyla yapılır.
- `node --test test/` Node 24'te klasörü modül sanıp hata verir; dosyalar adıyla verilir (`npm test` böyle).
- `test/` altındaki her `.mjs` varsayılan test keşfine girer; `sahte-claude.mjs` test değildir, bu yüzden keşif kullanılmaz.
- Betiklerde ve belgelerde adres `127.0.0.1` yazılır, `localhost` değil: Windows PowerShell 5.1 `localhost`'u önce IPv6'da dener ve
  2 sn'lik zaman aşımına düşer; `kur.ps1` bu yüzden çalışan sunucuya "başlamadı" demişti (2026-11-14).
- Cihaz oturumları (`cihazlar.json`) yalnızca sunucu açılırken okunur ve bellekte tutulur; başka bir süreçten dosyaya yazmak çalışan
  sunucuyu etkilemez. Bu yüzden `--sifre-sifirla` önce sunucuyu durdurur, sıfırlar, sonra yeniden başlatır (2026-11-16).
- Arayüzde `hidden` özniteliği, `display` veren sınıfları (`.dugme`) ezemiyordu; "Durdur" hazır durumda da görünüyordu. Çözüm
  `stil.css`'in başındaki `[hidden] { display: none !important; }` (2026-11-16, gerçek tarayıcı görüntüsünde fark edildi; sahte DOM
  testi bunu yakalayamaz).
- `fetch` `Host` başlığını değiştirtmez; yabancı `Host` testi `http.request` ile yapılır.
- `ayar.json` yokken sunucu varsayılan portlarla (7777/7778) açılır: ikinci örnek başlatılırken ayar dosyası **önce** yazılmalı.
- Sahte DOM testi bir görünümün sayfaya **yerleşmediğini** göremez: dosya görüntüleyicide içerik kabı sayfaya eklenmeden çiziliyordu;
  test geçti, gerçek Chrome'da "Yükleniyor…"da kaldı (2026-11-17). Yeni görünüm `araclar/ekran-goruntuleri.mjs`'e de eklenir.
- Kumanda'nın CSP'si `unsafe-eval` vermez: Playwright'ın `waitForFunction`'ı sayfada çalışmaz; metinli `waitForSelector` kullanılır.
- Kabukta (`node -e "…"`) ters tırnak içeren metin yazmak bash'te komut yerine geçer ve betiği bozar (2026-11-17); belge
  düzenlemeleri düzenleme aracıyla yapılır.
- Bash heredoc içindeki `node` betiğinde `'\\''` gibi kaçışlı tırnak arama metni dosyadakiyle eşleşmedi (2026-11-20); kaçış içeren
  arama/değiştirme düzenleme aracıyla yapılır.
- Arayüz dosyaları `no-cache` ile sunulur (ETag); arayüz değişikliği için sunucuyu yeniden başlatmak gerekmez, sunucu kodu için gerekir.

## Açık işler

- **Arayüz gerçek tarayıcıda kısmen denendi** (2026-11-16): `araclar/ekran-goruntuleri.mjs` başsız Chrome'da (telefon 390 px açık
  tema, masaüstü 1280 px koyu tema) projeler, ürünler, izin kartı ve sohbet ekranlarını hatasız açtı. 1.2.0'da aynı araç gezgini,
  dosya görüntüleyiciyi, kutunun açık kalmasını, sol barın sürüklenip kapanmasını, ☰/Ctrl+B'yi ve sahte dokunma olaylarıyla
  kaydırmayı da denetliyor; 1.3.0'da sohbetin Ürünler sekmesini, `/btw` kartını, istem taslağının geri gelmesini ve durum
  çubuğundaki effort'u (`KUMANDA_ARA_GORUNTU=<klasör>` verilirse ara görüntüler de alınır). "Kes + hemen
  gönder" sırası 2026-11-20'de gerçek CLI'de (haiku, 2.1.329) denendi: kesilen tur `error_during_execution`, yeni istem
  yanıtlandı. Gerçek telefon klavyesi, iOS Safari ve gerçek parmakla kaydırma (tarayıcının kendi hareketleriyle çakışma)
  denenmedi.
- **Uzak erişim telefondan denenmedi** (ajan tarafından): `uzak-kur.ps1` kullanıcı tarafından çalıştırıldı (2026-11-16), `serve`
  kuralları doğru (443 → 7777, 8443 → 7778, yalnızca kendi ağ); https adresi bu bilgisayardan yanıt veriyor ve vekil başlıkları
  algılanıyor (`yerel: false`). Telefonda giriş, ürün açma ve `Secure` çerez akışı gözle denenmeli.
- **Bildirim uçtan uca denenmedi:** abonelik https ya da localhost ister; VAPID imzası ve servis çalışanı gerçek cihazda denenmeli.
  `ayar.bildirimIletisim` yer tutucudur; Apple itme servisi geçerli bir `mailto:` isteyebilir.
- Aynı oturum hem terminalde hem Kumanda'da aynı anda açılırsa iki süreç aynı transkripte yazar; uyarı yok.
- Geçmiş varsayılan olarak son 12 MB / 1500 öğe; "Daha eski iletileri yükle" (`?daha`) 128 MB / 50000 öğeye kadar.
- Sunucu isteyen ürünler (ör. `localhost:3000`'de çalışan uygulamalar) için ters vekil yok.
