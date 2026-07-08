# Section 05 — Living World, Events, Contracts & Missions

Status: draft for cross-section critique pass. Author scope: sim-life
between real events, random event tables, seasonal/day-night calendar,
vault-todo → contract pipeline + completion detection, game-generated
dailies/weeklies, event→economy hooks, and the fiction-vs-real labeling
rule. Does NOT own: engine/renderer choice, employee trait/mood math,
building/room buffs, or Cash/Reputation earn-rate tuning outside what this
section itself mints — those belong to sections 02 (economy), 03
(employees), 04 (building), 06 (engine). Assumptions about them are pinned
below so the critique pass can reconcile numbers.

## ASSUMES (reconcile with other sections)

1. **Currency names/fields** — `Cash` (spendable) and `Reputation` (aka
   "Rep", permanent/slow-decaying) per Greg's ECONOMY answer. This section
   mints both as contract/event payouts; section 02 owns the sink side
   (upgrades/training costs) and any decay-rate math. If section 02 picks
   different field names, rename `payoutCash`/`payoutRep` below —the
   shapes don't change.
2. **Employee identifiers** — assumes section 03 produces a stable
   `employeeId: string` per persistent named character, addressable at
   contract-assignment time (`assignedEmployeeId` field below) and exposing
   at least one readable `morale: number (0-100)` and a boolean-ish
   "grimy/neglected" office state this section's event table nudges. If
   section 03's shape differs, adapt field names only.
3. **Renderer ownership** — this section defines the _data_ for day/night
   phase and season (pure functions of `Date.now()`), and the event table's
   deterministic id/weight/effect. Section 06 (engine/PixiJS) owns turning
   that data into lighting overlays, weather sprites, and event VFX. This
   doc does not specify shaders/sprites.
4. **No external calendar reads.** Seasonal "holidays" are fictional,
   hand-authored month/day ranges checked against the office's local clock
   — never Google Calendar, never Greg's real schedule. Keeps this section
   inside the tailnet-only, no-new-scopes constraint.
5. **contractStore / worldEventStore are new server modules**, file-backed
   under `~/.pixel-agents/` exactly like `progressionStore.ts` and
   `dispatchStore.ts` already do (same directory, same throttle pattern,
   same "never throws, cache-serves stale on read error" tolerance). No new
   database, no new env var beyond what's listed under Files below.

---

## 1. Fiction vs Real — the labeling rule (hard rule, read first)

The single biggest risk in this section is a fake event being mistaken for
a real crisis. The existing crisis layer (`webview-ui/src/office/crisis.ts`)
already reserves three glyphs for real, telemetry-anchored fires:
`≋` SMOKE, `▲` FIRE, `✱` ALARM — plus dispatch's `◎` RINGING / `✓`/`✗`
outcomes. **This section may never reuse those five glyphs for anything
fictional, full stop.**

Rule, enforced structurally (not by convention):

- Add one shared primitive, `webview-ui/src/components/ui/SignalChip.tsx`
  (new file, sits next to `Button.tsx`/`Checkbox.tsx` in that folder),
  taking a required `real: boolean` prop. It renders:
  - `real=true` → solid 1px border, glyph + WORD label as today's crisis
    tags already look, no prefix.
  - `real=false` → **dashed** 1px border (`border-style: dashed`, no color
    dependency) AND the literal text `SIM ·` prepended to the label before
    the glyph, e.g. `SIM · ✦ POACH OFFER`. The dash + prefix are both
    shape/text signals, so it survives grayscale and screen readers.
- Every new UI surface this section adds (ContractsPanel rows, World Event
  toasts, ambient dialogue bubbles) renders through `SignalChip`. Nothing
  fictional is allowed to hand-roll its own chip markup — that's the
  structural guarantee, not a lint rule.
- Reserved glyph registry: extend the existing `helpContent.ts` registry
  pattern (`.claude` note in STATE.md: "help screen registry-enforced") to
  cover the SIM glyph set below (§4), and add a unit test
  (`webview-ui/src/office/__tests__/signalChip.test.ts`) asserting the SIM
  glyph set and the REAL glyph set (`≋ ▲ ✱ ◎ ✓ ✗`) are disjoint sets — this
  test is the actual enforcement, fails the build if anyone reuses a real
  glyph for a sim event.
