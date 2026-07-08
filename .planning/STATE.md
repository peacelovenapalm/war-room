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

## Review findings (2026-07-06 adversarial pass)

Independent re-verification of every hard constraint, trying to refute the
build's claims. Method: full diff `928ccd4..HEAD`, live greps, live host
checks, and re-running the documented flows.

- ✓ **Zero color-only signals — HELD.** Code audit: `agentState.ts` chips are
  glyph + uppercase word (distinct shape per state); DebugView tool dots and
  JSONL status are glyph + word; `colorize.ts` is decorative only (floor/wall
  tiles, furniture) — not a state channel; team-lead role is TEXT ("LEAD")
  with color as reinforcement. Grayscale evidence re-inspected pixel-level:
  every agent's state + identity reads in `m3-dashboard-grayscale.png`; the
  ⚠ NEEDS INPUT chip is the brightest element in `m4-needs-input-poller.png`.
- ✓ **Nothing bound publicly / runbooks NOT executed — HELD.** Live checks:
  0 war-room/pixel docker containers, 0 launchd jobs, 0 LaunchAgents plists,
  `~/.claude/settings.json` has 0 pixel-agents/war-room entries. Server
  default bind is `127.0.0.1` (`cli.ts`); Dockerfile/runbook publish
  `-p 127.0.0.1:3141` on the host; Caddy site uses `bind <tailscale-ip>` on
  `nexus.tail722a2e.ts.net:8484` — never the funnel.
  ⚠ Minor leftover: local docker IMAGE `war-room:m2-test` (no container)
  still on this Mac — harmless, delete at leisure (`docker rmi war-room:m2-test`).
- ✓ **WS event plane preserved — HELD.** No EventSource/SSE anywhere in the
  branch diff; live WS probe on a fresh clean-shell start received the full
  upstream init sequence + live JSONL tool events.
- ✓ **MIT intact — HELD.** `LICENSE` untouched by any branch commit;
  `package.json` license MIT; upstream ships no per-file headers, none stripped.
- ⚠ **Git convention — PARTIAL.** All 22 commits are atomic with explicit-path
  staging, but 4 subjects lack the em-dash (`2f8645b`, `3533596`, `2cfbf79`,
  `0b64b46`). Fixing requires a history rewrite that would invalidate the
  commit hashes recorded in this ledger — left as Greg's pre-push call
  (reword via rebase, or accept as-is; branch is unpushed).
- ✓ **README-standalone start — RUN, works.** From a clean shell
  (`env -i … zsh -f`): `npm install && npm run build` → no `dist/extension.js`
  → `node dist/cli.js --port 3141` → `GET /` 200, `/api/health` ok, full WS
  init + live session adoption; port closed after kill; `~/.claude` untouched.

**Defects found and FIXED during review** (commits `8d8269b`, `622585b`):

1. ✗→✓ **Gated-action leak (real):** standalone default was
   `hooksEnabled: true` (`configPersistence.ts`), so a bare
   `node dist/cli.js` on any machine WITHOUT the pre-seeded
   `~/.pixel-agents/config.json` auto-wrote hook entries into that
   machine's live `~/.claude/settings.json`. Proven live in an isolated
   HOME (pre-fix build logged "Hooks installed in ~/.claude/settings.json"
   and created the file). Fixed: fork defaults `hooksEnabled: false`;
   hook wiring is runbook-only. Re-proven post-fix: fresh HOME → no write.
   (Docker was already safe — entrypoint seeds the guard.)
2. ✗→✓ **Dead hook-script path:** the CLI passed `dist/` to
   `copyHookScript`, which appends `dist/hooks/…` → `dist/dist/hooks`
   (script never copied when hooks are enabled). Fixed to package root;
   verified in isolated HOME (opt-in run now copies
   `~/.pixel-agents/hooks/claude-hook.js`).

Gates after fixes: check-types + eslint clean; server 223/223,
webview 48/48, poller 10/10; real `~/.claude/settings.json` still 0 entries.

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

## Post-v0: briefing feature (2026-07-06)

