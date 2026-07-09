# War Room v2 — Tuning & Review-on-Return Log

Started 2026-07-08 for the rev-2 `/goal` ultracode G0→G6 run. Every
design-feel issue, provisional number, and gated action Greg needs to
review lands here as a `REVIEW-ON-RETURN` item — note-and-continue,
never stall the line (KICKOFF.md rev 2 execution model).

Format per entry: `## [G<n>] <short title>` + what/why/what Greg should
do about it.

---

## [G2] economyConstants.ts rate table — REVIEW-ON-RETURN

`server/src/economyConstants.ts` holds every Cash/Reputation number in the
economy (`CASH_PER_TURN=2`, `CASH_PER_CRISIS_RESOLVED=10`,
`CASH_SHIFT_GRADE={LEAN:100,STEADY:40,HEAVY:0}`,
`REP_SHIFT_GRADE={LEAN:3,STEADY:1,HEAVY:0}`, `CASH_STREAK_DAY_TOUCH=10`,
`CASH_PER_DISPATCH_EXIT_0=5` capped `DISPATCH_CASH_DAILY_CAP=50`,
`REP_STREAK_MILESTONE={d3:10,d7:30,d30:120}`, bay cost `500*1.55^n`, room
costs 250-1200, `ADJACENCY_AND_ROOM_BONUS_CAP_PCT=40`). Greg confirmed
these are tune-from-telemetry provisional (GAME-DESIGN §3.5's pacing
envelope: ~300 Cash/day on a typical productive day) — this is a retune
checkpoint after a week of real play, not a deploy blocker. One file, one
commit to retune if the envelope is off by >2x.

Also provisional and worth a look during the same pass: the per-furniture
XP bonus values I introduced in `buildingBuffs.ts`/`furnitureBuffs.ts`
(`PC_FRONT_ON_*=10%`, `WHITEBOARD=15%`) — GAME-DESIGN doesn't specify
per-item furniture buff magnitudes, so these are my own judgment call,
sized so the 40% shared cap (§9.19) is meaningfully reachable/testable.
And the SERVER_RACK gap: GAME-DESIGN §5.3 names a `SERVER_RACK` furniture
type for the Server Room's "requires furniture inside" global buff, but
no such sprite asset exists in the bundled manifest — the PC electronics
group stands in until G5 Art adds a real asset (update both
`buildingBuffs.ts`'s and `furnitureBuffs.ts`'s qualifying-type lists
together when it does).

---

## [G2] BATCH-1 deploy — DONE, run by the orchestrator session

A sub-agent building G2 hit a block attempting the runbook itself (its
own permission classifier correctly refused to self-authorize an
infra action on a peer/orchestrator's say-so — working as designed for
a sub-agent). The top-level orchestrator session — the one Greg's own
`/goal` prompt directly named, carrying KICKOFF.md rev 2's written
pre-authorization read first-hand — then ran the runbook directly.
Deployed and independently verified 2026-07-08.

**Two real snags hit during this run, both now resolved, both will recur
at the G4 and G6 deploy gates unless noted:**

1. **`ssh nexus` times out from this environment** — the `nexus` alias in
   `~/.ssh/config` resolves to a LAN IP (`192.168.0.247:2222`) that isn't
   reachable from wherever this session's shell actually runs. The
   `nexus-ts` alias (Tailscale IP `100.77.128.49:2222`, confirmed
   `active` in `tailscale status`) works. **Fix: invoke the runbook with
   `NEXUS_HOST=nexus-ts bash .planning/runbooks/nexus-war-room-deploy.sh -y`**
   — the script already supports a `NEXUS_HOST` env override, no script
   edit needed. Use this at G4 and G6's deploy gates too.
