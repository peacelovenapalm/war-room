# Section 02 — Employee Sim (Persistent Personas)

Status: DECISIONS LOCKED for sonnet execution. Numbers here are exact
defaults — sonnet build agents implement the literal constants below, not
"reasonable" ones, unless a later reconciliation pass overrides a specific
value in the `ASSUMES` block.

## ASSUMES (things owned by other sections, taken as given here)

- **ASSUMES-ECON-1 (economy/03):** a `cashStore` exists exposing
  `spend(amount, reason): boolean` (false if insufficient) and
  `earn(amount, reason): void`, plus a separate `reputation` value with
  `adjust(delta, reason): void`. This section only calls those two
  functions by name; it does not define Cash accrual math.
- **ASSUMES-ECON-2:** placeholder Cash costs below (`TRAIN_COST`,
  `PROMOTE_COST_PER_TIER`, hire/fire Cash deltas) are **stand-ins** —
  economy section may retune the numbers but MUST NOT change which verbs
  cost Cash vs. which are free (that split is a hard rule here, see
  "Cost table").
- **ASSUMES-BUILD-3 (building/04):** `assignedRoomId` is a foreign key
  into a room registry owned by the building section. This section only
  stores the id and never validates room existence/capacity — building
  section's assign-flow calls back into `personaStore.setRoom(id, roomId)`.
  Room adjacency buffs feeding `needs` regen (break room, etc.) are a
  **stub hook** here (`applyRoomBuff()`), a no-op until 04 wires it.
- **ASSUMES-ENGINE-5 (engine/05):** rendering (sprite animation states,
  walk paths, mood face overlays) is owned by the engine/renderer
  section. This section only emits data (`PersonaSnapshot`, mood 0-100,
  status enum) over the existing WS broadcast plane — same contract shape
  as `AgentPidUpdate`/`ProgressionUpdate` in `core/src/messages.ts`. No
  Pixi/Phaser code lives in this section.
- **ASSUMES-DISPATCH-1:** dispatch (`server/src/dispatchStore.ts`) is
  extended elsewhere to accept an optional `personaId` on a dispatch
  request so "call this specific employee" routes work through the
  persona's growth path (recorded XP/history). This section defines the
  persona-side recording API (`recordDispatchExit`) that the dispatch
  section calls; it does not modify `dispatchStore.ts` itself.
- **ASSUMES-HARD-RULE:** per Greg's standing rules, no game-state verb
  here may block, delay, or degrade a real dispatch/hook/telemetry event.
  Every verb in this doc is confirmed against that rule explicitly.

---

## 1. Why a new store (grounding in the current repo)

Read: `server/src/agentStateStore.ts`, `server/src/types.ts`,
`server/src/progressionStore.ts`, `server/src/shiftStats.ts`,
`core/src/normalizeProjectPath.ts`.

Current facts, verified in-repo:

- `AgentState` (types.ts:7-83) is **per live session** — created on
  session start, discarded on session end/removal from `agentStateStore`.
  It carries `machine?`, `providerId?`, `projectDir`, `pid?`,
  `teamName?`/`agentName?` (the latter two are transient teammate-role
  labels within ONE team spawn, not a stable identity — reused across
  different sessions with different meanings).
- `progressionStore.ts` is **global, singular, one-player** — one XP/level/
  streak for the whole studio, persisted at `~/.pixel-agents/progression.json`.
  There is currently NO per-agent/per-project/per-machine persistent
  identity anywhere in the codebase.
- `shiftStats.ts` aggregates tokens/turns/crises **studio-wide**, not
  per session/persona.
- `core/src/normalizeProjectPath.ts` already gives a deterministic
  slug from an absolute path (`replace(/[^a-zA-Z0-9-]/g, '-')`) —
  reuse this, don't reinvent project-dir normalization.
- Character art exists today at `webview-ui/public/assets/characters/
char_0.png … char_5.png` (6 sprites), scanned dynamically by
  `server/src/assetLoader.ts:441-456` (`/^char_(\d+)\.png$/i`) — so the
  sprite pool size is **not hardcoded to 6** in code, just in current
  assets. Persona sprite assignment must use `assetLoader`'s discovered
  count, not a literal `6`, so the art pipeline (see engine/art section)
  can drop in more sprites without a code change.