Outside the M0-M4 goal contract — a dashboard add-on requested directly, not
a GOAL.md milestone. GET `/api/briefing` (unauthenticated, same as
`/api/health` — tailnet-only server) serves a 60s-cached JSON payload built
from two files wired via env vars (`WAR_ROOM_TODO_DIR`, `WAR_ROOM_TRACKER_STATE`
— documented in `README-standalone.md`), never hardcoded paths. A BRIEFING
toggle in the bottom toolbar overlays today's todo top-3 + tracker gate
tallies, colorblind-safe (glyph + word on every status). Both parsers are
tolerant line-based parsers (no YAML dependency); a missing env var, missing
file, or parse failure yields a null half + one `⚠` log line, never a crash.
Server: 236/236 tests green (was 223, +13). Webview: 48/48 green (unchanged
— no jsdom/testing-library in this repo, so no component render test was
added; noted as a deviation from the ask). Verified end-to-end with a real
build + start + curl + headless screenshot
(`.planning/evidence/briefing-panel.png`).

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
  the Mini). REWORKED 2026-07-07 (see the incident section below): installs
  `type:"command"` hooks running the `~/.war-room/hook.sh` forwarder
  (sources `~/.war-room/env` for token/URL/machine, backgrounds a curl,
  always exits 0), cleans up any legacy http entries + the legacy
  `~/.zshenv` token line, and ends with a smoke POST through the forwarder
  itself.
- ✗ **BLOCKED — poller launchd install NOT RUN** (M4; per machine, after the
  hooks runbook stored the token). `.planning/runbooks/install-poller-launchd.sh`
  (chmod +x, confirm prompt, plist backup, inline undo):
  `bash .planning/runbooks/install-poller-launchd.sh MACBOOK` (then `MINI`).
  Installs `bin/needs-input-poller.mjs` as a KeepAlive launchd user agent
  POSTing to the NEXUS ingest; logs to `~/Library/Logs/war-room-poller.log`.

## Needs Greg (max 3)

1. **Finish the runbooks** (deploy ✓ 2026-07-06, MACBOOK hooks ✓ 2026-07-07):
   still pending are `bash .planning/runbooks/macbook-hooks-install.sh MINI`
   (on the Mini) and `bash .planning/runbooks/install-poller-launchd.sh
MACBOOK` (then `MINI`). Run in a real terminal, not via Claude's `!` —
   the confirm prompt needs interactive stdin.
2. **Push decision** — branch `war-room/v0` is local-only (never pushed, per
   contract). Optional before pushing: reword the 4 em-dash-less commit
   subjects (see review findings); otherwise push as-is.
3. **M5 soak** — after the runbooks: use it daily for a month; watch
   laptop-sleep/reconnect behavior (the one untested DoD line).

---

## 2026-07-07 — v0 DEPLOYED to NEXUS + briefing feature + gamification next

- ✓ **NEXUS deploy DONE** (Greg ran the runbook 2026-07-06 evening): docker
  `war-room` on nexus 127.0.0.1:3141, `tailscale serve` at
  https://nexus.tail722a2e.ts.net:8484 (TAILNET ONLY — verified, no funnel).
  Serve needed a one-time `sudo tailscale set --operator=gregory` (done).
  Runbook rewritten to the no-sudo tailscale-serve path (`ee07a41`).
- ✓ **Briefing feature shipped + live** (`6ef83e6`, `3df55e8`, `3b0d555`):
  GET /api/briefing + HUD BRIEFING panel — today's todo top-3 + half-baked
  tracker gates (glyph+word, colorblind-safe). Sources on NEXUS (ro mounts):
  todo from the vault-notifier clone (self-refreshes every 15 min), tracker
  from /data/repos/completion-2026-07 (deploy runbook rsyncs laptop STATE.md
  → also un-stales the projects-board). Live-verified over tailnet: health ok,
  3 start-now items, 10 gates. Server tests 236/236, webview 48/48.
- ✗ STILL BLOCKED (unchanged): Mac hooks + poller launchd installs (runbooks
  above) — until then the office has no live agents, only the briefing panel.
- **NEXT ITERATION DIRECTION:** Greg's verdict after first browse —
  "aesthetics work, but it lacks fun or gamification." Full design contract
  seed: `.planning/GAMIFICATION-BRIEF.md` (crisis/triage layer → shift-report
  scorecard → real-milestone progression → emergence → expression; hard
  guardrails carried over). Read it FIRST before building v1.

---

## 2026-07-07 (later) — INCIDENT: http hooks broke Claude Code; design reworked

