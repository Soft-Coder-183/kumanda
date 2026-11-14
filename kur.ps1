# Kumanda kurulumu: önkoşulları denetler, Windows oturumu açılınca otomatik başlatmayı kurar,
# sunucuyu (yeniden) başlatır ve şifre belirlenmemişse şifre ekranını açar.
#   .\kur.ps1            kur / güncelle / yeniden başlat
#   .\kur.ps1 -Kaldir    otomatik başlatmayı kaldır ve sunucuyu durdur
param([switch]$Kaldir)
$ErrorActionPreference = 'Stop'
$kok = $PSScriptRoot
$sunucu = Join-Path $kok 'sunucu.mjs'
$kisayol = Join-Path ([Environment]::GetFolderPath('Startup')) 'Kumanda.lnk'

$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) { throw 'Node.js bulunamadı. 22 ya da üstünü kur: https://nodejs.org' }
if ([version]((& $node -v).TrimStart('v')) -lt [version]'22.0.0') { throw "Node.js 22 ya da üstü gerekir (kurulu: $(& $node -v))." }

if ($Kaldir) {
  & $node $sunucu --durdur
  if (Test-Path $kisayol) { Remove-Item $kisayol }
  'Otomatik başlatma kaldırıldı. Ayarlar ve şifre yerinde: ' + (Join-Path $env:LOCALAPPDATA 'Kumanda')
  return
}

if (-not (Get-Command claude -ErrorAction SilentlyContinue)) {
  Write-Warning 'claude komutu PATH''te yok. Claude Code kurulu ve giriş yapılmış olmalı; değilse sohbetler başlamaz.'
}

# Oturum açılışında penceresiz başlat (Başlangıç klasörüne kısayol; yönetici izni gerekmez).
$kabuk = New-Object -ComObject WScript.Shell
$k = $kabuk.CreateShortcut($kisayol)
$k.TargetPath = $node
$k.Arguments = "`"$sunucu`" --arkaplan"
$k.WorkingDirectory = $kok
$k.WindowStyle = 7
$k.Description = 'Kumanda: Claude Code uzaktan kumandası'
$k.Save()

& $node $sunucu --durdur | Out-Null
& $node $sunucu --arkaplan
$port = ((& $node $sunucu --portlar) -split ' ')[0]
# "localhost" değil 127.0.0.1: Windows PowerShell 5.1 localhost'u önce IPv6'da (::1) dener ve zaman aşımına düşer;
# sunucu yalnızca 127.0.0.1'i dinler.
$adres = "http://127.0.0.1:$port"
$durum = $null
foreach ($i in 1..40) {
  try { $durum = Invoke-RestMethod "$adres/api/durum" -TimeoutSec 2; break } catch { Start-Sleep -Milliseconds 250 }
}
if (-not $durum) { throw "Kumanda başlamadı. Günlük: $(Join-Path $env:LOCALAPPDATA 'Kumanda\gunluk.txt')" }

"Kumanda $($durum.surum) çalışıyor: $adres"
'Windows oturumu her açıldığında kendiliğinden başlayacak.'
if (-not $durum.kurulu) {
  'Şimdi açılan sayfada şifreni belirle (yalnızca bu bilgisayardan belirlenebilir).'
  Start-Process $adres
}
'Başka cihazlardan erişim için:  .\uzak-kur.ps1'
