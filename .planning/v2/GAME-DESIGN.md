# War Room v2 — Game Design (merged, contradiction-free)

Status: REV 2, 2026-07-08 — synthesized from 8 section drafts + adversarial
critiques, then revised against Greg's 32-question interrogation answers
(see the "Greg interrogation deltas" appendix; those answers are locked).
The 8 section drafts are ARCHIVED at `.planning/v2/archive/sections/` —
they contain known-false repo claims and are NOT authoritative for
anything; this document and BUILD-PLAN.md are the only design authorities,
and grepping the repo beats both. See "Conflict resolutions" (§9) for the
record of every synthesis override and why.

Grounded against real repo `/Users/greg/code/war-room`, branch `war-room/v1`,
HEAD `50f9ef2` (2026-07-08): server 329/329, webview 158/158, bin 63/63,
tsc/lint/build clean, dispatch vertical live + E2E-verified on NEXUS
(tailnet-only `:8484`).

---

## 1. Vision (Greg's locked answers, 2026-07-08)

War Room v2 is ONE coherent game, not four modes bolted together: a studio
boss manager sim + colony sim (employees have moods) + command-center
RTS-lite + idle empire, all reading the same state. Interrogation-locked
framing (2026-07-08): the core payoff is the **automation command center**
— managing multiple real sessions and watching results compound against
the real todo list — delivered as _a genuinely fun way to make real work
visible_. Contracts & crunch is the #1 slice when anything must triage.

- **REALNESS (relaxed):** the game has a full layer, loosely coupled to real
  work. Real events (turns, crises, shift grades, dispatch runs) feed the
  economy; the sim runs freely between real events (ambient office life,
  offline progress). Fictional flavor may be invented freely. **Real money
  (Cash/Reputation) and real completion facts may never be faked** — only
  fictional flavor may be invented on top of them.
- **ECONOMY:** dual currency. Cash (liquid, earned from real
  completions/efficiency, spent on upgrades/training/rooms). Reputation
  (permanent, slow, from streaks/shift grades, gates promotion/contract
  tiers, never spent).
- **EMPLOYEES:** colony-sim layer, mood-only (interrogation delta: the
  three per-employee needs meters are CUT — nothing to micromanage).
  Persistent named characters per (machine, project) identity. Traits
  derived from real behavior stats. Levels, mood, work history, template
  one-liner personalities. Verbs: hire, assign, train, promote, break,
  fire, retire, rehire.
- **BUILDING:** full build mode. Buy floor space, place typed rooms, place
  buffed furniture, adjacency bonuses, walk paths matter.
- **STAKES:** soft-fail. Neglect → mood drops → employees can quit
  (lose level/traits, recoverable) → reputation decays → office gets grimy.
  Every soft-fail path has a **free** recovery sink. No hard bankruptcy.
  Interrogation deltas: Reputation decay gets a **1-day grace** (rest days
  are designed-for), and an explicit **vacation/away toggle** freezes all
  decay/quits/Rep loss (§4.5).
- **CADENCE:** idle check-in loop (offline progress) + 20-60min dedicated
  sessions + phone play.
- **MISSIONS:** both layers. Real vault todos/gates become Contracts with
  Cash/Rep rewards (completing the real work completes the quest).
  Game-generated dailies/weeklies keep the loop warm between real events.
- **COMMAND:** dispatch chains (multi-step, output feeds next step) +
  standing orders (recurring automation) + Cash-purchased automation perks.
- **WORLD:** living office between real events — ambient wander, coffee
  runs, random events, day/night, seasons — all cosmetic flavor, never
  touching real Cash/Rep/completion facts.
- **BUDGET GUARDRAIL:** automation spends REAL tokens against Greg's actual
  Claude 5h/weekly and Codex ChatGPT-plan limits. The game reads/estimates
  headroom and self-pauses automation near the cap. Cash can buy the
  _capability_ to automate more, never the _right to exceed_ the real limit.
- **ENGINE:** PixiJS v8 renderer swap inside the existing React shell.
  Telemetry/Fastify/WS plane unchanged. Phone-friendly, PWA-installable.
- **ART:** animated employees, day/night, weather, seasons — generated via
  the Diablito gpt-image-2 pipeline (`/Users/greg/code/Diablito`).
- **V1.0 BAR:** all three slices DEEP (living studio+employees, empire
  economy loop, contracts & crunch) — not thin cuts.
- **HARD RULES (unconditional, apply to every system below):**
  1. Never gate real dashboard function behind game progress/state.
  2. No dark patterns on real money: efficiency/completion earn, volume
     never does. `HEAVY`-graded days always pay `0`, never negative.
  3. Colorblind-safe: shape + text label is the primary signal everywhere,
     color is reinforcement only. Grayscale screenshot test on every
     visual milestone.
  4. Tailnet-only. No new external scopes/funnels.
  5. Gated actions (deploy, NEXUS docker/tailscale, installs) stay a
     human-run runbook or an explicit, freshly-reconfirmed Greg
     authorization — a prior session's "yes" does not carry over.
  6. Atomic conventional commits, em-dash subject, explicit-path staging
     (never `git add -A`). One agent per checkout unless a wave/worktree
     partition is explicitly proven safe first (see BUILD-PLAN.md).

---

## 2. The one core loop

One state machine, three read/write cadences, all touching the same
server-authoritative stores. No renderer ever mutates game state — the
client is a projection, same relationship the client already has to
`progressionStore`/`shiftStats`/`dispatchStore` today.

| Cadence                                      | Trigger                                                    | What runs                                                                                                                                                                   |
| -------------------------------------------- | ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Real event** (server, synchronous)         | hook Stop, crisis resolved, shift day close, dispatch exit | Cash/Reputation/XP awarded, employee stats updated — the ONLY place currency is ever granted                                                                                |
| **Connect catch-up** (server, on WS connect) | a webview connects                                         | one-jump offline-progress calc: decay (mood/grime/reputation) over `min(elapsed, 72h)`, capped world-event catch-up (≤1 event per skipped calendar day), broadcast snapshot |
| **Live tick** (server, coarse interval)      | ≥1 socket connected, every 5 min                           | visible mood/grime decay during a long session; world-event roll; stops the instant the last socket disconnects                                                             |
| **Session** (webview, 20-60min)              | app open                                                   | build mode, dispatch, employee roster, drawer/inspection                                                                                                                    |
| **Check-in** (webview, phone, <2min)         | app opened briefly                                         | `/api/economy/summary` digest: net Cash/Rep delta + top-5 flavor events + mood/grime warnings                                                                               |

**No always-on `setInterval` tick loop.** This is the single biggest
architecture decision this synthesis makes (§9.1) — the game computes state
on-demand (real event or WS connect) plus one coarse 5-min interval gated on
having a live socket, never a perpetual background loop running against
nobody.

### 2.1 What a session actually feels like (the fun contract)

The loop must survive this test: _would Greg open it when nothing is on
fire?_ Each cadence has its own payoff:

- **Check-in (<2 min, phone):** open → offline-progress digest lands as a
  short "while you were out" story (net Cash/Rep, top-5 flavor events, any
  mood/grime warnings) → one or two taps (claim a contract, send someone
  on break, start a standing order) → close. The payoff is _narrative +
  one decision_, never a chore list.
- **Session (20-60 min, desk):** the real-work window. Greg works; the
  office animates his actual sessions; between his own turns he spends
  earnings — build a room, train the employee who just leveled, wire a
  chain for tomorrow morning. The payoff is _watching real work become
  visible progress, then reinvesting it_.
- **Crunch (crisis/contract deadline):** the RTS-lite spike — triage the
  fire, dispatch the right employee, watch the resolve bonus land. The
  payoff is _agency under pressure with real stakes_.

If a milestone ships a system that adds obligations without adding one of
those three payoffs, it has failed this section even if every test is
green.

---

## 3. Economy (Cash + Reputation)

### 3.1 Cash — liquid, spendable

**Sources** (canonical numbers, in `server/src/economyConstants.ts`):