- Contracts derived from real vault todos/gates render `real=true` even
  though the _contract wrapper_ (payout, deadline) is game fiction — the
  underlying **completion fact** is real (a todo genuinely closed, a gate
  genuinely flipped DONE), so it earns the real-signal treatment. Only the
  currency amounts are "invented" framing, per Greg's RELAXED-REALNESS
  rule (flavor may be invented, real completion facts may not be faked).
- Game-generated dailies/weeklies and all World Events render `real=false`
  always — they are never backed by an external fact.

---

## 2. Contracts — vault todos become jobs with payouts

### 2.1 Data model

New file `server/src/contractStore.ts`, same shape/conventions as
`dispatchStore.ts` (file-backed JSON + JSONL audit log, throttled writes,
`{ ok: true }`-style tolerant mutations, never throws on read).

```ts
export const CONTRACT_SOURCES = ['priority', 'backlog', 'gate', 'daily', 'weekly'] as const;
export type ContractSource = (typeof CONTRACT_SOURCES)[number];

export const CONTRACT_STATUSES = ['open', 'completed', 'expired', 'abandoned'] as const;
export type ContractStatus = (typeof CONTRACT_STATUSES)[number];

export type CompletionMethod =
  | 'todo-disappeared' // priority/backlog: text/count vanished from latest briefing
  | 'gate-flipped' // gate: TrackerGate.status became DONE
  | 'dispatch-result' // a linked dispatch run exited 0
  | 'manual-claim' // player-asserted, NOT independently verified
  | 'daily-auto'; // game-generated daily/weekly, self-certifying by design

export interface Contract {
  id: string; // `c_${sha1(sourceKey).slice(0,10)}` — stable across regen
  source: ContractSource;
  title: string; // cleaned todo text / gate label / template string
  sourceDate: string | null; // YYYY-MM-DD of the todo file, null for daily/weekly/gate
  sourceKey: string; // dedupe key: normalized text (priority/backlog) or gate id
  payoutCash: number;
  payoutRep: number;
  deadline: number | null; // epoch ms, null = no deadline
  status: ContractStatus;
  assignedEmployeeId: string | null;
  createdAt: number;
  completedAt: number | null;
  completionMethod: CompletionMethod | null;
  linkedDispatchId: string | null; // set when dispatched via BRIEFING→DISPATCH prefill
}
```

Real glyph carried for the panel: contracts use `real: true` in
`SignalChip` (per §1) for `priority`/`backlog`/`gate` sources,
`real: false` for `daily`/`weekly`.

### 2.2 Minting rules (exact numbers — no judgment calls)

Re-derive contracts every time `getBriefing()` recomputes (it already has
a 60s TTL cache in `briefingProvider.ts` — contract minting piggybacks on
that same tick via `contractStore.reconcileFromBriefing(briefing, now)`,
called from the same interval `httpServer.ts` already uses to serve
`/api/briefing`, no new poll loop).

**Priority contracts** (source: `priority`) — one per entry in
`briefing.todo.startNow` (typically ≤3, per existing "Start now" parser):

- `sourceKey` = normalized text: lowercase, trim, collapse whitespace (same
  normalization `cleanTodoLine` already applies, just also lowercased).
- `payoutCash = 40`, `payoutRep = 2`.
- `deadline` = end of the NEXT calendar day after `briefing.todo.date`
  (i.e., `sourceDate + 2 days` at local midnight) — "Start now" items get a
  ~24-48h window depending on when in the day the file was compiled.
- Minted once per distinct `sourceKey`; if the same text reappears in a
  later todo file (compiler re-listed it), the existing open contract is
  left alone — not re-minted, not re-paid.

**Backlog contracts** (source: `backlog`) — one per entry in
`briefing.todo.sections` (the non-"Start now" headings), keyed by
`sourceKey = normalized section title`:

- Created with `initialCount = section.count` recorded in title:
  `"Clear {section.count} items in {section title}"`.
- `payoutCash = min(150, 15 * initialCount)`, `payoutRep = min(5, floor(initialCount / 5))`.
- `deadline` = `createdAt + 7 days` (matches the weekly-rollup cadence
  already in the routines table).
- Re-minted whenever `sourceKey` doesn't match an existing OPEN contract
  for that title (a completed/expired one is fine to replace — the
  backlog section persists across days, so each week gets a fresh
  contract off the latest count).

**Gate contracts** (source: `gate`) — one per `TrackerGate` from
`briefing.tracker.gates` where `status !== 'DONE'`:

