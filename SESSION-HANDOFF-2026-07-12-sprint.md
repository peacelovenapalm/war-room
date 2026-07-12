# SESSION HANDOFF — 2026-07-12 autonomous sprint (RUN-MAP v5)

Executing contract: `.planning/v5/RUN-MAP-2026-07-12.md`. Ledger:
`.planning/v5/SPRINT-STATE.md`. All phases A–F ✓ complete; deployed and
live-verified. Bark success push sent 23:16Z.

## 1. Verified current state (live commands, this session ~23:16Z)

- ✓ `war-room/v3` HEAD = `c841054`, pushed (`origin/war-room/v3` = same),
  tree clean except untracked `.planning/v2/LOOP-LOCK` (left per run map).
- ✓ Deployed NEXUS = `c8410543e0a125…` (`/api/version`, builtAt
  2026-07-12T23:15:53Z) — was `16d7eee` at session start.
- ✓ `/api/districts`: **7 projects, all real `file:` sources, zero
  `source:unknown`** (exit bar was ≥4). TWE shows fresh 2026-07-08 state.
- ✓ Runners green post-everything: MACBOOK lastSeen 0.6 s, MINI 3.2 s,
  both `sessions:true`.
- ✓ `https://nexus.tail722a2e.ts.net:8484/` → 200; funnel check clean
  (tailnet-only); root serves V3 face; `/v3` 301 preserved.
- ✓ Full gate at HEAD before deploy: check-types (now incl. webview-v3),
  lint, server 991, webview-v3 465, webview-ui 294 (via `npm test` chain),
  poller 193, build clean, e2e v3 31/31, standalone e2e 10/10 one pass.
- ✓ `launchctl print` on all 4 MACBOOK war-room LaunchAgents: 0
  occurrences of WAR_ROOM_TOKEN (moved to 0600 `~/.war-room/env`).
- ✓ MINI `~/code/war-room` is a real git clone, war-room/v3 @ `03b52f5`,
  clean tree (see Deferred: one deploy behind HEAD by design).

## 2. Accomplished (each with commits)

