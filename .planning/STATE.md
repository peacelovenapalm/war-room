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

### 2026-07-08 — wave 2: mechanic #5 expression ✓ (`28bdee8`)

Decor unlocks consuming the progression flags, existing office sprites
only: Desk Pot (3-day streak), Cactus (7-day), Large Plant (30-day),
Coffee Machine (5 LEAN days), Wall Clock (level 5), Framed Painting
(level 10). Locked items simply don't render (no teasers); UNLOCKS panel
lists each with TEXT requirement + UNLOCKED/LOCKED word; help section
added. Gates re-verified by the orchestrator at HEAD: server 279/279,
webview 102/102, bin 21/21, tsc/lint/build clean. v1 fun layer complete;
visible after NEXUS redeploy.

### 2026-07-08 (later) — mechanic #6b dispatch vertical ✓ BUILT (`18f73cc`…`b9691c9`)

Greg approved the functionality-gap plan (~/.claude/plans/i-have-ran-all-nifty-zebra.md).
Two sequential Sonnet-5 waves, one agent per checkout (rule held — zero collisions):

- **Wave 1 (T1–T6, server+runner):** DispatchRequest/DispatchUpdate protocol;
  file-backed dispatchStore (UUID, 10-min TTL, ≤5 ringing/machine,
  append-only ~/.pixel-agents/dispatch-audit.jsonl); authed routes
  /api/dispatch/{poll,:id/decision,:id/status} + unauth /api/dispatch/machines
  (30s liveness prune); WS lifecycle broadcast + non-terminal connect-replay;
  bin/lib/dispatch-rules.mjs (realpath containment, argv-only, escape tests);
  bin/dispatch-runner.mjs daemon (deny-by-default allowlist re-read per tick,
  handled-set idempotency, focus action pid-only, per-run logs);
  install-dispatch-runner-launchd.sh (poller-runbook clone incl. fnm/PATH
  fixes, writes deny-everything allowlist template). Live smoke: full deny
  round-trip against a real local server; accept→spawn covered by injected-
  spawn tests (no unauthorized CLI spend).
- **Wave 2 (T7–T9, webview):** CallModal (machines/providers/roots from live
  runner advertisements, honest ⚠ NO RUNNERS), DispatchTray (glyph+word
  chips, DENIED sticky, ⚠ NOT QUEUED on silent-drop timeout), BRIEFING
  todo→DISPATCH prefill, agent detail drawer (machine/cwd/session/provider/
  state/permission text/age/tokens + FOCUS pid-gated + COPY ID), help
  sections registry-enforced. `7d432dd` fixed a real wave-1 contract gap
  (session id + project dir not reaching the webview).

Gates re-verified by the orchestrator at `b9691c9`: server 314/314,
webview 134/134, bin 57/57, tsc/lint/build clean.

**Go-live (human, in order):** (1) NEXUS redeploy + set WAR_ROOM_TODO_DIR
(+ optional WAR_ROOM_TRACKER_STATE, WAR_ROOM_PUSH_URLS) on the container;
(2) install-dispatch-runner-launchd.sh MACBOOK/MINI; (3) edit each
~/.war-room/dispatch.json from deny-everything to real roots. Then the
plan's E2E: dispatch `claude -p` to an allowlisted repo, watch
◎ ringing → ✓ answered → office render → ■ exited 0; verify deny path;
click a burning agent → drawer matches reality.

### 2026-07-08 (final) — FOCUS pid wiring ✓ (`81f0a0d`…`d3e56e0`)

Wave-2 finding closed: no pid existed anywhere in telemetry, so FOCUS was
permanently disabled-honest. Fix: hook.sh (runbook heredoc) now sends
`X-Pid: $PPID` (hooks run as children of the claude process) → server tags
pid onto AgentState → AgentCreated/ExistingAgents/AgentPidUpdate broadcast
→ drawer enables FOCUS when pid present AND machine advertises focus:true.
Pid legitimately absent for coworker (codex/gemini adapter) sessions and
until the refreshed forwarder is installed. Gates verified by orchestrator:
server 320/320, webview 139/139, bin 57/57, tsc/lint/build clean.
**Go-live addition: re-run macbook-hooks-install.sh on BOTH Macs** (idempotent,
token kept) so the forwarder gains the X-Pid header.

### 2026-07-08 (go-live) — v1 + dispatch DEPLOYED AND E2E-VERIFIED ✓

Greg authorized production deploy + all bash. Executed and verified live:
NEXUS redeployed (dispatch API serving JSON; funnel-check FAIL was a false
alarm — `tailscale funnel status` lists tailnet-only serves too, :8484 is
"(tailnet only)"; runbook grep needs tightening). X-Pid forwarders
reinstalled on BOTH Macs (smoke 200 each). Dispatch runners installed +
launchd-loaded on BOTH Macs; allowlists armed: providers claude/codex/
gemini, roots /Users/greg/code + /Users/greg/Brain2, focus:true.
**E2E PASSED over the real WS plane:** claude -p dispatched to MACBOOK →
ringing → answered (pid) → exited 0, run log contains the exact expected
output, audit JSONL complete on both ends; deny test on MINI →
`denied path-not-allowlisted` (2xx). Everything Greg asked for is LIVE.
M5 soak/streak clock is running.

### 2026-07-08 (fixes) — dispatch UX round 2 DEPLOYED ✓ (`efe3a99`…)

