# Session Handoff — 2026-07-11 — v4 Console sprint: Phases 1–3 complete

## 1. Verified current state (live commands, run now)

- **verified** Branch `war-room/v3` @ `e139579`, tree clean (one untracked
  `.planning/v2/LOOP-LOCK`, owned by the live /goal session pid 13670);
  origin in sync at the same SHA (`git ls-remote`).
- **verified** Deployed NEXUS `/api/version` = `645caf4` (via
  `ssh nexus-ts curl 127.0.0.1:3141`) — the v4 sprint is NOT deployed;
  deployed code is still the v3.1-accepted build. Direct tailnet curl from
  this Mac timed out (funnel/tailnet posture — ssh path works).
- **verified** Final Phase-3 gate GREEN, orchestrator-derived this session:
  asyncapi drift clean · types · lint · server 881/881 · webview-ui 293/293
  · webview-v3 315/315 · poller 154/154 · e2e:v3 17/17 · build OK.
- Run ledger: `.planning/v4/STATE-v4.md` — status **BLOCKED-AWAITING-GREG**
  (goal end-state; every item 0.1–3.5 settled `done`, G-1/G-2 open).

## 2. Accomplished this session (all on war-room/v3, all pushed)

- **Phase 1 — T1 remote live-tail plane, code-complete:** server ingest
  `POST /api/agents/output` + remote transcript-path retention + shared
  token accounting (`1ef316c`, fix `a5886a1`); tail-instruction plane
  `remoteTailDemand.ts` + `POST /api/tailer/poll` w/ at-most-once drain +
  advertisement reconciliation (`8558084`); `bin/transcript-tailer.mjs`
  daemon + `line-forwarder` + symlink-safe roots allowlist + launchd
  runbook (`86900f8`, `58b5a1e`, cap prep `f9973d2`); face verification +
  e2e remote-tail spec (`acaf111`, `fac3791`). Codex review round: 6
  findings fixed (`47396ba`, `b5448d5`), 2 → TUNING (`1faf6b7`).
- **Phase 2 — T2 design delivered:** `.planning/v4/REMOTE-ANSWER-DESIGN.md`
  (`47a8520`) — runner-owned tmux only, unmanaged sessions DESK-only by
  construction, one-shot nonces, verbatim receipts, threat model.
- **Phase 3 — T3 ladder + T5 controls, code-complete:** Ops Advisor rung 1
  (`90e465f`, `54a5a7e`), gated proposals rung 2 (`d8d1cf9`, `af2b2b0`),
  auto-executor rung 3 with ships-empty whitelist (`53e1fd1`, `f26959c`),
  T5 time cap + daily ceiling + rate-limit hints (`1a0c765`, `9b41bb4`,
  `4f71917`). Codex review round: 6 findings fixed (`699a735`, `612438d`)
  incl. the headline STOP-ALL-reaches-everything gap; stale standalone
  specs recorded (`f984961`).

## 3. In progress

- Nothing mid-flight in code. The Sonnet lane died twice on ECONNRESET
  during the Phase-3 fix round; the orchestrator finished and committed it
  — no partial work remains (`git status` clean).

## 4. Deferred / gated

- **G-1 (Greg):** approve `.planning/v4/REMOTE-ANSWER-DESIGN.md` → unblocks
  T2 Phase B + T4 build (managed tmux sessions, phone-answer, session
  launch). No T2/T4 code exists.
- **Deploy + T1 acceptance (Greg):** runbook one-liner below, then install
  the tailer on MACBOOK: `bash .planning/runbooks/install-transcript-tailer-launchd.sh`.
  Acceptance = phone opens a MACBOOK session drawer → live tail + real TOKENS.
- **Phase 4 riders (roll forward per contract):** T6 aesthetics (sprite
  diversity, gestures, bubbles, camera panels, soundscape), T7 integrations
  (morning, vault feeds, districts, WIRING.md), T8 Mini compute node
  (`"shell"` provider per MINI-COMPUTE-NODE.md).
- **TUNING review-on-return (3):** X-Machine↔token binding (fleet-wide,
  pre-existing), restart replay ≤5min window, 4 stale standalone e2e specs
  (selector drift, `.planning/v2/TUNING.md` bottom entries).

## 5. Decisions made (one-liners)

- Usage extraction server-side from the tailer's raw lines, not
  runner-side — one parser, never forked (design-doc principle).
- `fromStart` derived from `everIssued`, not hardcoded — covers
  late-resolving transcript paths (lane deviation, accepted).
- Per-dispatch TOKEN cap not built — genuinely unmeasurable for CLI runs;
  honesty over feature-count (daily ceiling uses the real aggregate).
- STOP ALL now suppresses the auto-executor + HELD auto-releases; a human
  /release override deliberately still beats the kill switch.
- 4 standalone e2e failures adjudicated pre-existing (empty sprint diff on
  webview-ui + e2e/tests) — recorded, not fixed, line never stalled.

## 6. Next steps (max 3)

1. **Read + approve/edit the T2 design** — open
   `.planning/v4/REMOTE-ANSWER-DESIGN.md` (5-min read; the gate blocking
   the sprint's #2 track).
2. **Deploy + accept T1:**
   `! cd /Users/greg/code/war-room && NEXUS_HOST=nexus-ts bash .planning/runbooks/nexus-war-room-deploy.sh -y`
   then the MACBOOK tailer runbook, then phone-check a live tail.
3. Kick Phase 4 (or T2 Phase B post-approval) with the prompt below.

## 7. Kickoff prompt (next session, cwd /Users/greg/code/war-room)

```
Continue the War Room v4 Console sprint. Ground truth:
.planning/v4/STATE-v4.md (Phases 1–3 done, gate green @ e139579;
BLOCKED-AWAITING-GREG) + .planning/v4/KICKOFF-v4.md. Verify repo/deploy
state with git log + ssh nexus-ts curl 127.0.0.1:3141/api/version before
trusting the ledger. My gate answers: [G-1 T2 design: APPROVED / edits: …;
deployed: yes/no; T1 acceptance: pass/fail]. Then proceed per the
contract: if G-1 approved → T2 Phase B + T4 (managed-session substrate,
build order at the bottom of REMOTE-ANSWER-DESIGN.md); Phase 4 riders
(T6/T7/T8) as capacity allows. Same rules: Sonnet implements, Fable
orchestrates/verifies, codex reviews each track, full gate re-derived at
phase ends, no deploys by the agent, review-on-return → TUNING.md.
```
