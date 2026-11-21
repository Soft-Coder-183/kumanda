# Makes Kumanda reachable from other devices (with Tailscale). The server only listens on 127.0.0.1;
# what opens it to the outside is the Tailscale forwarding this script sets up.
#   .\remote-setup.ps1           only the devices in your own Tailscale network (recommended): install Tailscale on the phone too
#   .\remote-setup.ps1 -Public   anyone on the internet can open the address (Tailscale Funnel); the password is the only protection
#   .\remote-setup.ps1 -Off      turn remote access off
# Layout: https://<computer>.<network>.ts.net → control, the same address :8443 → products (the server assumes this layout).
param([switch]$Public, [switch]$Off)
$ErrorActionPreference = 'Stop'
$server = Join-Path $PSScriptRoot 'server.mjs'

function Find-Tailscale {
  $t = (Get-Command tailscale -ErrorAction SilentlyContinue).Source
  if (-not $t) { $candidate = Join-Path $env:ProgramFiles 'Tailscale\tailscale.exe'; if (Test-Path $candidate) { $t = $candidate } }
  return $t
}

$ts = Find-Tailscale
if (-not $ts) {
  if ($Off) { 'Tailscale is not installed; there is nothing to turn off.'; return }
  'Installing Tailscale (it may ask for admin approval)...'
  winget install --id Tailscale.Tailscale -e --accept-source-agreements --accept-package-agreements
  $ts = Find-Tailscale
  if (-not $ts) { throw 'Tailscale could not be installed. Install it by hand from https://tailscale.com/download, then run this script again.' }
}

if ($Off) {
  & $ts serve reset
  & $ts funnel reset
  'Remote access is off. Kumanda only opens from this computer.'
  return
}

$cp, $pp = (node $server --ports) -split ' '
try { $status = Invoke-RestMethod "http://127.0.0.1:$cp/api/status" -TimeoutSec 3 } catch { throw 'Kumanda is not running. Run .\install.ps1 first.' }
if (-not $status.setUp) { throw "Set your password first: http://127.0.0.1:$cp  (a system without a password is not opened to the outside)" }

$t = & $ts status --json | ConvertFrom-Json
if ($t.BackendState -ne 'Running') {
  'You need to log in to your Tailscale account; a browser will open...'
  & $ts up
  $t = & $ts status --json | ConvertFrom-Json
  if ($t.BackendState -ne 'Running') { throw 'The Tailscale login did not finish.' }
}

$command = if ($Public) { 'funnel' } else { 'serve' }
& $ts $command --bg --https=443 "http://127.0.0.1:$cp"
if ($LASTEXITCODE) { throw "tailscale $command failed. If the output has a link, open it (HTTPS / Funnel must be enabled in the network settings), then run again." }
& $ts $command --bg --https=8443 "http://127.0.0.1:$pp"
if ($LASTEXITCODE) { throw "tailscale $command (product port 8443) failed." }

$name = $t.Self.DNSName.TrimEnd('.')
''
"Your Kumanda address:  https://$name"
if ($Public) { 'This address is open to the internet. Make sure you use a strong password (Settings > Password).' }
else { 'This address only opens from devices in your Tailscale network: install the Tailscale app on your phone and log in with the same account.' }
'On the phone, open the address and use "Add to Home screen" in the browser menu to install it like an app.'
