# War Room v2 — Tuning & Review-on-Return Log

Started 2026-07-08 for the rev-2 `/goal` ultracode G0→G6 run. Every
design-feel issue, provisional number, and gated action Greg needs to
review lands here as a `REVIEW-ON-RETURN` item — note-and-continue,
never stall the line (KICKOFF.md rev 2 execution model).

Format per entry: `## [G<n>] <short title>` + what/why/what Greg should
do about it.

---

## [KICKOFF v3.1] Delegation policy AMENDED by Greg (2026-07-10, live) — codex implementer-allowed

Greg's live instruction during the v3.1 sprint ("we can delegate to codex
5.6 sol and to sonnet 5 agents when possible if scope is clearly defined
and work is capable for those models") AMENDS KICKOFF-v2.0 0.5's
"cross-model reviewer/second-opinion ONLY, never implementer" rule for
this sprint and forward: codex may implement clearly-scoped mechanical
chunks behind agent review; Sonnet 5 carries well-scoped implementation
stages; Fable reserves for orchestration, adversarial verification, and
merges. Applied mid-sprint via stage-boundary retiering (A3/A4, B3/B4 →
Sonnet; verifies stayed Fable).

---

## [KICKOFF v3.1] No remote-answer API for interactive sessions — board APPROVE is honest-explainer — RATIFIED by Greg 2026-07-10