- ✗→✓ **Incident:** Greg ran the http-hook version of
  `macbook-hooks-install.sh MACBOOK`. Every Claude Code session on the
  MacBook then errored on every tool call: Claude Code hard-blocks
  `type:"http"` hooks whose URL resolves to a private/link-local address
  ("HTTP hook blocked: nexus.tail722a2e.ts.net resolves to 100.77.128.49"),
  and the runbook had installed that hook on 14 events. Recovery: all 14
  http entries stripped from `~/.claude/settings.json` (backup:
  `~/.claude/settings.json.bak-war-room-2026-07-07`); GSD/command hooks
  untouched. The 2026-07-04 "http hooks are safe" trap note was WRONG —
  non-2xx is non-blocking, but the private-IP guard rejects the hook before
  any request is made, loudly, every time.
- ✓ **Rework (this session):** delivery is now a `type:"command"` hook —
  `~/.war-room/hook.sh` reads the event JSON on stdin, sources
  `~/.war-room/env` (token + URL + machine label), POSTs via curl in a
  detached background job, always exits 0. No `.zshenv` sourcing needed
  (the script owns its env); the runbook removes the legacy `.zshenv` line
  and any legacy http entries (idempotent, sweeps ALL events). Smoke test
  now goes THROUGH the forwarder (`WAR_ROOM_HOOK_SYNC=1` foreground mode).
- ✓ **Verified in a sandboxed fake HOME against a local stub server:**
  install → 14 command entries, legacy http entries removed (including on
  events outside the install set), unrelated hooks preserved; background
  path delivers authenticated events with `X-Machine`; dead server → exit 0
  in 0.15s; re-run → still exactly 14 entries (no dupes).