- **Phase A — gate integrity (C5)** `afb7c2d`, `b38f421`, `c841054`:
  all SEVEN standalone e2e specs repaired (root cause was the df3a039
  face-merge cutover, not just ControlTooltip titles — 4 extra broken
  specs found and fixed beyond the run map's list). New `gotoLegacyFace`
  helper (`/v1/`), selector repoints, C4-retirement-bound comments.
  webview-v3 added to root `check-types`, proven both ways with a seeded
  type error. 2 pre-existing lint errors cleared. Codex: clean.
- **Phase B — hygiene + hardening (C9+C8)** `9016b4c`, `fff7b06`,
  `4de6330`: durable STOP-ALL server latch (survives server restart AND
  page reload, persisted in the state volume); budget-paused Bark proven
  already-wired; drawer `since=` anchored to blocked-onset (new
  `blockedAge.ts`); nonce + answerRequests TTL/LRU bounds (soak-tested);
  server-side focus validation (audited `focus-rejected` receipts);
  pid-reuse guard via `expectedStartTime` (fail-closed). Codex: clean.
- **Phase C — districts build-out (C1)** `942b521`, `c21dd2c`, `423b831`:
  data-driven `WAR_ROOM_DISTRICTS_DIR` scan replacing the 2-seed proof
  slice (legacy env vars still work, alias-deduped); N-project row-wrap
  world layout + nearest-wins hit-testing in webview-v3. Ops: 6 fresh
  read-only clones under nexus `/data/repos/districts/` (from local
  Gitea), 15-min `war-room-districts-pull` cron, runbook mount block
  wired (replaces d7fa85f's deliberate unwiring). Codex MAJOR
  (twe/two-wheel-events dedupe alias) reconciled.
- **Phase D — infra fixes (Q44)** `090f6f5`, `e5e66be`: WAR_ROOM_TOKEN
  out of all 4 MACBOOK LaunchAgent plists → 0600 env file + wrapper
  (receipts + undo at `~/.war-room/receipts/plist-backups-20260712/`);
  MINI rsync-copy → real git clone (bundle-shipped; old copy preserved at
  `~/code/war-room-rsync-copy-superseded-20260712`); new
  `scripts/mini-drift-check.sh` (live-tested pass AND fail paths).
  Codex: clean, MINOR reconciled.
- **Phase E — documents** `f625715`: `.planning/v5/C3-DESIGN.md`
  (born-managed wrapper, design only — recommends mechanism (d): wrapper
  as WS dispatch client through the existing gate; build Greg-gated) and
  `.planning/v5/ADVERSARIAL-AUDIT-2026-07-12.md` (codex-clean; webview-v3
  XSS open-check closed by grep). Codex MAJOR on C3 mechanism reconciled.
- **Phase F** — full gate at HEAD, whole-sprint codex review (verdict:
  SHIP, prior reconciles independently re-verified), push, deploy
  `c841054`, live verify (all ✓ above), Bark push sent, this handoff.

## 3. In progress

- (none — all phases closed; no dangling worktree changes. Agent
  worktrees under `.claude/worktrees/agent-*` can be pruned next session.)

## 4. Deferred / gated (with unblock conditions)

- **GATED per run map §3, untouched:** C4 old-face deletion (unblocks:
  your on-phone PWA acceptance), C2 sprite pass (attended/loop-batched),
  C6 per-machine tokens (attended), C7 tuning + C10 Mini sessions (you
  physically), C3 BUILD (your design gate — read
  `.planning/v5/C3-DESIGN.md` §6 Greg gates, esp. mechanism (d) vs (c)),
  morning-page absorption, vault PR-gate flip.
- **Token rotation (recommended, attended):** the WAR_ROOM_TOKEN value
  flashed once in a subagent transcript on this Mac before masking
  discipline was established (local-user-visible only, not exfiltrated).
  Rotation bricks runners if misstepped → deliberately left for an
  attended session. Unblock: you + 20 min + re-run hooks installers.
- **MINI plists still embed the token** (Phase D fixed MACBOOK only, as
  scoped). Same 0600-file treatment applies; receipts pattern is proven.
- **MINI clone is one deploy behind** (`03b52f5` vs HEAD `c841054`) —
  its runner bin predates the Phase B nonce-TTL change (compatible,
  polls green). `scripts/mini-drift-check.sh 03b52f5…` passes; against
  HEAD it fails BY DESIGN until the next ship-to-mini. Unblock: bundle
  ship or fix MINI's GitHub auth (it has none — no ssh key, stale gh).
- **C8-6 end-to-end:** pid-reuse guard is live server-side but the
  webview cannot send `startTime` (no wire surface exposes
  `ManagedSessionAd.createdAt` to clients — verified, documented in
  `webview-v3/src/net/answerFacts.ts`). Unblock: add `createdAt` to
  `agentManagedUpdate` broadcast (small, additive protocol change).
- **4 legacy-redirected e2e specs** (hooks/kill/triage/help-discoverability)
  guard the retiring face only; real v3 ports need new instrumentation
  (each spec's comment says exactly what's missing). C4 decides deletion
  vs port.

## 5. Decisions made (one-line rationale each)

- Districts sources = read-only Gitea clones + 15-min cron on nexus;
  war-room's own STATE rides laptop-canonical rsync at deploy (GitHub
  unreachable from nexus; matches the tracker precedent).
- Included 7 projects (not 4): every Gitea repo with a real
  `.planning/STATE.md`; stale-but-real renders honestly with its true
  lastActivity (doctrine: honest staleness ≠ plausible-but-wrong).
- Phase A scope extended to all 7 broken standalone specs because the
  contract's exit line is "standalone smoke green in one pass".
- C3 design recommends launch-through-existing-dispatch (mechanism d)
  over an export refactor: genuine gate reuse, runner stays the single
  manifest writer, dissolves the write race — final pick is yours.
- MINI runner left on `03b52f5` post-deploy: compatible + green, and
  churning live runners right before your phone test was the worse risk.
- No token rotation unattended (bricking risk beats a local-only
  exposure already behind your user account).

## 6. Next steps (max 3)

1. **Phone test (5 min):** open `https://nexus.tail722a2e.ts.net:8484`
   — expect ⌂ DISTRICTS showing 7 real projects, runners green, STOP-ALL
   state surviving a reload.
2. **Read `.planning/v5/C3-DESIGN.md` §6** and gate the born-managed
   build (mechanism (d) vs (c) is the one real fork).
3. **When attended:** rotate WAR_ROOM_TOKEN + de-plist MINI's token
   (receipts pattern in `~/.war-room/receipts/` is reusable).

## 7. Kickoff prompt for the next session

```
Read SESSION-HANDOFF-2026-07-12-sprint.md and .planning/v5/SPRINT-STATE.md
in /Users/greg/code/war-room. State: war-room/v3 @ c841054 pushed and
deployed to NEXUS (live-verified 2026-07-12); phases A-F of
RUN-MAP-2026-07-12 all complete; GATED items untouched. First task:
process Greg's phone-test verdict — if districts/board look right,
prune the .claude/worktrees/agent-* worktrees and pick up the C3 design
gate discussion; if anything looks wrong, the deploy rollback is
`ssh nexus-ts 'docker rm -f war-room'` + redeploy 16d7eee per
.planning/runbooks/nexus-war-room-deploy.sh UNDO notes.
```
