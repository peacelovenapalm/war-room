# STATE v4 — run ledger (machine-updated, newest log entries first)

status: IN PROGRESS <!-- IN PROGRESS | RUN COMPLETE | BLOCKED-AWAITING-GREG -->

Contract: `.planning/v4/KICKOFF-v4.md` (approved by Greg via /goal 2026-07-11;
EDITS: none; Mini Q2 = hand-edit dispatch.json; Mini Q3 = interruptible, no
caffeinate). Decisions ground truth: `DEBRIEF-REGISTER-2026-07-10.md`.
Baseline: war-room/v3 @ 287d779, deployed NEXUS = 645caf4, Mini dispatch
path live.

## Items

| #   | Item                                                            | Status                              | Evidence                                                                                                                      |
| --- | --------------------------------------------------------------- | ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| 0.1 | Ledger + LOOP-LOCK + baseline gate re-derivation                | in-progress (baseline gate running) | lock claimed pid 13670 session 66f5e360 2026-07-11T05:58Z (prior pid 30300 verified dead); origin war-room/v3 = local 287d779 |
| 1.1 | T1 server ingest: POST /api/agents/output + resolution          | pending                             |                                                                                                                               |
| 1.2 | T1 tail[] instruction plane (subscribe→enqueue, poll drain)     | pending                             |                                                                                                                               |
| 1.3 | T1 runner tailer daemon (bin/transcript-tailer.mjs) + runbook   | pending                             |                                                                                                                               |
| 1.4 | T1 usage extraction runner-side → real TOKENS everywhere        | pending                             |                                                                                                                               |
| 1.5 | T1 e2e remote-tail fixture + drawer/HUD wiring verification     | pending                             |                                                                                                                               |
| 1.6 | PHASE 1 GATE: full gate re-derived by orchestrator              | pending                             |                                                                                                                               |
| 2.1 | T2 REMOTE-ANSWER-DESIGN.md (Fable-authored)                     | pending                             |                                                                                                                               |
| G-1 | GREG GATE — approve T2 design before any T2/T4 code             | pending                             |                                                                                                                               |
| 3.1 | T3 rung 1 — Ops Advisor (read-only, receipts cite raw events)   | pending                             |                                                                                                                               |
| 3.2 | T3 rung 2 — one-tap gated proposals via existing verbs          | pending                             |                                                                                                                               |
| 3.3 | T3 rung 3 — auto with guardrails, whitelist ships EMPTY         | pending                             |                                                                                                                               |
| 3.4 | T5 fleet controls + budget ladder                               | pending                             |                                                                                                                               |
| 3.5 | PHASE 3 GATE: full gate re-derived by orchestrator              | pending                             |                                                                                                                               |
| 4.x | T6/T7/T8 riders as capacity allows (roll forward if cut)        | pending                             |                                                                                                                               |
| G-2 | GREG GATE — deploy (runbook one-liner) + real-device acceptance | pending                             |                                                                                                                               |

Settled-state rules (v1.1 protocol, unchanged): `pending` /
`in-progress (<what remains>)` / `done (<pass evidence>)` /
`review-on-return (<TUNING.md anchor>)`; `done` and `review-on-return`
are SETTLED and never re-opened. Every phase-end gate is re-derived by
the orchestrator directly, never trusted from agent reports. No deploys
by the agent — Greg-run only.

## Log

<!-- one line per event: ISO time — what happened / what's next -->

- 2026-07-11T05:59:00Z — RUN OPENED. /goal received = contract approval (KICKOFF-v4 as written; Mini Q2 hand-edit, Q3 interruptible/no-caffeinate). Read in full: KICKOFF-v4, DEBRIEF-REGISTER (D-1…D-48), MINI-COMPUTE-NODE, REMOTE-TAILER-DESIGN (T1 starting point), STATE-v2.0 (format), evening handoff, repo CLAUDE.md. Stale LOOP-LOCK (pid 30300, dead) reclaimed as pid 13670. Verified: war-room/v3 local = origin = 287d779, tree clean. NEXT: baseline gate re-derivation (background) + Phase 1 decomposition + Sonnet lane launch.