- ✓ **MACBOOK hooks LIVE (2026-07-07):** Greg ran the reworked runbook in a
  real terminal; smoke test through the forwarder returned 200. Remaining
  check: confirm a restarted Claude session appears on the dashboard (the
  one path the sandbox couldn't exercise). MINI never ran the broken
  version (nothing to clean) — its install is still pending, as are the
  poller launchd installs on both machines.
- Docs updated: GOAL.md known-traps + M2 wording, README-standalone.md M2
  ingest section, SESSION-HANDOFF-2026-07-07.md addendum.
- **v1 SCOPE ADDITIONS (Greg, 2026-07-07):** (a) in-dashboard HELP SCREEN
  explaining the game layer — ships WITH mechanic #1, `?` key + visible
  HELP button, a mechanic isn't done until its help section exists;
  (b) **Codex/Gemini as coworkers** — mechanic #6, staged: 6a render
  (per-provider ingest adapter → coworker sprite + `[CODEX]`/`[GEMINI]`
  text label), 6b dispatch ("call" a coworker from the dashboard — needs a
  design pass first; gated surface, never open remote-exec). Codex
  ingestion is thereby UN-PARKED from v0's parking lot. Full wording:
  `.planning/GAMIFICATION-BRIEF.md` "Additions" section + the reworked
  kickoff prompt in SESSION-HANDOFF-2026-07-07.md §7.

---

## 2026-07-07 (v1) — VISUAL + FUNCTIONALITY PASS: crisis layer, help screen, coworkers

Branch `war-room/v1` (cut from `war-room/v0`), design contract
`.planning/DESIGN-V1.md` (frontend-design skill pass; colorblind rules
override). All work local; NOT deployed (redeploy = Greg re-running
`.planning/runbooks/nexus-war-room-deploy.sh`), NOT pushed.

### Mechanic #1 — crisis & triage layer ✓ BUILT

- **Fires age at blocked desks:** SMOKE (0–90 s, rising gray puffs) → FIRE
  (90 s–4 m, flickering outlined flame) → ALARM (4 m+, flame + WHITE flashing
  beacon with rays). Distinct SILHOUETTES per stage + a text tag under the
  chip (`▲ FIRE 2:41`, tabular age). Procedural pixel frames
  (`sprites/crisisSprites.ts`), deterministic animation (no RNG).
- **TRIAGE incident board** (top-right, the signature element): auto-appears
  with ≥1 crisis, rows = stage glyph+word, identity, one-line cause
  (waitingFor), age; sorted by age × severity (blocked 3 > failed 2 >
  stopped 1). Collapsible; debris rows carry a CLEAR button.
- **Debris:** failed/stopped agents leave a rubble pile + `✗ DEBRIS · CLEAR`
  label until acknowledged (desk click or board CLEAR); localStorage-persisted
  so refresh doesn't tidy the room; auto-clears if the session recovers.
- **Calm feedback:** resolution → white steam + floating `✓ RESOLVED`; last
  crisis → `✓ ALL CLEAR` flash on the board.
- **Aging is honest + a v0 DEFECT FIXED:** server keeps the poll-state
  transition time (`since`), broadcasts skew-free `ageMs`, and REBROADCASTS
  unchanged states every 20 s — v0 lost the NEEDS INPUT badge on sessions
  blocked > 60 s (client TTL expiry with change-only broadcasts). Replay on
  page refresh re-anchors fire ages.

### Help screen ✓ BUILT (cross-cutting requirement)

`?` key + a visible **Help** word-button (bottom toolbar) open the in-dashboard
help modal: every state chip, fire stage, debris, triage board, resolution
feedback, briefing, machine labels, coworker badges, and the real data
sources. Registry-driven (`webview-ui/src/helpContent.ts`);
`helpContent.test.ts` FAILS if a new state/stage/surface ships without a help
entry — "a mechanic isn't done until its help section exists" is CI-enforced.

### Mechanic #6a — Codex/Gemini coworkers ✓ BUILT (6b design-only)

- Server threads the authed ingest's `:providerId` onto adopted agents and to
  the webview (`agentCreated.provider`, `existingAgents.providers`).
- Webview renders coworkers with a distinct badge SILHOUETTE above the head
  (SQUARE = Codex, DIAMOND = Gemini) + `[CODEX]` / `[GEMINI]` TEXT in the
  name tag and board rows.
- `bin/coworker-adapter.mjs` tails REAL session files —
  `~/.codex/sessions/**/rollout-*.jsonl` (tool-level: turns, shell commands
  with real argv, approval prompts → NEEDS INPUT) and `~/.gemini/tmp/*/logs.json`
  (heartbeat-level; the source only logs user messages). New activity only
  (pre-existing files seed at EOF); no message content leaves the machine.
  Record shapes verified against live captures (codex-cli 0.142.5,
  gemini-cli 0.40.0 on this Mac).
- **6b dispatch is DESIGN ONLY:** `.planning/DISPATCH-6B-DESIGN.md` (queue +
  per-machine opt-in runner + local allowlist; deny = 2xx +
  decision:"deny"; never an open remote-exec endpoint). Nothing built.

### Gates (2026-07-07)

- ✓ Tests: webview 66/66 (was 48; +14 crisis, +4 help), server 238/238
  (was 236; +2 aging), bin/node:test 20/20 (was 10; +10 coworker mapper);
  lint + tsc clean (note: root `check-types` does NOT cover webview-ui —
  `tsc -b` in webview-ui is the real gate and was run).
- ✓ Functionality acceptance (isolated HOME, authed-ingest sim — the M2
  pattern): 4 concurrent crises (3 blocked staggered + 1 failed), queue
  ordered by age × severity, resolve → reorder → steam → ALL CLEAR; fire
  aging captured live through all three stages (~4.5 min real time).
- ✓ Evidence (`.planning/evidence/`): v1-crisis-smoke.png, v1-crisis-stages.png
  (+ -grayscale), v1-crisis-resolve.png, v1-all-clear.png, v1-help.png
  (+ -grayscale), v1-coworkers.png.
- ✓ Colorblind: every new signal is SHAPE + TEXT first (stage silhouettes,
  glyph+word rows, white=loudest); grayscale screenshots in evidence.
- ✓ Guards intact: `~/.claude/settings.json` untouched (0 pixel/war-room
  entries), test server ran in an isolated HOME, port 3141 closed after,
  no adapter/poller processes left.

### Open / next (v1 continuation queue)

1. **Mechanic #2 — shift report (in-dashboard only).** Buildable now; the
   open delivery question (push to morning page/Bark?) gates only the push
   half. Efficiency scoring must reward LOW token spend.
2. **Mechanic #4 — emergence pass** (crowd gathers at a long-blocked desk,
   night mode when no sessions; ≤20-line rules).
3. **Gated on Greg:** brief's 3 open questions (progression storage, shift
   delivery, sound); MINI hooks + poller runbooks; NEXUS redeploy to take v1
   live; push decision for both branches.

### Iteration 2 (2026-07-07, same night) — mechanics #2 + #4 ✓ BUILT