| Source                   | Cash                                       | Real event                                                                                                                                                                                                                                                      |
| ------------------------ | ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Turn completed           | +2                                         | hook Stop (Claude only)                                                                                                                                                                                                                                         |
| Crisis resolved          | +10                                        | observed blocked→unblocked transition                                                                                                                                                                                                                           |
| Shift day LEAN           | +100                                       | `ShiftStats.onDayClose` — mirrors real `XP_SHIFT_GRADE_BONUS.LEAN=50` ×2                                                                                                                                                                                        |
| Shift day STEADY         | +40                                        | mirrors `XP_SHIFT_GRADE_BONUS.STEADY=20` ×2                                                                                                                                                                                                                     |
| Shift day HEAVY          | +0                                         | never negative — lower spend always pays ≥ higher spend                                                                                                                                                                                                         |
| Dispatch exits 0         | +5, hard capped +50/local day              | nonzero exit pays +0, never negative. The cap exists because dispatching is one click that burns REAL tokens — uncapped it would pay for volume (hard rule #2 violation); the cap keeps it a completion reward, not a farm                                      |
| Streak-day touch         | +10 flat, once/day                         | same real-activity definition as `progressionStore`'s streak — but `touchStreak` is `private` (progressionStore.ts:221), so economyStore tracks its own last-active-date at the same `recordTurnEnd` call sites, it does not subscribe to progression internals |
| Contract completed       | per Contract's `payoutCash`                | see §6 — Missions section owns this table                                                                                                                                                                                                                       |
| World-event flavor bonus | +1..+5, **hard capped +5/local day total** | the ONE exception to "no idle/passive Cash," see §9.3                                                                                                                                                                                                           |

**No Cash source ever reads token volume, session count, or elapsed idle
time as a multiplier** except the capped flavor-bonus exception above.

**Sinks:**

| Sink                  | Cost                                 | Notes                                      |
| --------------------- | ------------------------------------ | ------------------------------------------ |
| Bay (floor expansion) | `500 * 1.55^n`                       | Section: Building, §5                      |
| Room shell            | 250-1200 by type                     | Section: Building, §5                      |
| Furniture piece       | 20-200                               | Section: Building/Art                      |
| Employee training     | 100/session, 1/employee/day cooldown | Section: Employees, §4                     |
| Employee promotion    | `200 * nextTierIndex`                | Section: Employees, §4                     |
| Automation perk       | 500/800/1500/2500                    | Section: Command, §7                       |
| Break / cleaning      | **0 (always free)**                  | soft-fail recovery must never be paywalled |
| Cosmetic decor        | 10-50                                | pure flavor sink                           |

### 3.2 Reputation — permanent, slow, prestige

**Never spent** — no Reputation shop. Gates thresholds only (contract tiers,
promotion ≥300, prestige cosmetics).

| Source                                | Rep                                                                                  |
| ------------------------------------- | ------------------------------------------------------------------------------------ |
| Shift day LEAN / STEADY / HEAVY       | +3 / +1 / +0                                                                         |
| Streak milestone 3d / 7d / 30d        | +10 / +30 / +120 (tuned by synthesis — retune after 1 week real telemetry, per §9.2) |
| Level-up                              | +2/level                                                                             |
| Contract completed (gate tier)        | +10 (flat, per Missions §6)                                                          |
| Contract completed (priority/backlog) | +2 / min(5, floor(count/5))                                                          |

**Decay (soft-fail):** `-1 Rep` per full real-calendar zero-activity day
(zero completed turns AND zero dispatch runs), floored at 0, **with a
1-day grace**: the FIRST consecutive zero-activity day is always free;
decay starts on the second (interrogation delta — rest days are
designed-for, not penalized). No decay on any day with any real activity,
however small. No decay at all while vacation mode (§4.5) is on.

### 3.3 The "payroll" framing

Automation (standing orders, chain auto-continuation) spends _real_ tokens.
Cash purchases only ever unlock the **capability** (a standing-order slot, a
higher pause threshold within a hard ceiling) — never bypasses the real
rate-limit check itself. See §7.4 (Budget Guardrail) for the mechanism.

### 3.4 Anti-dark-pattern audit (unconditional, checked every milestone)

| Rule                                                          | Enforcement                                                                                                          |
| ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Volume never pays more than efficiency                        | `HEAVY` reward is literally 0 in both currencies                                                                     |
| Dispatch Cash can't be farmed by burning real tokens          | `+5` per exit-0 hard-capped at `+50`/local day (`DISPATCH_CASH_DAILY_CAP` in `economyConstants.ts`), boundary-tested |
| No idle/passive Cash beyond the capped flavor-bonus exception | grep test: currency-add calls only from real-event handlers or the flavor-bonus call site, never a bare tick         |
| No Reputation shop                                            | zero spend methods on `reputation`                                                                                   |
| Automation can't buy past a real rate limit                   | perk purchase unlocks a flag; budget check is a separate, unconditional gate in the runner path                      |
| Soft-fail always has a free recovery path                     | break/cleaning hard-coded Cash cost 0                                                                                |
| No pay-to-avoid-decay                                         | absence is the point — any future proposal needs an explicit exception discussion                                    |
| First-run confirm never purchasable                           | a new standing order's first fire always requires a human click — no perk removes this (Autopilot perk CUT)          |
| Global kill switch always reachable                           | STOP ALL control (§7.5) on desktop AND the phone check-in view, pauses all automation in one tap                     |
| Colorblind-safe                                               | every threshold/status is shape+word, verified by grayscale screenshot                                               |
| Dashboard never gated behind game state                       | nothing reads BRIEFING/dispatch/telemetry visibility conditional on Cash/Rep/level                                   |

### 3.5 Pacing sanity check (provisional, retune with §9.2)

Back-of-envelope on a typical productive day at these rates: ~30 turns
(+60), LEAN close (+100), streak touch (+10), 2 crises (+20), a few
dispatches (+25), 2-3 contracts (~+100) ≈ **300 Cash/day**. Against the
sinks: first bay ≈ 2 days, Dev Pit ≈ 1 day, War Room ≈ 4 days, the full
perk ladder (2800 — 3 perks, Autopilot cut) ≈ 10 days of consistent play.
That is deliberate
idle-empire pacing — always something affordable within a session,
something aspirational within a week. If a week of real telemetry shows
income off by >2x from this envelope, retune `economyConstants.ts` (one
file, one commit), not the design.

---

## 4. Employees (colony-sim layer)

**Store:** `server/src/employeeStore.ts`, file-backed at
`~/.pixel-agents/employees.json`, mirroring `progressionStore.ts`'s exact
persistence idiom (lazy homedir resolution, 5s throttled persist, tolerant
load, `VITEST` guard, `onChange` listener list).

### 4.1 Identity

```ts
function employeeId(machine: string, projectDir: string): string {
  const slug = normalizeProjectPath(projectDir); // reuse core/src/normalizeProjectPath.ts
  return `${machine || 'LOCAL'}:${slug}`;
}
```

One employee per **(machine, project)** pair. Provider (claude vs codex) is
an **attribute** (`defaultProvider`), not part of identity — dispatching the
same project via a different provider is the same employee using a
different tool, not a different hire (§9.4 — resolves the 4-way identity
disagreement across sections).

**Rehire-after-fire:** firing blacklists the base key; new telemetry under
the same key becomes a new `${key}#${n}` employee. A natural **quit**
(mood-driven, not fired) does NOT blacklist — the same key returning real
telemetry auto-rehires under the same id, same name/sprite/history.

### 4.2 Record shape

```ts
export type EmployeeStatus =
  | 'candidate'
  | 'active'
  | 'on_break'
  | 'training'
  | 'quit'
  | 'fired'
  | 'retired';
export type EmployeeRank = 'Junior' | 'Senior' | 'Lead' | 'Principal';

// NOTE (interrogation delta): per-employee needs (energy/social/hygiene)
// are CUT. Mood is the single managed meter. Needs-flavored behavior
// (coffee runs, break-room visits) survives as pure ambient animation.
interface EmployeeScores {
  speed: number;
  accuracy: number;
  nightOwl: number;
  tokenEfficiency: number;
} // 0-100, derived

interface Employee {
  id: string;
  machine: string;
  projectDir: string;
  projectLabel: string;
  name: string; // deterministic from id hash, stable across quit/rehire
  spriteIndex: number; // raw deterministic hash of id — the WEBVIEW resolves the sprite as
  // spriteIndex % getLoadedCharacterCount() (webview-ui/src/office/sprites/
  // spriteData.ts:51, verified real). There is NO server-side character-count
  // API — server/src/assetLoader.ts is extension-era vscode code; don't touch it.
  defaultProvider: 'claude' | 'codex';
  defaultModel?: string; // optional dispatch-prefill model (see §7.3)
  status: EmployeeStatus;
  rank: EmployeeRank;
  xp: number; // employee-local XP pool, separate from account-wide progression XP
  mood: number; // 0-100 STORED base value (needs cut — no longer derived from
  // needs). Decays slowly while idle (§4.5), restored by break (free) and
  // positive events. Effective mood on read = clamp(0,100, mood + moodBoost).
  moodBoost: number; // transient event term, clamped [-20,+20], halves each
  // local day — direct one-shot events (§4.5) write here, never to mood base
  scores: EmployeeScores; // derived from rolling turn stats, MIN_SAMPLES=5 gate (else "ROOKIE")
  trainingBonus: { speed: number; accuracy: number; nightOwl: number; tokenEfficiency: number };
  rolling: {
    recentTurns: Array<{
      ts: number;
      wallMs: number;
      outputTokens: number;
      wasError: boolean;
      hour: number;
    }>;
  }; // ring buffer, cap 50
  assignedRoomId?: string;
  createdAt: number;
  lastActiveAt: number;
  lowMoodStreakDays: number;
  breakUntil?: number;
}
```

Unbounded ledger, append-only, outside the hot file:
`~/.pixel-agents/employee-history/<id>.jsonl` (tail-keep at 5000→2500 lines,
same tolerance-over-completeness posture as every other file store).

### 4.3 Traits (derived, never player-assigned)

Recomputed from `rolling.recentTurns` on every `recordTurn()` call (turn
completion or dispatch exit, whichever source). Below `MIN_SAMPLES=5`,
scores stay at neutral defaults (50/50/0/50) and the badge is `◔ ROOKIE`
(suppresses all others — never show a misleadingly precise score off 1-4
samples).

```ts
const SPEED_MS_REFERENCE = 180_000;      // 3-min reference turn (new, employee-local)
// import { EFFICIENCY_LEAN_MAX, EFFICIENCY_STEADY_MAX } from shiftStats.ts — don't retype.
// VERIFIED REAL EXPORTS: EFFICIENCY_LEAN_MAX = 1_500, EFFICIENCY_STEADY_MAX = 6_000
// (server/src/shiftStats.ts:76-77). An earlier draft cited EFFICIENCY_HEAVY_MAX = 12_000,
// WHICH DOES NOT EXIST — HEAVY is simply anything above STEADY_MAX. Corrected scale below.

speed          = clamp(0,100, 100 - (avgWallMs / SPEED_MS_REFERENCE) * 100) + trainingBonus.speed
accuracy       = clamp(0,100, 100 - errorRate * 200) + trainingBonus.accuracy   // 50% errors -> 0
nightOwl       = clamp(0,100, nightFrac * 100) + trainingBonus.nightOwl
tokenEfficiency = clamp(0,100, scale(avgOutTok, EFFICIENCY_LEAN_MAX..EFFICIENCY_STEADY_MAX, 100..0)) + trainingBonus.tokenEfficiency
// i.e. ≤1500 avg output tokens/turn scores 100, ≥6000 (the real HEAVY threshold) scores 0
```

| Badge        | Glyph | Condition                                        |
| ------------ | ----- | ------------------------------------------------ |
| ROOKIE       | `◔`   | `recentTurns.length < 5` (suppresses all others) |
| FAST         | `⚡`  | `speed >= 70`                                    |
| SLOPPY       | `✗`   | `accuracy < 50`                                  |
| METICULOUS   | `✓✓`  | `accuracy >= 85`                                 |
| NIGHT OWL    | `☾`   | `nightOwl >= 40`                                 |
| EFFICIENT    | `⬇`   | `tokenEfficiency >= 70`                          |
| BURNS TOKENS | `⬆`   | `tokenEfficiency < 30`                           |

### 4.4 XP, leveling, rank

Reuse `core/src/leveling.ts` (new, extracted from `progressionStore.ts`'s
`xpForLevel`/`computeLevel` as pure parameterizable functions — the
refactor must leave `progressionStore.test.ts` green unmodified).
Employee curve: `{ base: 60, step: 30 }` (flatter than the account-wide
`{base:100, step:50}` curve — many employees leveling in parallel should
each feel faster).

```ts
XP_TURN = 4;
XP_CRISIS_RESOLVED = 12;
XP_DISPATCH_EXIT_0 = 8;
XP_DISPATCH_EXIT_NONZERO = 2; // never 0, never negative
```

| Rank      | Min level | Training bonus cap/track |
| --------- | --------- | ------------------------ |
| Junior    | 1         | +12                      |
| Senior    | 5         | +20                      |
| Lead      | 10        | +28                      |
| Principal | 18        | +36                      |

Promotion is a player verb, gated by level threshold — leveling up alone
does not auto-promote.

### 4.5 Mood, quit, vacation (soft-fail)

Mood is a **stored** 0-100 base value (needs cut — interrogation delta):

```ts
MOOD_DECAY_PER_HOUR_IDLE = 0.3; // slow drift down while the employee is idle
MOOD_DECAY_PER_HOUR_ACTIVE = 0; // working on real turns never drains mood
MOOD_BREAK_RESTORE = 30; // break (always free) adds to mood base, cap 100
// Break Room buff: mood regen ×1.5 while on break and inside (§5.3)
// grime > 70 multiplies idle decay ×1.5 (economyStore's office-wide grime)
```

One-shot events write to the transient `moodBoost` term (§4.2), never to
the base: crisis resolved by this employee +5, shift LEAN (studio-wide)
+5, promotion +15, training +3, shift HEAVY −5 **only when the day's
error rate is also high** (interrogation delta: a heavy-but-clean day is
mood-neutral — HEAVY alone already pays 0 Cash; the mood hit is reserved
for heavy AND sloppy, defined as day error rate ≥ 20%). `moodBoost`
halves each local day and clamps to ±20.

**Vacation mode (interrogation delta):** one studio-wide toggle
(`POST /api/economy/vacation`, persisted flag, glyph+label `⏸ ON HOLIDAY`
banner). While on: zero mood decay, zero grime accrual, zero Reputation
decay, quit rolls suspended, world events suppressed except pure-ambient
ones, employees animate on holiday. Turning it off resumes decay from the
off-timestamp — the away period never back-charges.

**Quit mechanic** (deterministic, testable — `mulberry32` seeded by a hash
of `id|date`, never `Math.random()`):

```ts
QUIT_THRESHOLD_MOOD = 20;
QUIT_GRACE_DAYS = 5;
// mood < 20 for QUIT_GRACE_DAYS consecutive real-calendar days →
// chance = clamp(0, 0.6, ((20 - mood) / 20) * 0.6), rolled once/day
// on quit: xp = xpForLevel(max(1, floor(currentLevel/2))) — HALVE, never reset to 1
// status='quit' (NOT blacklisted — same id auto-rehires on next real telemetry)
```

Halving (not resetting to level 1) is the deliberate resolution of a
contradiction between drafts — "recoverable but felt," not devastating,
matches the locked STAKES answer (§9.5).

**Break** is Cash-free, cosmetic + mood-restoring only. **It never blocks
real dispatch to that employee's project/machine** (§9.6 — hard rule,
resolves a direct contradiction found in review).

