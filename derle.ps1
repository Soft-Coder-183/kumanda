# Kumanda'da derleme adımı yoktur (saf Node + derlemesiz arayüz). Bu betik "çalışır hâle getirir":
# sözdizimini denetler, testleri çalıştırır, sunucuyu yeni kodla yeniden başlatır.
#   .\derle.ps1
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

foreach ($d in @('sunucu.mjs') + (Get-ChildItem src, web, test, araclar -Include *.mjs, *.js -Recurse | ForEach-Object FullName)) {
  node --check $d
  if ($LASTEXITCODE) { throw "Sözdizimi hatası: $d" }
}
npm test
if ($LASTEXITCODE) { throw 'Testler geçmedi; sunucu yeniden başlatılmadı.' }
& (Join-Path $PSScriptRoot 'kur.ps1')
