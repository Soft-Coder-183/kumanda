# Kumanda

A local server + web UI that lets Eren use the Claude Code on their computer and the products of all their projects (HTML, APK,
EXE, ZIP, video, documents) from the phone or another computer. Dependency-free Node.js (22+), no build step. The server only
listens on `127.0.0.1`; remote access comes through Tailscale forwarding (set up, own network only). Public repository (MIT):
https://github.com/Soft-Coder-183/kumanda. Status: 2.6.0 (2026-11-27: a stuck "working" chat fixed (Stop always stops), idle Claude processes close after 3 min, "Close all Claude processes"; 2.5.0 2026-11-25: chats working outside Kumanda shown as running, VS Code button opens only the project; 2.4.0: live follow of chats running outside Kumanda, prompts sharing a message with a system note shown; 2.3.1 2026-11-24: sidebar "Now" list removed; 2.3.0 2026-11-23: "/" menu, Claude artifacts, project order by last message; 2.2.1 limit-reset fix; 2.2.0 2026-11-22: search, Changes tab, scheduled/saved prompts, shared drafts); real phone use not tried by
the agent. Details: `HANDOVER.md` (read the relevant section when needed). The owner speaks Turkish: reply to them in Turkish.

## Commands
- Install / restart: `.\install.ps1` (startup shortcut + starts the server with the new code)
- Run (foreground, while developing): `node server.mjs`; background: `node server.mjs --background`
- Status / stop: `node server.mjs --status`, `node server.mjs --stop`
- Test: `npm test` (real server process + `test/fake-claude.mjs`; spends no Claude quota, uses its own temp ports and data folder)
- Build: `BUILD.md` (one command: `.\build.ps1`). Output: the running server, http://127.0.0.1:7777
- Remote access: `.\remote-setup.ps1` (`-Public`, `-Off`)
- README screenshots: `node tools/screenshots.mjs` (needs playwright-core: `npm i --no-save playwright-core` or
  `KUMANDA_PLAYWRIGHT=<folder with playwright-core>`); demo data, never touches real data. Rerun when the UI changes.

## Layout
- `server.mjs`: entry point; command line flags, API routes, control (7777) and product (7778) servers
- `src/sessions.mjs`: Claude Code processes (stream-json protocol, permission relay, event log, transcript reading)
- `src/projects.mjs`: project discovery, session list, product scan, safe path resolution
- `src/btw.mjs`: `/btw` side questions (forked, unsaved `claude -p` with the chat's flags so it reuses the prompt cache; tools
  blocked by the PreToolUse hook `src/btw-no-tools.mjs`; storage; terminal questions in history.jsonl)
- `src/store.mjs` (drafts, saved prompts, chat flags), `src/schedule.mjs` (scheduled prompts), `src/git.mjs` (read-only git),
  `src/search.mjs` (chat search), `src/commands.mjs` ("/" list), `src/artifacts.mjs` (Claude artifacts from transcripts)
- `src/auth.mjs`: password (scrypt), device sessions, login limit, product origin tickets
- `src/push.mjs`: Web Push (payload-less); `src/http.mjs`: HTTP helpers; `src/config.mjs`: config file + 1.x data migration
- `web/`: UI (`app.js`: views, layout/explorer, file viewer and syntax highlighter; `style.css`, `sw.js`); not built, served as is
- `test/`: `server.test.mjs` (server end to end), `ui.test.mjs` (fake DOM smoke test), `fake-claude.mjs`, `fake-vscode.mjs`
- Secrets are not in the repo: `%LOCALAPPDATA%\Kumanda\` (`config.json`, password hash, `devices.json`, push key, `server.log`)

## Code rules
- Everything in the repository is English: identifiers, comments, UI text, docs, release notes. ES modules, `node:` imports.
  Exception: the 1.x migration code that reads Turkish names.
- No external dependencies (neither server nor UI); what is needed is written with Node's built-ins.
- No emoji in the UI (owner's wish): buttons have text labels.
- A new view or panel comes with its way back (back link, Esc, route change closes menus); do not wait to be asked.
- In the UI, HTML is only produced with `h()` or as `md()` output; `md()` escapes first, then formats. Raw text never goes to `innerHTML`.
- Only nodes go into the DOM (`replaceChildren`, `append`); no `null`/arrays (`h()` filters them itself).
- `.ps1` files stay UTF-8 **with BOM** (Windows PowerShell 5.1 mangles non-ASCII text in files without a BOM).

## Rules
- **This system grants the right to run commands on the computer.** Before any change that loosens auth, origin or path checks,
  read `HANDOVER.md` → "Security model"; every security rule has a test in `test/server.test.mjs` and it is never deleted.
- The server listens only on `127.0.0.1` by default; do not change that or the "first password only locally" rule.
- Products are always served from a separate origin (the product port); no route is added that serves a project file **as a
  document** from the control origin. The file explorer (`/api/project/:pid/file`) only returns content inside JSON and the UI draws
  it as text (`h()`/`md()`); file content never goes into `innerHTML`, an `iframe` or a page opened on the control origin.
- Passwords, tokens, keys are never written to the repo or the docs; tests use their own temp data folder (`KUMANDA_DATA`).
- Trying with real Claude spends quota: `npm test` first; real trials only for protocol changes, and with `haiku`.
- A running server does not pick up code changes; after a change run `.\install.ps1` (or `--stop` + `--background`).
  **The agent's own session may run under this server** (started from the phone): restarting kills the session. Restart as the
  very last step, delayed and detached (see `HANDOVER.md` → pitfalls).
- When the Claude Code version changes the stream-json protocol may change: `HANDOVER.md` → "Claude Code protocol".

## Commits and releases
- The single source of the version is `package.json` → `version` (the UI and `--status` read it). Notes: `notes/vX.Y.Z.md`.
- The repo is public (`origin` = GitHub, work on `main`, pushing is allowed). Files are added to a commit by name (G2); before a push
  check new files for personal data/secrets (no Tailscale address, user paths, transcript excerpts). Messages in English, one topic (G6).
- Release: `package.json` version → note complete → commit → `git tag -a vX.Y.Z -m "Kumanda X.Y.Z"` → push → `gh release create vX.Y.Z
  --notes-file notes/vX.Y.Z.md` (no files attached). A published tag is never moved.
- The README is user-facing; update it when a feature or command changes.
- After every job update this file and `HANDOVER.md` (devret). `CLAUDE.md` only holds `@AGENTS.md` (global rule G5).

## In the handover document
- Architecture, Security model: before touching auth, origin, tunnel or product serving
- 2.0.0: the English rename: data folder migration, kept names, updating a running 1.x server
- Features table + "2.2.0 notes" / "2.3.0 notes": the routes and stores added since 2.2.0 ("/" list, artifacts, project order, following, running elsewhere)
- VS Code button: before touching `/api/project/:pid/vscode` (why a panel and not a terminal)
- Claude Code protocol: before touching `src/sessions.mjs` or when Claude Code is updated
- /btw side questions: before touching `src/btw.mjs` or how the chat history is merged (also: context and cache behaviour)
- Product scan: which file counts as a product, the "secondary" rules
- File explorer and viewer, Layout: before touching the explorer, the file viewer, the highlighter or the side panels
- Development environment and pitfalls, Open work: before starting new work