**Personality (interrogation delta):** every employee gets template
one-liners — deterministic quip pools in `core/src/quips.ts`, keyed off
(trait badge, mood band, event type), seeded by `hash(id|date|event)` so
the same moment always renders the same line. Consumed by webview speech
bubbles and the digest's flavor lines. No LLM, no tokens, pure functions
— unit-testable like `crisis.ts`.

### 4.6 Verbs

| Verb                  | Cost                  | Gate                                    | Blocks real work?                   |
| --------------------- | --------------------- | --------------------------------------- | ----------------------------------- |
| Auto-hire (candidate) | 0                     | first real telemetry for a new id       | No                                  |
| Onboard               | 0                     | player click or auto after 3 real turns | No                                  |
| Assign                | 0                     | active                                  | No                                  |
| Train                 | 100, 1/employee/day   | active, track < rank cap                | No                                  |
| Promote               | `200 * nextTierIndex` | level ≥ tier, mood ≥ 50                 | No                                  |
| Break                 | 0                     | active                                  | **No — cosmetic/mood only**         |
| Fire                  | 0                     | not terminal                            | No — Reputation −10, blacklists key |
| Retire                | 0                     | level ≥ 10                              | No — Reputation +10, Hall of Fame   |
| Rehire                | `2 * BASE_HIRE_COST`  | status fired/quit                       | No                                  |

Every "Blocks real work?" answer is re-verified against hard rule #1
before implementation — no exceptions ship silently.

**Retire ceremony (interrogation delta):** Retire is also the canonical
answer to "the real project ended" — when Greg archives/kills a project,
he retires its employee: a one-time celebration moment (confetti burst via
the crisis-effects particle system, farewell quip), then a permanent Hall
of Fame entry (name, rank, level, badge history, tenure dates) rendered in
the roster's retired tab. History JSONL is preserved, never deleted.
No auto-retire — it stays a player verb.

---

## 5. Building (office expansion)

Canonical building spec (Section 03, verified against real repo constants
— see §9.7). **Section 08's competing zone-tier/roomAdjacency design is
superseded** — this chapter is authoritative.

### 5.1 Grid (verified real, unchanged)

