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
- [x] **M3 Colorblind pass.** Every agent state = SHAPE glyph + TEXT chip
      (⚠ NEEDS INPUT / ▶ WORKING / ✓ DONE / ✗ FAILED / ■ STOPPED / ○ IDLE);
      per-agent name tags (#id [MACHINE] folder) always visible; needs-input
      is the loudest signal (inverted white chip + warning-triangle bubble
      sprite, never a tint). Acceptance met: grayscale screenshot fully
      readable (evidence below). ✓ done 2026-07-06.
- [x] **M4 needs-input poller.** CODE DONE + locally verified end-to-end
      2026-07-06 (evidence below). `bin/needs-input-poller.mjs` polls
      `claude agents --json` every ~15s through a tolerant normalizer
      (`bin/lib/normalize-agents.mjs`, node:test 10/10) and POSTs to the new
      authed `POST /api/agents/poll`; `state:"blocked"` + `waitingFor` render
      via the M3 ⚠ NEEDS INPUT chip (loudest element). Verified against the
      REAL 2.1.202 surface (it exists on this Mac — used live, matched real
      blocked sessions). Local acceptance: badge in 2.8s after a live
      working→blocked transition (page open; ≤ ~16s worst-case at the 15s
      default interval — inside the 30s budget). The literal cross-machine
      acceptance (MacBook block → NEXUS dashboard) is GATED on the NEXUS
      deploy + poller-launchd runbooks (Greg-run).
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

## M3 acceptance evidence (2026-07-06)

Commits `61a1204` (state chips + name tags), `+2` (alert bubble sprite,
canvas/DebugView glyphs). Built from `npm run build`; server
`node dist/cli.js --port 3141` (WAR_ROOM_MACHINE=MACBOOK, cwd vault, test
token); 3 MINI-SIM sessions simulated over the authenticated hook ingest +
6 live local MACBOOK sessions from JSONL.

- ✓ **State = SHAPE + TEXT everywhere.** New `webview-ui/src/office/agentState.ts`
  derives one visual state per agent; ToolOverlay renders it as a glyph+word
  chip. Chip vocabulary intentionally covers the `claude agents --json`
  states so the M4 poller reuses it unchanged (FAILED/STOPPED wired but not
  yet reachable — they arrive with the poller).
- ✓ **needs-input is the loudest signal:** inverted white bold chip
  "⚠ NEEDS INPUT" (always full-size, zIndex above everything, shown even
  with labels off) + the canvas permission bubble redrawn as a white warning
  triangle with dark "!" (was: amber "..." tint). Covers BOTH permission
  prompts ("Needs approval" detail) and idle-prompt ("Waiting for input").
- ✓ **Identity always visible as TEXT:** full panel shows "#id [MACHINE]
  folder"; when labels are off, a compact name tag (glyph + STATE word +
  identity) still renders for every agent — identity/state are never hidden.
- ✓ **Other tint-only signals demoted to reinforcement:** DebugView tool
  dots → ✓/⚠/▶ glyphs; JSONL status → "✓ JSONL connected"/"✗ JSONL not
  found"; fuel gauge gains % TEXT; seat picker ●/✓/✗ glyphs; invalid
  furniture ghost gets a bold ✗ (was green/red tint only).