- `sourceKey = gate.id`.
- `payoutCash = 200`, `payoutRep = 10`. Flat — gates are already weighted
  (a gate can have any number of sub-tasks); don't try to scale off
  `done/total`, that both double-counts backlog contracts and invites
  fiddly rebalancing. Flat number, reconciled in the critique pass against
  section 02's overall Cash economy if 200 is out of scale.
- `deadline = null` — gates are long-running by nature (STATE.md gates run
  weeks); no expiry penalty makes sense here.

### 2.3 Completion detection (in priority order, cheapest/most-real first)

1. **`dispatch-result`** (fastest signal). When a dispatch is created via
   the existing BRIEFING→DISPATCH prefill (STATE.md wave-2 T7-T9), add one
   optional field to `DispatchRequest` in `dispatchStore.ts`:
   `contractId?: string`, set by the webview at enqueue time when the
   prefill text matches an open contract's `title` (exact string match on
   the prefill source — the prefill already carries the todo text
   verbatim). When that dispatch's status transitions to a terminal
   `exited` state with `exitCode === 0` (the dispatch layer already tracks
   this — reuse `resultTail`/exit tracking, no new polling), call
   `contractStore.complete(contractId, 'dispatch-result', now)`
   immediately. This is the fast path Greg actually asked to reward
   (dispatching real work through the game should feel like it closed the
   loop instantly, not "wait for tomorrow's todo file").
2. **`todo-disappeared` / gate `gate-flipped`** (the ground-truth path,
   runs every briefing reconcile tick):
   - Priority: if `sourceKey` is absent from the _latest_ `startNow` list
     AND the contract's `sourceDate` is older than the latest todo file's
     date (i.e., a newer compiled file exists and didn't carry it
     forward) → `completed`, method `todo-disappeared`. Todo-compiler's
     own behavior (drops finished items) is the ground truth being
     trusted here — same trust boundary the BRIEFING panel already
     depends on.
   - Backlog: if `section.count` for that `sourceKey`'s section title in
     the latest file is `<= 0` (all checked off) → `completed`, method
     `todo-disappeared`. If the section title itself vanished from the
     latest file (folded/renamed by the compiler) treat as ambiguous —
     leave `open`, let it expire naturally at deadline rather than guess.
   - Gate: if `TrackerGate.status === 'DONE'` in the latest tracker parse
     → `completed`, method `gate-flipped`.
3. **`manual-claim`** (escape hatch, explicitly less trusted). A CLAIM
   button in the new `ContractsPanel.tsx` (mirrors `TriagePanel.tsx`
   structurally) posts `POST /api/contracts/:id/claim` (authed the same
   way dispatch decision routes are — Bearer token check already exists
   in `httpServer.ts`, reuse it). Sets `completed` /
   `manual-claim` immediately, no verification. **Rendered distinctly**:
   `SignalChip` gets a second boolean, `verified: boolean` — `manual-claim`
   completions render `✓ CLAIMED (unverified)` with a dashed border even
   though `real=true` for the source, so Greg always sees the difference
   between "the vault confirmed this" and "I said I did this." This is
   the one place a real-source contract still gets the dashed treatment —
   document it as the single exception to §1's real/fake border rule.
4. **`daily-auto`** — dailies/weeklies self-certify per §3 (they're
   fictional busywork; no external fact to verify).