`TILE_SIZE=16`, `DEFAULT_COLS=20`, `DEFAULT_ROWS=11`, `MAX_COLS=64`,
`MAX_ROWS=64` (`webview-ui/src/constants.ts` — confirmed present this
session, contradicting an earlier draft's "no bounds exist" premise).
Logical grid, pathfinding (`tileMap.ts` BFS, 4-connected), and
`OfficeLayout.tiles` indexing are **unchanged**.

### 5.2 Floor expansion — bays

- Expansion unit: a 4-col bay appended to the right edge of owned floor.
- Max bays: `(64-20)/4 = 11`.
- Cost: `500 * 1.55^n` Cash (`n` = bays already owned, geometric so late
  bays cost meaningfully more relative to a growing income rate).
- `POST /api/building/expand`: checks Cash, debits, converts the next
  4×rows `VOID` rectangle to floor, opens a doorway automatically at the
  shared wall midpoint (new floor is always reachable at purchase time),
  persists via `layoutPersistence.ts`, broadcasts `officeExpanded`.
- **Bays are never sellable** — permanent once bought.

### 5.3 Rooms

A room is a player-drawn rectangle tag over already-purchased floor —
metadata, not a new tile type (matches `pets`/`tileColors` precedent).

```ts
export const RoomType = {
  DEV_PIT: 'dev_pit',
  SERVER_ROOM: 'server_room',
  BREAK_ROOM: 'break_room',
  WAR_ROOM: 'war_room',
  KITCHEN: 'kitchen',
} as const;
interface PlacedRoom {
  uid: string;
  type: RoomType;
  colStart: number;
  rowStart: number;
  colEnd: number;
  rowEnd: number;
  createdAt: number;
}
```

`OfficeLayout.rooms?: PlacedRoom[]` — additive, `migrateLayout()` coerces
missing → `[]` (same pattern as the existing `pets` migration).

| Room        | Footprint | Cost | Buff                                                              | Scope                 |
| ----------- | --------- | ---- | ----------------------------------------------------------------- | --------------------- |
| Dev Pit     | 4×3       | 300  | +15% XP for employees seated inside                               | per-desk              |
| Server Room | 3×3       | 800  | +10% Cash company-wide while ≥1 SERVER_RACK placed inside         | **global**            |
| Break Room  | 3×3       | 400  | mood regen ×1.5 while on break and inside                         | per-desk, situational |
| War Room    | 4×4       | 1200 | +25% bonus XP on crisis resolution when resolver's seat is inside | per-event             |
| Kitchen     | 3×2       | 250  | passive company-wide mood-decay-rate ×0.85                        | **global**, ambient   |

Rules: rectangle must be all-owned, non-`VOID`/`WALL` at creation.
Rectangles MAY overlap (no exclusion enforcement in v1.0). Shrinking a
room below its minimum footprint via sell auto-disbands it.

### 5.4 Furniture buffs + adjacency

New sidecar (not a manifest rewrite): `webview-ui/src/office/layout/furnitureBuffs.ts`.

```ts
interface FurnitureBuff {
  cashBonusPct?: number;
  xpBonusPct?: number;
  moodRegenDelta?: number;
  adjacencyRadius?: number;
}
```

Chebyshev-distance adjacency: same-type items don't stack (strongest
instance only); different types stack additively. **Shared 40% cap** —
furniture-adjacency bonus and room-membership bonus draw from the **same**
`ADJACENCY_AND_ROOM_BONUS_CAP_PCT = 40` pool per desk, not two independent
40% caps (resolves §9.7's stacking-cap gap: two caps stacking to 80% would
defeat the purpose of having one).

### 5.5 Buff resolution (closes the global-vs-per-desk gap)

One function, `server/src/buildingBuffs.ts::computeActiveBuffs()`, with
**two paths merged at award time**:

- `buffsForDesk(layout, deskUid)` — room-membership (Dev Pit/Break
  Room/War Room) + furniture adjacency, capped at 40% combined.
- `globalBuffs(layout)` — Server Room (+10% Cash company-wide, requires
  furniture inside) and Kitchen (mood-decay ×0.85), evaluated once per
  award event regardless of desk.

Both are **point-in-time reads at the moment an event resolves** (turn
completed, crisis resolved, day rollover) — no continuously-recomputed
cache, no client-side buff computation, ever (buffs must be computed
server-side where the award happens).

### 5.6 Rendering

Floor tiles render with **viewport culling** (skip sprites outside the
camera rect + 1-tile margin) rather than 8×8 chunk `RenderTexture` caching
— simpler, Pixi-version-agnostic, sufficient at the verified 64×64=4096-tile
ceiling (§9.8). Revisit chunk-caching only if profiling in G0/G2 shows
culling insufficient.

### 5.7 Edit mode

New `EditTool` values: `ROOM_TAG` (drag-rectangle, palette of 5 room
buttons, shape+text, no color-only), `SELL` (50% flat refund on furniture
and rooms; no-op with a toast on bays). Reuses the existing
undo-stack/drag-marquee/toast infrastructure in `editorActions.ts`.

**Cash is server-authoritative — the client never debits.** Every
Cash-costing edit action (room tag, buffed-furniture purchase, sell
refund) goes through a server route (`POST /api/building/room`,
`POST /api/building/furniture`, `POST /api/building/sell` — same
check-debit-persist-broadcast shape as `/api/building/expand`, §5.2);
`editorActions.ts` applies the layout change only on the route's
`{ok:true}` and shows the `reason` toast on `{ok:false}`. This closes a
gap where the draft had the webview "debiting cost" locally, which would
have made real Cash a client-side variable.

---

## 6. Missions (Contracts + World Events)

Canonical mission spec is Section 05 in full (richer, tiered, matches
Greg's "both layers" MISSIONS answer) — **Section 08's competing flat
`50 + 10/subtask` contractStore is superseded** (§9.9).

### 6.1 Fiction-vs-real labeling (hard rule, read first)

A `SignalChip` primitive (`webview-ui/src/components/ui/SignalChip.tsx`)
takes `real: boolean`. `real=true` → solid border, no prefix. `real=false`
→ dashed border + `SIM ·` prefix. **Every** fictional UI surface renders
through it — no hand-rolled chip markup for anything fictional.

The **real glyph set is derived from code, never hand-typed**: a small
module unions `crisis.ts`'s `CRISIS_STAGES` glyphs (`≋ ▲ ✱`, plus whatever
else that file exports — confirmed `✗` also appears there) with
`dispatch.ts`'s `DISPATCH_STATUS_CHIPS` glyphs (`◎ ✓ ⊘ ○ ■`, verified this
session — corrects an earlier draft that guessed `✗` was real and missed
`⊘`). A unit test (`signalChip.test.ts`) asserts the SIM glyph pool and
this derived real-glyph set are disjoint — **mechanically enforced, not
convention.** SIM events get their own reserved pool, reassigned away from
any collision found in review: `✦ ✧ ⟡ ⬡ ≈ ⚡ ▣ ╳ ⌖ ⚙` (coffee_run/
client_call/mail_delivery specifically move off `○`, which the real set
already owns for `EXPIRED`).

Contracts derived from real vault todos/gates render `real=true` (the
underlying completion fact is real, even though payout numbers are
invented framing) — **except** `manual-claim` completions, which render
`✓ CLAIMED (unverified)` with a dashed border even though `real=true`,
the one documented exception to the real/fake border rule.

### 6.2 Contracts — vault todos become jobs

`server/src/contractStore.ts`, same file-backed/JSONL-audit pattern.

```ts
CONTRACT_SOURCES = ['priority', 'backlog', 'gate', 'daily', 'weekly'];
CompletionMethod =
  'todo-disappeared' | 'gate-flipped' | 'dispatch-result' | 'manual-claim' | 'daily-auto';
```

| Source                              | Payout Cash          | Payout Rep               | Deadline                             |
| ----------------------------------- | -------------------- | ------------------------ | ------------------------------------ |
| Priority (`briefing.todo.startNow`) | 40                   | 2                        | sourceDate+2 days                    |
| Backlog (`briefing.todo.sections`)  | `min(150, 15*count)` | `min(5, floor(count/5))` | createdAt+7 days                     |
| Gate (`briefing.tracker.gates`)     | 200 flat             | 10 flat                  | none (long-running)                  |
| Daily (12-entry template table)     | 20 flat              | 0                        | end of local day, no penalty on miss |
| Weekly (4-entry template table)     | 100 flat             | 5                        | createdAt+7 days, no penalty on miss |

