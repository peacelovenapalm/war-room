# STATE v2.0 — run ledger (machine-updated, newest log entries first)

status: IN PROGRESS <!-- IN PROGRESS | RUN COMPLETE -->

## Items

| #   | Item                                            | Status  | Evidence |
| --- | ----------------------------------------------- | ------- | -------- |
| 0.1 | Backup push (war-room/v1, war-room/v0, main)    | pending |          |
| 0.2 | State-migrating deploy + token rotation         | pending |          |
| 0.3 | Close v1.1 run (STATE-v1.1 + TUNING hygiene)    | pending |          |
| 0.4 | /api/version (GIT_SHA build arg)                | pending |          |
| 0.5 | GPT-5.6 wiring (codex update + tier + render)   | pending |          |
| 0.6 | Trivial riders (SecondShift cap, Bark classes)  | pending |          |
| 0.7 | Greg-gated (Mac Mini, FOCUS TCC, backup config) | pending |          |
| 0.8 | Calendar hooks (soak ~07-16, M5 mark ~08-08)    | pending |          |
| 1.1 | Mobile forensics → MOBILE-FORENSICS.md          | pending |          |
| 1.2 | V3 design panel → GAME-DESIGN-V3.md + mockups   | pending |          |
| 1.3 | SaaS assessment → SAAS-ASSESSMENT.md            | pending |          |
| G-1 | GREG GATE — design direction pick (Greg-only)   | pending |          |
| 2.1 | asyncapi outputChunk/tailSubscribe + regen      | pending |          |
| 2.2 | Ring buffer store (seq/replay/evict)            | pending |          |
| 2.3 | Subscription-gated WS fan-out                   | pending |          |
| 2.4 | Local JSONL source (fileWatcher → ring)         | pending |          |
| 2.5 | Runner forwarder (coalescing POST output)       | pending |          |
| 2.6 | Remote tailer design (+build if budget)         | pending |          |
| 3   | New face build (webview-v3, parity gate)        | pending |          |
| 4.1 | Adversarial review panels (Claude + codex)      | pending |          |
| 4.2 | Full gate + deploy + /api/version smoke         | pending |          |
| 4.3 | Real-device iPhone acceptance (Greg-only)       | pending |          |

Settled-state rules (v1.1 protocol, unchanged): `pending` /
`in-progress (<what remains>)` / `done (<pass evidence>)` /
`review-on-return (<TUNING.md anchor>)`; `done` and `review-on-return`
are SETTLED and never re-opened. RUN COMPLETE only after handoff →
completion Bark push → then status flip as the LAST write → delete
LOOP-LOCK.

## Log

<!-- one line per event: ISO time — what happened / what's next -->

- 2026-07-10T09:35:00Z — LOOP-LOCK claimed (pid 30300, session f0bbe1e0), STATE-v2.0.md created from KICKOFF-v2.0 template. All six required docs read in full (handoff, KICKOFF-v2.0, KICKOFF hard rules, TUNING, DESIGN-BRIEF-V3, GAMIFICATION-BRIEF, DISPATCH-6B). Verified: origin has ZERO war-room/\* refs (`git ls-remote origin | grep -c war-room` → 0) — 0.1 backup-push premise confirmed live. Local: war-room/v1 @ 91ebcc7 (two docs-only commits past the handoff's 7fdefcc — the /loop + /goal wiring commits, explainable), main @ 928ccd4 tracks origin/main. Next: commit this file, launch preflight while Greg is present, 0.1 push, baseline re-derivation.
