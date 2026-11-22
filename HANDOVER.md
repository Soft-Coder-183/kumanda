# Kumanda: Handover Document

A local server + web UI for using the Claude Code on this computer and the project products from any device. This document is
written so an agent taking over the project can start without seeing earlier conversations. (The owner's global rules call
this file `PROJE_DEVIR.md` and the build files `DERLE.md`/`derle.ps1`; in this project they are `HANDOVER.md`, `BUILD.md` and
`build.ps1`, the owner's decision on 2026-11-21.)

- **Owner:** Eren (speaks Turkish; replies to them in Turkish). For their own use; the repository is public (MIT).
- **Repository:** https://github.com/Soft-Coder-183/kumanda (public since 2026-11-16). Releases are GitHub tags + releases; nothing
  is built, so no files are attached (the source zip is enough).
- **Status:** 2.2.0 (2026-11-22): the "Now" list, search everything (Ctrl+K), chat pin/rename/archive and message search,
  the Changes (git) tab, scheduled prompts, saved prompts, drafts shared between devices, task panel, copy buttons, themes. 2.1.0 (2026-11-21): `/btw` reuses the chat's prompt cache, "Chats"/"Back to chat" navigation, the VS Code button,
  the handover/build files renamed. 2.0.0 (same day): the whole repository moved from Turkish to English. The server and the Claude protocol were tried with real Claude Code 2.1.322/2.1.329. The UI is tried in
  headless Chrome (`tools/screenshots.mjs`). Tailscale forwarding is set up (own network only), the https address was tried from
  this computer. **Not tried by the agent:** real phone use, notifications on the phone. See Open work.
- **Work in progress:** none.
- **Scope note:** this document does not list every part. If you see a part of the code that is not described here, ask the owner
  before changing it.

## Architecture

```
phone / other PC ──https──> Tailscale (serve: 443, 8443) ──> 127.0.0.1:7777 control server ──stdin/stdout──> claude -p (in the project folder)
                                                       └──> 127.0.0.1:7778 product server ──> the files in the project folders
```

- **Runtime:** Node.js 22+ (built-in `http`, `crypto`, `child_process`), no external dependencies. The UI is a single page without a
  build (`web/app.js`); the live stream is Server-Sent Events.
- **Two servers, two origins (important decision):** product HTML pages are made by the user/Claude and may load CDN scripts. If they
  were served from Kumanda's origin a script inside could use the API (that is, run commands on the computer). So they are served on
  a separate port; the origin includes the port, so the browser separates them. A sandbox CSP was not chosen because it breaks the
  products' `localStorage`.
- **One process per session:** for every live chat a `claude -p --input-format stream-json --output-format stream-json` process is
  kept open; after `idleCloseMinutes` (20) idle minutes it is closed and reopened with `--resume` on the next prompt.
- **The work goes on if the client disconnects:** the process belongs to the server; events are kept in a log and replayed from
  where a reconnecting client left off.
- **Secrets outside the project:** `%LOCALAPPDATA%\Kumanda\`. Why: the product server serves project folders and Kumanda is a
  project too; a password hash inside the project could be served or committed.

## File map

| Path | Job |
|---|---|
| `server.mjs` | Flags (`--background`, `--log`, `--stop`, `--status`, `--ports`, `--reset-password`), API, the `/open` hop, both servers |
| `src/config.mjs` | `config.json` in the data folder, `atomicWrite`, **the one-time migration of a 1.x data folder** (`migrateLegacyData`) |
| `src/sessions.mjs` | The `Run` class (process + event log), `toItems()` (line → UI item), `readHistory()`, `lastRequest()`, `effortSettings()` |
| `src/projects.mjs` | `listProjects`, `listSessions`, `listProducts` + secondary marking, `linkProductsToSessions`, `safePath`, `listFolder`, `readFileForView` |
| `src/btw.mjs` | `/btw` side questions: a forked, unsaved Claude call with tools blocked by a hook; storage; terminal questions from history.jsonl |
| `src/store.mjs` | Small shared JSON stores in the data folder: `drafts.json`, `snippets.json`, `chats.json` (pinned/archived) |
| `src/schedule.mjs` | Scheduled prompts (`scheduled.json`), the timer that sends them, the limit reset time |
| `src/git.mjs` | Read-only git: status, log, file/commit diff (`execFile`, argument array) |
| `src/search.mjs` | Chat search: titles in every project, message text in one project |
| `src/btw-no-tools.mjs` | The PreToolUse hook of `/btw` (exit code 2 = every tool call denied) |
| `src/auth.mjs` | Password, `control`/`product` device sessions, login limit, tickets |
| `src/push.mjs` | VAPID key, subscriptions, payload-less Web Push |
| `src/http.mjs` | `Router`, `json`, `sendFile` (Range, ETag), cookies, `requestInfo` (`local`, `client`, `https`) |
| `web/app.js` | The whole UI: `h()`, `md()`, layout (`applyLayout`, `handle`), explorer (`drawTree`), views (`projectPage`, `chatView`, `allProducts`, `fileView`, `settingsPage`), highlighter (`highlight`) |
| `web/sw.js` | Service worker, only for notifications |
| `tools/make-icons.mjs` | Makes `web/icon-*.png` (run again if the icon changes) |
| `tools/screenshots.mjs` | README screenshots (`docs/*.png`): a separate instance (7797/7798) in a temp folder with demo projects/chats and the fake Claude, headless Chrome; exit code 1 on page errors. Run again when the UI changes |
| `README.md`, `LICENSE` | The public face of the repository; update the README when a feature or command changes |
| `install.ps1`, `remote-setup.ps1`, `build.ps1` | Setup/automatic start, Tailscale, check+test+restart |

## Features

| Part | What it does |
|---|---|
| Projects | Folders under `config.roots` + folders Claude Code knows; sorted by last activity, live status dot |
| Chat | New chat or continue an existing session (including ones opened in the terminal); streaming reply, tool rows, images; Ctrl+Enter "send now"; prompt draft per chat in `localStorage['kumanda.draft.<pid>.<session or new>']` |
| Permissions | Tool permission card (Allow / Always allow / Deny), Claude's questions (`AskUserQuestion`), plan approval; mode, model and effort selects |
| Products | Per project and all together; web/video/PDF open, APK/EXE/ZIP download; device fit label; hiding |
| Notifications | "done / waiting for permission" push while the page is not open (turned on per device in Settings) |
| Settings | Device sessions, password change, adding a folder outside the roots, hidden projects |
| Files | The project folder as a tree (like the VS Code explorer) and a read-only, highlighted file viewer |
| Side questions | `/btw <question>`: a side question without interrupting the chat; the question and answer are kept, terminal ones' questions show too |
| VS Code | `POST /api/project/:pid/vscode { session? }`: opens the project in VS Code on the computer and the chat in the Claude Code extension panel (see "VS Code button") |
| Navigation | Chat top bar: "‹ Chats" → the project's chat list; file viewer: "‹ Back to chat" → the last chat opened in that project (`lastChat`, in memory per tab) |
| Layout | On the desktop the sidebar and the files panel resize/close by dragging; on the phone swipeable drawers |
| Now (2.2.0) | Sidebar list of open runs across projects (`GET /api/runs` + titles): working, waiting, finished and not seen (`localStorage['kumanda.seen']`) |
| Search (2.2.0) | Ctrl+K palette (projects, chats of the current project, `GET /api/search?q=` titles everywhere, actions); Chats tab filter + `?pid=` message search |
| Chat flags (2.2.0) | `POST /api/project/:pid/session/:sid/meta { pinned?, archived?, title? }`; the title is a `custom-title` line appended to the transcript (what Claude Code's /rename writes), refused while the run works |
| Changes (2.2.0) | Project tab `#/p/<pid>/changes`, `#/p/<pid>/diff/<path>`, `#/p/<pid>/commit/<hash>`; `GET /api/project/:pid/git` and `/git/diff?path=|commit=` |
| Later (2.2.0) | `GET/POST /api/schedule`, `/api/schedule/cancel`, `/api/schedule/run`; at a time or `afterLimit` (reset time from the last rate_limit_event, else parsed from "resets 4:20am" in the reply on the client) |
| Saved prompts, drafts (2.2.0) | `/api/snippets` (list, shared); `/api/drafts?key=<pid>.<sid or new>` (text, newest `at` wins); images stay in `localStorage['kumanda.draftImages.<key>']` |
| Chat comforts (2.2.0) | Copy/Edit again under messages, code copy, ↑/↓ prompt recall, Esc stops, "Latest" jump button, task panel (TaskCreate/TaskUpdate, TodoWrite), context tokens and working time in the status bar, export Markdown, error "Retry" |
| Share (2.2.0) | Manifest `share_target` GET to `/` → `?text=` is moved to `sessionStorage` and `#/share` asks for the project |
| Appearance (2.2.0) | `html[data-theme]` (light/dark, else the system) and `html[data-size]`, per device in Settings |

### 2.0.0: the English rename
- Every identifier, route, event type, field, CSS class, file and folder name moved to English (the Turkish → English mapping is
  in the git history of the 2.0.0 commit). Kept on purpose: the cookie names `kumanda_o` / `kumanda_u` / `kumanda_son` (so devices
  stay logged in). In 2.1.0 the global-rule files were renamed too: `DERLE.md` → `BUILD.md`, `derle.ps1` → `build.ps1`,
  `PROJE_DEVIR.md` → `HANDOVER.md`.
- **Data folder migration** (`src/config.mjs` → `migrateLegacyData`, runs on every start and on every CLI flag, does nothing when
  done): `ayar.json` → `config.json` (keys mapped, `sifre {tuz, ozet}` → `password {salt, hash}`), `cihazlar.json` → `devices.json`
  (`tur: kumanda|urun` → `kind: control|product`), `bildirim.json` → `push.json`, `gunluk.txt` → `server.log`, `yerel-anahtar` →
  `local-key`, `yan-sorular/` → `btw/` (fields translated); an old `limit.json` (field `bes`) is dropped (it is only a cache).
  Old files are renamed to `*.migrated`, never deleted. Tested: "a 1.x data folder is migrated".
- **Updating a running 1.x server:** `--stop` (and so `install.ps1`) first calls `/api/local/shutdown`; on 404 it calls the 1.x
  `/api/yerel/kapat` with `X-Yerel-Anahtar` (same key file content). The startup shortcut is rewritten by `install.ps1`.
- `localStorage` keys are moved once in the browser (`kumanda.taslak.*` → `kumanda.draft.*`, `kumanda.mod` → `kumanda.mode`,
  `kumanda.efor` → `kumanda.effort`, `kumanda.duzen` → `kumanda.layout`, `kumanda.satirSar` → `kumanda.wrap`).
- UI routes: `#/p/<pid>/last`, `/new`, `/s/<sid>`, `/f/<path>`, `/products`; `#/products`, `#/settings`.

### Project discovery
- Candidates: every root's subfolders + folders Claude Code knows one level down + `config.extraProjects` + `cwd`s in transcripts.
- "Knows" = a `~/.claude/projects/<encoded path>` folder exists (encoding: every non letter/digit character becomes `-`). The
  encoding is lossy and cannot be reversed; so folders outside the roots are only found if a transcript has their `cwd`, otherwise
  they are added by hand in Settings.
- **New project (1.3.0):** `POST /api/project-create { name }` creates an empty folder under `config.roots[0]` (a single, valid
  Windows name; never over an existing one, 409). UI: sidebar **＋** → `#/p/<pid>/new`. Claude Code's log appears with the first chat.
- **Choosing a project opens the latest chat (1.3.0):** the sidebar link is `#/p/<pid>/last`; `openLastChat` goes to the first
  session of `/api/project/:pid` with `history.replaceState` (Back does not loop), or to the chats tab if there is none. The back
  arrow in a chat goes to `#/p/<pid>`.
- A folder without its own log that contains candidates is a container and is not listed ("Games", "Pocket Apps"). The home folder
  and temp folders are excluded.

### Product scan (`src/projects.mjs`)
- Kind by extension: web, android, windows, archive, video, document. `SKIP` folders, ones starting with `.` and `*-unpacked` are
  not walked.
- A folder with more than 6 HTML files counts as a data dump (only `index.html` is taken); HTML calling a `/src/` script is a source
  template and is skipped.
- **Secondary** (listed under "Other files"): HTML in a source folder, exe under 1 MB, debug APK, archive outside the root.
- **Only the latest version (1.3.0, owner's request):** copies of the same kind and size ("copy") and older files with the same name
  apart from the version number ("old version"; folder does not matter) are **removed from the list**. Kumanda keeps no version
  history; these are old build files really on disk, never deleted.
- The result is cached per project for 60 s ("Rescan" refreshes). Products hidden by the user are in `config.hiddenProducts`.

### Product → chat link (`linkProductsToSessions`, 2026-11-16)
- Every product is linked to the session whose activity is nearest to the file's last modification (gap ≤ 20 min; else
  `session: null`, "Not linked to a chat" in the UI). Activity = every `"timestamp"` in the transcript; subagent transcripts in
  `<session>/subagents/*.jsonl` count for the main session.
- **Why time and not the file name:** APK/EXE/ZIP are written by build commands and their names may not be in the transcript. The
  price: with two chats running in the same project at once a product can land under the wrong chat; touching a file by hand later
  moves it to the chat of that moment.
- Transcripts only grow at the end: timestamps are cached per file; when the size grows only the new part is read (with a 93 MB
  transcript the first scan takes ~0.3 s, later ones ~10 ms).
- Routes: `GET /api/project/:pid/products` → `{ products (each with .session), sessions: { id: { title, mtime } } }`,
  `?session=<id>` only that chat's products; `/api/products` adds `sessions` to every group.
- UI (`sessionGroups`): the project's Products tab and the all-products page (`allProducts`, project title → chat groups) use the
  same grouping; the chat with the newest product on top. In a chat the **Products (n)** tab next to the title (1.3.0) opens a panel
  under the top bar (at most 45dvh, scrolls by itself, the composer stays visible). Its open state is in `openBoxes` as
  `<pid>|tab:<session>`. Rescanned 1.5 s after a turn ends.
- **Hiding** (`config.hiddenProducts`, the file is not deleted): every group has three parts: main products, "Other files"
  (secondary), "Hidden by you" (back with Show). So both list pages ask with `?hidden`.
- **Showing many** (1.2.0): `hide-products` takes one `path` or a `paths` array (at most 5000).
- **Boxes stay open:** the open/closed state of `<details>` is in the module-level `openBoxes` set (key
  `<pid>|<session or ->|<secondary|hidden-box>`, in the chat panel `<pid>|s:<session>`); redraws keep the scroll position with
  `redrawInPlace()`.

### Layout: sidebar, explorer, drawers (1.2.0)
- The desktop (≥ 900 px) grid is `[#side | #explorer | #main]`; the column widths are `--side-width` / `--explorer-width` on `#app`.
  Every element has a fixed `grid-column` (so the others do not shift when one is `display:none`).
- `handle()`: the edge handle. Dragging is tracked with pointer events on `window`: when the panel hides below the threshold the
  handle hides too and an element-bound capture would be lost. Below `CLOSE_THRESHOLD` (150 px) it closes; a closed sidebar is
  dragged back from the left edge with `.edge-handle`. The state is in `localStorage['kumanda.layout']` (per device).
- Buttons: « in the sidebar, ☰ in the main top bar (on the desktop only while the sidebar is closed), the explorer button from
  `topBar({ pid })`. Shortcuts: `Ctrl+B`, `Ctrl+Shift+E`.
- Phone (< 900 px): fixed drawers from the left with the `side-drawer` / `explorer-drawer` classes + `.backdrop`. Swipe
  (`touchSwipe`): ≥ 70 px and horizontal 1.8 times the vertical; ignored if it starts on a sideways-scrolling element (code, table,
  input). Right: project list (only while the main view is open); left: the open drawer closes. Every route change closes drawers.

### File explorer and viewer (1.2.0)
- Routes: `GET /api/project/:pid/files?path=<folder>` → `{ path, entries: [{ name, path, dir, size, mtime }], truncated }` (folders
  first, natural order, at most 3000); `GET /api/project/:pid/file?path=<file>` → `kind: 'text'` (first 1 MB; UTF-8, UTF-16 with
  BOM decoded; NUL in the first 8 KB means binary), `'image'` (base64, ≤ 5 MB, SVG included) or `'binary'` (info only, no content).
- Both go through `safePath()`: a part starting with `.` (`.env`, `.git`), `..`, an absolute path, a link leading outside (junction)
  are rejected; links leading outside are not listed either. Auth and origin checks like every `/api`.
- UI route `#/p/<pid>/f/<encodeURIComponent(path)>`. Explorer cache `treeCache` (`<pid>|<folder>`), open folders `openFolders`;
  opening a file opens its parent folders. No network request while the explorer is closed; refreshed on every open.
- Highlighter `highlight()`: each language's ordered rules (`RULE`) are joined into one regular expression; the matching group gives
  the class, words are classed as keyword/constant/function/type. Rules **must not** contain capturing groups (use `(?:)`) and do
  not use the `m` flag (it cuts multi-line comments at the line end; for line start use `(?:^|(?<=\n))`). Over 400 KB no colors.
  Line numbers are a CSS counter.
- Markdown is previewed with `md()`; images as an `<img>` with a `data:` URL; **Open / Download** go to the product origin via `/open`.
- Why not VS Code `serve-web` / a tunnel: it needs a new port, separate auth and a Tailscale rule (more attack surface); read-only
  viewing stays behind the existing password and origin checks. If editing is wanted, weigh this decision again first.

### Serving products
- The UI link is `/open?p=<project>&path=<path>` (control origin) → a single-use 60 s ticket → `/_open` on the product origin sets
  its own cookie (`kumanda_u`) → `/p/<project>/<path>`. The ticket exists so it works even when the two origins are on different hosts.
- Root-absolute paths (`/assets/a.js`) are searched from the product folder in the Referer, else from the last opened product in the
  `kumanda_son` cookie, up to the project root. Client-side routed sites (SPA) and apps that need a server do not work.
- The product origin address comes from `productOrigin()`: `config.publicOrigins[host]` if set; an https host without a port →
  `:8443` (the Tailscale layout); otherwise the same host + `productPort`.

### Live stream and history
- Persistent events carry a sequence number (`seq`); the SSE `id` is `<generation>:<seq>`. Streaming text pieces (`delta`), `status`,
  `activity`, `limit` are transient.
- The view = the transcript up to byte `historyLimit` (history) + the run's event log. So no message is drawn twice.
- A client with a marker from another generation or from before the log reset gets `reload`; it reloads the history.
- The client drops the stream 15 s after the tab is hidden; the server sends a push for a run without listeners.
- **Tool groups (1.3.0):** consecutive `tool` items gather in `toolGroup` (`add(el, true)`; any other item ends the group). A one-tool
  group is `.single` (summary hidden, open); with the second it closes, summary "N steps: Bash ×6 · Edit". `groupStatus()`.
- **Turn ends in the history (1.3.0):** the transcript has no "turn finished" line (`system/turn_duration` only on some CLI turns);
  `addTurnEnds()` adds `{ type: 'result', durationMs: last − prompt, at: last }` after the last item of each prompt. The UI writes
  "Worked for X · finished HH:MM". A turn being written in the terminal right now looks "finished" too (known limit).
- **Usage percentage (1.3.0):** `rate_limit_event` only comes after a request. The last value is in `DATA/limit.json`
  (`getLastLimit`, fields `fiveHour`, `sevenDay`, `*ResetsAt` in s); the history route returns `limit`; the UI hides a window whose
  reset time has passed.

### /btw side questions (`src/btw.mjs`, 1.3.0; cache reuse 2.1.0)
- **Claude Code does not keep them** (checked on 2.1.329): a terminal `/btw <question>` never enters the transcript (only an
  argument-less `/btw` lands with its "Usage" output; `toItems()` hides it); the question is only written to
  `~/.claude/history.jsonl` (`display`, `timestamp` ms, `sessionId`), **the answer is written nowhere**.
- Asked from Kumanda: a prompt starting with `/btw ` makes the UI send `POST /api/project/:pid/session/:sid/btw { id, question,
  model, effort }` (it does not go to the chat). The server runs `claude -p --output-format json --resume <sid> --fork-session
  --no-session-persistence --permission-mode manual --settings <PreToolUse hook> --max-turns 3 [--model] [--effort]` (2.1.0) and
  writes `[Side question (/btw): …] + question` to stdin.
  Tried with haiku: the copy knows the chat's context; neither the chat transcript nor a new transcript nor history.jsonl changes.
  At most 3 at once, 3 min timeout.
- **Context and cache (2.1.0, measured with haiku 2026-11-21):** the chat's context window is not affected (separate process,
  nothing saved). The prompt cache key is tools → system → messages, so the fork must start with **the same flags as the chat**
  (`--permission-mode` default/manual vs acceptEdits does not matter) and must not touch the tool list or the system prompt. What
  breaks reuse (each cache-wrote the whole conversation, 0 read): `--tools ""`, `--disallowedTools`, `permissions.deny` rules,
  `--append-system-prompt`, `--strict-mcp-config`, plan mode. What keeps it: a PreToolUse hook given with `--settings` (exit 2
  blocks the call, also in acceptEdits). Numbers on a ~35k-token chat: matching flags + hook = 34k read / 1.1k write, $0.0056;
  `--disallowedTools` = 0 read / 28.6k write, $0.0107. The instruction goes into the user message (stdin), not the system prompt.
  1.3.0–2.0.0 used `--tools ""` and so paid for the whole conversation every time.
- Storage: `%LOCALAPPDATA%\Kumanda\btw\<session>.jsonl` (`{ id, at, question, answer | error, source, model }`); pending ones in memory.
- View: the history route interleaves side questions (saved + pending + history.jsonl ones, `source: 'terminal'`) by time as
  `type: 'btw'` items (`interleave`). With an open run, the ones after `Run.historyLimitAt` stay out of the history; they land in the
  run's event log (`publishBtw`) twice, "pending" and answered. The client makes the id; the UI draws one card per id and an
  answered card never goes back to "pending" (whatever order the history, stream and POST reply arrive in).
- history.jsonl only grows at the end: only the new part is read (`terminal.read`); if the file shrinks, from the start.

### VS Code button (`POST /api/project/:pid/vscode`, 2.1.0)
- The owner wanted "open this project in VS Code, start the terminal and open our Claude chat there". **A VS Code terminal cannot
  be started from outside:** the `code` CLI has no such option, and the Claude Code extension (2.1.330) only has the URI
  `vscode://anthropic.claude-code/open?session=<id>&prompt=`, which opens the chat in the extension's **panel** (not a terminal);
  `claude-vscode.terminal.open` is a command and cannot be called by URI. So: `Code.exe <project>` and, 2.5 s later,
  `Code.exe --open-url <that URI>` (with no session only the folder).
- `vscodeCommand()`: env `KUMANDA_VSCODE` (JSON array, tests use `test/fake-vscode.mjs`) → `config.vscode` → `code.cmd` in PATH →
  `..\Code.exe` → `%LOCALAPPDATA%\Programs\Microsoft VS Code`, `%ProgramFiles%`. `launch()` spawns detached and drops
  `ELECTRON_RUN_AS_NODE`, `CLAUDECODE`, `CLAUDE_CODE_*` (otherwise Code.exe runs as Node or the extension thinks it is nested).
- Two writers on one transcript are avoided: if the chat's run is working → 409; if it is idle it is closed first (`closedRun`).
  400 bad session id, 404 no transcript, 501 VS Code not found. Same auth/origin checks as every `/api` (test "VS Code: …").
- **Not tried for real by the agent** (only the fake): the real window, the URI handler, the panel picking up the session.

### 2.2.0 notes
- Every new route is behind the same auth/origin checks. Git runs only fixed read commands with an argument array; the path must
  be relative without `..`, options or drive letters, a commit only hex (`validGitPath`, `validHash`; tested).
- The rename is the only place Kumanda writes into a transcript (one appended `custom-title` line).
- Scheduled prompts older than 12 h when due (computer off/asleep) are marked "missed" and not sent; failures send a push.
- `KUMANDA_TICK_MS` makes the schedule timer fast in tests.
- Menus/dialogs: `layer()` / `openMenu()` / `askText()`; one open at a time, Esc, a click outside or a route change closes it.
  On the phone a menu is a bottom sheet.

## Security model

Threat: whoever reaches this UI can run commands on the computer through Claude. Layers:

1. **Network:** the server is on `127.0.0.1`. The only way in from outside is the Tailscale forwarding `remote-setup.ps1` sets up
   (default: own network only).
2. **Password:** scrypt (N=2^15) hash. The first password can only be set with a "local" request: loopback address + `Host`
   localhost + no proxy header (`requestInfo().local`). A request through the tunnel or through DNS rebinding cannot claim the
   system. `remote-setup.ps1` refuses to run without a password.
3. **Login limit:** 5 wrong attempts per client in 15 min, 40 in total per hour. Behind the tunnel the client is read from
   `X-Forwarded-For`.
4. **Session:** `HttpOnly`, `SameSite=Lax` cookie (`Secure` on https), only its SHA-256 hash on the server, 30-day sliding lifetime.
5. **Origin:** for `/api/*` the `Origin` host must equal `Host` and `Sec-Fetch-Site` must be `same-origin`; non-GET requests need the
   `X-Kumanda: 1` header (a cross-origin simple request cannot send it). Product pages are on another origin and cannot pass.
6. **Path:** `safePath()` rejects `..`, parts starting with `.` and links whose real path leaves the project.
7. **File content is only data on the control origin:** the explorer routes return the content inside JSON (`nosniff`); the UI draws
   it as a text node or through `md()`, an image as an `<img>` with a `data:` URL (an SVG in `<img>` does not run scripts). No
   project file is opened as a document on the control origin; "Open" goes to the product origin.
8. **The side question (`/btw`) cannot use tools:** a PreToolUse hook (`src/btw-no-tools.mjs`, matcher `*`, exit 2) passed with
   `--settings` denies every call, `--permission-mode manual` and `--max-turns 3` on top (2.1.0; tools are not removed from the list
   so the prompt cache matches, see "/btw side questions"). The question goes through stdin, not as an argument (no shell, a `spawn`
   array). Auth/origin checks like every `/api`; test `server.test.mjs` → "/btw side question".

Known limits: cookies do not separate ports (on the same host the control cookie also goes to the product port, but it is
`HttpOnly` and the product server does not use it); all products share one origin and so `localStorage`; in `-Public` mode the
password and the login limit are the only protection.

## Claude Code protocol (seen on 2.1.322, 2026-11-12)

- The start flags are in `Run.#start`. `--permission-prompt-tool stdio` is a **hidden** flag (not in `--help`); without it permission
  requests are denied without asking. Without `--allow-dangerously-skip-permissions` a running session cannot switch to
  `bypassPermissions`.
- Permission request on stdout: `{"type":"control_request","request":{"subtype":"can_use_tool",tool_name,input,permission_suggestions,…}}`.
  Reply on stdin: `{"type":"control_response","response":{"subtype":"success","request_id",…,"response":{"behavior":"allow","updatedInput":…}}}`
  or `{"behavior":"deny","message":…}`. "Always allow" = `updatedPermissions: permission_suggestions` (writes a rule to the
  project's `.claude/settings.local.json`).
- `AskUserQuestion` comes as `can_use_tool` too; the reply is `updatedInput.answers = { "<question text>": "<label>" }`.
- Control requests we send: `interrupt`, `set_permission_mode` (`mode`: `default`/`acceptEdits`/`auto`/`plan`/`bypassPermissions`),
  `set_model`, `apply_flag_settings` (for effort `settings: { effortLevel }`). On the CLI flag `default` is called `manual`.
- **Effort (checked with a real request, 2026-11-16):** `--effort` when the process starts, `apply_flag_settings { effortLevel: X }`
  while it runs; both override the user's per-model `modelSettings.*.effortLevel` in `settings.json`, `effortLevel: null` returns to
  the user's setting. There is no `set_effort` request (`unsupported_request`). `get_settings`' "effective" field does not show the
  flag layer reliably; check through the `params.output_config.effort` field of the `api-request` line in the transcript.
- **Showing the current effort (1.3.0):** `lastRequest()` finds the last `api-request` line (`querySource` `sdk` or
  `repl_main_thread`) backwards in the last 2 MB of the transcript → `{ effort, model }`. The run reads it on the turn's first
  `assistant` line and on `result`, and sends it to the status bar as `snapshot().lastRequest`; the history route returns
  `lastRequest` too. The label of the "default" option comes from `GET /api/project/:pid/effort` (`effortSettings`:
  `~/.claude/settings.json` → the project's `.claude/settings.json` → `settings.local.json`; `effortLevel`, `model`,
  `modelSettings.<full model>.effortLevel`). An effort given by an environment variable is not seen.
- **Selects give the focus back (2.0.0):** after a `change` on the mode/model/effort select the UI calls `select.blur()` and (not on
  touch screens) focuses the prompt, so Enter sends the prompt instead of reopening the menu. Checked in real Chrome by
  `tools/screenshots.mjs` (pick effort → type → Enter → reply with that effort).
- **Send now (Ctrl+Enter, 1.3.0):** `now: true` on the `send` route while the run works first sends `interrupt`, then the prompt. The
  interrupted turn's `result` may arrive after the new prompt's `user` event. A plain Enter writes the prompt to stdin; the CLI
  queues it.
- With `--include-partial-messages` every content block comes as a separate `assistant` line and text pieces as `stream_event`.
- In a new session we give the id with `--session-id <uuid>`; `--resume` continues the same id and the same transcript file.
- In a working folder with a short (8.3) path (`C:\Users\NAME~1\…`) Claude Code refuses to write ("suspicious path"); projects are
  kept with long paths.
- If the protocol changes, first make `test/fake-claude.mjs` match reality, then `src/sessions.mjs`.

## Build and trial

- **Build pipeline:** none; `build.ps1` = check + test + `install.ps1`. Commands are in `BUILD.md`.
- **Background start:** on Windows `--background` starts the server through WMI (`Win32_Process.Create`, hidden window) with the
  `--log` flag: the process does not join the job object of the terminal/VS Code/Claude Code that started it and does not die with
  them; its parent is `WmiPrvSE.exe`. WMI cannot redirect output, so `--log` mode writes `console.*` to the log file. A process
  started by WMI does **not** inherit the caller's environment variables: the tests use the old (direct `spawn`) path with
  `KUMANDA_DIRECT=1`.
- **Trial setup:** `npm test` starts the real server in a temp folder (with the `KUMANDA_DATA`, `KUMANDA_CLAUDE_DIR`, `KUMANDA_CLAUDE`,
  `KUMANDA_DIRECT` environment variables) and uses the fake Claude. `ui.test.mjs` runs the UI in a fake DOM: it catches runtime
  errors, it does not check the look.
- **Trying with real Claude:** start a second instance with a separate data folder and ports (`KUMANDA_DATA=<temp>`, other ports in
  `config.json`) and try with `haiku`; do not touch the installed instance or the owner's password.

## Rules

Rules, commands and the commit/release practice are in `CLAUDE.md` (loaded every session); they are not repeated here.

## Development environment and pitfalls

- Windows 11, Node 24, Claude Code at `~\.local\bin\claude.exe`. The default shell is Windows PowerShell 5.1.
- **The agent's own session may run under this Kumanda server** (started from the phone). Stopping/restarting the server
  (`build.ps1`, `install.ps1`, `--stop`) kills the agent's session mid-work. Restart last, delayed and detached (e.g.
  `Start-Process powershell -WindowStyle Hidden -ArgumentList '-Command','Start-Sleep 90; & .\install.ps1'`).
- Writing a regex to a file through a shell script (`node -e`, heredoc) lost backslashes (2026-11-12); edits with regexes or escapes
  are made with the edit tool.
- `node --test test/` on Node 24 treats the folder as a module and fails; files are given by name (`npm test` does this).
- Every `.mjs` under `test/` enters the default test discovery; `fake-claude.mjs` is not a test, so discovery is not used.
- Scripts and docs write `127.0.0.1`, not `localhost`: Windows PowerShell 5.1 tries `localhost` on IPv6 first and runs into a 2 s
  timeout; `install.ps1` once said "did not start" to a running server because of this (2026-11-14).
- Device sessions (`devices.json`) are only read when the server starts and kept in memory; writing the file from another process
  does not affect the running server. So `--reset-password` stops the server, resets, then starts it again (2026-11-16).
- In the UI the `hidden` attribute could not override classes that set `display` (`.btn`); "Stop" showed in the ready state too. The
  fix is `[hidden] { display: none !important; }` at the top of `style.css` (2026-11-16, seen in a real browser screenshot; the fake
  DOM test cannot catch it).
- `fetch` does not let the `Host` header change; the foreign `Host` test uses `http.request`.
- Without `config.json` the server opens with the default ports (7777/7778): when starting a second instance write the config file
  **first**.
- The fake DOM test cannot see that a view is **not placed** on the page: in the file viewer the content box was drawn without
  being added to the page; the test passed, real Chrome stayed at "Loading…" (2026-11-17). New views go into `tools/screenshots.mjs` too.
- The fake DOM drops attributes containing `-` (`aria-label`); tests find elements by `title` or `placeholder`.
- Kumanda's CSP does not allow `unsafe-eval`: Playwright's `waitForFunction` does not run on the page; use `waitForSelector` with text.
- On a touch context (Playwright `hasTouch`) the UI deliberately does not move the focus to the prompt (no keyboard popping up);
  focus checks belong to the desktop context.
- UI files are served with `no-cache` (ETag); a UI change needs no server restart, server code does. **The other way round
  bites:** a new UI talking to an old server gets 404 "Not found" on new routes (seen 2026-11-22 when the restart had not run).
- The delayed restart started through WMI silently did nothing once (2026-11-21); now its output goes to
  `%TEMP%\kumanda-restart.log` and the next session checks `node server.mjs --status`.
- Bash heredocs with quotes or backslashes failed or mangled text several times; multi-line edits go through the edit tool or a
  script written with the file tool.
- A wrapper element around `.scroll` must be `flex: 1; min-height: 0` (`.scroll-wrap`), or the chat stops scrolling and does not
  open at the end (2026-11-22, when its CSS was missing). `tools/screenshots.mjs` checks the mouse wheel now.

## Open work

- **VS Code button not tried with the real VS Code** (see "VS Code button"); it opens the extension panel, not a terminal. If the
  owner wants the terminal: a `.vscode/tasks.json` with `runOn: folderOpen` running `claude --resume <id>` would do it, but needs
  the folder to be trusted and writes into the project.
- **The UI is partly tried in a real browser:** `tools/screenshots.mjs` in headless Chrome (phone 390 px light, desktop 1280 px dark)
  opens projects, products, the permission card, chat, explorer, file viewer, drawers, ☰/Ctrl+B, swipes, the chat's Products tab,
  the `/btw` card, the draft coming back, the effort in the status bar and the select focus (with `KUMANDA_EXTRA_SHOTS=<folder>`
  extra shots are taken). "Interrupt + send now" was tried on the real CLI (haiku, 2.1.329, 2026-11-20). A real phone keyboard, iOS
  Safari and real finger swipes (clashes with the browser's own gestures) were not tried.
- **Remote access not tried from a phone** (by the agent): `remote-setup.ps1` was run by the owner (2026-11-16, then named
  `uzak-kur.ps1`), the `serve` rules are right (443 → 7777, 8443 → 7778, own network only); the https address answers from this
  computer and proxy headers are detected (`local: false`). Login, opening products and the `Secure` cookie flow on the phone should
  be checked by eye.
- **Notifications not tried end to end:** subscriptions need https or localhost; the VAPID signature and the service worker should be
  tried on a real device. `config.pushContact` is a placeholder; Apple's push service may want a valid `mailto:`.
- 2.2.0 features tried in headless Chrome (palette, menus, wheel, shortcuts, Changes) and the fake DOM; real git/search on large
  projects, Android share target and scheduled sends at a real limit reset were not tried by the agent.
- If the same session is open in the terminal and in Kumanda at once, two processes write to the same transcript; no warning.
- The history defaults to the last 12 MB / 1500 items; "Load older messages" (`?older`) goes up to 128 MB / 50000 items.
- No reverse proxy for products that need a server (e.g. apps running on `localhost:3000`).
