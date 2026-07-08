# Section 01 — Core Loop & Dual-Currency Economy

Status: DRAFT for cross-section critique. Owns: currency schema, all earn/spend
numbers, sim tick cadence, offline progress, soft-fail decay curves, dark-pattern
audit. Does NOT own: room/furniture catalog contents (Section on Building),
employee trait derivation formulas (Section on Employees), dispatch/automation
UI (Section on Command), render/engine (Section on Engine/Art), contract
generation from vault todos (Section on Missions). Where those sections define
a number this doc consumes (e.g. "training costs X"), it's marked `[OWNED
ELSEWHERE: <section> — placeholder value used]` so the critique pass can
reconcile a single source of truth.

## ASSUMES (declare before reconciliation)

- **A1 — Engine:** renderer is rebuilt on PixiJS inside the existing React
  shell (`webview-ui/src/office/engine/`); the sim-tick/economy layer described
  here is renderer-agnostic and talks to the engine only via the existing WS
  message plane (`asyncapi`-generated), same as v1. If Engine section picks
  Phaser instead, nothing in this doc changes.
- **A2 — Persistence:** economy state persists the same way progression does
  today — a file-backed store at `~/.pixel-agents/economy.json`, throttled
  writes (5s), tolerant loads, process-wide singleton, `VITEST` guard against
  writing the real sidecar in tests. This doc assumes no DB/SQLite migration
  in v2. If Employees/Building sections need relational queries (e.g. "all
  employees in room X"), flag it — may force a schema rethink (see Risk R3).
- **A3 — Employee count is small.** Real "employees" map 1:1 to observed
  agent identities (machine × project × provider, extending
  `agentStateStore.ts`'s existing identity concept), realistically 2–8 at a
  time given Greg's 2-Mac setup. Economy numbers below are tuned for that
  scale, not hundreds of NPCs.
- **A4 — Real event vocabulary is fixed to what v1 already emits**: turn
  completed (hook Stop), crisis ignited/resolved (poll-state blocked
  transitions), shift-day-close with LEAN/STEADY/HEAVY grade, dispatch
  run exited (0 or nonzero). Any new real-event type another section wants
  to feed the economy (e.g. "contract accepted") must be named as a new
  server-side event in that section's doc — this doc only defines what
  happens once such an event fires.
- **A5 — Budget guardrail (rate-limit read) is Command section's build**,
  but this doc assumes its output shape: a `BudgetHeadroom` snapshot
  `{ claude5h: 0..1, claudeWeekly: 0..1, codexPlan: 0..1 }` (fraction of cap
  remaining) broadcast on the same cadence as the sim tick. This doc treats
  it as an input to the automation-pause rule (§5) and to the "raising
  payroll" framing (§2.3) — it does not design the estimator itself.
- **A6 — Missions/Contracts numbers (contract reward Cash/Rep amounts) are
  owned by the Missions section.** This doc defines the currency the
  contracts pay INTO and the sinks they can be spent on, not contract
  reward sizing itself. Placeholder values marked accordingly.

---

## 1. The three loop cadences

One coherent game means one state machine with three read/write cadences,
not three separate modes. All three touch the same `EconomyStore` and the
same `OfficeSimState`.

| Cadence                                        | Trigger                              | What runs                                                                                                    | Existing analog to extend                                                                            |
| ---------------------------------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| **Tick** (server, always-on)                   | every 15s while server process is up | sim-tick: mood/grime decay, ambient events, offline-progress accrual, budget-headroom check                  | `pollStateHandler.ts` interval pattern, `FILE_WATCHER_POLL_INTERVAL_MS`-style constant               |
| **Session** (webview, while open)              | app open, 20–60 min                  | build mode, dispatch, drawer/inspection, manual spends, watching the sim render                              | `App.tsx` + `office/engine/`                                                                         |
| **Check-in** (webview, <2 min, phone-friendly) | app opened briefly                   | offline-progress summary modal, quick-collect Cash, quick-glance morale/grime, one-tap standing-order toggle | new — phone/PWA shell (Engine section), but the _data_ it reads is this doc's `/api/economy/summary` |

The tick is the spine: it runs whether or not a webview is open, exactly like
`shiftStats`/`progressionStore` already accumulate server-side regardless of
client connection. Session and check-in are two different _views_ onto the
same tick history, not different simulations. This is what makes "loosely
coupled" real: real events emit into an append-only ledger; the tick consumes
the ledger plus wall-clock elapsed time to advance sim state; renderers read
snapshots. No renderer ever mutates economy state directly — same
client/server authority split v1 already uses (server is authoritative,
webview is a projection, per `clientMessageHandler.ts`).

---

## 2. Dual currency

### 2.1 Cash — liquid, spendable, volatile

Cash is the operating-budget currency: earned continuously, spent on
upgrades/rooms/training/automation-perk purchases. It can go up and down
during a session (spending, and a small idle-upkeep drain, see §4.2).

**Sources (all real-event-gated, no idle/passive Cash generation beyond
§4.1's capped offline accrual):**

| Source                  | Amount                                                                             | Real event                                                                                                                       | Anti-dark-pattern note                                                                                                                                                                      |
| ----------------------- | ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Turn completed          | **+2 Cash**                                                                        | hook Stop (Claude only, same exclusion as `shiftStats`/`progressionStore`)                                                       | flat per-turn; frequency-driven like XP, not size-driven                                                                                                                                    |
| Crisis resolved         | **+8 Cash**                                                                        | observed blocked→unblocked transition (never a TTL sweep — same guard `progressionStore.recordCrisisResolved` already documents) | rewards recovery, not avoidance-gaming                                                                                                                                                      |
| Shift day closes LEAN   | **+40 Cash**                                                                       | `ShiftStats.onDayClose`, `efficiency==='LEAN'`                                                                                   |                                                                                                                                                                                             |
| Shift day closes STEADY | **+15 Cash**                                                                       | same hook, `'STEADY'`                                                                                                            |                                                                                                                                                                                             |
| Shift day closes HEAVY  | **+0 Cash**                                                                        | same hook, `'HEAVY'`                                                                                                             | **lower spend always pays more or equal, never less** — mirrors `XP_SHIFT_GRADE_BONUS` exactly; this is the standing hard rule "efficiency/completion earn, volume never does" made numeric |
| Dispatch run exits 0    | **+5 Cash**                                                                        | `dispatchStore` terminal state `exited` with code 0                                                                              | success bonus; nonzero exit pays **+0** (not negative — failures aren't punished twice, they already cost real tokens)                                                                      |
| Contract completed      | `[OWNED ELSEWHERE: Missions — placeholder +25..+150 Cash scaled to contract size]` | real vault todo/backlog item marked done                                                                                         |                                                                                                                                                                                             |
| Streak-day bonus        | **+10 Cash** flat, once/day, on top of existing XP streak touch                    | `progressionStore.touchStreak` fires                                                                                             | small, so streak's main reward stays Reputation (below), not a Cash-farming loop                                                                                                            |

**No Cash source ever reads token volume, session count, or elapsed idle
time as a multiplier.** The only place elapsed time appears is the capped,
diminishing-returns offline accrual in §4.1, which is explicitly _not_ tied to
real work and is deliberately small.

**Sinks:**

| Sink                                                                                | Cost                                                                                                  | Effect                                                             | Notes                                                                                                                                        |
| ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Room shell (per `[OWNED ELSEWHERE: Building]` room type)                            | placeholder 150–600 Cash                                                                              | unlocks floor tile purchase + furniture slots                      | Building section owns exact catalog                                                                                                          |
| Furniture piece (buff-granting)                                                     | placeholder 20–200 Cash                                                                               | mood/efficiency buff, adjacency bonus                              | Building section                                                                                                                             |
| Employee training (levels up ONE trait or grants XP toward a level)                 | **80 Cash per training session**, 1 per employee per real-calendar-day (cooldown, not stackable-spam) | `[OWNED ELSEWHERE: Employees]` exact trait math                    | cooldown prevents "buy levels with idle Cash" farm loop                                                                                      |
| Automation perk purchase (queue depth +1, standing-order slot, chain-output wiring) | 100 / 250 / 500 Cash for perk tiers 1/2/3                                                             | reduces micromanagement, gated additionally by BudgetHeadroom (§5) | perk _unlocks capability_, never _bypasses the real rate limit_                                                                              |
| Break / rest (send employee on break)                                               | **free** (Cash cost = 0)                                                                              | restores morale toward baseline faster than passive decay reverses | free by design — never let "can't afford to rest staff" become a soft-fail spiral trap; this is the one sink that must never cost anything   |
| Cosmetic-only purchase (decor variant, palette swap)                                | 10–50 Cash                                                                                            | pure flavor, zero mechanical effect                                | explicit non-P2W parking spot for "spend Cash on nothing that matters" — keeps Cash sinks honest by having an always-available cosmetic dump |

### 2.2 Reputation — permanent, slow, prestige

Reputation never decreases from spending (there is no Reputation shop) — it
only decays slowly from neglect (§4.3) and grows from durable
accomplishment. It gates access to bigger contracts and to the top employee
promotion tier, not to Cash-earning ability (never double-gate the same
resource).

**Sources:**

| Source                                                                                     | Amount                                                  | Real event                                                                                                                             |
| ------------------------------------------------------------------------------------------ | ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Shift day closes LEAN                                                                      | **+3 Rep**                                              | `onDayClose`                                                                                                                           |
| Shift day closes STEADY                                                                    | **+1 Rep**                                              | `onDayClose`                                                                                                                           |
| Shift day closes HEAVY                                                                     | **+0 Rep**                                              | `onDayClose` (same no-reverse-incentive guarantee as Cash)                                                                             |
| Streak milestone reached (3/7/30-day, matches existing `streakBronze/Silver/Gold` unlocks) | **+15 / +40 / +200 Rep** one-time per milestone         | `progressionStore.finish` unlock transition (fires once, flags never revert — Reputation awards follow the same one-time-on-flip rule) |
| Contract completed at "high difficulty" tier                                               | `[OWNED ELSEWHERE: Missions — placeholder +5..+20 Rep]` |                                                                                                                                        |
| Level-up (existing XP level, `computeLevel`)                                               | **+2 Rep per level gained**                             | `progressionStore.finish` level comparison                                                                                             |

**Sinks:** none that spend Reputation directly. Reputation instead
**gates thresholds** (read-only checks, never consumed):

- Contract tier unlocks: Missions section reads `reputation >= threshold`.
- Employee promotion to top tier (`[OWNED ELSEWHERE: Employees]`) requires
  `reputation >= 300` as one of its conditions.
- Prestige-only cosmetics (office "trophy shelf" tier) unlock at Rep
  milestones, same fixed-placement pattern as `decor.ts` today.

### 2.3 The "payroll" framing (budget guardrail)

Automation perks and standing orders spend _real_ tokens against Greg's
actual Claude 5h/weekly and Codex ChatGPT-plan limits — this is the one
place the fictional-Cash economy must stay honest about a _different_,
non-fictional resource. Model: automation perks each declare an estimated
real-cost weight (e.g. "standing order: nightly triage" ≈ 1 dispatch run).
Turning ON a standing order is "raising payroll" — a deliberate real-budget
commitment, priced in Cash to buy the _capability_ but gated from _firing_
by BudgetHeadroom, never the reverse (Cash can never buy past a real rate
limit — see §5 rule R-AUTO-1).

---

## 3. Sim-tick design (server, conceptual)

Extends the existing single-process store pattern (`progressionStore.ts`,
`shiftStats.ts`) with one new file: `server/src/economyStore.ts`, plus one
new interval owner: `server/src/simTick.ts`.

```
server/src/simTick.ts
  setInterval(runTick, SIM_TICK_INTERVAL_MS)   // 15_000 ms
  runTick(now):
    elapsedMs = now - lastTickAt
    economy.applyDecay(elapsedMs)        // morale/grime/reputation decay, §4
    economy.rollRandomEvent(now)         // small chance/tick, §6
    economy.persist(now)
    broadcast('economyTick', economy.getSnapshot())
    lastTickAt = now
