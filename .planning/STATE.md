# STATE — War Room v0

Progress ledger for the autonomous build loop. Goal contract: `.planning/GOAL.md`
(copied verbatim from `completion-2026-07/war-room/BUILD-GOAL.md`). Read GOAL.md
first every iteration; check the kill criterion before building anything.

## Milestones

- [x] **M0 Bootstrap.** Fork cloned to `/Users/greg/code/war-room` (repo renamed
      `war-room`). `.planning/` seeded (GOAL.md + this file + runbooks/). Standalone
      CLI built and run locally; local Claude Code session verified rendering
      (evidence below). ✓ done 2026-07-06.
- [x] **M1 Decapitate.** Standalone server + static browser build with the
      VS Code extension quarantined from the build. Root package.json surgery
      done (`main` → `dist/cli.js`, engines vscode → node, extension manifest
      fields removed); `npm run build` no longer produces `dist/extension.js`
      (opt-in via `npm run build:extension`). Verified from a CLEAN
      `npm install && npm run build` → `node dist/cli.js --port 3141`: curl,
      WS probe, and headless screenshots pass; a live local Claude Code
      session renders end-to-end (evidence below). Start command documented
      in `README-standalone.md`. ✓ done 2026-07-06.
- [ ] **M2 Second machine over Tailscale.** Server runs on NEXUS (Docker +
      Caddy route = GATED runbook). MacBook Claude Code ships events via
      native `type:"http"` hooks to it. Acceptance: sessions from two
      machines visible in one browser view, machine identity labeled in text.
