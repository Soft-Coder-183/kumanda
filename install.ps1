# Kumanda setup: checks the prerequisites, sets up starting automatically when you log in to Windows,
# (re)starts the server and opens the password screen if no password is set yet.
#   .\install.ps1              install / update / restart
#   .\install.ps1 -Uninstall   remove the automatic start and stop the server
param([switch]$Uninstall)
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$server = Join-Path $root 'server.mjs'
$shortcut = Join-Path ([Environment]::GetFolderPath('Startup')) 'Kumanda.lnk'

$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) { throw 'Node.js not found. Install version 22 or newer: https://nodejs.org' }
if ([version]((& $node -v).TrimStart('v')) -lt [version]'22.0.0') { throw "Node.js 22 or newer is needed (installed: $(& $node -v))." }

if ($Uninstall) {
  & $node $server --stop
  if (Test-Path $shortcut) { Remove-Item $shortcut }
  'The automatic start was removed. The settings and the password stay in: ' + (Join-Path $env:LOCALAPPDATA 'Kumanda')
  return
}

if (-not (Get-Command claude -ErrorAction SilentlyContinue)) {
  Write-Warning 'The claude command is not on PATH. Claude Code must be installed and logged in; otherwise chats will not start.'
}

# Start without a window when you log in (a shortcut in the Startup folder; no admin rights needed).
$shell = New-Object -ComObject WScript.Shell
$s = $shell.CreateShortcut($shortcut)
$s.TargetPath = $node
$s.Arguments = "`"$server`" --background"
$s.WorkingDirectory = $root
$s.WindowStyle = 7
$s.Description = 'Kumanda: remote control for Claude Code'
$s.Save()

& $node $server --stop | Out-Null
& $node $server --background
$port = ((& $node $server --ports) -split ' ')[0]
# 127.0.0.1, not "localhost": Windows PowerShell 5.1 tries localhost on IPv6 (::1) first and times out;
# the server only listens on 127.0.0.1.
$address = "http://127.0.0.1:$port"
$status = $null
foreach ($i in 1..40) {
  try { $status = Invoke-RestMethod "$address/api/status" -TimeoutSec 2; break } catch { Start-Sleep -Milliseconds 250 }
}
if (-not $status) { throw "Kumanda did not start. Log: $(Join-Path $env:LOCALAPPDATA 'Kumanda\server.log')" }

"Kumanda $($status.version) is running: $address"
'It will start by itself every time you log in to Windows.'
if (-not $status.setUp) {
  'Set your password on the page that opens now (it can only be set from this computer).'
  Start-Process $address
}
'For access from other devices:  .\remote-setup.ps1'