- **Shift report (mechanic #2, in-dashboard only):** `GET /api/shift` +
  Shift toolbar button. Day-scoped scorecard from REAL events: completed
  turns (hook Stop), token deltas (JSONL usage), blocked episodes with
  mean/worst time-to-unblock (poll transitions incl. clears, sweep, agent
  removal — an episode leak found and fixed same session), todos/gates
  deltas vs the day's first briefing snapshot. Efficiency = avg OUTPUT
  tokens per completed turn graded LEAN/STEADY/HEAVY — LOWER is better
  (no-dark-patterns guardrail). Survives restarts
  (~/.pixel-agents/shift-stats.json). Push delivery NOT built (open
  question #1). Live-verified: sim Stop events + blocked→resolved episodes
  counted correctly (3 turns, 2 crises, 2.1 s mean unblock).
- **Emergence (mechanic #4, two cheap interacting rules):** idle wanderers
  bias toward the OLDEST ≥FIRE desk (crowd forms at stuck work — RNG-mocked
  unit test); empty office dims + "◐ NIGHT SHIFT" text label (evidence:
  v1-night-shift.png). Crowd rule not visually soaked (probabilistic —
  verify during M5 soak).
- Help sections added for both (registry test enforces); evidence:
  v1-shift-report.png, v1-night-shift.png.
- Gates: server 245/245 (+7 shiftStats), webview 68/68 (+2 crowd rule),
  bin 20/20, lint + tsc clean.
- **Brief scorecard after iteration 2:** principles #2 (multi-crisis) and
  #7 (feedback loops) fully served; #1 (decisions) via triage ordering;
  #4 (emergence) starter pair; #3 progression + #5 expression GATED on
  Greg's open questions; #6 supplied by real life. Everything buildable
  without Greg's input is built — remaining scope needs his answers,
  the MINI/poller runbooks, and a NEXUS redeploy.

### Iteration 2b — adversarial review pass (2026-07-07, same night)

Independent adversarial review of the full `war-room/v0...v1` diff (subagent,
v0-review method: refute every claim). **Hard constraints HELD:** colorblind
(all new signals shape+text, no color-only channel found), no dark patterns
on money (lower spend always grades better), no function gated behind
progress, WS plane / MIT / no config auto-writes.

**Real bugs found → FIXED same session** (commits `592007b`, `dfb9097`,
`94dfa50`, `88b42ec`):

1. `/resume` replayed historical JSONL usage records into today's token
   spend (efficiency = money integrity) → 5-min timestamp cutoff on
   shift-token recording.
2. Coworker Stop heartbeats counted as completed turns, deflating
   tokens-per-turn toward LEAN → only Claude sessions count turns.
3. Blocked episode leaked open when a burning agent was removed →
   endBlocked on agent removal.
4. TTL/sweep telemetry loss faked "✓ RESOLVED / ALL CLEAR" while the human
   was still being waited on → sweep clears broadcast `stale:true`; the
   webview drops the badge/fire WITHOUT the celebration (client TTL expiry
   also silent). Honest-feedback rule: celebrate only observed resolutions.
5. Adapter: overlapping ticks (slow server) could double-read files →
   in-flight guard; truncated/rotated rollouts stalled forever → offset
   reset; one-prompt Gemini sessions never rendered → post-seed new
   sessions count as activity; coworkers never left the office →
   idle SessionEnd (Codex 30 min, Gemini 60 min) + map pruning.
6. Poll cwd-matching could tag a coworker with a Claude session's blocked
   state → cwd fallback skips non-claude agents; same-machine coworkers
   were dropped by the tracked-dir gate → provider bypass.
7. Blocked episodes now persist across server restarts (no re-ignite
   inflation); briefing baseline captures at day start, not first panel open.

**Deferred (logged, low severity):** TriagePanel first-paint now=0 frame;
ShiftPanel staleness marker on failed refresh; debris keys reuse agent ids
across restarts; yesterday's ledger overwritten at midnight (no previous-day
card); ◆ glyph shared by GEMINI badge and GATES row (words disambiguate);
night-dim vs label use slightly different empty conditions; locally-anchored
fires (no poll state) reset to SMOKE on refresh (documented behavior).

Gates after fixes: server 246/246, webview 68/68, bin 21/21, lint + tsc
clean, `npm run build` clean.

### 2026-07-07 (evening) — telemetry wiring runbooks (`00bea1c`, `a25c327`)

Greg asked to wire the remaining telemetry (MINI hooks, pollers, coworker
adapter). Gated installs stay human-run; this session shipped the tooling:

- **fix `install-poller-launchd.sh`:** two launchd-only defects found by
  probing both Macs — (1) `command -v node` under fnm returns an ephemeral
  `~/.local/state/fnm_multishells/<pid>` path that dies with the installing
  shell (now `realpath`-resolved + hard-fail guard); (2) plist PATH lacked
  `~/.local/bin`, where `claude` lives on BOTH Macs, so `claude agents
--json` would never resolve under launchd. Neither Mac had the poller
  installed yet — fixed before first use.
- **new `install-coworker-adapter-launchd.sh`:** poller-runbook pattern
  (backup → 0600 plist → bootstrap → log smoke test); documents that
  `/api/hooks/{codex,gemini}` 404s until NEXUS runs v1 (adapter logs ⚠ and
  keeps going; no reinstall needed after redeploy).
- **new `ship-to-mini.sh`:** repo is unpushed, so MINI gets bin/ + runbooks
  rsynced to `~/code/war-room` (mirrored layout → relative paths hold) and
  `~/.war-room/env` seeded from MACBOOK's with the machine label rewritten
  to MINI. Targets `greg@100.121.189.6` (Tailscale) — the `mini` ssh alias
  points at a stale LAN IP. MINI probed live: node v22 (fnm), jq, codex,
  gemini, `~/.claude/settings.json` present, no war-room files yet.
- **Verified (live, non-persistent):** `needs-input-poller --once` → ✓ tick,
  7 agents, POST accepted by NEXUS v0; `coworker-adapter --once` → clean
  start. Hooks already installed on MACBOOK (env + hook.sh present).

**BLOCKED on Greg (in order):** `bash .planning/runbooks/ship-to-mini.sh`,
then the three printed MINI installers, then
`install-poller-launchd.sh MACBOOK` + `install-coworker-adapter-launchd.sh
MACBOOK` locally. NEXUS v1 redeploy still pending separately.

### 2026-07-08 — wave 1 fun layer, Sonnet-5 delegated (`11ac623`…`74d74e8`)

Greg answered the three GAMIFICATION-BRIEF questions: shift push → morning
page + Bark; progression → server-side; sound → FULL ambience, ON by
default. Three Sonnet 5 build agents ran; all gates green at `24d3286`
(server 279/279, webview 96/96, bin 21/21, tsc/lint/build clean — verified
independently by two agents at that HEAD).

- **Shift push + report usability** (`11ac623`, `bbfdf39`): closed-day
  summary POSTs to `WAR_ROOM_PUSH_URLS` (comma-sep, unset=off, 1 retry,
  masked logging); `/api/shift` → `{today, yesterday}`; YESTERDAY card;
  `⚠ STALE — last updated HH:MM` marker on failed refresh.
- **Mechanic #3 progression** (`c39f94b`, `24d3286`): file-backed
  server-side store (`~/.pixel-agents/progression.json`), XP from completed
  Claude turns + OBSERVED resolutions + shift grade (LEAN +50 / STEADY +20 /
  HEAVY +0 — lower spend earns more; token volume never read); daily-use
  streak; `progressionUpdate` WS message; always-visible ProgressionHUD.
  Unlock flags for #5: streakBronze/Silver/Gold (3/7/30d), leanGrade5,
  level5, level10 — permanent, data-only.
- **Sound layer** (content inside `c39f94b` — see ownership note):
  procedural WebAudio ambience ON by default with honest
  `SOUND: ON (click to start)` until a gesture arms it; FIRE/ALARM chirp,
  resolved ding, all-clear chime, arrival blip, night duck; text-labeled
  toggle, localStorage-persisted. Every sound mirrors a visible shape+text
  signal.

**Incidents (shared-checkout — worktree isolation did not take):** all three
agents ran in the live checkout. (1) `bbfdf39` swallowed progression's
in-flight edits to shiftStats/httpServer/helpContent; (2) sound's staged
files were swept into `c39f94b` by a concurrent commit (commit message
under-describes it; content correct); (3) lint-staged's stash cycle DROPPED
an asyncapi.yaml hunk from `c39f94b` (no yaml glob → invisible) — restored
in `24d3286`, glob added + file prettier-formatted in `74d74e8`. Rule going
forward: one agent per checkout, or verified worktrees.

**Wave 2 queued:** mechanic #5 expression (decor unlocks consuming the
flags). NEXUS still runs v0 — none of this is visible until redeploy.