```

**Design rules for the tick:**

1. **Tick is decay/ambiance ONLY. It never grants Cash/Rep/XP.** All
   currency grants are event-driven (§2), fired synchronously from the
   existing hook/poll/shift-close call sites, exactly like
   `progression.recordTurnEnd()` is called today from wherever
   `shiftStats.recordTurnEnd()` is called. This keeps the "no dark pattern /
   real work only" guarantee mechanically enforced — grep for `economy\.\(add\|grant\)` in server code should only ever show up inside handlers that already fire on a real event listed in §2, not inside `simTick.ts`.
2. **Tick is idempotent over elapsed wall time**, not wall-clock-interval
   count — if the server was asleep/restarted, `runTick` computes decay from
   `now - lastPersistedTickAt` in one jump (capped, see §4.1), not by
   replaying 300 missed 15s ticks. Same pattern as `ShiftStats.rollDay`
   collapsing a multi-day gap into one rollover.
3. **Tick output is a snapshot broadcast**, same shape family as
   `progressionUpdate`: a new WS message `economyTick` carrying
   `{ cash, reputation, morale, grime, headroom, generatedAt }`. Webview never
   computes decay client-side — avoids the classic idle-game bug of
   client-side clocks drifting from server truth.
4. **One process-wide singleton** (`export const economy = new
EconomyStore()`), constructed lazily, file-backed at
   `~/.pixel-agents/economy.json`, same throttle/tolerant-load/VITEST-guard
   idioms as `progressionStore.ts` lines 178–230. Reuse that file's
   `PERSIST_THROTTLE_MS = 5_000` constant rather than inventing a new one.

---

## 4. Offline progress & soft-fail decay

### 4.1 Offline/idle progress (the "check-in" loop)

When no webview has been open, the tick above still runs server-side (the
server is a long-lived NEXUS docker process, not something that only lives
while a browser tab is open) — so technically there is no "offline" gap
during a redeploy-free week. The idle-progress _feeling_ comes from what
accrues between check-ins:

- **Real Cash/Rep**: keeps accruing exactly per §2 whenever real events
  fire, whether or not anyone is looking. Nothing special needed — this is
  already "offline progress" in the truest sense (it's just... the server).
- **Ambient sim flavor** (coffee runs, chats, employees walking between
  rooms): accrues as _event log entries_ at a rate of ~1 flavor event per
  employee per 20–40 min of tick time (randomized), capped at **50 unseen
  flavor events** buffered — older ones silently drop. On next check-in, the
  webview fetches `/api/economy/summary` and shows a compressed "while you
  were away" digest (top 5 flavor events + net Cash/Rep delta + any morale
  drop warnings), never a wall of 200 log lines.
- **Decay** (§4.2/4.3) also keeps running in true wall-clock time whether or
  not the webview is open — this is the pressure half of "idle progress":
  good things (Cash/Rep from real work) and bad things (morale/grime decay
  from neglect) both continue regardless of observation. Decay is capped at
  a **72-hour lookback** for a single catch-up jump (§4.2) so a 2-week
  vacation doesn't nuke the office to zero in one tick — it bottoms out at
  a floor (see below) and _stays there_, not below.

### 4.2 Morale decay curve (soft-fail #1)

Each employee has `morale: 0..100`, baseline target depends on recent real
activity for that employee's identity.

- **Passive decay:** `-0.5 morale per idle hour` where "idle" = no real
  turn/dispatch event attributed to that employee's identity. Formula per
  tick: `morale -= 0.5 * (elapsedMs / 3_600_000)`, floored at **20** (never
  hits 0 from decay alone — 0 is reserved for an active negative event, see
  below). Cap the elapsed-time input to **72h** per single catch-up
  computation (A4.1's cap) so `elapsedMs` in the formula is
  `min(realElapsedMs, 72*3_600_000)`.
- **Active refresh:** every real turn/dispatch success attributed to that
  employee: `morale += 3`, capped at 100.
- **Break sink (free, §2.1):** sending an employee on break sets a
  `onBreakUntil` timestamp (real 30-min duration); while on break, morale
  regenerates at `+2/hour` instead of decaying, and no real work can be
  dispatched to them (so it's a genuine tradeoff, not a free lunch).
- **Thresholds (word + shape, never color-only per hard rule):**
  - `morale >= 70`: "◆ THRIVING"
  - `40 <= morale < 70`: "◇ STEADY"
  - `20 <= morale < 40`: "▽ STRAINED" — small productivity flavor penalty only (no real-Cash effect; cosmetic slouched sprite + slower walk anim)
  - `morale < 20` **only reachable via an active negative event** (crisis left unresolved >2h, or explicit "reprimand" action) — "✕ AT RISK": quit-risk roll begins (see below).
- **Quit risk:** once `morale < 20`, each tick rolls a **2% chance per hour**
  of that employee "quitting" (soft-fail, recoverable): on quit, the
  employee's _level resets to level 1 and unlocked traits are cleared_, but
  the identity itself persists (it's the same real machine/project, so it
  "gets rehired" — fires the employee-sim equivalent of `unlocks` never
  reverting: the RECORD of past achievement stays in a history log, the
  ACTIVE level/trait state resets). This is `[OWNED ELSEWHERE: Employees]`
  for the exact quit/rehire mechanic; this doc only defines the morale-decay
  input and the trigger threshold.

### 4.3 Office grime & Reputation decay (soft-fail #2)

- **Grime** is an office-wide (not per-employee) `0..100` stat, visual-only
  (dirty floor tiles, dead plants) — ties into Building section's render but
  the number lives here.
  - Decay: `+1 grime per 6 idle-tick-hours` (i.e., grows slowly, always
    trending toward dirty absent any cleaning action), capped at 100.
  - Sink: a "cleaning" action (assign an employee, or auto via a purchased
    janitorial perk) resets grime by `-30` per cleaning pass, real-Cash cost
    **0** (same free-recovery principle as morale's break sink — visual
    neglect must always be recoverable without a paywall).
  - Effect: purely cosmetic + small morale-decay-rate multiplier (`grime >