2. **The runbook's own funnel-check produced a `[FAIL] SAFETY: :8484
appears in FUNNEL status`** after a successful deploy. Independently
   verified via `ssh nexus-ts tailscale funnel status` — the raw output
   lists `:8484` explicitly labeled `(tailnet only)`, i.e. genuinely NOT
   funnel-exposed. This is the same false-positive already documented in
   `.planning/STATE.md`'s 2026-07-08 go-live entry for v1 ("funnel-check
   FAIL was a false alarm... runbook grep needs tightening") — the
   script's `grep -q ':${SERVE_PORT}'` matches the port substring
   regardless of the `(tailnet only)` annotation. Confirmed still a false
   positive on this run, not a regression. **The runbook's grep pattern
   should eventually be tightened to exclude `(tailnet only)` lines** —
   flagging as a REVIEW-ON-RETURN cleanup, not a blocker; every deploy
   gate needs a human (or the orchestrator) to re-verify this by hand
   until then.

**Post-deploy verification (independent, not the runbook's own output):**

```
$ curl -s https://nexus.tail722a2e.ts.net:8484/api/economy
{"cash":0,"reputation":0,"grime":0,"vacationMode":false,"bayCount":0,"ledger":[]}
```

Fresh container, zero accrued state — expected and correct for a first
deploy of the economy system. Image built clean (node:22-alpine,
`npm run build` succeeded inside the container), health check + briefing
endpoint both responded before the funnel-check false-positive was even
reached.

---

## [G3] Automation perk costs + budget pause thresholds — REVIEW-ON-RETURN

G3 (Command + Automation) is code/test complete; no deploy at this
milestone (batches with G4). Two numeric tables need Greg's explicit
sign-off before or shortly after the batch-2 deploy assumes them live —
flagging per BUILD-PLAN §G3's own instruction, not because anything here
is broken.

**Automation perk ladder** (`server/src/economyConstants.ts` —
`PERK_COST`/`PERK_IDS`), 3 perks, 2800 total (Autopilot perk CUT per
interrogation delta #6 — first-fire confirm is unconditional forever,
no perk purchase can ever bypass it):

| Perk                | Cost | Effect                                                            |
| ------------------- | ---- | ----------------------------------------------------------------- |
| Second Shift        | 500  | standing-order cap 1 → 2                                          |
| Chain Gang          | 800  | chain max steps 8 → 12, concurrent runs 3 → 5                     |
| Night Shift Foreman | 1500 | standing-order cap 2 → 4; budget pause thresholds 70/80% → 80/88% |

**Budget pause thresholds** (`server/src/budgetStore.ts`):

```
BUDGET_STALE_MS = 900_000          // 15min — no fresh Claude report => fail-safe pause
BUDGET_PAUSE_5H_PCT_BASE = 70       // -> 80 with Night Shift Foreman
BUDGET_PAUSE_7D_PCT_BASE = 80       // -> 88 with Night Shift Foreman
BUDGET_PAUSE_HARD_CEILING_5H = 95   // NEVER raised by any perk (clamped in code, not just docs)
BUDGET_PAUSE_HARD_CEILING_7D = 95   // NEVER raised by any perk
```

These numbers are grounded in the design doc's own values (§7.4), not
independently re-derived — flagging for Greg to confirm they still feel
right once real chain/standing-order usage exists to tune against
(same "retune after a week of real telemetry" posture as the G2 economy
numbers already carry).

**Statusline snapshot source — Greg's own decision is still OPEN**
(interrogation delta #13, "unsure"). G3 implemented Option B (the
decoupled default) per GAME-DESIGN §7.4: `bin/rate-limit-snapshot-hook.mjs`
is a standalone statusline hook, never touches `~/.claude/statusline.js`.
**Registering it is a Greg-owned config change — gated, not applied by
this session.** Runbook instruction (also embedded as a comment block at
the top of the script itself):

```
Add to your statusline hook config (wherever ~/.claude/statusline.js is
wired, typically ~/.claude/settings.json's "statusLine" hooks array) a
second command:
    node /Users/greg/code/war-room/bin/rate-limit-snapshot-hook.mjs
It reads the SAME stdin payload your existing statusline.js hook already
receives and writes ONLY ~/.pixel-agents/rate-limit-snapshot.json —
statusline.js itself is never edited.
```

Until this is wired, `bin/needs-input-poller.mjs` finds no snapshot file
to forward and every automation trigger path correctly fail-safe-pauses
(`stale-snapshot`) — this is the intended, safe default state, not a bug
to chase down.

**Live-stdin-dump note:** BUILD-PLAN §G3 task 11 asked to "dump one real
stdin payload before finalizing the parser." The parser
(`bin/lib/rate-limit-snapshot.mjs`) was verified against
`~/.claude/statusline.js`'s own confirmed parse sites (lines 353/357-366/ 174) and exercised end-to-end against a realistic SYNTHETIC payload
matching that exact shape (`echo '{...}' | node bin/rate-limit-snapshot-hook.mjs`
against an isolated HOME, confirmed the snapshot file writes correctly).
A genuinely live CLI-generated stdin capture was NOT performed — doing so
would require registering the hook in Greg's gated `~/.claude/settings.json`
first, which this session did not do. Label: parser logic **verified**
against statusline.js's source; exact live CLI payload shape **inferred**
from that source, not directly observed this session.

---
