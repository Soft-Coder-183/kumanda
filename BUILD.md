# Kumanda: build and run

There is no build step (a dependency-free Node.js server + a UI without a build). "Building" here means check, test, restart.


## One command

In PowerShell, in the project folder:

```powershell
.\build.ps1
```

In order: syntax check → `npm test` (with a fake Claude; spends no quota) → `install.ps1` (the startup shortcut + restarting the
server with the new code). If the tests fail, the server is not touched.

## What is produced, where

| Product | Where |
|---|---|
| The running Kumanda | http://127.0.0.1:7777 (product server: 7778) |
| Automatic start | `Kumanda.lnk` in the Startup folder |
| Settings, password hash, log | `%LOCALAPPDATA%\Kumanda\` (`config.json`, `devices.json`, `server.log`) |

## How to try it

1. Open `http://127.0.0.1:7777`. On the first visit you set the password (only from this computer).
2. Pick a project → **New chat** → write a prompt. The reply streams; a card appears if permission is needed.
3. Open an HTML or download an APK/EXE from the **Products** tab.
4. From the phone: run `.\remote-setup.ps1` (installs Tailscale, asks you to log in), open the `https://…ts.net` address it prints on
   the phone.

## Other commands

```powershell
.\install.ps1                  # install / restart
.\install.ps1 -Uninstall       # remove the automatic start, stop
.\remote-setup.ps1             # remote access (only your Tailscale network)
.\remote-setup.ps1 -Public     # remote access (open to the internet, Tailscale Funnel)
.\remote-setup.ps1 -Off        # turn remote access off
node server.mjs --status       # is it running
node server.mjs --stop         # stop
node server.mjs --reset-password   # forgot the password: deletes the password and every device session, restarts a running
                                   # server; the new password is set from http://127.0.0.1:7777
npm test                       # only the tests
node tools/screenshots.mjs     # README screenshots → docs\*.png (first: npm i --no-save playwright-core)
```
