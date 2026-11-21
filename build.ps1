# Kumanda has no build step (plain Node + a UI without a build). This script "makes it run":
# checks the syntax, runs the tests, restarts the server with the new code.
#   .\build.ps1
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

foreach ($f in @('server.mjs') + (Get-ChildItem src, web, test, tools -Include *.mjs, *.js -Recurse | ForEach-Object FullName)) {
  node --check $f
  if ($LASTEXITCODE) { throw "Syntax error: $f" }
}
npm test
if ($LASTEXITCODE) { throw 'The tests failed; the server was not restarted.' }
& (Join-Path $PSScriptRoot 'install.ps1')