**Completion detection, priority order:** (1) `dispatch-result` — the
BRIEFING→DISPATCH prefill passes an explicit `contractId` field set by the
webview at enqueue time (**not** inferred by string-matching the prompt
text — §9.10 fixes a brittleness a draft flagged in its own risk list); a
linked dispatch exiting 0 completes the contract instantly. (2)
`todo-disappeared`/`gate-flipped` — ground truth, checked every briefing
reconcile tick (piggybacks the existing 60s `briefingProvider.ts` cache,
no new poll loop). (3) `manual-claim` — escape hatch, **rate-limited to
`MAX_MANUAL_CLAIMS_PER_DAY = 3`** (closes a farming risk a draft flagged
but didn't fix), rendered visibly distinct per §6.1. (4) `daily-auto` —
self-certifying.

**Re-minting dedupe** (closes a double-pay risk a draft flagged): before
minting a backlog contract, check both currently-open AND
completed-in-the-last-7-days contracts for the same normalized
`sourceKey` — not just currently-open ones.

**Expiration:** priority contract expiry costs `-1 Reputation` (small,
Cash-never-touched). Backlog/gate expiry is silent (re-mints next cycle
off the current count).

### 6.3 World Events — ambient sim life

`server/src/worldEventStore.ts`, 12-entry weighted table — canonical
here (extracted from the now-archived section 05 draft, glyphs corrected
per §6.1, effects adapted to the mood-only model of §4.5):

| id                   | glyph | weight | min gap (hrs) | duration (sim-min) | effect                                                                                                                                                                                                                                                             |
| -------------------- | ----- | ------ | ------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `power_surge`        | `⚡`  | 10     | 4             | 2                  | Flavor only — all on-screen employees pause their current animation (visual only, no state mutation). Online-only, never replayed (§ below).                                                                                                                       |
| `inspection`         | `▣`   | 8      | 12            | 5                  | If office grime ≤ 70: `+2 Rep`. If grime > 70: `-1 Rep`. Reputation only, never Cash.                                                                                                                                                                              |
| `rival_poach`        | `✦`   | 6      | 18            | 10                 | Targets one random employee with effective mood < 40. Flavor bubble "considering an offer…"; 5% roll nudges that employee's `moodBoost` −3 (pressure via the mood lever Employees already owns — never fires a quit itself). Fizzles silently if nobody qualifies. |
| `coffee_run`         | `✧`   | 20     | 1             | 3                  | Pure ambient — two employees walk to the break room and back. No economy effect. (Moved off `○`, which the real dispatch set owns for EXPIRED.)                                                                                                                    |
| `birthday`           | `✦`   | 3      | 720 (30d)     | 60                 | One random employee gets a birthday flavor bubble + `moodBoost` +1.                                                                                                                                                                                                |
| `printer_jam`        | `╳`   | 12     | 6             | 4                  | Ambient only; one employee stands at a "printer" furniture tile if placed, else no-op. (NOT `▲` — that's a real crisis glyph.)                                                                                                                                     |
| `client_call`        | `⟡`   | 10     | 8             | 5                  | Ambient; flavor bubble on a random employee, no effect. (Moved off `○`.)                                                                                                                                                                                           |
| `weather_rain`       | `≈`   | 15     | 6             | 20                 | Window-tile decor overlay only; no economy effect.                                                                                                                                                                                                                 |
| `flavor_bonus`       | `✦`   | 5      | 24            | instant            | "Found a coffee gift card" — `+Cash`, roll `1..5`, hard capped at **+5 total per local day** across all triggers. The ONLY currency-producing fictional event (see cap paragraph below).                                                                           |
| `heatwave`           | `≈`   | 8      | 48            | 180                | Ambient AC-strain flavor bubble; no effect.                                                                                                                                                                                                                        |
| `power_outage_scare` | `⚡`  | 4      | 72            | 3                  | Screen briefly flickers (render-only); no effect. Online-only, never replayed.                                                                                                                                                                                     |
| `mail_delivery`      | `⬡`   | 15     | 3             | 2                  | Ambient walk-to-mailbox animation if that furniture piece exists; no effect. (Moved off `○`.)                                                                                                                                                                      |

Selection: weighted-random among events whose per-id min-gap has
elapsed, evaluated on the same coarse live-tick as §2 — most ticks fire
nothing by construction (rare, ambient, not spammy). All events except
pure-ambient ones are suppressed while vacation mode (§4.5) is on.

**Hard cap (the one, explicit, documented exception to "no idle Cash"):**
`flavor_bonus` grants `+1..+5` Cash, capped at **+5 total per local day**
across all triggers, tracked in `worldEventStore` independent of the
economy store's own caps (belt-and-suspenders). No other event ever
touches Cash or Reputation. Max `±5` on any single event tick, full stop.
No event may directly set an employee to quit/fired/hired — only nudge
the mood/moodBoost fields Employees already owns.

**Online-only vs offline-simulated:** anything whose entire value is a
live visual moment (`power_surge`, `power_outage_scare`) never replays
retroactively on reconnect. Ambient logging events
(`coffee_run`/`mail_delivery`) log as "having happened" without an
animation replay. Dailies/weeklies/contract deadline sweeps compute in one
lump on reconnect, capped at one event per skipped calendar day (never a
week of events dumped after a vacation).

### 6.4 Day/night + seasons

`webview-ui/src/office/dayNight.ts` — pure functions of `Date.now()`:
`getDayPhase()` (dawn/day/dusk/night, local wall clock) and `getSeason()`
(meteorological quarters). One fictional holiday week (Dec 20-31), zero
external calendar reads, ever.

### 6.5 Digest voice + push notifications (interrogation deltas)

**Digest voice:** the "while you were out" story is assembled from
deterministic template strings (drawing quips from `core/src/quips.ts`,
§4.5) — free, instant, testable. The assembler exposes a named seam
(`renderDigest(events, narrator = templateNarrator)`) where an LLM
narrator can slot in post-v1.0; templates ship in v1.0, no token spend.

**Bark pushes:** War Room joins Greg's existing notification fabric via a
thin server-side emitter (`server/src/notifyBark.ts`) POSTing to the NEXUS
Bark wrapper (same transport `scripts/nexus-notifier` already uses; URL
from env, absent = silently disabled — never a crash path). Two classes:

1. **Morning digest** — one push per day at most, the §2 check-in summary
   (net Cash/Rep, top events, warnings), designed to join the existing
   morning-page flow.
2. **Event pushes** — big moments only, hard-capped small: contract
   completed, employee quit, budget auto-pause, STOP ALL engaged, chain
   run failed. Never per-turn, never per-world-event — pushes are for
   things Greg would want to know while away from the desk, full stop.

All push text is shape+word (glyph prefixes per §6.1's SIM/real
discipline) and never includes secrets or repo paths beyond project
labels.

---

## 7. Command & Automation

Canonical command spec is Section 04 in full — **Section 08 G3's
"bolt fields onto dispatchStore" design is superseded** (§9.11). Two
correctness bugs Section 04 found in its own draft are fixed below.

### 7.1 Dispatch chains

`server/src/chainStore.ts` + `server/src/chainOrchestrator.ts` — separate
files, NOT fields on `DispatchRecord` beyond the two additive optional
fields needed to correlate (`chainRunId`, `chainStep` — these two ARE
added to `DispatchRecord`/`DispatchEnqueueInput`, additive, zero existing
test impact). `CHAIN_MAX_STEPS=8`, `CHAIN_MAX_CONCURRENT_RUNS=3`.

**Bug fix 1 (subscription wiring):** `chainOrchestrator` subscribes to
`dispatchStore.onUpdate()` via **one server-side singleton call at
process startup**, not inside the per-WebSocket-connection handler in
`httpServer.ts`. Subscribing per-connection means two open browser tabs
create two independent chain-advance handlers for the same event —
double-enqueuing (and double-spending real tokens on) the next chain step.

**Bug fix 2 (`expired` status):** the chain-advance algorithm treats a
step reaching dispatch status `expired` the same as `denied` — fails the
run immediately, never retries. Additionally, `CHAIN_STEP_TIMEOUT_MS` is
set to `500_000` (was `900_000`), strictly **less than**
`DISPATCH_TTL_MS=600_000` — the chain's own timeout must trip before the
dispatch-level TTL sweep can leave a chain stuck in `running` for 5 extra
minutes with a stale `currentStep`.

A denied/expired step is never retried and never advances — the runner's
allowlist decision is final, same as any manual dispatch; the chain fails
cleanly, it never bypasses the deny-by-default boundary.

### 7.2 Standing orders

`server/src/standingOrderStore.ts` — two schedule kinds only (`daily`,
`interval`), no cron-expression parser. Base cap **1 enabled order**,
raised by perks (§7.4). A brand-new standing order's **first-ever
execution requires one explicit human confirm click** (`⚠ needs first-run
confirm`); after that it runs unattended on schedule. **This gate is
unconditional and permanent — no perk, purchase, or setting removes it**
(interrogation delta: the Autopilot perk is CUT; no amount of fictional
currency buys away a real-money safety check).

### 7.3 Templates + per-employee routing

`server/src/dispatchTemplateStore.ts` (cap 20). `resolveEmployeeDefaults()`
reads exactly 4 fields off `Employee`, all of which exist on the §4.2
record: `machine` (dispatch target machine), `projectDir` (dispatch cwd),
`defaultProvider`, `defaultModel` — an earlier draft named
`homeMachine`/`defaultCwd`, which are not fields on the record; corrected
here. Three call sites (CallModal prefill, chain step, standing order) —
explicit fields always win over the employee default (a prefill
convenience, never a hard lock). Every dispatch that
carries an `employeeId` and exits 0 fires `employeeWorkCompleted` exactly
once — the one integration point Employees consumes for dispatch-driven
XP growth.

### 7.4 THE RATE-LIMIT BUDGET (real, non-fictional resource)

`~/.claude/statusline.js` (Greg-owned) already renders live rate-limit
data (`five_hour`/`seven_day`, each `{used_percentage, resets_at}`) on
every prompt render — the authoritative first-party signal.

**Snapshot source — Greg-decision flagged OPEN (interrogation 2026-07-08:
"unsure"). Default until he rules: the DECOUPLED option (B).**

- **Option A:** a ~10-line snapshot write added inside statusline.js
  itself (a separate, explicitly-approved edit, never bundled into a repo
  commit). Simplest, but couples the game to a file Greg actively
  rewrites for HUD tinkering.
- **Option B (default):** a standalone `~/.claude/hooks/` status-hook
  script (repo-versioned under `bin/`, symlink/instructions in the
  runbook) that receives the same stdin payload and writes ONLY
  `~/.pixel-agents/rate-limit-snapshot.json` — statusline.js untouched,
  decoupled from Greg's HUD.

Either way the game must degrade gracefully when the snapshot vanishes —
the `BUDGET_STALE_MS` fail-safe pause below plus a visible `⚠ STALE`
badge already cover this; absence of the file is a pause, never a crash
and never an automation green-light. `bin/needs-input-poller.mjs`
forwards the snapshot to `POST /api/budget/report`.

Codex has **no equivalent live signal** — its budget is a manual,
labeled-as-inferred heuristic: Greg enters `codexWeeklyMessageCap` once;
`server/src/budgetStore.ts` counts codex dispatch exits against it,
renders with a `~` prefix and the word "est." (never the bare `%` the
Claude meter gets — the word "est." IS the honesty signal, not a color).

```ts
BUDGET_STALE_MS = 900_000; // no fresh report in 15min => fail-safe pause
BUDGET_PAUSE_5H_PCT_BASE = 70;
BUDGET_PAUSE_7D_PCT_BASE = 80;
BUDGET_PAUSE_HARD_CEILING_5H = 95;
BUDGET_PAUSE_HARD_CEILING_7D = 95; // NEVER raised by any perk
```

**Paused by budget:** standing-order fires, chain-step auto-continuation.
**Never paused:** a manual CALL from CallModal — a human clicking Send is
a conscious spend the player owns; CallModal only _shows_ the meter next
to Send, never disables it (gating it would violate hard rule #1 in the
wrong direction).

**Automation perks** (Cash-purchased, read-only `perkFlags` consumed by
the three stores above):

| Perk                | Cost | Effect                                    | Guardrail                |
| ------------------- | ---- | ----------------------------------------- | ------------------------ |
| Second Shift        | 500  | standing-order cap 1→2                    | —                        |
| Chain Gang          | 800  | max steps 8→12, concurrent runs 3→5       | —                        |
| Night Shift Foreman | 1500 | cap 2→4; pause thresholds 70→80% / 80→88% | hard ceilings never move |

The **Autopilot perk is CUT** (interrogation delta) — first-fire confirm
is unconditional forever (§7.2); the perk ladder is these 3, total 2800.

"Raising payroll" = buying Night Shift Foreman: consciously letting
automation eat more of the real rate-limit window before it self-pauses —
the one place Cash purchase directly changes real API-spend behavior, and
it must say so in plain words in any tutorial copy, never buried in a
tooltip.

### 7.5 STOP ALL — the global kill switch (interrogation delta)

One always-visible control, desktop AND the phone check-in view — shape +
word (`■ STOP ALL`), never an icon alone, never buried in a menu.
`POST /api/automation/stop-all` in one transaction:

1. Disables every enabled standing order (sets a `stoppedByKillSwitch`
   flag so re-enable restores exactly the prior set).
2. Halts chain advancement — running `ChainRun`s finish their in-flight
   dispatch (a dispatched process is already spent) but never enqueue the
   next step; runs land in `halted`.
3. Cancels queued-not-yet-dispatched chain steps and pending
   standing-order fires.
4. Broadcasts a `automationStopped` WS message + fires a Bark push (§6.5).

Resuming is a separate explicit action (`RESUME`, with a confirm click)
— never automatic, never time-based. Manual CallModal dispatch remains
available throughout (it is human-initiated; the kill switch targets
autonomy, not the human). Server-authoritative, works even if the webview
that pressed it disconnects mid-request.

---

## 8. Engine, Rendering, Art

### 8.1 Engine: PixiJS v8, not Phaser

The current renderer is already a pure-render-function over a pure-sim
state class (`officeState.ts` / `renderer.ts` / `gameLoop.ts`). PixiJS
replaces exactly the drawing half — a scene-graph swap, not a rewrite.
**Fidelity bar (interrogation delta): "better is welcome"** — the swap
must preserve the scene's content and legibility (same sprites, same
shapes, grayscale-readable), but pixel-perfect parity with the old canvas
renderer is NOT required and chasing it is explicitly out of scope;
visual improvements (crisper scaling, smoother camera) are allowed.
Phaser is rejected: its opinionated Scene/GameObject lifecycle would fight
the existing tested `update(dt)`-is-pure property 300+ vitest tests rely
on, and it ships ~5x the bundle weight (bad for phone cold-load).

`app.stage → worldContainer (camera) → floorLayer / sceneLayer / bubbleLayer
/ crisisLayer / editorOverlayLayer`. Federated pointer events unify
mouse+touch. Existing z-sort formulas, camera-follow lerp, and
`officeState.ts`'s pure sim logic are reused unchanged.

**Recolor pipeline (must exist before deleting the old decode path):** the
existing `office/colorize.ts` hue-shift mechanism (`adjustSprite`,
`hueShiftSprites`) is how 6 character templates become N visual variants
and how furniture gets recolored — Employees and Art both key off it.
Before `decoded/*.json`/`pngDecoder.ts`'s pixel-JSON pipeline is deleted
(it's dead weight once Pixi loads PNGs as GPU textures directly), **a
Pixi-native recolor strategy must exist and be verified** — a
`ColorMatrixFilter` or a one-time render-to-texture per hue-shift variant.
This is an explicit G0 task, not an afterthought (§9.14 — a draft flagged
this deletion would silently break Employees/Art without a replacement;
cross-ref corrected by the Fable review, the prior text pointed at §9.12).

### 8.2 Server-authoritative sim stores (one file per concern)

Each new store gets its **own** file under `server/src/`, mirroring
`progressionStore.ts`'s exact shape — not one shared blob
(`economyStore.ts`, `employeeStore.ts`, `roomStore.ts` +
`buildingBuffs.ts`, `contractStore.ts`, `worldEventStore.ts`,
`chainStore.ts`, `standingOrderStore.ts`, `budgetStore.ts`,
`dispatchTemplateStore.ts`, `notifyBark.ts`). This resolves a draft's
single-blob `economyEngine.ts` proposal in favor of the pattern every
other section (and the existing codebase) already independently
converged on (§9.13).

**Prestige seam (interrogation delta — documented, not built):** no
prestige/reset ships in v1.0, but every new store must expose a clean
`reset(preserve?: ...)` seam and keep permanent-vs-liquid state
separable (Reputation, Hall of Fame, and employee history are
prestige-survivors by design; Cash, rooms, and perks are resettable).
A v2.1 prestige layer must be addable without store-schema surgery.

New WS messages are added to `core/asyncapi.yaml` FIRST, then generated
via `npm run asyncapi:generate` — never hand-write `core/src/messages.ts`.

### 8.3 Art pipeline

Diablito's image-gen system is located and verified, but it is TWO paths,
and an earlier draft conflated them (corrected here after reading
`/Users/greg/code/Diablito/SESSION-HANDOFF-2026-07-06.md` §7.3, the
verified pipeline doc):

- **Primary (verified working, $0 marginal):** Codex CLI `$imagegen` on
  Greg's ChatGPT subscription — `codex exec --skip-git-repo-check
-s workspace-write -i <anchor.png> < prompt.txt`, structured JSON-slot
  prompt, reference-anchor image, batches in waves of ~6-9 parallel jobs.
  **This burns the REAL Codex/ChatGPT plan limits at 3-5x per image turn**
  — the same budget §7.4's guardrail protects. Art batches are a
  conscious, Greg-scheduled spend: check Codex headroom before each wave,
  stop-and-report on any rate-limit message, never hammer.
- **Fallback (skill exists, NOT provisioned):** Fal AI `gpt-image-2`
  (`/Users/greg/code/Diablito/.claude/skills/gpt-image-2/SKILL.md`) —
  requires a `FAL_KEY` that does not currently exist anywhere (verified:
  no `.env` in Diablito, nothing in shell rc). Provisioning it is a
  Greg-only action (real money account).

Post-processing → asset: `rembg` background removal → mechanical
downsample/quantize (`sharp`, nearest-neighbor, ≤16 unique colors) →
decoder smoke-test QA gate → fallback to hue-shift-recolor of an existing
sprite if generation fails QA twice. **Neither `rembg` nor `sharp` is
currently installed on this machine (verified)** — installing them is a
gated action under hard rule #5: G5's preflight must ask Greg explicitly
before any `pip install`/`npm install` of these tools.

**Corrected finding:** desk-work animation does **NOT** reuse frames 4-6
of the existing `char_N.png` sheet — verified this session that all 7
frame slots (0-6) are already wired: `walk` renders frames [0,1,2,1],
`typing` frames 3-4, `reading` frames 5-6 (the slicing lives in
`webview-ui/src/office/sprites/spriteData.ts:136-152`
`getCharacterSprites()`, decode contract in
`core/src/assets/pngDecoder.ts:127-128` — 112×96, 3 direction rows × 7
frames of 16×32). Desk-work ships as its **own new sheet**
(`char_N_work.png`, same 112×96/3-row×7-frame grid). **Correction on top
of the correction:** celebrate/break sheets do NOT "already exist" as an
earlier draft claimed — the only shipped character sheets are
`char_0..5.png` (verified by filesystem search); `char_N_work.png`,
`char_N_celebrate.png`, and `char_N_break.png` are all NEW files G5
creates, following the existing sheet's grid contract, with new decoder
entry points added (never modifying `decodeCharacterPng`).

Palette discipline (unconditional): every new visual state changes
silhouette or adds a distinct icon glyph first, color is reinforcement —
verified by a literal grayscale-diff build gate, not a suggestion.

---

## 9. Conflict resolutions

Numbered for traceability. "Wins" = the design this document adopts as
canonical; the losing section file's competing design is superseded.

1. **Tick model (01 vs 02 vs 06 vs 08).** 06's compute-on-demand model
   wins (real-event-driven + WS-connect catch-up + coarse 5-min
   live-only interval). 01's always-on `simTick.ts` and 02's separate
   5-min `PERSONA_TICK_MS` loop are both dropped in favor of one unified
   cadence (§2). Rationale: single-user, mostly-idle app — an
   always-on wakeup serves no one when nobody's watching, and two
   independent tick loops computing two independent mood systems is
   exactly the drift 01's own Risk R1 predicted.
2. **Cash/Rep numbers (01 vs 08).** Canonical table in §3 — mostly 08's
   numbers (grounded against the real `XP_SHIFT_GRADE_BONUS`/
   `XP_CRISIS_RESOLVED` ratios), streak-milestone Reputation re-tuned by
   synthesis (10/30/120, between 01's 15/40/200 and 08's 5/15/50) —
   flagged provisional, retune after a week of real telemetry per 01's
   own Risk R3.
3. **World-event Cash exception (01 vs 05, both claimed "no exceptions"
   while 05 shipped one).** §6.3/§3.4 codify `flavor_bonus` as the one,
   explicit, capped (+5/day) exception. 01's own richer §6 tick-based
   roll is dropped entirely in favor of 05's 12-entry weighted table,
   which becomes canonical for World Events (§6.3).
4. **Employee identity grain — does provider split identity? (02 says
   yes; 04/06/08 assume no, 3-vs-1).** No — `employeeId = machine:project`,
   provider is an attribute (§4.1). Majority-section simplicity wins;
   avoids a second identity dimension nothing else in the design needs.
5. **G1 acceptance-criteria bug (08).** "fresh session from same identity
   creates a NEW employee" was internally contradictory against a
   deterministic id function. Fixed: a fresh session under the SAME id
   returns the SAME record (deterministic); a fresh session after a
   **fire** (blacklisted key) creates a new `#`-suffixed record. Quit
   (not fire) never blacklists.
6. **Break blocking dispatch (01 says yes; 02 says no; hard rule says
   no).** 02 wins — break is cosmetic/needs-only, never blocks real
   dispatch (§4.5, §4.6). 01's blocking clause is struck.
7. **Building spec ownership (03 vs 08 G2) + 08's factual grounding
   error.** Verified this session: `MAX_COLS=64`/`MAX_ROWS=64`/
   `DEFAULT_COLS=20` **do exist** in `webview-ui/src/constants.ts` — 08's
   premise ("no fixed map bounds exist... grep found nothing") is false.
   03's bay/room/furniture-adjacency design, built on the correct
   grounding, is canonical (§5). 08 G2's competing zone-tier/
   roomAdjacency design is superseded.
8. **Chunk rendering (03 says needed at the verified 64×64 cap; 06 says
   not needed until >100×100).** Reconciled with a third option neither
   proposed: viewport culling (§5.6) — simpler than 03's Pixi-version-
   fragile `RenderTexture` chunk cache, cheaper than 06's naive
   per-tile-every-frame assumption at 4096 tiles. Revisit chunking only
   if profiling shows culling insufficient.
9. **Missions/Contracts ownership (05 vs 08 G3) + misattribution (05's
   own finding).** 05's richer, tiered contract/dailies/weeklies design
   is canonical (§6); 08 G3's flat `50+10/subtask` design is superseded.
   05's internal misattributions ("section 03" for employee fields) are
   corrected to "Employees" throughout this document.
10. **Contract↔dispatch link brittleness (05's own flagged risk).** Fixed
    per 05's own suggested repair: an explicit `contractId` field passed
    from the BRIEFING panel's prefill action, not inferred by string-
    matching the prompt text (§6.2).
11. **Command/Automation architecture (04 vs 08 G3).** 04's separate
    `chainStore.ts`/`chainOrchestrator.ts` + `budgetStore.ts` perk
    economy is canonical (§7; originally 4 perks — rev 2 cut Autopilot,
    leaving 3) — richer, and it's the literal mechanism
    for the locked "raising payroll" vision line. 08 G3's "bolt chain
    fields onto dispatchStore + flat run-count cap, no perks" design is
    superseded, though its codex-fallback rolling-counter idea is folded
    into 04's already-existing `codexWeeklyMessageCap` heuristic (no net
    loss — 04 already covered this case).
12. **04's own two correctness bugs** (subscription wiring double-
    dispatch risk; unhandled `expired` chain-step status) — fixed in
    §7.1 (singleton subscription at startup; `expired` treated as
    terminal failure; `CHAIN_STEP_TIMEOUT_MS` lowered below
    `DISPATCH_TTL_MS`).
13. **Store file layout (06's single `economyEngine.ts` blob vs every
    other section's one-file-per-concern pattern).** One file per
    concern wins (§8.2) — matches the existing codebase convention
    (`progressionStore.ts`, `dispatchStore.ts` are each their own file)
    and every other section (01/02/03/04/05) independently chose it.
14. **06's colorize/recolor deletion gap.** A Pixi-native recolor
    replacement is now an explicit, gating G0 task (§8.1) — the old
    decode pipeline cannot be deleted until it exists and is verified.
15. **07's desk-work frame-slot-reuse premise, verified false this
    session.** Frames 4-6 of `char_N.png` are already wired to `reading`
    — desk-work ships as a new sheet (§8.3), not a slot overwrite. This
    also corrects 08 G4's independently-invented, incompatible
    72-generation asset-directory scheme — 07's spec (extend the
    existing embedded sheet convention) is canonical; G4/G5 in
    BUILD-PLAN.md are edited to point at 07's layout, not re-derive one.
16. **Real-glyph-set for the fiction/real signal border (05's own
    flagged bug — claimed real set included `✗`, which isn't real, and
    missed `⊘`; and reused `○` for three SIM events when `○` is already
    the real EXPIRED glyph).** Fixed: the real set is derived from
    `crisis.ts`+`dispatch.ts` at test time, never hand-typed; SIM events
    reassigned off the collision (§6.1).
17. **Manual-claim farming risk + backlog double-pay risk (05's own
    flagged, unfixed risks).** Both fixed: `MAX_MANUAL_CLAIMS_PER_DAY=3`;
    backlog dedupe checks a 7-day completed-lookback, not exact-string
    open-only match (§6.2).
18. **Quit severity (01's own flagged uncertainty: reset-to-1 vs
    halving).** 02's halving-not-resetting design wins — better matches
    "recoverable but felt" for a solo 2-Mac setup where losing your one
    senior employee to a full reset would be a session-ending blow, not
    a felt setback.
19. **Room-buff vs furniture-adjacency stacking cap (03's own flagged
    gap).** One shared 40% cap pool per desk, not two independent 40%
    caps (§5.4-5.5).
20. **Global-scope room buffs (Server Room, Kitchen) have no
    per-employee join key, but 03's own `computeActiveBuffs()` signature
    only took one (03's own flagged gap).** Fixed: two merged resolution
    paths, `buffsForDesk()` and `globalBuffs()` (§5.5).

---

## 10. What stays true from v1 (unchanged, reused verbatim)

- **Telemetry plane**: hooks/poller/coworker-adapter, `agentStateStore.ts`,
  `hookEventHandler.ts` — untouched.
- **Dispatch vertical** (mechanic #6b): `dispatchStore.ts`,
  `bin/dispatch-runner.mjs`, `bin/lib/dispatch-rules.mjs` — deny-by-default,
  argv-only, realpath-contained. Chains/standing-orders/employee-routing
  are pure extensions, never a second execution path.
- **Progression** (`progressionStore.ts`): account-wide XP/level/streak
  stays meaning what it means today; employee-local XP is a parallel pool,
  not a rename or replacement.
- **`~/.pixel-agents/*.json` file-store convention**: every new store
  clones this pattern (lazy homedir, throttled persist, tolerant load,
  `VITEST` guard).
- **Fastify server, WS plane, asyncapi-generated message contract**
  (`core/asyncapi.yaml` → `npm run asyncapi:generate`) — extended with new
  message types, never bypassed with hand-written types.
- **Colorblind discipline** (`crisis.ts`'s "grayscale-readable by shape
  alone" precedent) — extended verbatim to every new mood/weather/
  room/trait visual.
- **Hard rules** (§1): never gate real function behind game state, no
  dark patterns on real money, colorblind shape+label, tailnet-only,
  gated actions stay human-runbook, atomic commits, one-agent-per-checkout
  unless proven safe otherwise.
- **Test/gate bar** (softened by interrogation delta): server 329/329,
  webview 158/158, bin 63/63, tsc/lint/build clean at HEAD `50f9ef2` is
  the verified baseline. The bar going forward is **every milestone's
  definition-of-done criteria have tests** — no count-ratcheting, no
  padding; deleting a redundant test with a stated justification in the
  commit message is legitimate. The existing suites must stay green.

---

## Appendix: Fable review deltas (2026-07-08 adversarial pass)

Substantive changes applied by the final Fable review, each re-verified
against the live repo/machine this session:

1. **§4.3 — `EFFICIENCY_HEAVY_MAX = 12_000` was fabricated.** The real
   exports are `EFFICIENCY_LEAN_MAX = 1_500` and
   `EFFICIENCY_STEADY_MAX = 6_000` (shiftStats.ts:76-77); a builder
   following "import, don't retype" would have hit a missing export.
   tokenEfficiency scale corrected to LEAN_MAX..STEADY_MAX.
2. **§4.2/§4.5 — mood was simultaneously "derived every read" and
   directly written by events.** Added transient `moodBoost` field
   (±20 clamp, halves daily); direct events write there.
3. **§4.2/§7.3 — `resolveEmployeeDefaults` read 3 fields that didn't
   exist on the record** (`homeMachine`/`defaultCwd`, plus `defaultModel`
   was never declared). Record gains `defaultModel?`; resolver reads
   `machine`/`projectDir`/`defaultProvider`/`defaultModel`.
4. **§4.2 — `assetLoader.getCharacterCount()` doesn't exist**, and
   server/src/assetLoader.ts is extension-era vscode code. spriteIndex is
   now a raw hash; the webview mods by the real
   `getLoadedCharacterCount()` (spriteData.ts:51).
5. **§3.1/§3.4 — dispatch Cash was farmable**: +5 per exit-0 with no cap
   pays for volume of real token spend (one-click farm — a dark-pattern
   hole the anti-dark-pattern table itself missed). Hard-capped
   +50/local day.
6. **§3.1 — `touchStreak` is `private`**; economy tracks its own
   last-active-date instead of subscribing to progression internals.
7. **§5.7 — client-side Cash debit gap closed**: all build-mode spends go
   through server routes; the client never mutates Cash.
8. **§8.3 — art pipeline corrected against the Diablito handoff**: the
   verified primary transport is Codex CLI `$imagegen` on the ChatGPT
   subscription (burns real plan limits 3-5x/turn — budget-relevant);
   Fal is an unprovisioned fallback (no FAL_KEY exists); rembg/sharp are
   NOT installed (gated installs). The prior text presented Fal as the
   pipeline and the tools as ready.
9. **§8.3 — "exactly like celebrate/break already do" was false**: no
   such sheets exist; only char_0..5.png ship. All three animation
   sheets are new G5 work.
10. **§2.1 + §3.5 added** — explicit fun contract per cadence and a
    pacing-arithmetic sanity envelope, so "is this actually a game?" has
    a testable answer and the economy numbers have a stated intent to
    retune against.

---

## Appendix: Greg interrogation deltas (2026-07-08, rev 2)

32 questions answered interactively; these answers are LOCKED and this
revision applies them. Do not re-litigate without flagging Greg first.

1. **Core payoff locked** (§1): automation command center — manage
   multiple real sessions, watch results compound against the real todo
   list. Contracts & crunch is the #1 slice; all 7 milestones still ship
   ("all 7 or it's a corpse").
2. **Needs CUT** (§4.2/§4.5): mood-only. Mood is a stored base value +
   transient `moodBoost`; needs-flavored behavior survives as pure
   ambient animation. G1 shrinks accordingly.
3. **Rep decay 1-day grace** (§3.2): first consecutive zero-activity day
   is free; decay starts on the second.
4. **Vacation mode** (§4.5): explicit studio-wide toggle freezing
   decay/quits/Rep loss/world events; never back-charges.
5. **HEAVY mood hit is contextual** (§4.5): −5 only when HEAVY coincides
   with day error rate ≥ 20%; heavy-but-clean is mood-neutral. Cash
   stays 0 for HEAVY regardless.
6. **Autopilot perk CUT** (§7.2/§7.4): first-fire confirm is
   unconditional forever. Perk ladder = 3 perks, 2800 total.
7. **STOP ALL kill switch** (§7.5): global, server-authoritative,
   desktop + phone, with explicit RESUME.
8. **Personality layer** (§4.5): deterministic template one-liners in
   `core/src/quips.ts`; no LLM.
9. **Digest voice** (§6.5): templates now, named LLM-narrator seam for
   post-v1.0.
10. **Bark pushes** (§6.5): morning digest + capped big-moment event
    pushes via the NEXUS Bark wrapper.
11. **Retire ceremony** (§4.6): celebration + Hall of Fame when a real
    project ends; player verb, no auto-retire.
12. **Prestige seam** (§8.2): documented reset seam per store, nothing
    built in v1.0.
13. **Statusline snapshot source OPEN** (§7.4): Greg answered "unsure";
    default is the decoupled status-hook (Option B). Present the choice
    at G3 before wiring.
14. **Pixi fidelity** (§8.1): "better is welcome" — no pixel-parity
    obligation.
15. **Test bar softened** (§10): definition-of-done coverage, no
    count-ratcheting.
16. **World-event table inlined** (§6.3) so the section drafts could be
    archived to `.planning/v2/archive/sections/` (known-false repo
    claims; no longer readable authority).
17. **Kept as-designed, explicitly confirmed:** manual-claim 3/day,
    self-gaming unconcern ("can't cheat myself"), codex manual weekly
    cap (Greg will maintain it), backlog 7-day dedupe, contract payout
    tables, economy numbers tune-from-telemetry, iPhone as the G6
    target, game state on NEXUS joining backup v2 before G1 data
    accrues.
18. **Execution model** (BUILD-PLAN/KICKOFF): single /goal ultracode
    run G0→G6 to completion, self-paced around Greg's real rate limits,
    GPT-5.5/Codex delegation allowed, batched pre-authorized deploys,
    Fable medium review at the end if usage allows, Bark push on
    completion. Feel-bad issues: note-and-continue into a tuning list.