- [ ] **M3 Colorblind pass.** Shape + text label for every state; per-agent
      name tags; needs-input as a distinct SHAPE (e.g. ⚠ badge + "NEEDS
      INPUT" text), not a tint. Acceptance: grayscale screenshot of the
      dashboard is fully readable.
- [ ] **M4 needs-input poller.** Small script per machine: poll
      `claude agents --json` every ~15s, POST normalized state to the server;
      render `state:"blocked"` + `waitingFor` as the loudest badge on screen.
      Acceptance: block a session behind a permission prompt on the MacBook,
      badge appears on the NEXUS dashboard within 30s.
- [ ] **M5 Soak (not a build task).** Use it daily for a month. Only after
      that does anything in the parking lot get discussed.

## Verified ground truth (2026-07-06)

- ✓ **Kill criterion checked 2026-07-06 — NOT fired.** Agent View is still a
  local research preview (`claude agents --json`, v2.1.139+); no hosted/web
  cross-machine Agent View shipped by Anthropic. Build proceeds.
- ✓ **Fork created by Greg personally 2026-07-06:**
  `origin = github.com/peacelovenapalm/war-room`,
  `upstream = github.com/pixel-agents-hq/pixel-agents` (verified `git remote -v`).
  Branch `war-room/v0` cut from `main` @ `928ccd4` (feat: animated pet system).
- ✓ **Root package IS the VS Code extension** (`main: ./dist/extension.js`),
  workspaces = `server` + `webview-ui` only, `bin.pixel-agents = ./dist/cli.js`
  — matches the known-traps note; M1 decapitation target confirmed real.
- ✓ **Build path that works (no lint/typecheck needed for a run):**
  `npm install` → `npm run asyncapi:generate` → `node esbuild.js`
  (bundles `dist/cli.js` + copies `dist/assets/` + builds `dist/hooks/`) →
  `npm run build:webview` (vite → `dist/webview/`).

## M0 acceptance evidence (2026-07-06)

Ran `node dist/cli.js --port 3141` with cwd `/Users/greg/Brain2/vault`
(a project dir with live Claude Code sessions). Server log:

```
[Pixel Agents] Assets loaded: 6 characters, 2 pets, 38 furniture items
[Pixel Agents] Server: listening on 127.0.0.1:3141
[Pixel Agents] Scanning project dir: /Users/greg/.claude/projects/-Users-greg-Brain2-vault
[Pixel Agents] Watcher: detected global session bbc07ed6-…17e1.jsonl (referral)
[Pixel Agents] JSONL: Agent 2 - tool start: toolu_012wif… Using mcp__claude_ai_Supabase__execute_sql
[Pixel Agents] JSONL: Agent 2 - tool done: toolu_012wif…
```

- ✓ SPA served: `GET /` → HTTP 200 (459 bytes, vite index.html);
  `GET /api/health` → `{"status":"ok","uptime":32,"pid":28879}`.
- ✓ Session discovery from `~/.claude/projects` JSONL: WebSocket probe
  (send `webviewReady`, existing event plane) received
  `{"type":"existingAgents","agents":[1,2],"folderNames":{"1":"referral"},"externalAgents":{"1":true,"2":true}}`
  — two live local sessions adopted, with live `agentStatus: active`,
  `agentTokenUsage`, and `agentToolStart` (Bash + MCP tools) streaming for
  agent 2. Acceptance met: ≥1 local session discovered and rendered as state.
- ✓ Server stopped after verification (kill by pid, clean).
- ⚠ Upstream JSONL parser logs `unrecognized record type 'permission-mode'` /
  `'pr-link'` — benign (new Claude Code record types), not fixed per M0 rule
  ("do not fix upstream bugs yet"). Note for M4: `permission-mode` records may
  matter for needs-input.

## M1 acceptance evidence (2026-07-06)

Clean-room proof on branch `war-room/v0` (commits `6ca0361` build surgery,
`32f3b50` README):

- ✓ **Clean build:** `rm -rf node_modules */node_modules dist` →
  `npm install` → `npm run build` (the one documented command). Produces
  `dist/cli.js` + `dist/assets/` + `dist/hooks/` + `dist/webview/`;
  asserted `dist/extension.js` does NOT exist. Opt-in path
  `npm run build:extension` still bundles the extension (then removed).
- ✓ **Plain node start, no VS Code/Electron/Tauri:**
  `node dist/cli.js --port 3141` (cwd `/Users/greg/Brain2/vault`) →
  `GET /` 200 (vite SPA index), `GET /api/health` `{"status":"ok"}`.
- ✓ **WS event plane untouched:** probe sent `webviewReady` on
  `ws://127.0.0.1:3141/ws`, received the full existing sequence
  (providerCapabilities → sprites/tiles/furniture → layoutLoaded →
  settingsLoaded → existingAgents) plus live `agentCreated`,
  `agentStatus: active/waiting`, `agentToolStart` ("Running: echo …",
  toolName Bash), `agentToolDone`, `agentTokenUsage` from real headless
  `claude -p` probe sessions in the vault project dir.
- ✓ **End-to-end render in a normal browser:** headless Chromium via
  `npx playwright screenshot` shows the pixel office; with a live session
  running mid-page-life, a character sprite renders at a desk with a TEXT
  status label ("Idle") — shape + label, no color-only signal.
- ✓ Server stopped clean after verification (kill by pid; port refused after).
- ⚠ **Upstream bug found (NOT fixed — flag only):** in the standalone
  server the WS init order is `layoutLoaded` BEFORE `existingAgents`, but
  `webview-ui/src/hooks/useExtensionMessages.ts` only flushes the
  `existingAgents` buffer inside its `layoutLoaded` handler → sessions
  adopted BEFORE the page loads never spawn characters (page refresh loses
  characters until the next `agentCreated`). State/events still flow.
  Fix candidate for M3 (it must be fixed by then — a grayscale screenshot
  of pre-existing sessions can't pass if they don't render at all):
  flush `pendingAgents` in the `existingAgents` branch when
  `layoutReadyRef.current` is already true.

## Config guard (important — do not undo)

The CLI's default `hooksEnabled: true` would have auto-written Pixel Agents
hook entries into Greg's live `~/.claude/settings.json` on first start — a
GATED action. Pre-seeded `~/.pixel-agents/config.json` (the app's own config
file) with `standalone: { hooksEnabled: false, watchAllSessions: true,
alwaysShowLabels: true }` BEFORE first run. Verified after the run:
`~/.claude/settings.json` contains 0 `pixel-agents` entries — untouched.
Hook installation stays OFF until M2, where hook wiring ships as a runbook
Greg runs himself.

## Gated / blocked items

- ✗ None executed. Nothing gated was needed for M0. (M2 will need NEXUS
  Docker + Caddy runbooks in `.planning/runbooks/` — directory seeded, empty.)

## Next step (one)

**M2 Second machine over Tailscale:** server on NEXUS (Docker + Caddy on
`nexus.tail722a2e.ts.net` = GATED → author runbooks in
`.planning/runbooks/`, never run them); MacBook ships events via native
`type:"http"` hooks (hook install itself is also a Greg-run runbook — the
`hooksEnabled:false` config guard stays until then). Acceptance: sessions
from two machines in one browser view, machine identity labeled in TEXT.
