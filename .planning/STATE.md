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
- [x] **M2 Second machine over Tailscale.** CODE DONE + locally verified
      2026-07-06; NEXUS deploy + Mac hook installs are GATED runbooks, NOT
      RUN (blocked on Greg). Authenticated ingest (`Bearer` from
      `WAR_ROOM_TOKEN` env + `X-Machine` label) rides the existing WS event
      plane; remote sessions render hooks-only (label + state, no JSONL).
      Local acceptance: two machines (MACBOOK local + MINI-SIM simulated)
      visible in one browser view, machine identity in TEXT (evidence below).
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

## M2 acceptance evidence (2026-07-06)

Everything below ran LOCALLY (NEXUS deploy is gated). Built from clean
`npm run build`; server `node dist/cli.js --port 3141` with
`WAR_ROOM_TOKEN=<test> WAR_ROOM_MACHINE=MACBOOK`, cwd vault.

- ✓ **Bearer auth on the ingest path:** `POST /api/hooks/claude` → 401 with
  no token, 401 with wrong token, 200 with `Authorization: Bearer <token>`.
  Token from `WAR_ROOM_TOKEN` env (stable across restarts, logged masked as
  "from WAR_ROOM_TOKEN env"); falls back to random-per-start without it.
- ✓ **Remote machine identity end-to-end:** POSTed realistic Claude Code hook
  payloads with `X-Machine: MINI-SIM` for two fake sessions:
  (a) `SessionStart` → `PreToolUse` confirmation path, and
  (b) `PreToolUse` with NO prior SessionStart (already-running-session path —
  new auto-adopt for authenticated remote events). Both created hooks-only
  agents: log `detected hooks-only external session (turffinder) [machine=MINI-SIM]`.
- ✓ **Two machines in one view:** WS probe `existingAgents` →
  `machines: {1:"MINI-SIM", 2:"MINI-SIM", 3:"MACBOOK"}` (agent 3 = real local
  `claude -p` probe session adopted via JSONL). Browser screenshots:
  `.planning/evidence/m2-two-machines.png` (labels `[MACBOOK]`,
  `[MINI-SIM] turffinder`, `[MINI-SIM] arcade` — machine identity as TEXT)
  and `m2-remote-live-states.png` (remote agent live states: "Running: npm
  run build" and "Needs approval" — hooks-only agents render label + state,
  no crash, no blank sprite).
- ✓ **Docker image exercised locally:** `docker build` (multi-stage,
  `--build-arg BASE_IMAGE=public.ecr.aws/...` used locally because this Mac's
  Docker Hub login is stale) → `docker run -e WAR_ROOM_MACHINE=NEXUS
-p 127.0.0.1:3199:3141` → health 200, 401 unauthenticated, authenticated
  MACBOOK event adopted inside the container. Container removed after.
- ✓ **Upstream bugs fixed (both REQUIRED for M2 acceptance):**
  1. Stale-check despawned hooks-only agents seconds after adoption
     (`statSync('')` throws — remote agents have no local JSONL by design).
     Fixed: skip `agent.hooksOnly` in `startStaleExternalAgentCheck`.
  2. The M1-flagged existingAgents/layoutLoaded ordering bug (pre-existing
     sessions never spawned characters on page load — remote agents were
     invisible after refresh). Fixed: flush pending agents in the
     `existingAgents` handler when layout is already ready. M3's "fix by
     then" item is now done.
- ✓ Tests: server 213/213, webview 41/41 (2 assertions updated for the new
  optional `machine` callback arg); `check-types` + eslint clean; asyncapi
  schema extended (`agentCreated.machine`, `existingAgents.machines`) and
  `core/src/messages.ts` regenerated (pre-push drift gate green).
- ✓ Guards intact after all runs: `~/.claude/settings.json` has 0
  pixel-agents/war-room entries; `~/.pixel-agents/server.json` cleaned up;
  port 3141 closed; test containers removed.

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

- ✗ **BLOCKED — NEXUS deploy NOT RUN.** `.planning/runbooks/nexus-war-room-deploy.sh`
  (chmod +x, confirm prompt, [OK]/[WARN] lines, inline undo): rsync source to
  nexus, docker build/run bound to **127.0.0.1:3141 on NEXUS**, Caddy site on
  the TAILNET listener `nexus.tail722a2e.ts.net:8484` with `bind <tailscale-ip>`
  — never the public funnel. Token generated on nexus into
  `~/apps/war-room/war-room.env` (0600, never printed). Greg runs:
  `bash .planning/runbooks/nexus-war-room-deploy.sh`
- ✗ **BLOCKED — Mac hook installs NOT RUN** (Greg's live `~/.claude` is gated).
  `.planning/runbooks/macbook-hooks-install.sh` (chmod +x, backup-first,
  inline undo, parameterized by machine name — same script for both Macs):
  `bash .planning/runbooks/macbook-hooks-install.sh MACBOOK` (then `MINI` on
  the Mini). Installs native `type:"http"` hooks with
  `Authorization: Bearer $WAR_ROOM_TOKEN` + `X-Machine`, `allowedEnvVars:
["WAR_ROOM_TOKEN"]`, and ends with an authenticated smoke POST.
  ⚠ Verify on first run: `allowedEnvVars` is written per hook entry; if the
  installed Claude Code version expects it at hooks-top-level, move it (the
  runbook header documents this; failures are fire-and-forget, check the
  server log for 401s).

## Next step (one)

**Greg runs the two gated runbooks** (deploy on NEXUS, then hooks on the
MacBook), and we verify a REAL MacBook session appears on the NEXUS
dashboard. After that: **M3 colorblind pass** (shape + text for every state;
the M1 render bug earmarked for M3 is already fixed in M2).