- ✓ **Grayscale acceptance (met literally):** `.planning/evidence/m3-dashboard.png`
  (1800x1240, 5x zoom, 9 agents: ▶ WORKING "Running: npm run build"
  #7 [MINI-SIM] turffinder; ⚠ NEEDS INPUT "Needs approval" #8 [MINI-SIM]
  arcade; ✓ DONE #9 [MINI-SIM] nexus-tools; ▶ WORKING "Fetching web content"
  #3 [MACBOOK] vault (live session); ○ IDLE × rest) and
  `.planning/evidence/m3-dashboard-grayscale.png` (canvas luminance
  conversion — no ImageMagick on this Mac; "canvas script" path of the
  acceptance). Every agent's identity and state reads in grayscale; the
  NEEDS INPUT chip is the single brightest element.
- ✓ **Gates:** check-types + eslint clean; webview 41/41, server 213/213;
  fresh `npm run build` served the reworked UI for the evidence run.
- ✓ **Guards intact after runs:** `~/.claude/settings.json` 0 pixel-agents/
  war-room entries; `~/.pixel-agents/server.json` removed; port 3141 closed;
  temp driver script deleted.
- ⚠ **e2e specs not run** (they need live `claude` sessions + the harness).
  Detail strings the specs assert ("Needs approval", "Waiting for input",
  "Idle") were deliberately kept in the overlay panel, but two behavior
  changes may need spec touch-ups when e2e next runs: (1) idle agents now
  render a compact name tag instead of NO overlay when labels are off;
  (2) a permission/awaiting-input agent shows its full stack even with
  labels off (loud rule).

## M4 acceptance evidence (2026-07-06)

Commits `8fa902c` (poller + normalizer), `cfe570b` (server ingest),
`70df9c8` (webview chips), `0d65b9c` (gated launchd runbook), `8f01da7`
(docs). Built from `npm run build`; server `node dist/cli.js --port 3141`
(WAR_ROOM_TOKEN=test, WAR_ROOM_MACHINE=MACBOOK, cwd vault).

- ✓ **Real surface verified live:** `claude agents --json` EXISTS on this Mac
  (Claude Code 2.1.202) and already diverges from the documented surface —
  `kind:"interactive"` entries carry NO `state` field (only `status:
idle|busy`), `waitingFor` is absent in this build, ids are short UUID
  prefixes with full `sessionId` alongside. The normalizer absorbs all of it
  (real capture is a checked-in fixture); stateless interactive entries are
  skipped by design (local JSONL/hooks already cover them).
- ✓ **Normalizer unit tests:** `npm run test:poller` — node:test 10/10 against
  fixtures: real 2.1.202 capture, documented surface (all 5 states), per-entry
  garbage (missing id/state, bad state, wrong types), whole-payload malformed
  (not JSON, wrong shape → ok:false = tick skipped), wrapper shape, caps.
- ✓ **Ingest hardening exercised:** /api/agents/poll → 401 no/wrong token,
  400 bad body shape, 200 `{matched, cleared}`. Machine-scoped: MACBOOK's
  tick cannot clear MINI's states (vitest-covered).
- ✓ **E2E fixture drive (the sanctioned local stand-in for the gated
  cross-machine test):** MINI-SIM session adopted via authed hooks; poller
  ran with `--cmd "cat fixture.json"`: page open → fixture flipped
  working→blocked → **⚠ NEEDS INPUT badge in 2.8s** with waitingFor detail
  "Permission: Bash(supabase db push)" + identity "#3 [MINI-SIM] turffinder"
  (`.planning/evidence/m4-needs-input-poller.png` — badge is the brightest
  element on screen); fixture emptied → badge cleared in 4.3s; poller killed
  → sweep cleared all poll badges within the 60s TTL (verified in browser).
- ✓ **Real-output live run:** poller `--once` with the real CLI matched 2
  adopted local agents — real blocked session "diablito v1.0" rendered
  ⚠ NEEDS INPUT "Blocked — needs input" (no waitingFor in 2.1.202 → generic
  TEXT fallback), real working session rendered ▶ WORKING
  (`.planning/evidence/m4-real-agents-poll.png`).
- ✓ **Page-refresh survival:** webviewReady replays live poll states —
  WS probe received `agentPollState` (blocked + waitingFor) right after
  `existingAgents`; badge visible 0.2s after a fresh page load.
- ✓ **Gates:** check-types + eslint clean; webview 48/48 (+7 precedence/TTL),
  server 223/223 (+10 pollStateHandler), poller 10/10; asyncapi schema
  extended (AgentPollState) + messages.ts regenerated (drift gate clean).
- ✓ **Guards intact after runs:** `~/.claude/settings.json` 0 pixel-agents/
  war-room entries; `~/.pixel-agents/server.json` absent; port 3141 closed;
  no poller process left; `~/.pixel-agents/config.json` still
  `standalone.hooksEnabled: false`.
- ⚠ e2e specs still not run (need live `claude` + harness — unchanged M3 note).

## Definition of done (v0) — honest state 2026-07-06

- ✗ Dashboard reachable tailnet-only on NEXUS — **BLOCKED on Greg:**
  `nexus-war-room-deploy.sh` not run (image now bakes M3+M4 via rsync+rebuild).
- ✗ Live sessions from ≥2 machines — code + local sim verified (M2);
  **BLOCKED on Greg:** `macbook-hooks-install.sh MACBOOK` / `MINI`.
- ✗ Needs-input badge via shape+text within 30s — code verified locally
  (2.8s fixture, real CLI live); **BLOCKED on Greg:** NEXUS deploy +
  `install-poller-launchd.sh` per Mac for the literal cross-machine proof.
- ✗ Survives laptop sleep/reconnect — untested (needs the deployed NEXUS
  setup + a real sleep cycle; M5 soak territory).
- ✓ Zero color-only signals — grayscale test passed (M3); M4 badge reuses it.
- ✓ Every gated NEXUS/live-config change has a runbook (deploy, hooks ×2 Macs,
  poller launchd ×2 Macs).
- ✓ `.planning/STATE.md` current.

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
- ✗ **BLOCKED — poller launchd install NOT RUN** (M4; per machine, after the
  hooks runbook stored the token). `.planning/runbooks/install-poller-launchd.sh`
  (chmod +x, confirm prompt, plist backup, inline undo):
  `bash .planning/runbooks/install-poller-launchd.sh MACBOOK` (then `MINI`).
  Installs `bin/needs-input-poller.mjs` as a KeepAlive launchd user agent
  POSTing to the NEXUS ingest; logs to `~/Library/Logs/war-room-poller.log`.

## Next step (one)

**Greg runs the three runbooks** (build work is done through M4; M5 soak
can't start without them): `nexus-war-room-deploy.sh` on the Mac →
`macbook-hooks-install.sh MACBOOK` / `MINI` → `install-poller-launchd.sh
MACBOOK` / `MINI`. The Docker image bakes `dist/` at build time, so the
rsync+rebuild in the deploy runbook picks up M3+M4 automatically. After
that: M5 = use it daily for a month (not a build task).
