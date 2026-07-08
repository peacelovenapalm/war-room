# Session Handoff — 2026-07-08 — v1 fun layer + dispatch vertical COMPLETE

## 1 · Verified current state (live commands, end of session)

- **Branch `war-room/v1`** — HEAD `a240e52`, 52 commits from `war-room/v0`,
  tree clean, **UNPUSHED** (per contract).
- **NEXUS container (uptime ~2.6 h at check):** serves the FUN-LAYER build —
  `/api/shift` returns the new `{today,…}` shape ✓, `/api/briefing` returns
  REAL vault todos ✓ (`WAR_ROOM_TODO_DIR` is set on the container). But
  `/api/dispatch/machines` falls through to the SPA HTML → **the dispatch
  vertical + pid wiring are NOT deployed yet** (built after Greg's redeploy).
- **MACBOOK:** hooks live (pre-X-Pid forwarder), `needs-input-poller` +
  `coworker-adapter` launchd agents both running (exit 0).
- **MINI:** hooks live (hook.sh present, pre-X-Pid), poller + adapter launchd
  agents both running — Greg completed all MINI installs this session.
  MINI's `~/code/war-room/bin` predates `dispatch-runner.mjs` (shipped before
  wave 1) — re-ship needed.
- **Gates at HEAD (run by orchestrator, this session):** server 320/320,
  webview 139/139, bin 57/57, tsc clean, eslint clean, build clean,
  asyncapi valid.

## 2 · Accomplished (commits on `war-room/v1`)

- **Telemetry wiring** (`00bea1c`, `a25c327`): fixed poller launchd runbook
  (fnm-multishell node paths die on reboot; `~/.local/bin` missing from
  plist PATH), authored `install-coworker-adapter-launchd.sh` +
  `ship-to-mini.sh`. All installs subsequently run by Greg on both Macs.
- **Wave 1 fun layer, 3 parallel Sonnet-5 agents** (`11ac623`…`24d3286`):
  shift push (`WAR_ROOM_PUSH_URLS`) + yesterday card + ⚠ STALE marker;
  mechanic #3 progression (server-side XP/streak/unlocks, honest XP only);
  full ambience sound ON-default with honest autoplay state.
- **Wave 2** (`28bdee8`): mechanic #5 decor unlocks (6 items, existing
  sprites, cosmetic-only, UNLOCKS panel).
- **Dispatch vertical 6b, 2 sequential agents** (`18f73cc`…`b9691c9`):
  full plan at `~/.claude/plans/i-have-ran-all-nifty-zebra.md` — server
  queue (TTL, caps, append-only audit), deny-by-default per-machine runner
  daemon + launchd runbook, CALL modal, dispatch tray (`◎ ✓ ⊘ ○ ■` +
  words), BRIEFING todo→DISPATCH bridge, agent detail drawer (machine/cwd/
  session/permission-text/age/tokens + FOCUS + COPY ID).
- **FOCUS pid wiring** (`81f0a0d`…`d3e56e0`): hook.sh sends `X-Pid: $PPID`
  → AgentState.pid → `agentPidUpdate` broadcast → drawer FOCUS enabled.
- **Guardrail fixes:** lint-staged yaml gap (`74d74e8`) after a stash race
  dropped an asyncapi hunk; shared-checkout incidents documented; rule =
  ONE agent per checkout (held for all later waves).

## 3 · In progress

- Nothing mid-edit. Tree clean, all suites green.

## 4 · Deferred / gated

- ✗ **NEXUS redeploy #2** — dispatch + pid wiring invisible until Greg
  re-runs `.planning/runbooks/nexus-war-room-deploy.sh`.
- ✗ **Forwarder refresh both Macs** — re-run `macbook-hooks-install.sh
MACBOOK` / `MINI` (idempotent, token kept) to gain X-Pid → FOCUS.
- ✗ **Dispatch runners** — `ship-to-mini.sh` (MINI lacks the new bin/),
  then `install-dispatch-runner-launchd.sh MACBOOK` / `MINI`, then edit
  each `~/.war-room/dispatch.json` (deny-everything template → real
  providers/roots + `"focus": true`).
- ◷ **Push decision** — v0+v1 still local-only (52 commits unpushed).
- ◷ **Nits:** gemini `-p` headless visibility unverified (call lifecycle
  renders regardless); tsconfig.node.json lacks DOM lib (blocks OfficeState
  test imports — one-line fix when wanted); no component-render test harness
  (pure-logic pattern only); pid absent for coworker sessions (by design).

## 5 · Decisions made

- Full 6b vertical (not MVP slice) + todo bridge in one build — Greg's call.
- Live blocked-session steering OUT of scope — no remote-answer API; drawer
  - FOCUS get you to the right terminal, you answer there.
- Progression server-side; sound full-ambience ON-default; shift push to
  morning page + Bark — Greg's three answers.
- WS `dispatchRequest` (not new unauth HTTP write); runner short-poll with
  allowlist advertisement; machines self-prune 30 s.
- FOCUS is pid-gated and honest — no fake telemetry; X-Pid capture at hook
  time was built rather than shipping a dead button.

## 6 · Next steps (max 3)

1. **(<5 min) Redeploy:** `bash /Users/greg/code/war-room/.planning/runbooks/nexus-war-room-deploy.sh`
   — takes dispatch + drawer + pid live (fun layer is already up).
2. **Refresh + arm both Macs:** re-run `macbook-hooks-install.sh` on each;
   `bash .planning/runbooks/ship-to-mini.sh`; then
   `install-dispatch-runner-launchd.sh` on each; edit both
   `~/.war-room/dispatch.json`.
3. **E2E moment:** dashboard → CALL → `claude -p` at an allowlisted repo →
   watch `◎ ringing → ✓ answered → ■ exited 0`; click a burning agent →
   FOCUS fronts its terminal. Then the M5 soak (= the streak) starts for real.

## 7 · Kickoff prompt (next session, verbatim)

```
Read /Users/greg/code/war-room/.planning/STATE.md (2026-07-08 sections) and
SESSION-HANDOFF-2026-07-08.md. State: war-room/v1 at a240e52 (52 commits,
unpushed, all gates green — server 320/webview 139/bin 57) has the complete
v1: fun layer (crisis/shift/progression/emergence/sound/decor/coworkers) +
dispatch vertical 6b (queue server, deny-by-default runner, CALL modal,
todo bridge, agent drawer, pid-gated FOCUS). NEXUS serves the fun layer but
NOT dispatch (needs redeploy #2); both Macs run poller+adapter; forwarders
predate X-Pid; MINI lacks the dispatch-runner bin.

Task: [pick one] (a) post-deploy E2E verification over the tailnet once
Greg redeploys + installs runners (dispatch round-trip, deny path, FOCUS,
todo bridge); (b) gemini -p headless-visibility check + adapter fix if its
logs don't appear; (c) push decision prep (52 commits, 4 v0 subjects lack
em-dash). Hard rules unchanged: no push, no deploy, colorblind shape+label
first, gated actions → runbooks only, ONE agent per checkout.
```
