# Kumanda'yı başka cihazlardan erişilir yapar (Tailscale ile). Sunucu yalnızca 127.0.0.1'i dinler;
# dışarıya açan şey bu betiğin kurduğu Tailscale yönlendirmesidir.
#   .\uzak-kur.ps1            yalnızca kendi Tailscale ağındaki cihazlar (önerilen): telefona da Tailscale kurulur
#   .\uzak-kur.ps1 -Herkese   internetteki herkes adresi açabilir (Tailscale Funnel); koruma yalnızca şifredir
#   .\uzak-kur.ps1 -Kapat     uzak erişimi kapat
# Düzen: https://<bilgisayar>.<ağ>.ts.net → kumanda, aynı adres :8443 → ürünler (sunucu bu düzeni varsayar).
param([switch]$Herkese, [switch]$Kapat)
$ErrorActionPreference = 'Stop'
$sunucu = Join-Path $PSScriptRoot 'sunucu.mjs'

function Tailscale-Bul {
  $k = (Get-Command tailscale -ErrorAction SilentlyContinue).Source
  if (-not $k) { $aday = Join-Path $env:ProgramFiles 'Tailscale\tailscale.exe'; if (Test-Path $aday) { $k = $aday } }
  return $k
}

$ts = Tailscale-Bul
if (-not $ts) {
  if ($Kapat) { 'Tailscale kurulu değil; kapatılacak bir şey yok.'; return }
  'Tailscale kuruluyor (yönetici onayı isteyebilir)...'
  winget install --id Tailscale.Tailscale -e --accept-source-agreements --accept-package-agreements
  $ts = Tailscale-Bul
  if (-not $ts) { throw 'Tailscale kurulamadı. https://tailscale.com/download adresinden elle kur, sonra bu betiği yeniden çalıştır.' }
}

if ($Kapat) {
  & $ts serve reset
  & $ts funnel reset
  'Uzak erişim kapatıldı. Kumanda yalnızca bu bilgisayardan açılır.'
  return
}

$kp, $up = (node $sunucu --portlar) -split ' '
try { $durum = Invoke-RestMethod "http://127.0.0.1:$kp/api/durum" -TimeoutSec 3 } catch { throw 'Kumanda çalışmıyor. Önce .\kur.ps1 çalıştır.' }
if (-not $durum.kurulu) { throw "Önce şifreni belirle: http://localhost:$kp  (şifresiz sistem dışarı açılmaz)" }

$t = & $ts status --json | ConvertFrom-Json
if ($t.BackendState -ne 'Running') {
  'Tailscale hesabına giriş gerekiyor; tarayıcı açılacak...'
  & $ts up
  $t = & $ts status --json | ConvertFrom-Json
  if ($t.BackendState -ne 'Running') { throw 'Tailscale girişi tamamlanmadı.' }
}

$komut = if ($Herkese) { 'funnel' } else { 'serve' }
& $ts $komut --bg --https=443 "http://127.0.0.1:$kp"
if ($LASTEXITCODE) { throw "tailscale $komut başarısız. Çıktıda bir bağlantı varsa aç (HTTPS / Funnel ağ ayarlarından etkinleştirilmeli), sonra yeniden çalıştır." }
& $ts $komut --bg --https=8443 "http://127.0.0.1:$up"
if ($LASTEXITCODE) { throw "tailscale $komut (ürün kapısı 8443) başarısız." }

$ad = $t.Self.DNSName.TrimEnd('.')
''
"Kumanda adresin:  https://$ad"
if ($Herkese) { 'Bu adres internete açık. Güçlü bir şifre kullandığından emin ol (Ayarlar > Şifre).' }
else { 'Bu adres yalnızca Tailscale ağındaki cihazlardan açılır: telefonuna Tailscale uygulamasını kurup aynı hesapla giriş yap.' }
'Telefonda adresi açınca tarayıcı menüsünden "Ana ekrana ekle" ile uygulama gibi kurabilirsin.'