70` doubles the passive morale decay rate in §4.2) — grime is a leading
    indicator, not a direct Cash/Rep tax.
- **Reputation decay:** `-1 Rep per full real-calendar-day with zero
completed turns AND zero dispatch runs` (a fully dark day), floored at
  **0** (Reputation never goes negative). A single dark day costs 1 point —
  deliberately small relative to the +40..+200 milestone rewards, so missing
  a day is a nudge, not a cliff. No decay at all on days with any real
  activity, however small — this rewards _any_ real touch, not volume.

### 4.4 Why these numbers are soft, not hard-fail

Every decay path above has a floor (morale 20 outside active events, grime
100 cap, Reputation 0 floor) and every soft-fail state has a **free**
recovery sink (break, cleaning). Nothing compounds into a permanent-loss
spiral except the quit-risk roll, which itself resets to level 1 rather
than deleting the employee record — matching Greg's "recoverable but felt"
stakes requirement exactly, and matching the "no hard bankruptcy" line.

---

## 5. Automation budget guardrail rule (consumed here, built in Command section)

**R-AUTO-1 (hard rule, enforce in `simTick.ts` and in the dispatch-runner
path, not just the UI):** before any standing-order/automation-perk fires a
real dispatch, check `BudgetHeadroom` (A5). If `claude5h < 0.10` OR
`claudeWeekly < 0.05` (thresholds placeholder, Command section may tune),
the standing order is skipped for that cycle and logged as `⚠ SKIPPED —
budget headroom`, never silently retried in a hot loop. Cash/Rep are NEVER
spent to bypass this — the perk purchase only ever unlocks the _queue slot_,
never the _right to exceed the real cap_. This is the mechanical
implementation of the locked-vision line "raising payroll consciously = the
player deciding to use more of the real limit" — the game can make spending
more headroom _legible and deliberate_, it can never make more headroom
_appear_.

---

## 6. Ambient/world events (loosely-coupled flavor between real events)

Random-event roll happens inside `runTick`, independent of real events —
this is the explicit "sim runs freely between real events" requirement.

- Roll chance: **3% per tick** (≈ once per ~8 tick-hours on average) for a
  minor flavor event (coffee run, two employees chatting, a random compliment
  bump of `+1 morale` to one random employee).
- Roll chance: **0.3% per tick** (≈ once per ~1.4 tick-days on average) for a
  named world event from a fixed table (power surge → temporary grime +10;
  inspection → temporary morale flavor text only; rival studio poaching →
  flavor-only unless Employees section wants it to threaten quit-risk, in
  which case it should call into §4.2's quit mechanic rather than defining
  its own).
- **Hard rule: no world event ever grants or costs Cash/Reputation.** World
  events are flavor + at most a small morale/grime nudge (≤5 points),
  keeping the _only_ Cash/Rep economy honest and fully explained by §2's
  table. This is the line between "living office" and "idle-game currency
  faucet from RNG" — the locked vision wants the former.

---

## 7. Anti-dark-pattern audit (every number, one pass)

| Rule                                                        | Where enforced                                                                                       | Check                                                                                                                  |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Volume (tokens/turns count) never pays more than efficiency | §2.1 Cash table: LEAN > STEADY > HEAVY, always                                                       | `HEAVY` reward is literally 0 in both currencies, never negative-then-recoverable-by-spend                             |
| No idle/passive Cash generation                             | §2.1 header + §3 rule 1 (tick never grants currency)                                                 | grep test: `economyStore.ts` currency-add methods are only called from real-event handlers, never from `simTick.ts`    |
| No Reputation shop (can't buy prestige)                     | §2.2 "Sinks: none"                                                                                   | Reputation has zero spend methods in `EconomyStore`                                                                    |
| Automation can't buy past a real rate limit                 | §5 R-AUTO-1                                                                                          | perk purchase unlocks capability flag only; headroom check is a separate, unconditional gate in the runner path        |
| Soft-fail always has a free recovery path                   | §4.2 break (free), §4.3 cleaning (free)                                                              | both sinks hard-coded at Cash cost 0, not "cheap" — actually zero                                                      |
| No pay-to-avoid-decay                                       | Decay formulas (§4.2–4.3) have no "spend Cash to pause decay" sink anywhere in this doc              | absence is the point — if a later section proposes one, it needs an explicit exception discussion, not a silent add    |
| Colorblind-safe status                                      | §4.2 morale thresholds use shape glyphs (◆◇▽✕) + words, never color-only                             | matches vault-wide hard rule                                                                                           |
| Dashboard function never gated behind game state            | Nothing in this doc reads BRIEFING/dispatch/telemetry visibility conditional on Cash/Rep/level       | cross-check against Command + existing `help screen registry-enforced` pattern                                         |
| No negative-real-money framing                              | Failed dispatch runs pay 0, not negative Cash; a fictional currency going to zero costs nothing real | Cash/Rep are entirely fictional-in-consequence; the only real resource (headroom) is read-only gated, never spent-into |

---

## 8. Concrete file/schema deliverables (for the execution plan)

- `server/src/economyStore.ts` — new. Class `EconomyStore` mirroring
  `ProgressionStore`'s shape: `cash: number`, `reputation: number`,
  per-employee `morale: Record<employeeId, number>`, `grime: number`,
  `lastTickAt: number`, unseen-flavor-event ring buffer (cap 50). Methods:
  `addCash(amount, reason)`, `addReputation(amount, reason)` (both take a
  `reason` string for the audit-log/no-dark-pattern grep test above),
  `applyDecay(elapsedMs)`, `rollRandomEvent(now)`, `getSnapshot()`,
  persist/load pair copying `progressionStore.ts`'s throttle+VITEST-guard
  idiom verbatim.
- `server/src/simTick.ts` — new. Owns the `setInterval`, wires
  `economy.applyDecay` + `economy.rollRandomEvent` + broadcast. Constant
  `SIM_TICK_INTERVAL_MS = 15_000` added to `server/src/constants.ts`
  alongside the existing interval constants block.
  `EMPLOYEE_MORALE_DECAY_PER_HOUR = 0.5`, `GRIME_DECAY_PER_HOUR_DIVISOR = 6`,
  `REPUTATION_DECAY_DARK_DAY = 1`, `TICK_CATCHUP_CAP_MS = 72 * 3_600_000` —
  all as named exported constants, not inline magic numbers, matching the
  existing `constants.ts` convention.
- New WS message `economyTick` added to the asyncapi schema alongside
  `progressionUpdate` (same generator, same location the v1 commits touched
  for `AgentPidUpdate`).
- New route `GET /api/economy/summary` (check-in digest: current
  cash/reputation/morale-summary/grime + last-N flavor events) —
  same route-registration pattern as `/api/shift` in `httpServer.ts`.
- Wire `economy.addCash`/`addReputation` calls into the exact same call
  sites `progression.recordTurnEnd/recordCrisisResolved/recordShiftDayClosed`
  are already wired into (hook handler, poll-state transition, `ShiftStats`
  `onDayClose`) — do not create parallel event plumbing, extend the existing
  call sites so Cash/Rep/XP always stay in lockstep per real event.

---

## Risks

- **R1 — Two parallel per-employee stat stores.** If the Employees section
  independently designs a `traits`/`level` store, and this doc's `morale`
  map lives in a _separate_ `EconomyStore`, they'll drift (different
  employee-identity keys, different persistence cadence). Needs
  reconciliation: probably one `EmployeeStore` owning morale+traits+level
  together, with `EconomyStore` only owning Cash/Reputation/grime. Flagging
  now rather than guessing Employees' schema.
- **R2 — Sim tick under multi-machine/no-webview reality.** The tick runs
  in the NEXUS server process, which is already always-on — but if Engine
  section's phone/PWA push notifications need a _client-side_ countdown or
  local prediction between server pushes, `economyTick`'s 15s broadcast
  cadence may feel laggy on phone check-ins. May need a lighter, more
  frequent `/api/economy/summary` poll for the phone shell specifically.
- **R3 — File-backed JSON at employee-sim scale.** A2 assumes JSON-sidecar
  persistence is fine at ~2–8 employees. If Building section's
  room/furniture/adjacency queries want relational lookups (e.g. "employees
  in room X sorted by morale"), a flat JSON blob works but every section
  reads/writes the same 200-line-ish file — lock contention or accidental
  clobber risk mirrors the "shared-checkout" incident already logged in
  `.planning/STATE.md` 2026-07-08, just at the data layer instead of git.

## Three things most likely to be wrong

1. **The Cash numbers (§2.1) are invented, not calibrated against real
   observed event frequency.** A real day might produce 40 turns (+80 Cash)
   or 4 turns (+8 Cash) — I haven't pulled actual `shift-stats.json`
   history to tune constants against Greg's real cadence. These are
   starting values explicitly meant to be tuned after a week of real
   telemetry, not final.
2. **The quit-risk mechanic (§4.2) may be too harsh or too soft** without
   seeing how Employees section wants "identity persistence vs. reset"
   to feel — resetting level-to-1 on quit could feel punishing for a solo
   2-Mac setup where losing your one "senior" employee is a big session-long
   setback, contradicting the "recoverable but felt" (not "keenly painful")
   requirement. May need a partial-reset (e.g. -50% levels, not to 1).
3. **The tick/event split (tick never grants currency, only decays) is the
   right anti-dark-pattern spine, but it assumes every currency-worthy real
   event already has a server-side hook to attach to.** Contract completion
   (Missions) and dispatch-exit (already exists) are covered; something like
   "actively working in the office view for N minutes" (a pure engagement
   metric, not real work) is NOT a source here on purpose — if Missions or
   Engine sections want a "session length" reward, it must be rejected or
   routed through this doc's audit table, not added ad hoc.
