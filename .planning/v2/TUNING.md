# War Room v2 — Tuning & Review-on-Return Log

Started 2026-07-08 for the rev-2 `/goal` ultracode G0→G6 run. Every
design-feel issue, provisional number, and gated action Greg needs to
review lands here as a `REVIEW-ON-RETURN` item — note-and-continue,
never stall the line (KICKOFF.md rev 2 execution model).

Format per entry: `## [G<n>] <short title>` + what/why/what Greg should
do about it.

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