**Expiration** (soft-fail, per STAKES): a cron-style check on the same
reconcile tick — `deadline !== null && now > deadline && status === 'open'`
→ `expired`. Priority contract expiry costs `-1 Reputation` (small, felt,
never Cash — matches "no dark patterns on real money", this is a
Reputation-only penalty for letting a real priority item's window lapse).
Backlog/gate contracts have `deadline` either absent (gate) or expiry that
is silent (backlog just quietly drops to `expired`, no Rep penalty, since
it'll re-mint next week off the still-current section count anyway).

### 2.4 Employee assignment

`assignedEmployeeId` is settable via the ContractsPanel (dropdown of
section-03's roster) — assigning an employee to a contract is flavor +
progression hook: on `completed`, if `assignedEmployeeId` is set, section
03's employee-growth hook is called with the contract's payout as the XP
input (exact formula owned by section 03; this section just guarantees it
calls `employees.recordContractCompletion(employeeId, contract)` — one
integration point, defined here as the call site, tuned there).

---

## 3. Game-generated dailies & weeklies

Distinct from vault contracts — pure fiction, `real: false` always, exists
to keep the loop warm between real events (Greg's CADENCE answer: idle
check-ins + dedicated sessions).

**Rollover hook**: reuse `shiftStats.ts`'s existing local-day-boundary
detection (it already computes `localDate(now)` and fires an
`onDayClose` callback into `progressionStore.ts` — see the day-close
summary wiring already built for XP). Add one more subscriber call from
that same rollover: `contractStore.mintDaily(now)`, and on Mondays
specifically (`new Date(now).getDay() === 1`) also
`contractStore.mintWeekly(now)` — Monday matches the existing
`weekly-rollup` routine's cadence (08:30 Mon), so the fiction layer's
weekly beat lines up with the real one Greg already reads.

**Daily template table** (12 entries, pick 1 at random per day, no repeat
of yesterday's id):

| id               | title                                            | completion check                                                                                                                                                                        |
| ---------------- | ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `daily.turn`     | "Log one completed turn today"                   | `shiftStats` turnsCompleted ≥ 1 today                                                                                                                                                   |
| `daily.lean`     | "Close the day LEAN-graded"                      | today's `ShiftReport.efficiency === 'LEAN'` at day-close                                                                                                                                |
| `daily.fireout`  | "Extinguish a fire within 2 minutes of ignition" | a crisis resolved with `ageMs < 120_000` (client reports this once via a new lightweight `POST /api/contracts/daily-signal` the webview already has full crisis lifecycle info to call) |
| `daily.streak`   | "Keep the daily-use streak alive"                | `progressionStore` streak incremented today                                                                                                                                             |
| `daily.dispatch` | "Dispatch one real coworker job"                 | a `DispatchRequest` reached `exited` today                                                                                                                                              |
| `daily.clean`    | "Clear one backlog contract"                     | any backlog contract completed today                                                                                                                                                    |
| `daily.claim`    | "Claim a priority contract"                      | any priority contract completed today                                                                                                                                                   |
| `daily.notouch`  | "Zero crises open at close"                      | `crisesOpen === 0` at day-close                                                                                                                                                         |
| `daily.quiet`    | "No new fires today"                             | `crisesIgnited === 0` today                                                                                                                                                             |
| `daily.grade2`   | "Two LEAN days this week"                        | rolling count, tracked in `contractStore` itself, small local counter                                                                                                                   |
| `daily.gate`     | "Advance a gate"                                 | `gatesAdvanced > 0` in today's briefing delta (shiftStats already computes this)                                                                                                        |
| `daily.social`   | "Assign an employee to a contract"               | `assignedEmployeeId` set on any contract today                                                                                                                                          |

Payout: **flat `payoutCash = 20`, `payoutRep = 0`** for every daily —
deliberately small and uniform; dailies are warmth, not the economy's
engine (contracts are). `deadline = end of local day`. Auto-expires at
midnight with **no penalty** (missing a daily costs nothing — only real
priority-contract misses cost Reputation, per the no-dark-patterns-on-
fiction principle: fictional obligations never punish).

**Weekly template table** (4 entries, pick 1 per Monday):

| id                      | title                                 | completion check                                                     |
| ----------------------- | ------------------------------------- | -------------------------------------------------------------------- |
| `weekly.threecontracts` | "Complete 3 contracts this week"      | count of `completed` contracts with `completedAt` in the last 7d ≥ 3 |
| `weekly.alldailies5`    | "Hit 5 daily quests this week"        | count of completed `daily.*` this week ≥ 5                           |
| `weekly.leanweek`       | "Average LEAN across the week"        | 7-day rolling efficiency average, reuses `shiftStats` history        |
| `weekly.nograme`        | "Zero contract expirations this week" | no `expired` contracts with `createdAt` in last 7d                   |

Payout: flat `payoutCash = 100`, `payoutRep = 5`. `deadline = createdAt + 7 days`, no penalty on miss (same fiction-never-punishes rule).

---

## 4. World Events — ambient sim life

New file `server/src/worldEventStore.ts` (state) +
`webview-ui/src/office/worldEvents.ts` (pure trigger/effect logic, mirrors
`crisis.ts`'s pure-function style so it's independently unit-testable).

### 4.1 Event table (12 entries — exact numbers, no "pick some later")

| id                   | glyph (SIM set)                                                                                                      | weight | min gap (hrs) | duration (sim-min) | effect                                                                                                                                                                                                                                                                                                                                                                                                         |
| -------------------- | -------------------------------------------------------------------------------------------------------------------- | ------ | ------------- | ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `power_surge`        | `⚡`                                                                                                                 | 10     | 4             | 2                  | Flavor only. All on-screen employees pause their current animation for the duration (visual only — no state mutation). Requires an active connected client (never runs as an offline/idle-catchup event — see §4.3).                                                                                                                                                                                           |
| `inspection`         | `🔍`→ rendered as glyph `▣` (emoji reserved for docs only, UI uses the ASCII/geometric glyph per the existing style) | 8      | 12            | 5                  | If office `grimy` flag (section 04) is false: `+2 Rep`. If true: `-1 Rep`. Reputation only, never Cash.                                                                                                                                                                                                                                                                                                        |
| `rival_poach`        | `✦`                                                                                                                  | 6      | 18            | 10                 | Targets one random employee with `morale < 40` (section 03 threshold). Shows a flavor bubble "considering an offer…". 5% roll: employee's `quitRisk` flag ticks up (consumed by section 03/04's existing neglect mechanic — this event never directly fires the quit itself, only nudges the same lever real neglect already uses). If no employee has low morale, event fizzles silently (logged, not shown). |
| `coffee_run`         | `○`                                                                                                                  | 20     | 1             | 3                  | Pure ambient — two employees walk to break room and back. No economy effect.                                                                                                                                                                                                                                                                                                                                   |
| `birthday`           | `✦`                                                                                                                  | 3      | 720 (30d)     | 60                 | One random employee gets a "birthday" flavor bubble + `+1 morale` nudge (small, capped, section 03's field).                                                                                                                                                                                                                                                                                                   |
| `printer_jam`        | `▲`(NOT the crisis glyph — use `╳`)                                                                                  | 12     | 6             | 4                  | Ambient only; one employee stands at a furniture "printer" tile if placed, else no-op.                                                                                                                                                                                                                                                                                                                         |
| `client_call`        | `○`                                                                                                                  | 10     | 8             | 5                  | Ambient; flavor bubble on a random employee, no effect.                                                                                                                                                                                                                                                                                                                                                        |
| `weather_rain`       | `≈`                                                                                                                  | 15     | 6             | 20                 | Window-tile decor overlay only (section 06 renders); no economy effect.                                                                                                                                                                                                                                                                                                                                        |
| `flavor_bonus`       | `✦`                                                                                                                  | 5      | 24            | instant            | "Found a coffee gift card" — `+Cash`, roll `1..5`, **hard capped at +5 total flavor Cash per local day** across all `flavor_bonus` triggers (tracked in `worldEventStore`) — this is the ONLY currency-producing fictional event and the cap exists specifically so it can never become a real-income exploit per the no-dark-patterns guardrail.                                                              |
| `heatwave`           | `≈`                                                                                                                  | 8      | 48            | 180                | Ambient AC-strain flavor bubble; no effect (hook point for section 04 if a "utility cost" mechanic exists there — this section does not spend Cash on its own).                                                                                                                                                                                                                                                |
| `power_outage_scare` | `⚡`                                                                                                                 | 4      | 72            | 3                  | Screen briefly flickers (render-only); no effect. Distinguish from `power_surge` only by flavor text — both are cosmetic.                                                                                                                                                                                                                                                                                      |
| `mail_delivery`      | `○`                                                                                                                  | 15     | 3             | 2                  | Ambient walk-to-mailbox animation if that furniture piece exists; no effect.                                                                                                                                                                                                                                                                                                                                   |

Selection algorithm (`worldEventStore.tick(now)`, called on the same
60s-ish server tick the briefing cache uses — no new interval): weighted
random among events whose `min gap` has elapsed since their last fire
(tracked per-id in the persisted state), skip silently if nothing is
eligible (most ticks fire nothing — a 60s tick against 1-72hr gaps means
events are rare by construction, which is the intent: ambient, not
spammy).

### 4.2 Effect application boundaries (hard caps, no exceptions)

- Max `±5` Cash or Rep per single event tick (already true of every row
  above; `flavor_bonus` is the only one touching Cash at all).
- No event may **directly** set an employee to quit/fired/hired — only
  nudge morale/quitRisk fields section 03/04 already own and gate real
  consequences behind. World events are pressure, not a second stakes
  system running in parallel to the real-neglect one.
- Daily flavor-Cash cap (`+5/day` total, not per-event) enforced in
  `worldEventStore`, independent of section 02's real-economy caps —
  belt-and-suspenders the same way `dispatchStore.ts` re-caps
  `resultTail` even though the runner already caps it.

### 4.3 Online-only vs offline-simulated

Greg's CADENCE answer wants offline progress (idle loop) AND live play.
Split explicitly:

- **Offline-simulated** (computed in one lump when a client reconnects,
  like `dispatch-runner`'s tick-based catch-up): dailies/weeklies rollover,
  contract deadline/expiry sweeps, `coffee_run`/`mail_delivery`/ambient
  walk logging (just logged as having "happened", no animation replay
  needed — flavor is disposable).
- **Online-only** (never simulated retroactively, only fire while a
  websocket client is connected): `power_surge`, `power_outage_scare` —
  anything whose entire value is a live visual moment gets skipped
  (not queued, not replayed) if no client was connected during its
  eligible window. This avoids a dishonest "welcome back, here's 40
  events you didn't see" wall of toasts, and avoids ever implying an
  offline session earned more than the numbered caps allow.

### 4.4 Day/night + seasons (data layer only — §ASSUMES 3)

New pure module `webview-ui/src/office/dayNight.ts`:

```ts
export type DayPhase = 'dawn' | 'day' | 'dusk' | 'night';
export function getDayPhase(now: number): DayPhase {
  const hour = new Date(now).getHours(); // local wall clock, same convention shiftStats.ts uses
  if (hour >= 6 && hour < 8) return 'dawn';
  if (hour >= 8 && hour < 18) return 'day';
  if (hour >= 18 && hour < 20) return 'dusk';
  return 'night';
}
```

Consumed by `ambience.ts` (which STATE.md already documents doing a
"night duck" — wire it to this function instead of any ad hoc check it
currently has) and by section 06's lighting overlay.

Season, same file:

```ts
export type Season = 'winter' | 'spring' | 'summer' | 'fall';
export function getSeason(now: number): Season {
  const m = new Date(now).getMonth(); // 0-11
  if (m === 11 || m <= 1) return 'winter';
  if (m <= 4) return 'spring';
  if (m <= 7) return 'summer';
  return 'fall';
}
```

Meteorological quarters (Dec-Feb / Mar-May / Jun-Aug / Sep-Nov) — simplest
deterministic rule, no lookup table to maintain.

One fictional holiday week, hand-authored, zero external reads:
`isHolidayWeek(now)` → true for Dec 20-31 inclusive (any year) → unlocks a
cosmetic decor set the same way `decor.ts` already gates progression
decor, but keyed off date instead of an unlock flag (`decor.ts`'s
`DecorCatalogEntry.unlockKey` becomes `unlockKey: string | { season: Season } | { holiday: true }` — a small union widening, not a rewrite).

---

## 5. Files (new + touched) — sonnet execution checklist

**New, server:**

- `server/src/contractStore.ts` — §2 schema, mint/reconcile/complete/claim/expire.
- `server/src/worldEventStore.ts` — §4 table, tick/select/apply, daily flavor-Cash cap counter.
- `server/__tests__/contractStore.test.ts`, `server/__tests__/worldEventStore.test.ts`.
- Routes in `httpServer.ts`: `GET /api/contracts` (authed, same pattern as
  `/api/dispatch/recent`), `POST /api/contracts/:id/claim` (authed),
  `GET /api/world-events/recent` (unauthed, like `/api/briefing` — flavor
  only, no secrets).

**Touched, server:**

- `briefingProvider.ts` — no signature change; `contractStore` imports
  `getBriefing`/types from it, doesn't modify it.
- `dispatchStore.ts` — add optional `contractId?: string` to
  `DispatchRequest`; on terminal `exited`+`exitCode 0`, call
  `contractStore.complete(...)` (one new call site in whatever function
  already flips status to exited).
- `shiftStats.ts` — add two more subscriber calls in the existing
  day-close path: `contractStore.mintDaily(now)` and, Mondays only,
  `contractStore.mintWeekly(now)`.

**New, webview:**

- `webview-ui/src/office/worldEvents.ts` — pure logic mirror of server table for local prediction/animation cues (server is authoritative; this just interprets the broadcast).
- `webview-ui/src/office/dayNight.ts` — §4.4.
- `webview-ui/src/components/ui/SignalChip.tsx` — §1.
- `webview-ui/src/components/ContractsPanel.tsx` — mirrors `TriagePanel.tsx`/`UnlocksPanel.tsx` structure; lists open contracts grouped by source, CLAIM button, employee-assign dropdown.
- `webview-ui/src/office/__tests__/signalChip.test.ts` — disjoint-glyph-set enforcement test (§1).

**Touched, webview:**

- `ambience.ts` — wire night-duck check to `dayNight.getDayPhase`.
- `decor.ts` — widen `unlockKey` union per §4.4 (season/holiday variants), additive only.
- `helpContent.ts` — add "contracts" and "world events" sections (registry-enforced pattern already established).

**New env vars:** none required — contracts/events derive entirely from
already-mounted `WAR_ROOM_TODO_DIR`/`WAR_ROOM_TRACKER_STATE` plus local
server state. (If section 02/03 need a Cash/Rep ledger file location, that
belongs to their section, not this one.)

**Verification commands per milestone:**

- `npm --prefix server test -- contractStore` — mint/complete/expire unit coverage, all 2.2/2.3/2.4 numbers asserted literally (not just "some number").
- `npm --prefix server test -- worldEventStore` — weight/gap/cap enforcement, especially the `+5/day` flavor-Cash ceiling and the online-only skip for `power_surge`/`power_outage_scare`.
- `npm --prefix webview-ui test -- signalChip` — glyph-set disjointness.
- Manual E2E (documented in a runbook, human-run like existing dispatch E2E): drop a real todo file with a known "Start now" line into a test `WAR_ROOM_TODO_DIR`, confirm a priority contract mints within one reconcile tick, delete the line from the next day's file, confirm `todo-disappeared` completion within one tick — no invented data, same rigor as the dispatch E2E already in STATE.md.

---

## 6. Risks

- **Todo-text matching is brittle.** `sourceKey` normalization (lowercase/
  trim/collapse-whitespace) will false-negative if the todo-compiler
  rewords a line slightly between runs (common with LLM-authored todo
  files) — a contract could sit open forever, never detected as
  `todo-disappeared`, only ever closing via `expired` or `manual-claim`.
  Mitigated partially by the `dispatch-result` fast path, but only for
  items actually dispatched through the game.
- **Reconcile-tick coupling to the 60s briefing cache** means contract
  completion detection is only as fresh as that cache; if `getBriefing()`
  ever changes its TTL or gets called from a different code path, contract
  reconcile could silently stop firing without an obvious error (it fails
  soft, same as the briefing provider's own philosophy — but soft
  failures here mean stale contracts, not just a blank panel).
- **World event cadence tuning (min-gap hours, weights) is a guess**,
  calibrated only by "should feel rare, not spammy" — no playtesting data
  exists yet. Actual tuning will need at least a week of real usage before
  the numbers in §4.1 can be trusted; flag them as provisional in the
  build, not load-bearing constants to protect.

## 7. Three things most likely to be wrong

1. **The `manual-claim` escape hatch may be too easy to abuse** — nothing
   stops Greg (or future-Greg on a tired night) from CLAIM-ing every
   contract to farm Cash, and the "dashed/unverified" label is a labeling
   fix, not an economic one. If section 02's Cash sink design assumes
   contract payouts are trustworthy income, this needs a rate limit
   (e.g., max N manual claims/day) added in the critique pass.
2. **Backlog contract re-minting logic ("re-mint when sourceKey doesn't
   match an existing open contract") could double-pay** if the todo-
   compiler renames a section heading and then renames it back within a
   week — two contracts could exist for effectively the same backlog,
   both payable. Needs either a longer dedupe window or a title-similarity
   check, not exact string match.
3. **The dispatch↔contract link (`contractId` matched by exact prefill
   text)** assumes BRIEFING→DISPATCH prefill always sends the _exact_
   `title` string with no truncation/edit — if the CallModal lets the
   operator tweak the prompt before sending (plausible — that's the whole
   point of a call modal), the match breaks silently and that contract
   just falls back to the slower `todo-disappeared` path. Should be
   replaced with an explicit `contractId` passed as a first-class field
   from the BRIEFING panel's prefill action, not inferred by string match.
