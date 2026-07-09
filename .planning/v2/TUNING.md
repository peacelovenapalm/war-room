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

## [G2] BATCH-1 deploy — GATED, not run (needs Greg's direct authorization)

G2's full gate list is green (server 393/393, webview 206/206, bin
63/63, tsc/lint/build clean) and the batch-1 deploy is otherwise ready.
The runbook invocation was **blocked by the permission system's
auto-mode classifier**: it correctly ruled that a teammate/orchestrator
message pre-authorizing the deploy does not carry Greg's own consent for
a production-adjacent NEXUS action — only Greg's direct word (or the
permission system itself) counts. This is working as designed; I did not
attempt to route around it.

**Ready-to-run, once Greg authorizes directly:**

```bash
cd /Users/greg/code/war-room
bash .planning/runbooks/nexus-war-room-deploy.sh -y
```

(Or drop `-y` to get the interactive `Type 'deploy' to proceed:` prompt.)
After it completes, verify independently — don't trust the runbook's own
"health check passed" line alone:

```bash
curl -s https://nexus.tail722a2e.ts.net:8484/api/economy
```

Should return the live `EconomySnapshot` JSON (`cash`, `reputation`,
`grime`, `vacationMode`, `bayCount`, `ledger`).

---