**Decision:** add a new store, `server/src/personaStore.ts`, following the
exact structural pattern of `progressionStore.ts` (lazy-resolved path via
`os.homedir()`, `PERSIST_THROTTLE_MS = 5_000`, tolerant JSON load, throttled
write, `onChange` listener list, VITEST default-path guard). Do not fold
personas into `AgentStateStore` — that store's lifecycle is explicitly
per-session/ephemeral (`agentAdded`/`agentRemoved` on process lifetime) and
mixing persistent identity into it would break its existing contract and
tests (`server/__tests__/agentStateStore.test.ts`).

**Refactor task (reuse, not duplicate):** extract `xpForLevel`/`computeLevel`
from `progressionStore.ts:59-77` into `core/src/leveling.ts` as pure,
parameterizable functions:

```ts
// core/src/leveling.ts
export interface LevelCurve {
  base: number;
  step: number;
}
export function xpForLevel(level: number, curve: LevelCurve): number {
  let total = 0;
  for (let l = 1; l < level; l++) total += curve.base + curve.step * (l - 1);
  return total;
}
export interface LevelInfo {
  level: number;
  xpIntoLevel: number;
  xpForNextLevel: number;
}
export function computeLevel(xp: number, curve: LevelCurve): LevelInfo {
  let level = 1;
  while (xp >= xpForLevel(level + 1, curve)) level++;
  const floor = xpForLevel(level, curve);
  const ceil = xpForLevel(level + 1, curve);
  return { level, xpIntoLevel: xp - floor, xpForNextLevel: ceil - floor };
}
```

`progressionStore.ts` switches to `computeLevel(xp, { base: 100, step: 50 })`
(same numbers, zero behavior change — verify via existing
`server/__tests__/progressionStore.test.ts` passing unmodified).
`personaStore.ts` uses `computeLevel(xp, { base: 60, step: 30 })` — a
flatter curve, because there are potentially many personas leveling in
parallel and each should feel faster than the single studio-wide track.

---

## 2. Identity derivation (project + machine → stable character)

**Key formula (exact):**

```ts
import { createHash } from 'node:crypto';
import { normalizeProjectPath } from '../../core/src/normalizeProjectPath.js';

function personaKey(machine: string, providerId: string, projectDir: string): string {
  const slug = normalizeProjectPath(projectDir); // reuse existing helper
  const raw = `${machine}|${providerId}|${slug}`;
  return createHash('sha1').update(raw).digest('hex').slice(0, 16);
}
```

- **Grain:** one persona per **(machine, provider, project)** triple. Same
  project dispatched from MACBOOK via `claude` and from MACBOOK via `codex`
  are two different employees (different skillset/provider = different
  hire). Same project on MACBOOK vs MINI are two different employees
  (different desk/machine = different hire) — matches the "office" spatial
  metaphor (a person sits at one machine).
- `machine` defaults to `'LOCAL'` when `AgentState.machine` is undefined
  (server's own machine, matching existing convention in
  `hookEventHandler.ts`/`fileWatcher.ts` — verify by grepping
  `agent.machine ??` call sites before hardcoding a different default).
- `providerId` defaults to `'claude'` (matches `AgentState.providerId`
  comment: "defaults to 'claude'" at types.ts:44).
- Rehire-after-fire uses a **suffix bump**: if `personaKey` collides with a
  `status: 'fired'` record, the NEW hire gets key `${key}#${n}` where `n`
  increments from the count of fired records sharing that base key. Fired
  personas are never overwritten — history is permanent.

## 3. Name + sprite assignment