WS-A stage 2 verified the wire has NO remote approve gate for blocked
interactive sessions (no ClientMessage, no HTTP route; the needs-input
poller is report-only) — same constraint v1 documented ("live
blocked-session steering is OUT"). Shipped treatment: ✓ APPROVE on
dispatch-gated rows is REAL (runner owns the gate); on interactive-session
rows the verb explains itself ("⊘ NO REMOTE GATE — ▸ DESK → COPY ID /
KILL") instead of faking success; debris ACK has a real 5s undo. **Greg:**
ratify this treatment or fund a remote-answer plane as its own future
project (it is not a panel — it is a new containment surface).

**RATIFIED 2026-07-10 (interactive session):** honest-explainer treatment
stands. Remote-answer plane not funded — remains parked as a possible
future project, not queued.

---

## [KICKOFF v3.1] Phase-4.1 review verdicts + standing rules (2026-07-10)

Containment lens (re-run after a schema-cap failure): NEW server surface
CLEAN — auth parity with the established player-action plane (tailnet +
loopback publish), rework redispatch cannot bypass dispatchStore.enqueue
or the runner allowlist, no todo-dir path traversal (anchored filename
regex), X-Machine boundaries unchanged. One minor hardened same-day
(1681fac): player-suppliable :ids no longer resolve through
Object.prototype (ownRecord guard + dunder regression tests; the three
non-HTTP v3 stores still use bare Records — fold into any future route
exposure). STANDING RULE for panel wiring: verbatim todo/tail text
renders via JSX text interpolation ONLY — never dangerouslySetInnerHTML.

Fix round (35-finding panel incl. codex gpt-5.6-sol lane, 15 verified
cross-model findings): all 3 criticals + 10 majors fixed with
regression tests proven red pre-fix (dd12df3…ef9d30a); two changes
touched hard-rule-adjacent planes UNDER the hard rules' own direction —
(a) contract priority-expiry REP penalty REMOVED (dark-pattern rule),
(b) debris ACK-undo re-keyed by failure instance (a stale ack could
sweep a NEW crisis). Flagging per the loop-gate contract; both moved
TOWARD the rules, neither loosened anything. Known accepted edge
(documented in state/stopAll.ts): a STOP ALL that halted only chain
runs leaves no durable server flag, so a fresh page hydrates
not-stopped; re-pressing is an idempotent re-halt — a durable server
latch is future scope.

---

## [KICKOFF v3.1] Economy items awaiting Greg review (hard-rule-adjacent) — APPROVED by Greg 2026-07-10 (both, as shipped)

Two shipped-but-gated designs need Greg's eyes before they count as
settled: (1) studio-contract reward wiring (bonus-only +25 CASH via
economyStore with receipts; target formula documented in
studioContractIngest.ts — ~2x trailing natural pace); (2) Match Day W/D/L
honest mapping (documented in matchDayDerivation.ts: W = completed +
all-exit-0, L = run failed, D = terminal-not-failed; burn axis always
NO_DATA — no per-dispatch token attribution exists). Both live behind
v3Flags source-data gating; neither touches real functionality.

**APPROVED 2026-07-10 (interactive session):** both designs approved as
shipped — +25 CASH bonus-only contract rewards and the W/D/L mapping
(burn axis NO_DATA) are settled numbers now.

---

## [KICKOFF v1.1] Deploy gates blocked by the harness permission classifier — RESOLVED 2026-07-10

**RESOLVED by the v2.0 run (KICKOFF-v2.0 0.2/0.3):** Greg was present at the
v2.0 kickoff and live-authorized the command classes; all three gates'
accumulated code deployed to NEXUS via the (now state-preserving) runbook.
Deployed SHA verified via the new `/api/version`. Original entry below kept
for the record.

All three KICKOFF-v1.1.md batched deploy gates (after items 1-2, 3-5,
6-9) run `NEXUS_HOST=nexus-ts bash .planning/runbooks/nexus-war-room-deploy.sh -y`.
KICKOFF-v1.1.md's own "Deploy pre-authorization" section grants this in
writing for this run. Gate 1 (after items 1-2, both done) hit a DIFFERENT,
harness-level block: Claude Code's own auto-mode permission classifier
denied the `-y` invocation — "the deploy script is invoked with -y to
bypass its own confirmation prompt against the nexus host with no
preview/dry-run step shown... the generic 'never ask Greg' loop directive
does not name skipping that specific confirmation." This is a real-time
tool-permission gate independent of KICKOFF's own written scope — a doc
pre-authorization doesn't satisfy it, only a live Greg approval click or a
pre-configured Bash permission rule for this exact command would.

Not retried, not worked around (piping a fake "deploy" answer to the
runbook's interactive prompt would defeat the identical guard by another
route). All code for items 1-2 (and later 3-9 + landed F items) is
committed and independently verified regardless — only the NEXUS
container push itself is gated. **What Greg should do:** either (a) run
the exact runbook command above himself when next at the machine, or (b)
add a Bash permission rule allowlisting this exact runbook invocation if
he wants future overnight runs to deploy unattended. All three gates will
hit this same wall; each will accumulate its own settled items behind it
until a deploy actually runs.

---

## [Greg feedback, 2026-07-08 live testing] — NOTE ONLY, next build iteration

Greg's own observations from using the deployed instance directly (not a
sub-agent finding). Explicit instruction: **do not act on these now** —
record for the Fable review pass and the next build iteration after
v1.0 ships. Not gating G6 or the batch-3 deploy.

1. **Crisis card for a permission-denied agent isn't interactive.** When
   an agent hits a permission error, it starts a crisis ("fire") but
   there's no way to click into it to open the agent and give it input —
   the crisis card should be clickable, opening the same drawer/modal a
   normal agent click would.
2. **Breaking visual bug: changing the view or altering room contents
   makes everything disappear until a manual refresh.** Worth checking
   against G2's Pixi `dispose()`/canvas-DOM-detachment fix (`ef5dfa8`) —
   that fix specifically covered the `isEditMode` toggle path; this
   report describes a broader trigger set ("view changed" / "things in
   the room are altered"), so either the fix doesn't cover every
   dispose+recreate trigger, or this is a related-but-distinct instance
   of the same bug class. Needs a fresh repro pass across all the paths
   that call `OfficeCanvas`'s dispose/recreate effect, not just edit-mode
   toggling.
3. **Help section reads as a wall of text** — not something Greg
   references in practice. Needs a UX pass (progressive disclosure,
   search, or trimming to the handful of things people actually look
   up) rather than more content added to it.
4. **Real runtime error, FOCUS feature (pre-existing v1 functionality,
   not new in v2):**
   ```
   [FOCUS] MACBOOK — ⊘ DENIED — focus-failed: Command failed: osascript -e
   'tell application "System Events" to set frontmost of (first process
   whose unix id is 7096) to true'
   ```
   `osascript`-based window-focus is failing on Greg's Mac. Pre-dates
   this v2 run (FOCUS pid wiring shipped in the v1 dispatch vertical,
   see STATE.md's "FOCUS pid wiring" entry) — flagging since it surfaced
   during this session's live testing, not a v2 regression.
5. **No way to stop a single agent's process** — only the global STOP
   ALL (G3) exists. Feature gap, not a bug: clicking an individual
   worker/employee should offer a per-agent stop, distinct from the
   all-or-nothing kill switch.
6. **Progress tracker overlaps the zoom `+` button.** Same bug CLASS as
   the G5 WorldEventBanner/ProgressionHUD overlap (`d8b18df`'s fix,
   `top-8`→`top-24`) — another instance of two absolutely-positioned HUD
   elements colliding at certain viewport/zoom states. Worth a dedicated
   HUD-layout pass across all overlay elements rather than fixing
   collisions one at a time as they're found.

---

## [KICKOFF v2.0 0.7] Greg-gated riders — REVIEW-ON-RETURN (2026-07-10)

Settled as review-on-return by the v2.0 run per KICKOFF 0.7 ("listed,
never a stall"). Three items, all need Greg at a keyboard:

1. **Mac Mini onboarding** — now correctly sequenced AFTER 0.2's token
   rotation, so it installs ONCE with the new token:
   `bash .planning/runbooks/macbook-hooks-install.sh MINI` +
   `bash .planning/runbooks/install-poller-launchd.sh MINI` +
   `bash .planning/runbooks/ship-to-mini.sh` (each prompts for its own
   confirm; token to paste lives in nexus `~/apps/war-room/war-room.env`).
2. **FOCUS/osascript TCC consent** — see the "[KICKOFF v1.1 item 9]" entry
   below for the exact System Settings path + diagnostic (unchanged, still
   open).
3. **NEXUS backup-v2 include** — ✓ DONE 2026-07-10: `~/apps/war-room/state`
   added to nightly-backup.sh tar list (canonical copy Brain2
   scripts/nexus-health/, commit 5eb6e85; installed on NEXUS), `server.json`
   excluded (root-owned 600 + restoring a stale pid registry is the exact
   blank-deploy bug). Verified: manual run rc=0, 16 state files in the
   2026-07-11 tarball.

---

## [2026-07-08 handoff] "Economy state survived across all 3 redeploys" — REFUTED 2026-07-10

The 2026-07-08 session handoff (§ around line 41) claimed economy state
survived three redeploys. The 2026-07-10 audit's critic pass REFUTED this:
`git log -p` across all four historical revisions of
`.planning/runbooks/nexus-war-room-deploy.sh` shows NO state volume ever
existed, and the 2026-07-09 recreate demonstrably destroyed the prior save.
The apparent "survival" was gate contracts auto-re-completing against the
read-only briefing mounts — new state that merely resembled the old.
Deploy-wipes-state stood unqualified until the v2.0 run's 0.2 added the
persistent state volume + migration (commit 2a67f27) and PROVED persistence
with identical economy values across two consecutive recreates.

---

## [KICKOFF v1.1 item 9] FOCUS/osascript — macOS Automation/TCC consent, not a code bug — REVIEW-ON-RETURN (still open, Greg-gated)

Diagnosed live on Greg's MacBook (2026-07-09), per KICKOFF v1.1 item 9's
mandate to capture real stderr before fixing anything. Two candidate root
causes were named: (a) the pid targets the headless `claude` CLI process,
which has no GUI window identity for System Events to front; (b) missing
macOS Automation/TCC consent for the process invoking `osascript`, which
is a GUI permission dialog only Greg can click through.

**Reproduction:** ran the exact `osascript -e 'tell application "System
Events" to set frontmost of (first process whose unix id is <pid>) to
true'` shape against TWO targets — a real running headless `claude` CLI
pid (matching the failure's target type) AND a real running GUI app pid
(`Terminal.app`, PID 4213 at time of test). **Both produced the identical
error after ~60s:**

```
execution error: System Events got an error: AppleEvent timed out. (-1712)
```

Root cause (a) predicts the GUI-app target succeeds while only the
headless-CLI target fails, with a distinct error (e.g. "no such process").
It did not — both hung identically for ~60 seconds before timing out.
This rules out (a) and confirms (b): the process invoking `osascript` has
never been granted Automation consent to control "System Events", so
macOS queues a consent dialog that never gets displayed/dismissed in this
context, and the underlying AppleEvent IPC call blocks until its own
~60s native timeout fires.

**Why Greg's reported error looked different (`Command failed: osascript
-e '...'` with no detail):** `attemptFocus`'s `execAsync` call uses
`FOCUS_TIMEOUT_MS = 5_000` (`bin/dispatch-runner.mjs:85`) — Node kills the
`osascript` child via its own 5s timeout, twelve times faster than the
~60s native AppleEvent timeout ever fires. So in production the child is
SIGTERM'd before it can report its real reason, and `shortErr`
(`bin/dispatch-runner.mjs:588-591`, first line / 200 chars) surfaces only
the generic exec-kill message. My reproduction ran the same osascript
command WITHOUT that 5s wrapper, letting the native call complete and
reveal its true reason. Same root cause either way — this just explains
why the on-screen error text doesn't literally say "AppleEvent timed out".

**Confirmed the real runner is launchd-run, not an interactive terminal
session** (KICKOFF's own suspicion): `~/Library/LaunchAgents/com.war-room.dispatch-runner.plist`
runs `/Users/greg/.local/share/fnm/node-versions/v22.22.3/installation/bin/node
/Users/greg/code/war-room/bin/dispatch-runner.mjs` with `RunAtLoad` +
`KeepAlive`, no bound TTY/window session. A LaunchAgent has no interactive
surface to click through a first-run Automation consent dialog — so this
grant can never happen on its own, no matter how the code is structured.
No code fix exists for this; per KICKOFF item 9's own instruction, this is
a REVIEW-ON-RETURN GUI-consent gate, not an engineering task.

**What Greg should do, exact steps:**

1. Open **System Settings → Privacy & Security → Automation**.
2. Find the entry for **`node`** (the fnm-managed binary at
   `/Users/greg/.local/share/fnm/node-versions/v22.22.3/installation/bin/node`
   — if it isn't listed yet, the toggle won't appear until the LaunchAgent
   triggers the OS's first-ever consent prompt while Greg is logged in and
   present at the physical console to click "OK"; running
   `launchctl kickstart -k gui/$(id -u)/com.war-room.dispatch-runner`
   from an interactive Terminal session right after opening that System
   Settings pane is the most reliable way to force the prompt to surface).
3. Enable the checkbox for **System Events** under that `node` entry.
4. Re-run the FOCUS action from War Room — the fix requires zero code
   changes once consent is granted.

**Ready-to-run diagnostic** (confirms whether consent was granted, safe,
takes ~1s if granted or ~60s if not — run from an interactive Terminal,
not through this harness):

```bash
osascript -e 'tell application "System Events" to set frontmost of (first process whose unix id is '"$$"') to true'
echo "exit: $?"
```

Exit 0 with no output = consent is granted, FOCUS will work as-is. A
60s hang ending in "AppleEvent timed out" = still ungranted, repeat step 2.

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
   **→ RESOLVED 2026-07-10 (v2.0 run 0.2):** the runbook's funnel grep now
   excludes `(tailnet only)` lines (commit 2a67f27); both v2.0 deploys
   reported a clean `funnel check clean` with no false FAIL.

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

---

## [G4] Batch-2 deploy — DONE, run and verified by the orchestrator

Deployed 2026-07-08 via `NEXUS_HOST=nexus-ts bash .planning/runbooks/nexus-war-room-deploy.sh -y`
(same SSH-alias fix as batch-1 — see the `[G2] BATCH-1 deploy` entry
above). The ad-hoc pre-deploy check this section originally called for
(`ssh nexus-ts "docker exec war-room env | grep ..."`) was **correctly
blocked by the permission classifier** — that specific command falls
outside KICKOFF.md's narrow pre-authorization (which covers only the
runbook script itself, not arbitrary SSH/docker reads against the live
host), same posture as every other gated NEXUS action. Verified the
todo-path claim a different way instead: the runbook script itself
hard-codes `TODO_DIR_NEXUS=/data/repos/vault-notifier/vault/vault/
_inbox/routines/todo` (line 36) with no fixture-path branch — every
deploy, batch-1 and batch-2 alike, mounts this exact real path
read-only. No live read needed to confirm it.

**Deploy independently verified live** (funnel-check false-positive
re-confirmed still a false positive via `tailscale funnel status`,
same as batch-1):

```
$ curl -s https://nexus.tail722a2e.ts.net:8484/api/contracts
```

returned real contracts minted from Greg's actual vault — recognizable
real task titles (the Diablito Vercel-billing blocker, the DISPATCH
zombie gate, the Arcade half-built-tools gate, docs-tracker stale-
siblings flag), 2 gate contracts already auto-completed
(`completionMethod:"gate-flipped"`) matching gates that are genuinely
closed. `GET /api/economy` shows real accrued Cash=400/Reputation=20
from those 2 completions, ledger reasons `contract-gate-gate-flipped`.
This is real production data, not a fixture — the pre-deploy concern
this section originally raised is resolved.

**2. Bark wiring — 3 of 5 big-moment classes wired, 2 deferred:**
`server/src/notifyBark.ts` implements the full class-filtered emitter
(unit-tested: class allowlist + daily-digest dedupe). Wired at real call
sites: `contract-completed` (`contractStore.onCompleted`), `stop-all`
(the existing STOP ALL route), `chain-failed`
(`chainStore.onRunUpdate`, filtered to `status==='failed'`). **NOT
wired:** `employee-quit` and `budget-paused`.

- `employee-quit`: found (not introduced) a pre-existing gap —
  `employeeStore.ts`'s quit roll (inside `applyUpkeep()`) never calls
  `finish()`/persists+broadcasts+ledger-appends the same way every
  other mutation does; it only appends to the JSONL ledger directly.
  Wiring a Bark push off a broadcast that doesn't fire would be
  silently dead code, and fixing the underlying emit gap felt like
  scope creep beyond G4's task list — flagging for a dedicated look
  rather than a rushed fix.
- `budget-paused`: needs edge-triggered state (push only on the
  false→true transition, not every paused tick) that neither
  `budgetStore.isAutomationPaused()` nor any G4 task explicitly asked
  for. Deferred rather than guessed at.

**3. `WAR_ROOM_BARK_URL` is unset on NEXUS today** (never configured) —
by design this means zero Bark pushes fire (feature-off posture,
verified: `getBarkUrl()` returns undefined, `push()` no-ops before any
fetch). Setting it is a Greg-owned NEXUS env change, not something this
session touched.
**→ RESOLVED 2026-07-10:** `WAR_ROOM_BARK_URL` is present in
`~/apps/war-room/war-room.env` (key verified live) and a real push through
the deployed instance's notifyBark path returned the 2xx-only "delivered"
log line during the v2.0 run's 0.2 smoke — the Bark plane is live
end-to-end.

**4. Daily/weekly contract flavor titles are a judgment call.**
GAME-DESIGN §6.2 names "12-entry template table" / "4-entry template
table" for dailies/weeklies by COUNT only — no literal titles are given
anywhere in the design doc (unlike the World Event table, which is fully
inlined at §6.3). `DAILY_CONTRACT_TITLES`/`WEEKLY_CONTRACT_TITLES` in
`contractStore.ts` are my own flavor text (12/4 entries, deterministically
picked by date hash) — payout is flat regardless of title, so this is
purely cosmetic and safe to edit freely.

**5. `dayNight.ts`'s ambience wiring — deliberately NOT changed.**
BUILD-PLAN §G4 task 12 says "wire ambience.ts's existing night duck to
getDayPhase() instead of any ad hoc check." The existing "night duck" in
`OfficeCanvas.tsx` (`ambience.setNightMode(characters.size === 0)`) is
actually the v1 "NIGHT SHIFT" mechanic (ducks when the office is EMPTY —
no active sessions), a different concept from this milestone's wall-clock
day/night cycle, and it has dedicated help-modal text describing exactly
that behavior. Replacing it with `getDayPhase()==='night'` would duck the
ambience during real nighttime work sessions regardless of activity — a
functional regression, not an enhancement. `dayNight.ts` ships standalone
(pure, tested, GAME-DESIGN §6.4-compliant) for G5's rendering layer to
consume; the empty-office duck logic is untouched. Flagging in case this
reading is wrong and Greg actually wants the literal wire.

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

## [G5] Track 2 art generation — DEFERRED, ready-to-run `/loop` job

Track 1 (world sim polish — `ambientEvents.ts`, `WorldEventBanner.tsx`,
`calendarStore.ts`) shipped this session, code-only, against hue-shift
recolors of the existing 6 character palettes. Track 2 (actual AI art
generation via Codex `$imagegen`) was explicitly out of scope for this
run — it needs a fresh, in-person Greg authorization for the gated
`rembg`/`sharp` installs, and it burns real Codex/ChatGPT plan budget
3-5x per image turn, which shouldn't be spent unattended. Per BUILD-PLAN
§G5's own sanctioned fallback: v1.0 ships on hue-shift recolors; this
entry is the "documented post-run `/loop` job" it calls for.

**Preflight re-confirmed this session (read-only checks only, nothing
installed or invoked):**

- `pip show rembg` / `pip3 show rembg` → not found. `npm ls sharp`
  (repo-local and global) → empty. `which rembg` → not found. **Still not
  installed**, matching GAME-DESIGN §8.3's prior finding.
- `~/Diablito/.env` → does not exist, `FAL_KEY` not in this shell's env.
  **Fal fallback still unprovisioned.**
- Re-read `/Users/greg/code/Diablito/SESSION-HANDOFF-2026-07-06.md` §7.3
  in full — the documented transport is still accurate: Codex CLI
  `$imagegen` on the ChatGPT subscription, prompt via stdin (a positional
  arg after `-i` gets swallowed as an image path), waves of 6-9 parallel
  `codex exec` jobs, stop-and-report on any rate-limit message. No drift
  from what GAME-DESIGN §8.3/BUILD-PLAN §G5 task 4a already say.
- **New this session:** the `BIG_MAP_TABLE` 2×2-footprint code gate
  (BUILD-PLAN §G5 task 7) is **CONFIRMED already supported** —
  `footprintW`/`footprintH` occupancy loops in
  `webview-ui/src/office/layout/layoutSerializer.ts`,
  `webview-ui/src/office/editor/editorActions.ts`, and
  `webview-ui/src/office/engine/officeState.ts` are all generic nested
  `for (dr < footprintH) for (dc < footprintW)` loops — nothing hardcodes
  a 1-wide or 2-tall assumption. A 2×2 furniture manifest entry
  (`footprintW:2, footprintH:2`) needs no code changes; a future session
  can generate/wire `BIG_MAP_TABLE` without first spiking `tileMap.ts`.

**When Greg is present to authorize installs and watch Codex budget, the
job is:**

1. Install the two gated post-processing tools (ask first, then):
   ```bash
   pip install rembg
   npm install --save-dev sharp   # or install globally if preferred
   ```
2. Per-asset generation, reference-anchored against the existing shipped
   PNG, one `codex exec` call per image/frame-set:
   ```bash
   codex exec --skip-git-repo-check -s workspace-write \
     -i <anchor.png> < prompt.txt > log.txt 2>&1
   ```
   Batch in waves of 6-9 parallel jobs (`&` + `wait`), check logs for
   rate-limit messages between waves, stop and report rather than
   hammering. This matches Greg's own stated preference: "batch the
   sprites around my reset and use /loop on a 6-hour timer until all of
   the images are done" — each `/loop` iteration is one wave, sized to
   the 5h Codex reset window.
3. Asset list (from `archive/sections/07-art-pipeline.md` §2/§3/§5.5 —
   asset tables/prompt templates only; GAME-DESIGN §8.3 wins on any repo
   fact conflict, already reconciled below):
   - `char_N_work.png` — desk-work cycle, NEW file (not a slot reuse —
     GAME-DESIGN §8.3 correction), 112×96/3-row×7-frame grid, all 6
     palettes (N=0..5): 6 jobs.
   - `char_N_celebrate.png` — down-row only, 4-frame, NEW file, all 6
     palettes: 6 jobs.
   - `char_N_break.png` — single-row 112×32, NEW file + NEW decoder export
     `decodeSingleRowCharacterPng` (add, don't modify the 3-row decoder),
     all 6 palettes: 6 jobs.
   - Room/furniture sprites (Section 07 §3's table): `SERVER_RACK`,
     `CABLE_TRAY`, `ESPRESSO_MACHINE`/`VENDING_MACHINE`, `STANDING_DESK`,
     `BIG_MAP_TABLE` (2×2 — code gate now confirmed clear, see above),
     floor tile variants for Server/Break/War rooms: ~9-10 jobs.
   - Weather particle textures (rain streak, snowflake): 2 jobs.
   - Mood/trait badge glyph set (4 mood states + ~7 trait icons from G1's
     badge table, `personaBadges.ts`): ~10-11 jobs.
   - Total ≈ 40-41 generation jobs, budget 2-3x in regens per GAME-DESIGN's
     own risk note.
4. QA gate per asset (extend `webview-ui/test/dev-assets.test.ts`, don't
   create a parallel test path), per BUILD-PLAN §G5 task 10 — before
   accepting into the manifest:
   - Dimension check (exact width/height match).
   - Alpha check (real alpha channel, not a baked checkerboard — confirms
     `rembg` actually ran).
   - Grayscale-distinctness check against any asset it appears alongside
     on screen (colorblind hard rule — reject on >90% silhouette overlap).
   - Decoder smoke test (`decodeCharacterPng`/`decodeSingleRowCharacterPng`/
     `pngToSpriteData`/`decodeFloorPng` — must not throw, must produce a
     non-empty grid of the expected shape).
   - **2 failed regens on the same asset → fall back to hue-shift-
     recoloring an existing sprite** (`adjustSprite`/`hueShiftSprites` in
     `colorize.ts`), logged explicitly as `[x] (FALLBACK: recolored
     <source>)` in `assets-source/_progress.md` — never silently
     substituted, never blocks anything downstream (Track 1's code
     already renders correctly against pure hue-shift recolors, so a
     partial or zero-generation outcome ships fine).
5. Wire each accepted sheet/sprite through the existing asset-loader/
   manifest path (no new pipeline) and re-run the full gate list
   (`check-types`, `lint`, `test`, `build`) before considering the batch
   done.

**Framing:** this is a proposed `/loop`-able job for a future session
with Greg present, not a blocker on G5/G6/v1.0 shipping. v1.0 ships on
hue-shift recolors; this entry exists so picking Track 2 back up doesn't
require re-deriving the transport, asset list, or QA gate from scratch.

---

## [G6] PWA icons are TEMP placeholders — REVIEW-ON-RETURN

G5 Track 2 art generation never ran (see above), so there was no real art
set to pull PWA icons from — G6's own doc explicitly sanctions this exact
fallback ("otherwise placeholder squares labeled TEMP"). Generated three
flat accent-colored square PNGs via `pngjs` (already a devDependency, no
new install): `webview-ui/public/icons/icon-192-TEMP.png`,
`icon-512-TEMP.png`, `apple-touch-icon-TEMP.png` (180×180). Referenced
from `webview-ui/vite.config.ts`'s `VitePWA({ manifest: { icons: [...] } })`
and `index.html`'s `<link rel="apple-touch-icon">`.

**When Track 2 art generation eventually runs:** swap the three file
paths in `vite.config.ts`'s manifest `icons` array and `index.html`'s
`apple-touch-icon` href to the real generated assets (or export square
192/512/180 crops of the office banner art) — no other code change
needed, no manifest schema change, no rebuild-pipeline change. Delete the
three `*-TEMP.png` files once replaced.

---

## [G6] Third data point on the HUD-overlap bug class — REVIEW-ON-RETURN

Independently spotted by the orchestrator reviewing `g6-mobile.png`
directly (not reported by G6's own sub-agent, whose touch-target work was
correct and thoroughly verified — this is a separate, narrower finding):
at the iPhone 14 viewport, the STOP ALL control visually crowds the
STREAK HUD text, the "Instant Detection Active" toast partially covers
the NIGHT SHIFT status line beneath it, and the bottom toolbar's
"SOUND: ON" label gets cut off by the "v1.3" version tag overlapping it.
None of these break function (STOP ALL's own hit target is still intact
per G6's 44px audit) or violate the colorblind hard rule — this is
purely visual crowding, not a shape/color signal failure.

This is now the **third independent instance** of the same bug class:
G5's WorldEventBanner/ProgressionHUD overlap (fixed, `d8b18df`), Greg's
own item 6 above ("progress tracker overlaps the zoom + button"), and
now this. Reinforces item 6's recommendation: this needs a dedicated
HUD/overlay layout pass (consistent z-index + reserved vertical rhythm
for stacked top-anchored elements: HUD bar → toasts → world-event banner
→ status chips) across every absolutely-positioned overlay, not more
one-off `top-N` fixes as each collision is separately discovered.
Not blocking the batch-3 deploy — v1.0's underlying function is intact,
this is a polish item for the next iteration.

---

## [Fable review, 2026-07-08] — 4 real bugs, next-iteration priority list

Run's final completion step: a Fable-model adversarial review of the
full v2 diff (`git diff 50f9ef2..HEAD`, 155 files), targeted at award-site
sourcing, the three unattended-run safety guards, server-authoritative
Cash mutation, and the G2 Pixi dispose fix — not a line-by-line sweep.
Findings NOT acted on this run (explicit run design: log for next
iteration), but all four are genuine, concretely-reproducible bugs, not
speculation — worth prioritizing early next session.

**Clean (no findings):** the three unattended-run safety guards
(first-fire confirm, budget fail-safe + hard-ceiling clamp, STOP ALL —
all verified in code, not just comments); every httpServer.ts v2 route's
Cash handling (validate→debit→persist→broadcast, no client-supplied
amounts trusted); the Pixi `dispose()`/DOM-detachment fix (`removeView:
false`, consistently applied, the one `OfficeCanvas.tsx` consumer
correctly cleans up on every `isEditMode` toggle).

**F1 — `employeeStore.ts:415-449` (`train()`/`promote()`) never debit
Cash**, and `httpServer.ts:599-606`'s route wrapper doesn't either.
GAME-DESIGN §3.1 prices these at 100/session and `200×nextTierIndex`;
the daily training cooldown works, the cost never fires.
**Repro:** `POST /api/employees/:id/train` — free permanent stat growth,
respecting only the once/day cooldown, Cash balance untouched.

**F2 — 4 of 5 `buildingBuffs.ts` effects are computed and unit-tested but
never consumed in production.** Only `buffsForDesk().xpBonusPct` (Dev
Pit + furniture adjacency) is wired, at `hookEventHandler.ts:730`. War
Room's `crisisXpBonusPct`, Break Room's `moodRegenMult`, Server Room's
`globalBuffs().cashBonusPct`, and Kitchen's `globalBuffs().moodDecayMult`
have zero call sites anywhere (grep-confirmed).
**Repro:** build a War Room (1200 Cash) or Server Room (800 Cash) — pure
Cash sink, zero mechanical effect ever fires.

**F3 — the "Chain Gang" perk (800 Cash) is a paid no-op.** It sets
`perkFlags.chainGang=true` (`economyStore.ts:350`), but
`CHAIN_MAX_STEPS`/`CHAIN_MAX_CONCURRENT_RUNS`
(`chainStore.ts:32-33`) are hardcoded constants never read against any
perk flag (grep-confirmed). Buying it debits real earned Cash for
nothing.

**F4 — highest priority, rule-6-adjacent: buffed furniture is placeable
for free through the ordinary edit tool, bypassing the paid route
entirely.** `useEditorActions.ts:556-583`'s `FURNITURE_PLACE` handler →
`editorActions.ts`'s pure-client `placeFurniture()` → `saveLayout()` →
`clientMessageHandler.ts:62-64` writes the layout directly, for ANY
furniture type including the priced ones (`WHITEBOARD`@60,
`PC_FRONT_ON_*`@150 in `economyConstants.ts`'s `FURNITURE_COST`). The
actual paid/debiting function, `commitBuyFurniture()`
(`editorActions.ts:332`, the only thing that POSTs
`/api/building/furniture`), has **zero call sites anywhere in
`webview-ui/src`** — it looks unwired/dead. The free-placed furniture
still fully qualifies for adjacency buffs (`buffsForDesk` reads the
persisted layout with no "was this paid for" check). Doesn't violate
hard rule #6's letter (the client never directly mutates the Cash
number), but defeats §3.1's furniture-sink economy design through
completely ordinary UI use, not an edge case. **Repro:** edit mode →
Furniture tool → pick `WHITEBOARD` → click a tile — placed, persisted,
buffed, free.

**Suggested next-iteration order:** F4 first (economy-design integrity,
trivially reachable), then F2 (four dead-but-priced rooms is a
significant "why did I buy this" moment for a real player), then F1 and
F3 (smaller, single-function fixes).

---

## [KICKOFF v1.1 items 10-13] StandingOrdersPanel has the same unwired-perk

## pattern F3 just fixed for ChainBuilderPanel — RESOLVED 2026-07-10

**RESOLVED by the v2.0 run (KICKOFF-v2.0 0.6, commit c1a773a):**
`standingOrderCapClient()` in `webview-ui/src/standingOrders.ts` mirrors the
server's `standingOrderCap()` value table exactly (base 1, Second Shift +1,
Night Shift Foreman +2 — both perks, not just Second Shift, so the same bug
class can't recur for the Foreman), threaded `economy` through
`StandingOrdersPanel` the same way c369684 did for `ChainBuilderPanel`,
fail-closed to base cap with no snapshot. 4 new unit tests including a
regression test demonstrating the pre-fix false block. Original entry below.

Found incidentally while independently verifying F3's webview follow-up
fix (2026-07-09) — not itself part of items 10-13's scope, not acted on
this run. `webview-ui/src/components/StandingOrdersPanel.tsx:46-50`
already has an explicit code comment acknowledging the same class of gap
F3 had: the Second Shift perk (500 Cash) raises the standing-order cap
1→2 server-side, but the webview has no live perk-state plumbing to know
that, so it falls back to always showing the conservative base cap as a
UI hint. This predates this run (the comment itself is pre-existing, per
`git log` on that file) — not a regression introduced by F3's fix.

Now that F3's follow-up (commit `c369684`) has already built the exact
plumbing this needs — `EconomySnapshotClient.purchasedPerks` is live on
the wire, threaded through `App.tsx` — closing this should be small: pass
`economy` into `StandingOrdersPanel` the same way it now flows into
`ChainBuilderPanel`, derive `hasSecondShift` from `purchasedPerks`, and
replace the hardcoded base-cap hint with the real effective cap (1 vs 2).
Same shape, same file pattern, same test convention as the F3 follow-up
commit — should be a fast pickup for a future session, not a fresh
investigation.

---
