# Kumanda: derleme ve çalıştırma

Derleme adımı yoktur (bağımlılıksız Node.js sunucusu + derlemesiz arayüz). "Derlemek" burada denetle, test et, yeniden başlat demektir.

## Tek komut

PowerShell'de, proje klasöründe:

```powershell
.\derle.ps1
```

Sırasıyla: sözdizimi denetimi → `npm test` (sahte Claude ile; kota harcamaz) → `kur.ps1` (oturum açılışında otomatik başlatma
kısayolu + sunucuyu yeni kodla yeniden başlatma). Test geçmezse sunucuya dokunulmaz.

## Ne üretilir, nerede

| Ürün | Yer |
|---|---|
| Çalışan Kumanda | http://localhost:7777 (ürün sunucusu: 7778) |
| Otomatik başlatma | Başlangıç klasöründe `Kumanda.lnk` |
| Ayarlar, şifre özeti, günlük | `%LOCALAPPDATA%\Kumanda\` (`ayar.json`, `cihazlar.json`, `gunluk.txt`) |

## Nasıl denenir

1. `http://localhost:7777` aç. İlk açılışta şifre belirlenir (yalnızca bu bilgisayardan).
2. Bir proje seç → **Yeni sohbet** → istem yaz. Yanıt akar; izin gerekirse kart çıkar.
3. **Ürünler** sekmesinden bir HTML'i aç ya da APK/EXE indir.
4. Telefondan: `.\uzak-kur.ps1` çalıştır (Tailscale kurar, giriş ister), çıkan `https://…ts.net` adresini telefonda aç.

## Diğer komutlar

```powershell
.\kur.ps1                    # kur / yeniden başlat
.\kur.ps1 -Kaldir            # otomatik başlatmayı kaldır, durdur
.\uzak-kur.ps1               # uzak erişim (yalnızca Tailscale ağın)
.\uzak-kur.ps1 -Herkese      # uzak erişim (internete açık, Tailscale Funnel)
.\uzak-kur.ps1 -Kapat        # uzak erişimi kapat
node sunucu.mjs --durum      # çalışıyor mu
node sunucu.mjs --durdur     # durdur
node sunucu.mjs --sifre-sifirla   # şifreyi ve bütün cihaz oturumlarını sil (yenisi localhost'tan belirlenir)
npm test                     # yalnızca testler
```