- **Name pool:** a fixed, versioned array of 120 names in
  `server/src/personaNames.ts` (new file — sonnet agent generates a plain
  list, no logic; e.g. `["Ada Byte", "Kernel Sanders", ...]`, office-sim
  flavor, PG). Deterministic assignment: `nameIndex = firstNBytesOfKeyAsInt(key) % NAME_POOL.length`. On collision (two personas resolving to
  the same name — pigeonhole with >120 personas), append a two-digit
  numeric suffix (`"Ada Byte 02"`) using an in-memory collision counter at
  hire time; persist the resolved name, never recompute it after hire (a
  quit/rehire under the SAME key keeps the SAME name — this is "the same
  person came back").
- **Sprite index:** `spriteIndex = secondNBytesOfKeyAsInt(key) % discoveredCharCount`
  where `discoveredCharCount` comes from `assetLoader`'s existing
  `char_N.png` scan (export a `getCharacterCount()` from `assetLoader.ts`
  if not already exposed — check before adding). Never hardcode `% 6`.
- Both are computed **once at hire time** and stored (not recomputed on
  read) so art-pool growth doesn't reshuffle existing employees' looks.

## 4. Persistence schema

New file: `~/.pixel-agents/personas.json` (sibling to `progression.json`,
`shift-stats.json`, `dispatch-queue.json` — same dir constant
`LAYOUT_FILE_DIR` from `server/src/constants.ts`).

```ts
// server/src/personaStore.ts
export type PersonaStatus =
  | 'candidate' // auto-hired on first telemetry, unnamed-to-player until onboarded
  | 'active'
  | 'on_break'
  | 'training'
  | 'quit'
  | 'fired'
  | 'retired';

export type PersonaRank = 'Junior' | 'Senior' | 'Lead' | 'Principal';

export interface PersonaScores {
  /** 0-100, higher = faster average turn completion. */
  speed: number;
  /** 0-100, higher = fewer failed/errored turns. */
  accuracy: number;
  /** 0-100, higher = more turns land in 22:00-06:00 local window. */
  nightOwl: number;
  /** 0-100, higher = lower output-tokens-per-turn (cheaper). */
  tokenEfficiency: number;
}

export interface PersonaTrainingBonus {
  speed: number;
  accuracy: number;
  nightOwl: number;
  tokenEfficiency: number;
}

export interface PersonaNeeds {
  energy: number; // 0-100
  social: number; // 0-100
  hygiene: number; // 0-100
}

export interface PersonaRollingStats {
  /** Ring buffer, max 50 entries, oldest evicted first. */
  recentTurns: Array<{
    ts: number;
    wallMs: number;
    outputTokens: number;
    wasError: boolean;
    hour: number;
  }>;
}

export interface PersonaRecord {
  id: string; // personaKey (or #-suffixed rehire variant)
  machine: string;
  providerId: string;
  projectDir: string; // raw absolute path, for display
  projectLabel: string; // basename(projectDir)
  name: string;
  spriteIndex: number;
  status: PersonaStatus;
  rank: PersonaRank;
  xp: number;
  mood: number; // 0-100, derived+cached (see formula below)
  needs: PersonaNeeds;
  scores: PersonaScores; // derived+cached, recomputed on every recordTurn
  trainingBonus: PersonaTrainingBonus;
  rolling: PersonaRollingStats;
  assignedRoomId?: string; // ASSUMES-BUILD-3
  createdAt: number;
  lastActiveAt: number;
  lowMoodStreakDays: number; // consecutive real-calendar days under QUIT_THRESHOLD_MOOD
  breakUntil?: number; // ms epoch; status='on_break' until this
}
```

Unbounded history lives OUTSIDE the hot file, append-only, matching the
`dispatch-audit.jsonl` pattern already in `dispatchStore.ts`:

`~/.pixel-agents/persona-history/<personaId>.jsonl` — one JSON line per
ledger event:

```json
{"ts":1234567890000,"kind":"turn","xpDelta":4,"note":"turn completed"}
{"ts":1234567891000,"kind":"crisis_resolved","xpDelta":12,"note":null}
{"ts":1234567892000,"kind":"promotion","xpDelta":0,"note":"Junior -> Senior"}
{"ts":1234567893000,"kind":"quit","xpDelta":0,"note":"mood 12 for 5 days"}
```

Rotate: if a persona's ledger file exceeds 5000 lines, truncate to the last
2500 (tail-keep, same tolerance-over-completeness posture as the rest of
this codebase's file stores — never crash on write failure).

## 5. Trait derivation formulas (FROM REAL TELEMETRY — exact math)

Recorded on every real turn-completion-equivalent event (Claude hook Stop,
OR a dispatch exit — both route through one call):

```ts
personaStore.recordTurn(id, {
  wallMs: number, // turn duration, real clock
  outputTokens: number, // real, same field shiftStats already tracks
  wasError: boolean, // hook Stop with error signal, OR dispatch exit code != 0
  now: (number = Date.now()),
});
```

Push `{ ts: now, wallMs, outputTokens, wasError, hour: new Date(now).getHours() }`
onto `rolling.recentTurns`, cap at 50 (drop oldest). Require `recentTurns.length >= MIN_SAMPLES (5)`
before scores deviate from the neutral default (50/50/0/50) — below that,
show `"ROOKIE"` (see badges below), never a misleadingly precise score off
1-4 samples.

```ts
const SPEED_MS_REFERENCE = 180_000; // 3 min reference turn
const EFFICIENCY_LEAN_MAX = 1_500; // reuse shiftStats.ts constant literally — import it, don't retype
const EFFICIENCY_HEAVY_MAX = 12_000; // 0 floor beyond this

function computeScores(
  turns: PersonaRollingStats['recentTurns'],
  bonus: PersonaTrainingBonus,
): PersonaScores {
  if (turns.length < 5) return { speed: 50, accuracy: 50, nightOwl: 0, tokenEfficiency: 50 };
  const avgWallMs = mean(turns.map((t) => t.wallMs));
  const errorRate = turns.filter((t) => t.wasError).length / turns.length;
  const nightFrac = turns.filter((t) => t.hour >= 22 || t.hour < 6).length / turns.length;
  const avgOutTok = mean(turns.map((t) => t.outputTokens));

  const speed = clamp(0, 100, 100 - (avgWallMs / SPEED_MS_REFERENCE) * 100);
  const accuracy = clamp(0, 100, 100 - errorRate * 100 * 2); // 50% errors -> 0
  const nightOwl = clamp(0, 100, nightFrac * 100);
  const tokenEfficiency = clamp(
    0,
    100,
    avgOutTok <= EFFICIENCY_LEAN_MAX
      ? 100
      : avgOutTok >= EFFICIENCY_HEAVY_MAX
        ? 0
        : 100 -
          ((avgOutTok - EFFICIENCY_LEAN_MAX) / (EFFICIENCY_HEAVY_MAX - EFFICIENCY_LEAN_MAX)) * 100,
  );
  return {
    speed: clamp(0, 100, speed + bonus.speed),
    accuracy: clamp(0, 100, accuracy + bonus.accuracy),
    nightOwl: clamp(0, 100, nightOwl + bonus.nightOwl),
    tokenEfficiency: clamp(0, 100, tokenEfficiency + bonus.tokenEfficiency),
  };
}
```

**Discrete trait badges** (shape+text chips, same pattern as
`webview-ui/src/office/crisis.ts`'s `STATE_CHIPS` — new sibling file
`webview-ui/src/office/personaBadges.ts`), computed from scores, MULTIPLE
can apply:

| Badge        | Glyph | Condition                                        |
| ------------ | ----- | ------------------------------------------------ |
| ROOKIE       | `◔`   | `recentTurns.length < 5` (suppresses all others) |
| FAST         | `⚡`  | `speed >= 70`                                    |
| SLOPPY       | `✗`   | `accuracy < 50`                                  |
| METICULOUS   | `✓✓`  | `accuracy >= 85`                                 |
| NIGHT OWL    | `☾`   | `nightOwl >= 40`                                 |
| EFFICIENT    | `⬇`   | `tokenEfficiency >= 70`                          |
| BURNS TOKENS | `⬆`   | `tokenEfficiency < 30`                           |

No color-only signal anywhere — every badge is glyph + uppercase label,
per the vault-wide colorblind hard rule.

## 6. XP, leveling, rank

```ts
export const XP_TURN = 4;
export const XP_CRISIS_RESOLVED = 12; // only the persona assigned when it resolved
export const XP_DISPATCH_EXIT_0 = 8;
export const XP_DISPATCH_EXIT_NONZERO = 2; // still credit for the attempt — never zero, never negative
```

Level via `computeLevel(xp, { base: 60, step: 30 })` (section 1). Rank
thresholds (cosmetic + raises `trainingBonus` per-track cap):

| Rank      | Min level | Training bonus cap per track |
| --------- | --------- | ---------------------------- |
| Junior    | 1         | +12                          |
| Senior    | 5         | +20                          |
| Lead      | 10        | +28                          |
| Principal | 18        | +36                          |

Promotion is a player verb (section 8), gated by level threshold — leveling
up alone does NOT auto-promote (keeps "promote" a meaningful spend, not
just a number ticking over).

## 7. Mood + needs (colony layer)

Tick function, called from a single server-side interval
(`setInterval(tickAllPersonas, PERSONA_TICK_MS)`, `PERSONA_TICK_MS = 5 * 60_000`),
guarded to skip entirely if zero non-terminal personas exist (no idle CPU
burn, no idle file writes):

```ts
const DECAY_PER_HOUR = { energyActive: 1, energyIdle: 0.25, social: 0.5, hygiene: 0.2 };

function tick(p: PersonaRecord, hoursElapsed: number): void {
  if (p.status === 'quit' || p.status === 'fired' || p.status === 'retired') return;
  const activeRecently = Date.now() - p.lastActiveAt < 60 * 60_000;
  p.needs.energy = clamp(
    0,
    100,
    p.needs.energy -
      hoursElapsed * (activeRecently ? DECAY_PER_HOUR.energyActive : DECAY_PER_HOUR.energyIdle),
  );
  p.needs.social = clamp(0, 100, p.needs.social - hoursElapsed * DECAY_PER_HOUR.social);
  p.needs.hygiene = clamp(0, 100, p.needs.hygiene - hoursElapsed * DECAY_PER_HOUR.hygiene);
  if (p.status === 'on_break' && p.breakUntil && Date.now() >= p.breakUntil) {
    p.needs.energy = 100;
    p.needs.social = clamp(0, 100, p.needs.social + 20);
    p.status = 'active';
    p.breakUntil = undefined;
  }
  p.mood = clamp(
    0,
    100,
    Math.round(0.5 * p.needs.energy + 0.3 * p.needs.social + 0.2 * p.needs.hygiene),
  );
}
```

Direct mood events (applied immediately, outside the tick, at the moment
they happen):

| Event                                                                                   | Mood delta |
| --------------------------------------------------------------------------------------- | ---------- |
| This persona's assigned crisis resolves (real, observed)                                | +5         |
| Shift day closes graded LEAN (studio-wide, applies to all `active`/`on_break` personas) | +5         |
| Shift day closes graded HEAVY                                                           | −5         |
| Promotion                                                                               | +15        |
| Training                                                                                | +3         |

## 8. Quit mechanics

At real-calendar day rollover (reuse the exact pattern of
`shiftStats.ts`'s `onDayClose` hook — wire a persona-side day-close check
into the SAME rollover, don't add a second timer):

```ts
export const QUIT_THRESHOLD_MOOD = 20;
export const QUIT_GRACE_DAYS = 5;

function dailyQuitCheck(p: PersonaRecord, dateSeed: string): void {
  if (p.mood < QUIT_THRESHOLD_MOOD) p.lowMoodStreakDays += 1;
  else {
    p.lowMoodStreakDays = 0;
    return;
  }
  if (p.lowMoodStreakDays < QUIT_GRACE_DAYS) return;
  const chance = clamp(0, 0.6, ((QUIT_THRESHOLD_MOOD - p.mood) / QUIT_THRESHOLD_MOOD) * 0.6);
  const roll = seededRandom(`${p.id}|${dateSeed}`); // mulberry32(hash(seed)), deterministic + testable
  if (roll < chance) {
    const lostLevel = computeLevel(p.xp, LEVEL_CURVE).level;
    p.xp = xpForLevel(Math.max(1, Math.floor(lostLevel / 2)), LEVEL_CURVE);
    p.status = 'quit';
    appendLedger(p.id, {
      ts: Date.now(),
      kind: 'quit',
      xpDelta: 0,
      note: `mood ${p.mood} for ${p.lowMoodStreakDays}d`,
    });
  }
}
```

`seededRandom` = mulberry32 seeded by a 32-bit hash of the string — pure,
deterministic, unit-testable without mocking `Math.random`. Quit is
**visible, not silent**: broadcast a `PersonaQuit` WS message (new type in
`core/src/messages.ts`, sibling to `AgentPidUpdate`) so the office renderer
can show a walkout beat (ASSUMES-ENGINE-5 renders it; this section just
emits the event with `{ id, name, lastLevel }`).

**Rehire:** a `fired`/`quit` persona can be rehired via the same identity
key returning real telemetry (auto) or an explicit REHIRE verb (player).
Rehire cost = `2 * BASE_HIRE_COST` (placeholder, ASSUMES-ECON-2), resets
`mood = 50`, `needs = {70,70,70}`, `xp = xpForLevel(max(1, floor(oldLevelAtQuit/2)))`
(already halved once at quit time — rehire does not halve again), keeps
the SAME name/sprite/history ledger (append a `rehired` ledger line).

## 9. Verbs — full table with costs, gates, and the hard-rule check

| Verb                       | Cost                                                 | Gate                                                                                | Effect                                                                                                                           | Blocks real work?                                                                                                     |
| -------------------------- | ---------------------------------------------------- | ----------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Auto-hire (candidate)      | Cash 0                                               | first real telemetry event for a new key                                            | creates `PersonaRecord`, `status: 'candidate'`                                                                                   | No — happens on the same tick as the real event, fire-and-forget                                                      |
| Onboard (candidate→active) | Cash 0                                               | player click, or auto-promotes to `active` after 3 real turns if player never looks | `status: 'active'`                                                                                                               | No                                                                                                                    |
| Assign                     | Cash 0                                               | persona `active`                                                                    | sets `assignedRoomId`/routing preference (ASSUMES-BUILD-3, ASSUMES-DISPATCH-1)                                                   | No                                                                                                                    |
| Train                      | Cash `TRAIN_COST = 100` (ASSUMES-ECON-2 placeholder) | `status active`, chosen track's `trainingBonus` < rank cap                          | `xp += 25`, chosen track `trainingBonus += 5` (capped per rank table §6)                                                         | No                                                                                                                    |
| Promote                    | Cash `PROMOTE_COST_PER_TIER = 200 * nextTierIndex`   | `level >= tier threshold` AND `mood >= 50`                                          | `rank` += 1 tier, `mood += 15`, raises trainingBonus cap                                                                         | No                                                                                                                    |
| Send on break              | Cash 0                                               | `status active`                                                                     | `status = 'on_break'`, `breakUntil = now + 20min`, needs restore on completion (§7)                                              | **No — dispatch to this persona's project/machine still works normally; break is cosmetic/needs-only, per hard rule** |
| Fire                       | Cash 0                                               | any status except already-terminal                                                  | `status = 'fired'`, Reputation −10 (ASSUMES-ECON-1), key blacklisted from auto-rehire (new telemetry → new `#`-suffixed persona) | No                                                                                                                    |
| Retire                     | Cash 0                                               | `level >= 10`                                                                       | `status = 'retired'`, Reputation +10, listed in Hall of Fame panel                                                               | No                                                                                                                    |
| Rehire                     | Cash `2 * BASE_HIRE_COST`                            | persona `status` is `fired` or `quit`                                               | see §8                                                                                                                           | No                                                                                                                    |

Every row's last column is a designed answer, not an oversight — re-verify
each against the standing hard rule before implementation.

## 10. HTTP + WS surface (extends existing patterns, doesn't invent new ones)

Routes (in `server/src/httpServer.ts`, same auth posture as existing
`/api/progression`/`/api/dispatch/*` — read routes unauth+safe, mutating
routes behind whatever session auth dispatch decisions already use):

- `GET /api/personas` → `PersonaRecord[]` (full roster, all statuses)
- `GET /api/personas/:id/history?limit=50` → tail of the JSONL ledger
- `POST /api/personas/:id/{train|promote|break|fire|retire|rehire|assign|onboard}`
  → body per-verb (e.g. `{track: 'speed'}` for train), returns updated
  `PersonaRecord` or `{ok:false, reason}` on a failed gate (insufficient
  Cash, wrong status, etc. — 200 with `ok:false`, matching `dispatchStore`'s
  "deny is a decision, not an error" posture, not a 4xx).

WS message types, added to `core/src/messages.ts` union (alongside
`AgentPidUpdate`/`ProgressionUpdate`) and to `core/asyncapi.yaml`:

```ts
export interface PersonaSnapshot {
  type: 'personaSnapshot';
  id: string;
  name: string;
  spriteIndex: number;
  status: PersonaStatus;
  rank: PersonaRank;
  level: number;
  mood: number;
  needs: PersonaNeeds;
  scores: PersonaScores;
  badges: string[];
}
export interface PersonaHired {
  type: 'personaHired';
  id: string;
  name: string;
}
export interface PersonaQuit {
  type: 'personaQuit';
  id: string;
  name: string;
  lastLevel: number;
}
```

Broadcast `personaSnapshot` on every `finish()`-equivalent mutation
(mirrors `progressionStore`'s `onChange`/listener pattern exactly — reuse
the same `onChange(listener)` method shape for API consistency across
stores).

## 11. File-level task list (execute in this order)

1. `core/src/leveling.ts` — new, pure functions (§1). Update
   `progressionStore.ts` to call it; run
   `npx vitest run server/__tests__/progressionStore.test.ts` — must stay
   100% green with zero test edits (proves the refactor is behavior-neutral).
2. `server/src/personaNames.ts` — new, 120-name flavor array.
3. `server/src/assetLoader.ts` — add/verify `getCharacterCount()` export
   (grep first: `grep -n "export function" server/src/assetLoader.ts`;
   only add if it's not already exposed).
4. `server/src/personaStore.ts` — new, full store per §2-§8 (identity key,
   hire/onboard, scores, mood/needs tick, quit check, ledger writer).
5. `server/__tests__/personaStore.test.ts` — new. Minimum coverage: key
   determinism, score formula boundaries (0/50/100 cases), quit
   determinism (fixed seed → fixed outcome), ledger rotation at 5000
   lines, VITEST-default-path guard (copy the assertion pattern from
   `server/__tests__/progressionStore.test.ts` that checks the real
   sidecar is never touched under test).
6. `core/src/messages.ts` + `core/asyncapi.yaml` — add the 3 message
   types (§10). Run whatever codegen/lint step validates asyncapi against
   the TS types (check `package.json` scripts for `asyncapi` before
   assuming one).
7. `server/src/httpServer.ts` — wire the 9 routes (§10), throttled the
   same way dispatch routes are.
8. Wire `recordTurn`/`recordCrisisResolved` calls into the SAME call
   sites that already call `progression.recordTurnEnd()` /
   `progression.recordCrisisResolved()` (grep those two call sites first —
   likely `hookEventHandler.ts` and wherever poll-state blocked→resolved
   transitions fire) — add the persona-side call alongside, not instead of.
9. `webview-ui/src/office/personaBadges.ts` — new, badge table (§5), same
   shape/pattern as `webview-ui/src/office/crisis.ts`'s `STATE_CHIPS`.
10. Roster UI panel (new component under `webview-ui/src/components/`,
    naming to match sibling `ProgressionHUD.tsx`) — read-only list first
    (name, sprite, rank, level, mood bar as TEXT number + bar, badges) with
    verb buttons wired to the routes in §10. Full render polish deferred
    to engine/art section per ASSUMES-ENGINE-5.

## 12. Verification commands

```bash
cd /Users/greg/code/war-room
npx vitest run server/__tests__/progressionStore.test.ts   # refactor didn't break player progression
npx vitest run server/__tests__/personaStore.test.ts        # new store's own suite
npx tsc --noEmit                                            # whole-repo type check
npx eslint server/src/personaStore.ts core/src/leveling.ts
# manual: start server, tail ~/.pixel-agents/personas.json across a real
# Claude turn on 2 different machines — expect 2 distinct persona ids.
```

---

## Risks

- **Identity churn:** if a project gets moved/renamed on disk, its
  `normalizeProjectPath` slug changes and a "new employee" appears,
  orphaning the old one's history silently. No migration path defined here.
- **Quit-then-rehire loop farming:** a player could deliberately tank mood,
  let a persona quit (halves level), then keep working the same project
  under a fresh implicit hire to dodge the rehire-cost path entirely (fired
  blacklists the key, but a natural quit does NOT blacklist it — re-check
  whether that's intended or a gap).
- **Tick cadence vs. wall-clock drift:** the 5-minute `tickAllPersonas`
  interval assumes the server process stays running continuously; a
  server restart (redeploy, which this project does often per STATE.md)
  loses in-flight decay accumulation between ticks — acceptable for mood
  (self-corrects next tick) but not verified against long sleep/wake gaps
  on a laptop server.

## 3 things most likely to be wrong

1. **The (machine, provider, project) identity grain** — Greg said "per
   project/machine identity" but didn't confirm provider should also
   split identity; splitting claude vs codex on the same project/machine
   into two employees may feel wrong once he sees it populated (could
   instead be one employee with a "provider" trait tag, not a key
   component).
2. **Auto-hire-for-free with no Cash cost** — plausible per "real work
   always flows" but conflicts with the fantasy of a manager sim where
   hiring is a decision; economy section may want a first-hire cost that
   this section currently sets to 0 everywhere.
3. **Quit halving XP/level rather than firing outright** — invented to
   match "recoverable but felt" softly; the grace window (5 days under
   mood 20) and probability curve are unvalidated guesses with no
   playtest — likely the single most retuned number after first contact.