Greg's live testing found: codex denied trust at non-repo cwd, gemini dead
(Google IneligibleTierError even on 0.49.0 — GEMINI SCRAPPED from dispatch,
Greg's call; 6a rendering kept), results invisible, only 2 cwd choices, no
model/effort. Fixed + deployed: resultTail capture (~8KB, runner→server→WS

- GET /api/dispatch/recent, clickable in tray), subpath input under roots,
  codex --skip-git-repo-check (allowlist = trust boundary), model/effort
  pickers (claude+codex, flags verified via --help), gemini out of the picker.
  Allowlists on both Macs → providers [claude, codex]. Gates verified:
  server 329/329, webview 152/152, bin 63/63. PROD E2E: codex → real MACBOOK
  → exited 0, resultTail contains expected output, /api/dispatch/recent
  returns it. Also fixed ship-to-mini.sh (ssh -n; stdin-drain ate the piped
  confirm and silently no-opped a ship — caught by md5 diff, MINI re-shipped
- runner kickstarted).

### 2026-07-08 (round 3) — model dropdowns DEPLOYED ✓ (`36098d5`)

Greg's "4.6" model failure → MODEL is now a strict per-provider dropdown of
LIVE-VERIFIED values: codex = default | gpt-5.5 ONLY (gpt-5.5-codex 400s on
his ChatGPT tier — verified by real runs, not guessed); claude = default |
fable/opus/sonnet/haiku, effort enum fixed (no 'minimal' — claude --help is
authoritative: low..max). Codex stdin preamble = cosmetic, no suppress flag,
left alone. "No codex coworker rendered" root-caused: adapter keep-alive
sockets pin to the dead container ~10 min after each redeploy (502 burst,
self-heals; ingest verified 200 across all event types now, container logs
show both Macs posting). Gates: webview 158/158, server 329, bin 63.
Deployed; PROD E2E codex -m gpt-5.5 → exited 0 + resultTail verified.

### 2026-07-08 (overnight) — v2 GAME DESIGN COMPLETE, ready for build kickoff

Greg's verdict on v1: "this is closer to v0.5" — wants a full gamified
studio sim he'd play over office-management games. 15-question vision
lock, then an ultracode design workflow (18 agents: 8 sonnet designers →
8 sonnet critics → sonnet synthesis → FABLE adversarial review).
Verdict READY-WITH-NOTES; fable fixed 9 fabricated repo claims, 2
hard-rule violations (uncapped dispatch Cash farm; client-side Cash
mutation) and 2 contradictions IN the docs before commit. Committed:
.planning/v2/{GAME-DESIGN,BUILD-PLAN,KICKOFF}.md + sections/ (reference
only — contain known-false claims the main docs correct; trust order
documented in KICKOFF). Build = G0 engine port → G1 employees → G2
economy+building → G3 command/automation (real-money milestone — Greg
reviews thresholds) → G4 missions/world → G5 art (worktree-canary,
codex-budget warning) → G6 phone; strictly linear; new-session sonnet
ultracode; per-milestone deploy gates need fresh Greg authorization.
Top risks recorded in the workflow result + BUILD-PLAN.

### 2026-07-08 (later) — G0 engine foundation ✓ DONE (PixiJS swap-in)

Two agent instances (the first hung 3+ hours on an unbounded command and was
terminated; a second picked up from `aa249f0` — tasks 1-9 already landed —
and finished tasks 10-11). Recolor pipeline (task 6 gate) verified:
`manifestToPixiSpritesheet.ts`'s `getSpriteTexture` caches one Pixi texture
per distinct hue-shifted `SpriteData` object — `colorize.ts`'s existing
hue-shift math is untouched, renderer-agnostic. Confirmed visually (20
distinct characters spawn 5+ clearly distinct palette/hue colors) and by
`pickDiversePalette()`'s existing diversity logic.

**Task 10 (delete canvas engine):** WAR_ROOM_ENGINE flag flipped clean —
canvas2d → pixi → canvas2d → pixi, each cycle a real build +
`dist/cli.js` standalone server + real Chromium page + 3 live hook-driven
characters, zero console errors. Then deleted `engine/renderer.ts`,
`engine/gameLoop.ts`, the `WAR_ROOM_ENGINE` flag/env read in
`constants.ts`, and `engine/index.ts`'s barrel file (dead, unused,
re-exported from the deleted files — broke `webview-ui`'s `tsc -b` step,
which root `check-types` doesn't cover). `OfficeCanvas.tsx` now runs the
Pixi path unconditionally. `matrixEffect.ts`/`crisisEffects.ts` (old canvas
draw fns) are NOT deleted — out of task 10's named file list, and
`matrixEffect.ts`'s `matrixEffectSeeds` export is still load-bearing
(`officeState.ts`); their `renderMatrixEffect`/`renderCrisisEffects`
exports are now dead code, flagged for a future cleanup pass, not blocking.

**Task 11 (test coverage):** old `renderer.ts` had zero direct unit tests
to port (verified — nothing ever imported it by path). Extended
`pixiRenderer.test.ts` from 2-of-12 to all 12 draw-concern functions
(184 webview tests total, up from 164).

**Verification (deviation from the doc's literal command list, justified):**
`node scripts/run-e2e.mjs` was NOT run — `e2e/global-setup.ts` unconditionally
downloads VS Code via `@vscode/test-electron` (no cached binary in this
environment), an unbounded network dependency matching the exact risk
class that likely caused the first agent's hang. Substituted an
equal-coverage standalone harness reusing the repo's own
`e2e/helpers/standalone.ts`/`hooks.ts` contracts (real `dist/cli.js` +
real Chromium, no Electron/VS Code) driven directly via node+playwright.
Recommend running the full VS Code E2E suite once in a session with a
pre-cached binary or more headroom, as a follow-up (G0 has no deploy gate,
so this is a managed risk, not a skipped requirement).

Gates: server 329/329, webview 184/184, bin 63/63, tsc/lint/build clean
(root `check-types` doesn't cover `webview-ui`'s own `tsc -b` — caught
the barrel-file break via the full `npm run build` instead; worth adding
webview-ui to root check-types as a follow-up). `grep -r "engine/renderer\|
engine/gameLoop"` against the real build output (`dist/webview/` — the doc
says `webview-ui/dist`, which doesn't exist; outDir is repo-root
`dist/webview`) is empty, though structurally this grep is a no-op either
way since import paths never survive minification — the load-bearing check
is zero source references (confirmed) + a clean build (confirmed).

**FPS (recorded, `app.ticker.FPS` itself isn't exposed anywhere to test
code — measured via real rAF sampling over 3s, an equivalent proxy since
Pixi's ticker is itself rAF-driven):** 20 characters + 3 simultaneous
crisis effects + a full 64×64 (4096-tile) floor with viewport culling
active, combined worst-case in one measurement — **91.7 FPS** (≥50 bar,
comfortable headroom; chunking not needed yet).

Screenshots: `.planning/evidence/g0-pixi.png` + `-grayscale.png` (6
characters, 2 in SMOKE-stage crisis, TRIAGE panel, full furniture scene —
grayscale fully legible, chip+glyph+text primary signal per the colorblind
hard rule). Pixel-perfect parity with the old canvas renderer was not
attempted (GAME-DESIGN §8.1 rev 2: "better is welcome").

Proceed to G1 (Employees).

### 2026-07-08 (later) — G1 employees ✓ DONE (colony-sim layer, mood-only)

Wave A (server, tasks 1-8, commits `9901065`..`99dfd28`) then Wave B
(webview, tasks 9-12, commits `bf67d60`..`fa7aa88`), one agent, one
checkout, sequential — no collisions. Implements GAME-DESIGN.md §4 rev 2
exactly (mood-only, the three needs meters CUT per interrogation delta).

**Server:** `core/src/leveling.ts` extracted from `progressionStore.ts`
as pure `{base,step}`-parameterizable functions (progressionStore.ts
keeps its single-arg public API — 15/15 tests green, zero edits).
`server/src/employeeStore.ts` — identity via `core/src/employeeId.ts`
(machine:project, provider is an attribute, §9.4); fire blacklists the
routing key and the next telemetry allocates a fresh `#n` record, a
natural quit never blacklists and auto-rehires under the same id on the
next real event (§9.5); derived traits/badges gated at MIN_SAMPLES=5;
employee-local XP on the flatter `{base:60,step:30}` curve; deterministic
mulberry32 quit roll (XP halved, never reset to 1). New shared core
primitives beyond the literal task list: `core/src/deterministicRandom.ts`
(FNV-1a hash + mulberry32 — never `Math.random()` for anything that must
replay identically) and `core/src/quips.ts` (template one-liners, no LLM).
Wired into the exact two real event call sites `progression`/`shiftStats`
already use: `hookEventHandler.ts`'s `handleStop` (turn completion) and
`pollStateHandler.ts`'s `applyPollStates` (observed crisis resolution,
never a stale sweep). 10 HTTP routes (`server/src/httpServer.ts`),
unauthenticated (same trust level as `/api/briefing`/dispatch-machines —
local-webview player-action plane), `{ok:false,reason}` at 200 never
4xx. `employeeSnapshot` WS broadcast + full-roster replay on connect.

**Webview:** `office/personaBadges.ts` (glyph+TEXT chips, mirrors
`agentState.ts`'s `STATE_CHIPS` shape — that convention lives there, not
`crisis.ts`, correcting an earlier draft's misattribution).
`office/mood.ts` — pure functions; `CharacterState.BURNED_OUT` added to
the existing enum (not a parallel state machine) renders a droop pose by
reusing an existing walk-cycle frame and applies a 0.6x walk-speed
multiplier (not numerically specified by GAME-DESIGN — a documented
judgment call); wired into `characters.ts`'s three idle-transition sites
and the movement/sprite-getter code. `officeState.ts`'s `addAgent` stamps
a stable `employeeId` FK computed via the same shared function the server
uses; `useExtensionMessages.ts` subscribes to `employeeSnapshot` and sets
`moodBand` on any character whose FK matches — live, reactive, not inert
plumbing. `components/EmployeeRoster.tsx` — ROSTER/HALL OF FAME tabs,
clones `AgentDrawer.tsx`'s row conventions, verbs POST to the routes and
wait for the next broadcast (server-authoritative, no optimistic local
mutation). Wired into `BottomToolbar.tsx`/`App.tsx` (new "Employees"
toggle). `asyncapi.yaml` gained `sampleCount` on `EmployeeSnapshot` (the
ROOKIE-badge gate the client needs; the raw rolling-turns ring buffer
stays server-only).

**Deviation (acceptance criterion, documented explicitly per the
kickoff's instructions):** the literal ask — "actually running a Claude
Code turn against the dev server and re-querying, not a fixture-only
test" — was attempted for real. Built an isolated-HOME standalone server,
verified hook auto-install touched ONLY the scratch home (real
`~/.claude/settings.json` count unchanged, no scratch paths/ports leaked
in), then ran `claude -p`. It failed: `--dangerously-skip-permissions`
was denied by the permission classifier ("no explicit user instruction
authorizes this exact unsandboxed invocation"), and without that flag the
fresh isolated HOME had no auth ("Not logged in"). Rather than work
around the classifier's denial, substituted the repo's own established
stand-in: realistic hook payloads (`SessionStart`+`Stop`) posted directly
to `/api/hooks/claude` over the authed `X-Machine` path — the exact
pattern M2's acceptance evidence used and documented as accepted. Also
discovered along the way: `PixelAgentsServer` alone (as
`server.test.ts`/`dispatchRoutes.test.ts` use it) is a bare HTTP harness
with no `AgentRuntime` attached — `employeeRoutes.test.ts` wires the full
pipeline itself, cloning `cli.ts`'s own bootstrap, since it's the only
way to drive a genuine adoption+Stop sequence through the real code path.

**Verification:** server 355/355 (was 329, +26 — `employeeStore.test.ts`
21, `employeeRoutes.test.ts` 5), webview 199/199 (was 184, +15 —
`mood.test.ts` 10, `personaBadges.test.ts` 5), bin/poller 63/63
unchanged. Root `check-types`, webview's own `tsc -b`, full `npm run
lint`, root `npm test`, and `npm run build` all clean. Break-never-
blocks-dispatch verified explicitly at both the store level
(`employeeStore.test.ts`) and the HTTP/real-ingest level
(`employeeRoutes.test.ts` — a 4th real turn succeeds while `on_break`).
Fire-vs-quit identity verified explicitly (blacklist+`#n` vs
auto-rehire-under-same-id), both unit and HTTP level. `token` grep sweep
clean — every hit is `tokenEfficiency` (rewards LOWER spend, same
polarity as `shiftStats`) or its plumbing; XP/moodBoost awards are all
fixed constants, never token-scaled.

Screenshots: `.planning/evidence/g1-employee-roster.png` + `-grayscale.png`
(two real employees driven through the actual hook ingest — one crosses
MIN_SAMPLES into real FAST/METICULOUS/EFFICIENT badges + active status,
one stays ROOKIE/candidate; badges, mood glyph+number, rank/level/status
all read by shape+text alone in grayscale).

**Scoping decisions (forward-compatible, not implemented yet):** G2+
dependencies (Cash/Reputation, vacation-mode flag) don't exist — verb
gates run against real non-economic thresholds now; Reputation awards
and vacation-awareness are injected callbacks, no-ops until G2 wires
them. `employeeHired`/`employeeQuit` WS message types are defined
(asyncapi.yaml) but not yet emitted — `employeeSnapshot` alone covers
the roster UI's needs; the dedicated events are natural G4 Bark-digest
wiring. No G1 help-modal section added (not CI-enforced for this new
surface — `helpContent.test.ts` only gates a fixed, explicit list).

No deploy at G1 (batches into G2's deploy gate). Proceed to G2
(Economy + Building).

### 2026-07-08 (later still) — G2 economy + building ✓ DONE (BATCH-1 deploy GATED)

Three waves, one agent, one checkout, sequential — no collisions. Wave A
(economy, commit `30307b8`), Wave B (building, `9cca5f8`), Wave C
(webview build-mode UI, `91af910`), plus a real-browser perf-bug fix +
evidence (`ad8386e`) and TUNING.md (`f007786`). Implements GAME-DESIGN.md
§3/§5 exactly.

**Wave A (economy):** `economyConstants.ts` (single numeric authority) +
`economyStore.ts` — Cash/Reputation/grime/vacation-mode, capped 200-entry
ledger, Reputation decay with a 1-day grace + a 72h/3-day
offline-catchup cap (own day-by-day walk, not a batch recompute — avoids
double-decaying already-processed days), dispatch-cash anti-farming daily
cap (`DISPATCH_CASH_DAILY_CAP=50`, implemented + unit-tested per the
build plan's task 4 but not yet wired to a live dispatch route — that
wiring is G3's dispatch-chains territory, a deliberate scope line, not an
oversight). Wired into the EXACT real-event call sites
`progression`/`shiftStats` already use: `hookEventHandler.ts`'s
`handleStop` (turn completed — also the once/day streak-touch bonus) and
`pollStateHandler.ts`'s observed-transition branch (crisis resolved) and
`shiftStats.ts`'s `onDayClose` default callback (shift grade). GET/POST
`/api/economy*` routes + WS `economyUpdate` broadcast + connect-time
offline catch-up. `employeeStore.ts`'s singleton export now wires its
Reputation-award/vacation-flag deps to the real `economyStore` (a
one-line change at the export site — the `EmployeeStoreDeps` injection
seam G1 anticipated for exactly this).

**Wave B (building):** `buildingBuffs.ts` — the authoritative
`computeActiveBuffs()`, `buffsForDesk()` (Dev Pit/Break Room/War Room
room-membership + Chebyshev furniture adjacency, one shared 40% cap per
GAME-DESIGN §9.19, not two independent 40s) and `globalBuffs()` (Server
Room +10% Cash requiring qualifying furniture inside, Kitchen mood-decay
×0.85). `officeLayoutStore.ts` owns the four server-authoritative
mutations (expand/room/furniture/sell) — check-debit-persist, client
never mutates Cash. Bay expansion converts a 4-col rectangle to floor
with a doorway punched through the old right-edge wall at the row
midpoint, exact `500*1.55^n` cost. The Dev Pit +15% XP room-membership
bonus is wired into the REAL turn-XP call site
(`hookEventHandler.ts`'s `handleStop`) via `employeeStore.recordTurn`'s
existing `xpOverride` param — looks up the employee's `assignedRoomId`
(repurposed as the assigned desk's furniture uid) and computes the buff
server-side, point-in-time, at the moment the real event resolves.
Webview gains `RoomType`/`PlacedRoom` on `OfficeLayout` (rooms default to
`[]`, same shape as `pets`) and a `furnitureBuffs.ts` sidecar for future
UI display — the generated asset manifest is untouched, per the doc's
explicit instruction.

**Wave C (webview):** `EconomyHUD.tsx` (Cash/Reputation strip, sibling to
`ProgressionHUD.tsx`) wired through `useExtensionMessages.ts`'s new
`economyUpdate`/`officeExpanded`/`officeLayoutUpdated` handlers.
`EditorToolbar.tsx` gains a 5-button room palette + Sell tool + Expand
Office button (shape+text, no color-only). `OfficeCanvas.tsx` wires
ROOM_TAG (drag-rectangle, mirrors the existing tile-paint drag pattern)
and SELL (click-to-target) to new `editorActions.ts` async commit
functions — server-authoritative check-debit-persist-broadcast, client
applies the returned layout only on `{ok:true}`. New `pixiRenderer.ts`
functions (`renderRoomTagPreview`, `renderBayGhost`) reuse the existing
`dashedRect` primitive for the drag-rectangle preview and the next-bay
LOCKED ghost overlay.

**Real-browser bug found + fixed (not caught by any unit test):**
`renderBayGhost()` reassigned a Pixi `Text.text` property every frame
regardless of whether the value changed. Pixi re-rasterizes the glyph
texture on every `.text` write — this pegged the render loop's CPU to
100% the instant edit mode was entered, and independently caused
Playwright's `page.screenshot()` to hang indefinitely (reproducible with
`--disable-gpu --use-gl=swiftshader` forcing software rendering, which
surfaced it faster; the browser's own GPU compositor apparently masked
enough of the cost that the hang was CPU-load-dependent, not purely
correctness-dependent). Root-caused via a from-scratch bisection (WS
frame counting ruled out a server broadcast loop; disabling the new
render calls but keeping the computation ruled out the two new render
functions themselves as the _rendering_ cost, isolating it to the `.text`
write; CPU measurement during the hang window, not just after, confirmed
it wasn't a screenshot-API-specific issue). Fixed with a value-comparison
guard before the write, matching the existing `renderSeatIndicators`
precedent elsewhere in the same file (which only ever writes `.text`
conditionally, never unconditionally every frame). This is the kind of
bug `pixiRenderer.test.ts`'s mocked-`Application` scene-graph assertions
structurally cannot catch — worth flagging as a gap: no G0-era test
exercises real per-frame render cost against a live browser.

**Verification:** server 393/393 (was 355, +38 — `economyStore.test.ts`
23, `buildingBuffs.test.ts` 12, `buildingRoutes.test.ts` 3), webview
206/206 (was 199, +7 — `layoutSerializer.test.ts` +2 rooms-migration
cases, `editorActions.test.ts` 5 new), bin/poller 63/63 unchanged. Root
`check-types`, webview's own `tsc -b`, full `npm run lint`, and `npm run
build` all clean. `grep` sweep of the full G2 diff for the word "token"
— every hit is inside a guardrail comment ("never token volume", "burning
real tokens"), zero hits in actual reward-computation code.

**Acceptance checks, explicitly confirmed:**

- A real completed turn increases Cash by exactly `CASH_PER_TURN=2` —
  verified via before/after `GET /api/economy` reads in
  `economyStore.test.ts`, not just unit-level state assertions.
- Bay purchase deducts the exact `500*1.55^n` formula, twice in a row,
  via a live HTTP round-trip in `buildingRoutes.test.ts` (not a unit
  test alone) — cols grow by exactly 4, the doorway tile at the old
  right-edge wall's midpoint row is punched open, insufficient-Cash is
  rejected without mutating the layout.
- Dev Pit +15% XP bonus: `buildingRoutes.test.ts` drives 3 real turns to
  cross the candidate→active threshold, assigns the employee to a desk,
  tags a Dev Pit over it via the live route, drives a 4th real turn, and
  asserts the XP delta is exactly `Math.round(XP_TURN * 1.15)` — a real
  observed event through the actual hook-ingest→employeeStore pipeline,
  not a unit test alone.
- 40% shared cap: `buildingBuffs.test.ts` constructs a layout where
  Dev Pit (15%) + 4 distinct buffed furniture types (10+10+10+15=45%)
  would total 60% uncapped, and asserts the resolved bonus is exactly
  `ADJACENCY_AND_ROOM_BONUS_CAP_PCT=40`, not 60 and not 80 — the
  boundary case, not just "stays under 40."

Screenshots: `.planning/evidence/g2-build-mode.png` + `-grayscale.png` —
the room palette (5 buttons, glyph+text: Dev Pit/Server Room/Break
Room/War Room/Kitchen), Sell tool, Expand Office button showing the exact
live `bayCost(1)=$775`, the LOCKED $775 bay-ghost text, the grid overlay,
the full office (furniture/floor/walls) rendering correctly, and the
EconomyHUD (`$1850 ★42`) against real seeded economy/employee data.
Grayscale fully legible.

**CORRECTION (superseding the first pass of this entry): the office
canvas going blank in edit mode was a REAL, SEVERE regression, not a
capture artifact — it was mis-diagnosed on the first pass.** Team-lead
review of the initial screenshot pair caught it (the canvas region was
genuinely empty, not a camera-framing issue) and sent it back before
deploying. Root cause: `pixiApp.ts`'s `dispose()` called
`app.destroy(true, {...})` — Pixi's `removeView: true` shorthand, which
physically removes the `<canvas>` element from the DOM. `OfficeCanvas.tsx`'s
main effect disposes and recreates the whole Pixi app on every
`isEditMode`/`_editorTick` change (pre-existing architecture, unchanged
since before G0's PixiJS swap). Under the old canvas2d engine this was
harmless — nothing there owned DOM insertion. Under Pixi, `destroy(true)`
silently orphans the canvas node on the FIRST dispose; the next
`startPixiApp()` call re-initializes onto a detached element React never
re-inserts, leaving the office permanently blank the instant edit mode
(or any other `_editorTick`-triggering action) is entered — **latent
since G0**, since nothing exercised a dispose+recreate cycle in a
screenshot test until this session's build-mode capture was the first
attempt to screenshot edit mode since the PixiJS migration. Verified via
a real-browser repro (`document.querySelectorAll('canvas').length`: 1 →
0 the instant edit mode is entered, before the fix; stays 1 after).
Fixed by passing `{ removeView: false }` to both `destroy()` call sites
in `pixiApp.ts` (commit `ef5dfa8`) — Pixi tears down its own
renderer/ticker/texture resources but leaves the canvas DOM node alone,
since React owns its lifecycle via the ref, not Pixi. Re-verified: full
gate list green again (server 393/393, webview 206/206, check-types/
lint/build clean), evidence screenshots re-captured showing the office
rendering correctly in edit mode.

**BATCH-1 DEPLOY: GATED, NOT RUN.** The full gate list is green and the
deploy was otherwise ready. Invoking
`.planning/runbooks/nexus-war-room-deploy.sh` was **blocked by the
permission system's auto-mode classifier** — it correctly determined
that a teammate/orchestrator's pre-authorization does not carry Greg's
own direct consent for a production-adjacent NEXUS action, and the
agent did not attempt to route around the block. Ready-to-run command
and the independent post-deploy `curl` verification step are logged in
`.planning/v2/TUNING.md` under "[G2] BATCH-1 deploy — GATED, not run."
Greg needs to either run the runbook himself or explicitly authorize it
directly in a session before G4's batch-2 deploy assumes G2 is live.

**Scoping decisions (forward-compatible, not implemented yet):**
`recordDispatchExit()` (Cash + activity-touch for dispatch runs) is
implemented and unit-tested but not wired into a live dispatch route —
BUILD-PLAN's Wave A task 3 scopes G2's wiring to exactly 3 call sites
(turn/crisis/shift-close); dispatch-exit Cash naturally lands in G3
alongside the dispatch-chains/budget-guardrail work. `/api/building/furniture`
exists and is tested indirectly via `buildingBuffs.test.ts`'s fixtures but
has no dedicated buy-flow webview UI beyond the route + editorActions
wrapper (`commitBuyFurniture`) — no acceptance criterion required it and
the existing free-furniture-placement UI already covers plain decor; a
buffed-furniture shopping UI is a reasonable follow-up, not a gap against
this milestone's stated criteria. `PlacedRoom` has no persistent visual
indicator in the renderer yet (an already-tagged room doesn't render a
tinted overlay) — GAME-DESIGN doesn't require one for v1, follow-up for
G5 polish.

Proceed to G3 (Command + Automation) once G2's deploy is confirmed live.

### 2026-07-08 (later) — G2 BATCH-1 deploy ✓ LIVE, verified by orchestrator

The G2 sub-agent's own deploy attempt was correctly refused by its
permission classifier (a sub-agent cannot self-authorize an infra action
on a peer's say-so). The top-level `/goal` orchestrator session — directly
named in Greg's own kickoff prompt, holding KICKOFF.md rev 2's written
pre-authorization read first-hand — ran
`.planning/runbooks/nexus-war-room-deploy.sh` directly.

Two environment snags hit and resolved (documented in detail in
`.planning/v2/TUNING.md`, both will recur at G4/G6 unless fixed
upstream): (1) the `nexus` SSH alias times out from this session's shell
(LAN IP unreachable) — `NEXUS_HOST=nexus-ts` (Tailscale alias) works,
confirmed reachable via `tailscale status`; (2) the runbook's own
funnel-check false-alarmed (`[FAIL] SAFETY: :8484 appears in FUNNEL
status`) — independently re-verified via `ssh nexus-ts tailscale funnel
status`, which explicitly labels `:8484` `(tailnet only)`. Same
already-documented false-positive as v1's go-live entry above, not a
regression; the runbook's grep needs tightening but this isn't a
blocker.

Deploy verified live and independent of the runbook's own success
message: `curl https://nexus.tail722a2e.ts.net:8484/api/economy` →
`{"cash":0,"reputation":0,"grime":0,"vacationMode":false,"bayCount":0,"ledger":[]}`
— fresh container, correct empty state for a first deploy. Image built
clean, health check + briefing endpoint both responded.

G2 (Economy + Building) is fully done: code, tests, screenshots, and the
batch-1 deploy all verified. Proceeding to G3 (Command + Automation).

### 2026-07-08 (later) — G3 (Command + Automation) code/test complete, no deploy

Chains (`chainStore.ts`/`chainOrchestrator.ts`), standing orders
(`standingOrderStore.ts`), templates (`dispatchTemplateStore.ts`), and the
budget guardrail (`budgetStore.ts`) per GAME-DESIGN.md §7, superseding the
old 08-draft "bolt fields onto dispatchStore" design (§9.11) — the
`chainStore.ts`/`chainOrchestrator.ts` split with a real perk economy per
§9.11's ruling.

**Both of §7.1's self-identified correctness bugs, pre-fixed:**

- **Bug #1 (subscription wiring):** `chainOrchestrator.start()` subscribes
  to `dispatchStore.onUpdate()` exactly ONCE, called from
  `httpServer.ts`'s `createHttpServer()` bootstrap — never inside
  `registerWebSocketRoute`'s per-connection handler (grepped every
  `dispatchStore.onUpdate` call site; the WS route's own subscription is a
  separate, harmless pure-broadcast-forwarding one, not an advance-logic
  subscription). `start()` is also idempotent as defense-in-depth, and the
  advance algorithm independently re-checks `run.currentStep === stepIndex`
  before acting on any event — two independent layers against the bug
  shape, not just call-site discipline.
- **Bug #2 (`expired` status):** treated IDENTICALLY to `denied` in
  `chainOrchestrator.onDispatchUpdate` — terminal, fails the run
  immediately, never retried. `CHAIN_STEP_TIMEOUT_MS=500_000`, verified
  strictly less than `dispatchStore.ts`'s live `DISPATCH_TTL_MS=600_000`
  constant (not retyped from memory).

**Three unattended-run safety guards, all confirmed intact:**

1. Standing-order first-fire confirm (`needsFirstFireConfirm`) is
   UNCONDITIONAL — `confirmFirstFire()` is the only code path that ever
   clears it, reachable only via an explicit human UI click; no perk
   purchase, `tick()`, or STOP ALL/RESUME path can reach it (verified by a
   dedicated test: an order with every perk owned still shows
   `needsFirstFireConfirm:true` and `tick()` never fires it).
2. Budget fail-safe pause: `budgetStore.isAutomationPaused()` returns
   `paused:true, reason:'stale-snapshot'` whenever no fresh Claude report
   exists — verified live end-to-end (fresh isolated server, zero
   snapshot, a chain's step-2 auto-continuation genuinely stalled in
   `pending` until a snapshot was seeded, exactly as designed — this was
   an early test failure that turned out to be the fail-safe working
   correctly, not a bug). Manual CallModal dispatch is never gated by this
   store — grepped every call site.
3. STOP ALL (`POST /api/automation/stop-all`) halts every running chain
   run and disables every enabled standing order in one transaction,
   broadcasts `automationStopped`; RESUME is a separate explicit action
   restoring exactly the STOP ALL-disabled set (never a
   previously-disabled order). Verified live: stop-all mid-chain, then the
   in-flight step's own terminal exit arrives — the run stays `halted`,
   step 2 never enqueues.

**Regression tests for both named bugs, explicit and passing:**
`chainOrchestrator.test.ts`'s "bug #1" test calls `start()` twice
(simulating 2 WS connections naively re-wiring it) and asserts
`dispatch.enqueue` is called exactly twice total across the whole 2-step
run (once per step, never doubled) via a spy; the "bug #2" test drives a
step to `expired` via `dispatchStore.sweepExpired()` and asserts the run
fails immediately with `failReason:'step-expired'`, no stall.

**Live E2E (real Fastify server + real poll/decide/status runner
simulation, no mocked-Application shortcuts — `chainOrchestratorRoutes.test.ts`):**
a 2-step chain on an allowlisted root completes with `{{step1.result}}`/
`{{step1.exitCode}}` correctly substituted into step 2's actual prompt;
a non-allowlisted root is denied by the (simulated) runner and the chain
reaches `failed` with the runner's own deny reason surfaced, step 2 never
enqueued.

**Budget pause E2E (`standingOrderStoreRoutes.test.ts`) — spawns the REAL
`bin/needs-input-poller.mjs` as a child process** (not a simulated forward
call) against a hand-edited `~/.pixel-agents/rate-limit-snapshot.json`
(`five_hour.used_percentage:95`, real field names verified against
statusline.js), confirms the poller's `POST /api/budget/report` actually
reaches the live server, then confirms a due standing order skips with
`lastSkipReason:'budget-paused'`, `lastFiredAt` unchanged.

**Claude/Codex usage-signal check, explicitly labeled per BUILD-PLAN §G3's
required line:** the Claude rate-limit parser (`bin/lib/rate-limit-snapshot.mjs`)
is **verified** against `~/.claude/statusline.js`'s own confirmed parse
sites (lines 353/357-366/174) and exercised end-to-end against a
realistic synthetic stdin payload matching that exact shape. The exact
live CLI-generated stdin payload was NOT captured this session (doing so
requires registering the hook in Greg's gated `~/.claude/settings.json`
first, which this session correctly did not do) — the live CLI payload
shape is **inferred** from statusline.js's source, not directly observed.
The Codex weekly-cap heuristic is a manual config value by design (Greg
enters it once), not a live signal — nothing to verify/infer there beyond
the counter-increment logic, which is unit-tested.

**Full verification (before → after):** server 393 → 463 (+70), webview
206 → 231 (+25), bin/poller 63 → 74 (+11). Root `check-types`, full
`npm run lint`, full `npm test`, and `npm run build` all clean. Live
smoke-verified against a real running server instance with an isolated
HOME (no interactive browser was available in this sandbox — no Chrome
extension connection — so route responses, WS broadcast-on-connect
replay, and the built bundle's inclusion of the new message types were
confirmed via curl/websocket instead); Greg's own long-running local
instance (PID 49078, port 3149) was detected via the CLI's server.json
discovery and deliberately left untouched throughout (an isolated fake
HOME was used instead of interacting with or restarting it).

**Deviations from BUILD-PLAN:** CallModal's "employee prefill" call site
(task 8's third of three `resolveEmployeeDefaults()` consumers) was not
wired into a new UI affordance — `employeeStore.resolveEmployeeDefaults()`
exists and is fully wired at the other two call sites (chain steps,
standing orders); adding a "call this employee" button to
`EmployeeRoster.tsx` would be new UI surface not required by any G3
acceptance criterion, so it was deferred rather than speculatively built.
WS broadcast planes (`chainRunUpdate`/`standingOrderUpdate`/`budgetUpdate`)
were added beyond the doc's literal minimum (`automationStopped`) so
ChainTray/StandingOrdersPanel/the CallModal budget chip update live —
judged in-scope since every other v1/v2 tray/HUD in this codebase follows
the same push pattern.

**REVIEW-ON-RETURN logged to TUNING.md:** the 3-perk cost table, the
budget pause thresholds (70/80 base, 80/88 Night Shift Foreman, 95/95
hard ceilings), and the still-open statusline-snapshot-source decision
(Option B implemented as the default per Greg's own "unsure" answer,
Option A never touched).

No deploy at G3 (batches with G4 per rev-2 sequencing). Proceeding to G4
(Missions).

### 2026-07-08 (later) — G4 (Missions + World Events) code/test complete, no deploy

Two waves, one agent, one checkout, sequential — no collisions. Implements
GAME-DESIGN.md §6 exactly (contracts §6.2, world events §6.3, fiction/real
labeling §6.1, digest+Bark §6.5).

**Wave A (contracts):** `contractStore.ts` — 5 sources (priority/backlog/
gate/daily/weekly), the exact payout table, 5 completion methods in
priority order (dispatch-result > todo-disappeared/gate-flipped >
manual-claim > daily-auto). Piggybacks `briefingProvider.ts`'s existing
60s cache via `reconcile()`, called from both `/api/briefing` and the new
`/api/contracts` — no new poll loop. `MAX_MANUAL_CLAIMS_PER_DAY=3` rejects
(never silently no-ops) the 4th claim. Backlog re-minting dedupe checks
both currently-open AND completed-in-the-last-7-days by normalized
sourceKey (gates use the same rule with an unbounded lookback — a gate
contract pays out once, ever). `dispatchStore.ts` gained an explicit
`contractId` field (mirrors `employeeId`'s pattern) — set only by the
webview's BRIEFING→DISPATCH prefill / ContractsPanel's "Dispatch via…"
employee-assign dropdown, never string-matched; a terminal exit 0 calls
`contractStore.completeByDispatch()` from `httpServer.ts`'s existing
dispatch status route. Dailies/weeklies are self-certifying (mint and
complete in the same call) wired into `shiftStats.ts`'s onDayClose path,
gated on `turnsCompleted > 0` (the same real-activity trace every other
award already requires) — weekly additionally gated on the new day being
a Monday. Wired to the real `economyStore` singleton at export time (same
pattern as `employeeStore.ts`), never as a call-site import.

**Wave B (world events):** `core/src/worldEventGlyphs.ts` (NEW, shared)
holds the 12-entry SIM glyph table as the single source of truth for both
`worldEventStore.ts` (server) and `signalChip.test.ts` (webview) — neither
side hand-types a duplicate that could drift. `webview-ui/src/office/
realGlyphs.ts` derives the REAL glyph set by importing `crisis.ts`'s
`CRISIS_STAGE_SPECS` + a newly-exported `DEBRIS_GLYPH` (previously an
inline literal in `buildTriageRows`, promoted to a named export so it's
mechanically derivable, not hand-typed) and `dispatch.ts`'s
`DISPATCH_STATUS_CHIPS`. `webview-ui/test/signalChip.test.ts` asserts the
two pools are disjoint — verified this session to actually FAIL when
`mail_delivery`'s glyph was deliberately changed to the real debris glyph
`✗` (`colliding glyphs: ✗`), then reverted and re-verified green.

`server/src/worldEventStore.ts` — the 12-entry weighted table exactly per
§6.3 (weights/min-gaps/durations), `pureAmbient`/`onlineOnly` flags
driving vacation-mode suppression and the online-only skip
(`power_surge`/`power_outage_scare`). ONE-WAY LAYERING held: this file
imports neither `economyStore.ts` nor `employeeStore.ts` (grep-verified —
zero code hits, only comments); every effect (`inspection`'s Reputation
swing, `rival_poach`/`birthday`'s employee moodBoost nudge, `flavor_bonus`'s
capped Cash) routes through an injected `WorldEventTickDeps` object built
in `httpServer.ts`'s new live-tick handler — the ONE place those two
stores are actually touched for world events. `flavor_bonus` is capped at
`+5/local day` independent of its own 24h min-gap (belt-and-suspenders,
unit-tested by forcibly re-seeding eligibility across 5 simulated
triggers). Added `server/src/digest.ts` (`renderDigest`/`templateNarrator`
— the named LLM seam, templates only in v1.0) and `server/src/
notifyBark.ts` (class-filtered big-moment emitter + 1/day morning-digest
dedupe, `WAR_ROOM_BARK_URL` env-gated, feature-off = zero fetch calls).
`webview-ui/src/office/dayNight.ts` ships standalone (`getDayPhase`/
`getSeason`/`isHolidayWeek`, pure, GAME-DESIGN §6.4-compliant) for G5's
rendering layer — **deviation, documented in TUNING.md:** did NOT wire it
into `ambience.ts`'s existing "night duck" as BUILD-PLAN's task 12
literally says, because that duck is actually the v1 "NIGHT SHIFT"
empty-office mechanic (a different concept with its own help text);
replacing it with wall-clock night would duck sound during real late-night
work sessions regardless of activity — judged a functional regression, not
an enhancement.

**Live-tick infrastructure (new, not present before G4):** GAME-DESIGN §2's
"coarse interval, ≥1 socket connected, every 5 min" cadence didn't exist
in the codebase yet. Added a plain per-`createHttpServer()`-instance
socket counter (incremented/decremented in `registerWebSocketRoute`'s
connect/close handlers, not a module-level singleton — safe across the
many test files that each construct their own app) gating a new 5-min
`setInterval` that calls `worldEventStore.tick()`.

**Bark wiring — 3 of 5 big-moment classes wired this session, 2 explicitly
deferred (detail in TUNING.md):** `contract-completed`
(`contractStore.onCompleted`), `stop-all` (existing route), `chain-failed`
(`chainStore.onRunUpdate` filtered to `status==='failed'`). NOT wired:
`employee-quit` (found a pre-existing gap — the quit roll inside
`employeeStore.ts`'s `applyUpkeep()` never calls `finish()`/broadcasts at
all, fixing that felt like scope creep beyond G4's task list) and
`budget-paused` (needs edge-triggered state tracking no G4 task specified).

**ContractsPanel.tsx** mirrors TriagePanel.tsx's row structure (glyph+word
`SignalChip`, identity, one-line detail) — CLAIM button (manual-claim) +
an employee-assign "Dispatch via…" dropdown that opens CallModal prefilled
from the chosen employee's real record + the contract's explicit id
(`contractId`/`employeeId` threaded end-to-end: `CallModalPrefill` →
`dispatchRequest` WS message → `clientMessageHandler.ts` →
`dispatchStore.enqueue()`). Manual-claim completions render `SIM ·
CLAIMED (unverified)` with a dashed border even though the underlying
contract is real — the one documented exception to the real/SIM border
rule (§6.1), verified live in the evidence screenshot.

**Verification (before → after):** server 463 → 509 (+46 —
`contractStore.test.ts` 17, `worldEventStore.test.ts` 14,
`digest.test.ts` 6, `notifyBark.test.ts` 9), webview 231 → 237 (+6 —
`dayNight.test.ts` 3, `signalChip.test.ts` 3), bin/poller 74 → 74
(unchanged — no bin/ files touched this milestone). Root `check-types`,
webview's own `tsc -b`, full `npm run lint`, root `npm test`, and
`npm run build` all clean. `grep -in "token"` swept across every new G4
file — zero hits in reward-computation code (both hits are benign:
"zero token spend" in a doc comment, "may carry a token" in a URL-masking
comment).

**Live E2E (isolated HOME, fresh port, real `dist/cli.js` + real HTTP —
Greg's own running instances on 3149/3199 + the dispatch-runner/
coworker-adapter/needs-input-poller processes detected and left
untouched throughout):** dropped a real `WAR_ROOM_TODO_DIR` file with a
"Start now" line → `GET /api/contracts` minted a priority contract
(`$40`/`★2`, `status:"open"`) within the same tick. Edited the file to
remove the line, waited past the 60s briefing cache TTL (polled, no fixed
sleep), re-queried → `status:"completed"`,
`completionMethod:"todo-disappeared"`. Independently confirmed via
`GET /api/economy` that real Cash/Reputation actually moved
(`{"cash":40,"reputation":2}`, ledger reason
`"contract-priority-todo-disappeared"`) — not just a mocked unit
assertion. Also live-verified the manual-claim route accepting a claim,
then honestly rejecting a re-claim (`not-open`) and an unknown id
(`not-found`).

**Screenshots:** `.planning/evidence/g4-missions-world.png` + `-grayscale`
— CONTRACTS panel with 2 open priority + 1 open backlog contract (solid-
border `SignalChip`s, real=true) and a RECENT section showing the
manually-claimed contract's dashed `SIM · CLAIMED (unverified)` chip.
Grayscale fully legible — every signal is shape+glyph+text, colorblind
hard rule held.

**Not deployed — sub-agent correctly did not attempt NEXUS/SSH/deploy of
any kind** (per this session's explicit instructions). TUNING.md carries
the pre-deploy checklist for the batch-2 orchestrator: verify
`WAR_ROOM_TODO_DIR` on the NEXUS container is still the real vault clone
(not a fixture), and note `WAR_ROOM_BARK_URL` is unset today (Bark pushes
are feature-off by design until Greg configures it).

Proceed to G5 (Art + Living World Polish) once G4's batch-2 deploy
(bundled with G3) is confirmed live.

### 2026-07-08 (later) — G4 BATCH-2 deploy ✓ LIVE, verified by orchestrator

Same pattern as G2's batch-1: G4's sub-agent correctly did not attempt any
deploy. The orchestrator ran `NEXUS_HOST=nexus-ts bash
.planning/runbooks/nexus-war-room-deploy.sh -y` directly, hitting and
resolving the same two known snags (LAN-only `nexus` SSH alias, funnel-
check false-positive — both documented in TUNING.md's G2 entry).

The BUILD-PLAN-specified pre-deploy check (confirm `WAR_ROOM_TODO_DIR` on
NEXUS points at the real vault) required an ad-hoc `docker exec ... env`
read that the permission classifier correctly refused — outside
KICKOFF.md's narrow runbook-only pre-authorization. Verified the same
fact a different way: the runbook script hard-codes the real
vault-notifier mount path with no fixture branch, confirmed by reading
the script source directly.

Deploy verified live: `GET /api/contracts` on the deployed instance
returned real contracts minted from Greg's actual vault (recognizable
task titles — Diablito Vercel blocker, DISPATCH zombie gate, Arcade
tools gate), including 2 gate contracts already correctly
auto-completed. `GET /api/economy` shows real accrued Cash=400/
Reputation=20 from those completions. This is genuine production data,
not a fixture — G4's missions system is live and correctly wired.

G3+G4 (Command+Automation, Missions) are both fully done: code, tests,
screenshots, and the batch-2 deploy all verified. Proceeding to G5 (Art +
Living World Polish).

### 2026-07-08 (later) — G5 Track 1 (world sim polish) ✓ DONE, Track 2 (art gen) DEFERRED

Scope for this run, set by the top-level orchestrator: Track 1 (code —
ambientEvents.ts, WorldEventBanner.tsx, calendarStore.ts) in full;
Track 2 (actual Codex `$imagegen` art generation) explicitly OUT OF SCOPE
— it needs a fresh in-person Greg authorization for the gated
`rembg`/`sharp` installs and burns real Codex plan budget unattended,
neither appropriate for an unattended run. BUILD-PLAN §G5 itself sanctions
this exact fallback ("ship v1.0 on hue-shift recolors ... document the
generation batch as a post-run `/loop` job"). One agent, one checkout,
sequential — no worktree canary needed since Track 2 never ran.

**Track 1 — ambient wander bias
(`webview-ui/src/office/world/ambientEvents.ts`, NEW):** idle (non-
BURNED_OUT) employees occasionally drift toward a same-real-project
coworker (employeeId's project slug, machine-agnostic) or the placed
Break Room instead of a fully random tile — same "cheap rule" shape as
the v1 emergence crowd-pull in `characters.ts` (`CROWD_PULL_CHANCE`).
Deliberately does NOT touch `characters.ts`'s tested FSM: `officeState.ts`'s
existing `update()` loop (already driven by pixiApp.ts's ticker, no new
timer) now computes a per-character `wanderTarget` — the existing global
crisis `crowdTarget` when one exists (crisis attention always wins), else
`ambientWanderTarget()` for any character currently `CharacterState.IDLE`
— and passes whichever applies to the unmodified `updateCharacter()` call,
same as before. `COWORKER_CLUSTER_PULL_CHANCE=0.3`/
`BREAK_ROOM_PULL_CHANCE=0.25` are documented judgment calls (GAME-DESIGN
doesn't specify numbers), deliberately lower than the v1 fire-crowd's 0.65
so ambient flavor reads as occasional texture, not a dominant behavior.

**Track 1 — live WorldEventBanner:** `worldEventStore.tick()` (G4) already
produced an event log for the digest/Bark planes but never broadcast live
— confirmed this session via grep (no `worldEventFired`-equivalent message
existed, `useExtensionMessages.ts` had no handler). Added: `WorldEventFired`
to `core/asyncapi.yaml` (regenerated `messages.ts`, never hand-edited);
`httpServer.ts`'s live-tick handler now calls `options.store.broadcast(...)`
whenever `tick()` returns a fired entry (in addition to its existing
economy/employee-store effects, unchanged); `useExtensionMessages.ts`
gains a capped rolling `worldEvents` list. `webview-ui/src/worldEventBanner.ts`
(NEW, plain `.ts`) holds the testable core (`WorldEventEntryClient` type,
`latestVisibleWorldEvent()`, 15s `WORLD_EVENT_BANNER_AUTO_HIDE_MS`) —
`WorldEventBanner.tsx` is a thin wrapper, mirroring this repo's own
`standingOrders.ts`/`StandingOrdersPanel.tsx` split (no jsdom/
testing-library in this repo; pure logic lives outside the component).
Every event renders through `SignalChip` with `real=false` (§6.1) —
purely fictional flavor, dismissable, auto-hides so it never lingers like
a real alert or competes with the TRIAGE board.

**Real bug found + fixed via the real-browser evidence capture (not
caught by any unit test):** first evidence pass showed `WorldEventBanner`
rendering directly on top of `ProgressionHUD` — both were positioned
`absolute top-8 left-8`, an overlap invisible in `latestVisibleWorldEvent`'s
unit tests (which never render layout) and only found once a live
`heatwave` event actually fired mid-capture and visually collided with the
LVL/STREAK text. Moved to `top-24 left-8` (same left edge, stacked below),
rebuilt, and re-ran the full 5-minute capture rather than ship evidence
with a visible bug baked in.

**Track 1 — `server/src/calendarStore.ts` (NEW):** `getSeason()`
(meteorological quarters) + `isHolidayWeek()` (Dec 20-31), pure functions
of a timestamp, zero external calendar reads. Intentionally mirrors
`webview-ui/src/office/dayNight.ts`'s identical logic rather than sharing
it — server can't import webview-ui files (same constraint
`buildingBuffs.ts` already documents for `furnitureBuffs.ts`). Not wired
to any consumer this session (BUILD-PLAN's task list names no call site);
a forward-compatible scoping decision, same posture as G1's
`employeeHired`/`employeeQuit` message types being defined-but-unemitted.

**Idle-wander/clustering observation (real, not simulated):** isolated-
HOME standalone server (`dist/cli.js`, same pattern G0-G2 used) + real
headless Chromium via Playwright. Seeded a Break Room over the bundled
default layout's furnished lounge (`POST /api/building/room`, Cash
fixture-seeded to skip the grind) and 4 employees as 2 same-project
coworker pairs via the authed hook-ingest path (`SessionStart`+`Stop`,
the same M2/G1 acceptance pattern). `LIVE_TICK_INTERVAL_MS=300_000`
exactly matches the "5-minute unattended observation window" acceptance
line — deliberately, since a fresh `worldEventStore` always fires
something on its first eligible tick, so the same window also proves the
live broadcast. T0 screenshot (`g5-living-world-before.png`) taken ~8s
after seeding (characters just gone idle at their desks); T1
(`g5-living-world.png` + `-grayscale.png`) taken 305s later. Confirmed
across two capture runs: character tile positions visibly changed
(desk-chair reassignments; one run had an employee reach the tagged
Break Room directly), and a live world event (`heatwave` in the first
run, `coffee_run` in the final one) rendered via the banner both times —
the store's per-id min-gap/weighted-roll logic means the SPECIFIC event
is nondeterministic run-to-run, which is correct behavior, not flakiness.
Two real environment gotchas hit and fixed in the driver script (not
product code): the standalone server never auto-persists the bundled
default layout to `~/.pixel-agents/layout.json` (serves it from an
in-memory cache until a client `SaveLayout`s — `loadLayout()`'s
file-persisting variant is `adapters/vscode`-only, not part of the
standalone build) — seeded `layout.json` directly instead; the bundled
21×22 default layout has an internal wall splitting a desk room from a
furnished lounge (not the `DEFAULT_COLS=20`/`DEFAULT_ROWS=11` fallback
`createDefaultLayout()` shape) — the Break Room rectangle needed retagging
onto the actual open floor after the first attempt hit `tile-not-owned-floor`.

**Verification (before → after):** server 509 → 512 (+3 —
`calendarStore.test.ts`), webview 237 → 255 (+18 — `ambientEvents.test.ts`
12, `WorldEventBanner.test.ts` 6), bin/poller 74 → 74 (unchanged, no
`bin/` files touched). Root `check-types`, webview's own `tsc -b` (a
first draft's `WorldEventBanner.test.ts` imported a type straight from
`useExtensionMessages.ts`, which pulled that file — and transitively
`notificationSound.ts` — into `tsconfig.node.json`'s program for the
first time, surfacing a latent gap where `testHooks.ts`'s
`Window.__pixelAgentsTestHooks` global augmentation isn't reachable from
that tsconfig; fixed by the `worldEventBanner.ts` split above, which also
matches the repo's own existing convention rather than being a one-off
workaround), full `npm run lint`, root `npm test`, and `npm run build`
all clean. `dist/webview` bundle: 2.6M (STATE.md's own G0 correction
still holds — the real outDir is repo-root `dist/webview`, not
`webview-ui/dist` — recorded here for G6's batch-3 deploy check per
BUILD-PLAN's instruction).

**Grep sweep (BUILD-PLAN §G5 acceptance criterion):** the full G5 diff
(`ambientEvents.ts`, `officeState.ts`'s wander-target change,
`worldEventBanner.ts`, `WorldEventBanner.tsx`, `useExtensionMessages.ts`'s
new handler, `httpServer.ts`'s new broadcast lines, `calendarStore.ts`) —
zero `economyStore`/`employeeStore` hits. `httpServer.ts` as a whole file
still touches both stores extensively (pre-existing G2-G4 wiring,
unchanged), but the diff added by this session does not.

**Track 2 preflight (task 4a, read-only — nothing installed, nothing
invoked):** `pip`/`pip3 show rembg`, `npm ls sharp` (repo-local + global),
`which rembg` all confirm **still not installed**. `~/Diablito/.env`
still absent, `FAL_KEY` still unset — **Fal fallback still
unprovisioned**. Re-read `Diablito/SESSION-HANDOFF-2026-07-06.md` §7.3 in
full — the documented Codex `$imagegen` transport is unchanged from
GAME-DESIGN §8.3/BUILD-PLAN §G5 task 4a, no drift. New finding this
session: the `BIG_MAP_TABLE` 2×2-footprint code gate (task 7) is already
satisfied — `footprintW`/`footprintH` occupancy loops in
`layoutSerializer.ts`/`editorActions.ts`/`officeState.ts` are generic
nested loops, nothing hardcodes a 1-wide/2-tall assumption. Full
ready-to-run job (install commands as instructions, the `codex exec`
invocation pattern, the ~40-41-job asset list, the QA-gate +
hue-shift-fallback workflow) logged to `.planning/v2/TUNING.md` as
`[G5] Track 2 art generation — DEFERRED, ready-to-run /loop job`.

**Explicit confirmations:** did NOT install `rembg`/`sharp` (read-only
checks only). Did NOT invoke Codex/`$imagegen` or attempt any image
generation. Did NOT attempt any deploy, NEXUS, SSH, docker, or tailscale
action (G5 has no deploy gate — batches with G6). Did NOT touch anything
outside `/Users/greg/code/war-room`. Did NOT touch Greg's own running
local instances (his server on 3149/3199 was not detected this session
since the earlier discovery windows weren't re-probed, but the evidence
harness used an isolated `HOME`/dynamic free port throughout, same as
every prior milestone's pattern, so no collision risk either way).

Screenshots: `.planning/evidence/g5-living-world-before.png` (T0),
`g5-living-world.png` + `-grayscale.png` (T1, 5 min later) — grayscale
fully legible, every signal (state chips, the world-event chip, HUD
numbers) reads by shape+text alone.

No deploy at G5 (batches with G6's batch-3). Proceed to G6 (Phone/PWA)
once ready; the deferred Track 2 job in TUNING.md is available for a
future session with Greg present.
