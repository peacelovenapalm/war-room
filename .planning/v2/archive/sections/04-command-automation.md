# 04 — Command Layer: Dispatch Chains, Standing Orders, Automation

Status: v2 section design. Extends the SHIPPED dispatch vertical (mechanic
#6b, `.planning/DISPATCH-6B-DESIGN.md`, live since 2026-07-08 per
`.planning/STATE.md`). Everything below is an EXTENSION of
`server/src/dispatchStore.ts` + `bin/dispatch-runner.mjs` +
`bin/lib/dispatch-rules.mjs` — nothing here introduces a second execution
path. Read those three files before building; this doc names exact
functions/fields they already export and the exact new fields/files that
extend them.

## ASSUMES (for the critique pass to reconcile against other sections)

1. **Economy section owns Cash.** This doc treats `Cash` as an opaque
   integer balance with a `spendCash(amount, reason): boolean` server-side
   function it can call — it does not define how Cash is earned. If the
   economy section's currency store has a different name/shape, the perk
   costs below (§6) are the numbers to port, not the plumbing.
2. **Employee section owns the Employee record.** This doc assumes an
   `Employee` shape that includes at minimum: `{ id, name, homeMachine,
defaultProvider, defaultCwd, defaultModel? }`. Dispatch routing (§4) reads
   these four fields only. If the employee schema names fields differently,
   rename the four reads in `resolveEmployeeDefaults()` (§4) — nothing else
   in this doc depends on the employee record.
3. **Engine choice (PixiJS) does not touch this doc.** Command automation is
   server + bin only; the only webview surface is CallModal extensions and
   two new panels (Chain Builder, Standing Orders), which are DOM/React
   panels layered over the canvas today and can stay DOM/React after the
   Pixi rewrite — no canvas rendering is specified here.
4. **`~/.pixel-agents/` is the existing file-backed store root** on each
   Mac (`LAYOUT_FILE_DIR` in `server/src/constants.ts`) — the same directory
   `progressionStore.ts` and `dispatchStore.ts` already use. New stores in
   this doc follow that exact convention (file-backed, tolerant parse,
   append-only audit where noted).

---

## 1. Ground truth on the existing dispatch vertical (what this extends)

- `DispatchRecord` (`server/src/dispatchStore.ts`) already has: `id, action,
machine, provider, cwd, prompt, sessionId, pid, model, effort, status
('ringing'|'answered'|'denied'|'expired'|'exited'), reason, exitCode,
resultTail (≤8192 chars), createdAt, updatedAt`.
- `enqueue()` is the ONLY way a request becomes runnable. The runner
  (`bin/dispatch-runner.mjs`) polls `POST /api/dispatch/poll`, re-reads its
  local allowlist every tick, and denies-by-default. **Every new mechanic in
  this doc creates DispatchRecords through `enqueue()` — none of them talk
  to the runner directly, none of them add a new poll route, none of them
  add a new allowlist file.** This is the one hard architectural rule this
  whole section exists to protect.
- `DISPATCH_RINGING_CAP = 5` per machine and `DISPATCH_TTL_MS = 600_000`
  already provide natural backpressure — chains and standing orders inherit
  these caps for free by going through `enqueue()`.

---

## 2. Dispatch chains (multi-step, output feeds next step)

### 2.1 New file: `server/src/chainStore.ts`

Same conventions as `dispatchStore.ts` (file-backed at
`~/.pixel-agents/chain-defs.json` + `~/.pixel-agents/chain-runs.json`,
append-only audit at `~/.pixel-agents/chain-audit.jsonl`, throttle-free
writes — a chain mutates on every step transition and every mutation
matters for restart survival, same rationale dispatchStore.ts documents).

```ts
export const CHAIN_MAX_STEPS = 8; // reject at save time
export const CHAIN_MAX_CONCURRENT_RUNS = 3; // server-wide, not per-machine
export const CHAIN_STEP_TIMEOUT_MS = 900_000; // 15 min; step neither exited
// nor denied by this age =>
// chain fails 'step-timeout'

interface ChainStepDef {
  order: number; // 1-based, contiguous, enforced at save
  employeeId?: string; // resolved via resolveEmployeeDefaults()
  machine: string; // required if employeeId absent
  provider: 'claude' | 'codex'; // gemini excluded, mirrors DISPATCH_UI_PROVIDERS
  cwd?: string; // required if employeeId absent
  promptTemplate: string; // may contain {{stepN.result}} / {{stepN.exitCode}}
  model?: string;
  effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  continueOnError?: boolean; // default false: nonzero exit halts chain
}

interface ChainDef {
  id: string; // uuid
  name: string; // ≤64 chars, shown in Chain Builder + BRIEFING
  steps: ChainStepDef[]; // 1..CHAIN_MAX_STEPS, order 1..N contiguous
  createdAt: number;
  updatedAt: number;
}

type ChainRunStatus = 'running' | 'completed' | 'failed' | 'paused-budget' | 'cancelled';

interface ChainStepRun {
  stepOrder: number;
  dispatchId?: string; // the DispatchRecord.id for this step
  status: 'pending' | 'ringing' | 'answered' | 'exited' | 'denied' | 'timed-out' | 'skipped';
  resultTail?: string; // copied from the DispatchRecord on exit
  exitCode?: number;
  startedAt?: number;
  endedAt?: number;
}

interface ChainRun {
  id: string;
  chainDefId: string;
  status: ChainRunStatus;
  currentStep: number; // 1-based; 0 before first enqueue
  steps: ChainStepRun[];
  failReason?: string; // set on 'failed'/'paused-budget'
  startedAt: number;
  updatedAt: number;
}
```

Exports mirror `dispatchStore.ts`'s naming: `saveChainDef`, `listChainDefs`,
`deleteChainDef`, `startChainRun(chainDefId): { ok: true, run } | { ok:
false, reason }`, `listChainRuns`, `cancelChainRun(id)`.

`startChainRun` rejects (`ok:false`) when `listChainRuns().filter(r =>
r.status === 'running').length >= CHAIN_MAX_CONCURRENT_RUNS` — same
backpressure shape as `DISPATCH_RINGING_CAP`.

### 2.2 New file: `server/src/chainOrchestrator.ts`

Pure-logic-plus-glue module, subscribed to the SAME `dispatchUpdate`
broadcast the webview already consumes (`clientMessageHandler.ts` is where
that broadcast currently fans out — add a second internal subscriber here,
do not add a second WS connection).

Algorithm, invoked on every `dispatchUpdate` where the record carries
`chainRunId` + `chainStep` (two new **optional** fields added to
`DispatchRecord` and `DispatchEnqueueInput` in `dispatchStore.ts` — additive,
does not change any existing dispatch behavior or test):

1. Look up the `ChainRun` by `chainRunId`. If not found or already terminal,
   no-op (idempotent — a duplicate broadcast must never double-advance).
2. Update `steps[chainStep]` from the incoming `DispatchRecord` (`status`,
   `resultTail`, `exitCode`, timestamps).
3. If status is `denied` or (`exited` with nonzero `exitCode` and
   `continueOnError` is not true): mark the `ChainRun` `failed`, set
   `failReason` from the dispatch's own `reason`/`exitCode`, stop. **A
   denied step is not retried and does not advance** — the runner's
   allowlist decision is final, full stop, same as any manual dispatch.
4. If status is `exited` (0, or nonzero+`continueOnError`) and there is a
   next step (`chainStep < steps.length`):
   a. Render `steps[chainStep+1].promptTemplate` — replace every
   `{{stepK.result}}` with `steps[K].resultTail` (already ≤8192 chars,
   the existing `DISPATCH_RESULT_TAIL_MAX_CHARS` cap) and every
   `{{stepK.exitCode}}` with `steps[K].exitCode`. `K` must be `<
chainStep+1` (a step may only reference an earlier step, never
   itself/later — reject unresolvable refs at `saveChainDef` time via
   static validation, not at render time).
   b. **Budget gate here** (§5) — if the target machine+provider is
   currently paused, set `ChainRun.status = 'paused-budget'` and stop;
   do NOT enqueue. A paused chain run is resumable: a 60s sweep
   (`chainOrchestrator.resumePausedRuns()`, called from the same
   scheduler tick as §3) re-checks budget and calls step 4 again when
   clear.
   c. Otherwise call `dispatchStore.enqueue({ ...resolved step fields,
chainRunId, chainStep: chainStep+1 })` — this is the ONLY call site
   that starts a chain step. It goes through the exact same `enqueue()`
   the CallModal uses, which means the runner's per-machine allowlist
   check applies to EVERY step independently. A chain step targeting a
   root/provider the target machine's runner doesn't allow gets denied
   locally by the runner exactly like a manual dispatch — the chain then
   fails cleanly per step 3, it never bypasses the boundary.
5. If there is no next step: mark `ChainRun.status = 'completed'`.

Step timeout: a 60s sweep marks any `ChainStepRun` in `ringing`/`answered`
older than `CHAIN_STEP_TIMEOUT_MS` as `timed-out` and fails the run — mirrors
`DISPATCH_TTL_MS` sweep semantics already in `dispatchStore.ts`.

### 2.3 Webview: Chain Builder panel

New file `webview-ui/src/components/ChainBuilderPanel.tsx` (list of
`ChainStepDef` rows, add/remove/reorder, each row = the same fields
CallModal already collects: provider/machine/cwd/model/effort dropdowns
sourced from live `GET /api/dispatch/machines`, plus the `promptTemplate`
textarea with inline `{{stepN.result}}` autocomplete listing only prior
steps). "Run chain now" button calls `startChainRun`. A running chain
renders in a new `ChainTray.tsx` (sibling of `DispatchTray.tsx`, same
glyph+word chip convention: `▶ step 2/4 running`, `✗ FAILED step 3`, `⏸
PAUSED — budget`, `✓ completed`).

---

## 3. Standing orders (cron-like recurring dispatch/chain)

**Decision: no cron-expression parser.** Sonnet build agents must not
hand-roll cron parsing. Two schedule kinds only:

```ts
type StandingOrderSchedule =
  | { kind: 'daily'; hour: number; minute: number } // local machine tz, 0-23 / 0-59
  | { kind: 'interval'; everyMinutes: number }; // min 60, max 1440

interface StandingOrder {
  id: string;
  name: string;
  target: { kind: 'dispatch'; template: DispatchTemplate } | { kind: 'chain'; chainDefId: string };
  schedule: StandingOrderSchedule;
  enabled: boolean;
  employeeId?: string;
  requiresFirstFireConfirm: boolean; // true until manually confirmed once (see §6 Autopilot)
  lastFiredAt?: number; // epoch ms
  lastFireDateLocal?: string; // 'YYYY-MM-DD', dedupe guard for 'daily'
  lastSkipReason?: string; // budget-paused / stale-snapshot / disabled
  createdAt: number;
  updatedAt: number;
}
```

New file: `server/src/standingOrderStore.ts` (file-backed,
`~/.pixel-agents/standing-orders.json`, same conventions).

**Base cap: 1 enabled standing order.** Raised only by Cash perks (§6) — the
cap itself lives in `standingOrderStore.ts` as
`standingOrderSlots(perkFlags): number`, reading unlock flags from the
economy/perk store (see ASSUMES §1).

### 3.1 Scheduler

Reuse `server/src/timerManager.ts` (already the server's tick primitive per
its existing use for TTL sweeps) — add one more named tick,
`standingOrderTick`, every 60s:

1. For each `enabled` order with `schedule.kind === 'daily'`: fire if
   local `HH:MM` (server's local tz — NEXUS container tz must be set to
   Greg's tz at deploy, a go-live checklist item, not a code concern) `>=`
   `hour:minute` AND `lastFireDateLocal !== today's date string`.
2. For each `enabled` order with `schedule.kind === 'interval'`: fire if
   `now - (lastFiredAt ?? 0) >= everyMinutes * 60_000`.
3. Before firing: resolve `employeeId`/`target` to machine+provider (§4),
   check the budget gate (§5). If paused, set `lastSkipReason`, do NOT
   update `lastFiredAt` (so it fires as soon as budget clears, not stuck
   until tomorrow).
4. If `requiresFirstFireConfirm` is true and this order has never fired
   (`lastFiredAt` undefined): do NOT fire. Instead set a `pendingConfirm:
true` flag surfaced in the Standing Orders panel as `⚠ needs first-run
confirm` — a human clicks CONFIRM once in the UI (`POST
/api/standing-orders/:id/confirm`), which flips
   `requiresFirstFireConfirm = false` permanently for that order. This is
   the automation speed bump: a brand-new standing order's first execution
   is always a conscious click, exactly once, ever — after that it runs
   unattended on schedule. (Autopilot perk, §6, removes this gate entirely
   for orders created after the perk is purchased.)
5. Otherwise: fire — `target.kind === 'dispatch'` calls
   `dispatchStore.enqueue()` directly; `target.kind === 'chain'` calls
   `chainStore.startChainRun()`. Set `lastFiredAt`, `lastFireDateLocal`,
   clear `lastSkipReason`.

### 3.2 Webview: Standing Orders panel

New file `webview-ui/src/components/StandingOrdersPanel.tsx` — list rows
(name, schedule text, enabled toggle, last-fired relative time, status
chip), "New standing order" form reusing the CallModal's provider/machine/
cwd/model pickers plus the two schedule-kind radio options, and a
"promote a template to a standing order" affordance (§4).

---

## 4. Templates/favorites + per-employee routing

### 4.1 Templates

```ts
interface DispatchTemplate {
  id: string;
  name: string; // ≤64 chars
  provider: 'claude' | 'codex';
  machine?: string; // optional: if absent, resolved from employeeId at fire time
  cwd?: string;
  promptTemplate: string; // may itself contain {{stepN.*}} ONLY if used inside a chain step;
  // a standalone template's placeholders are left literal (not chain-aware)
  model?: string;
  effort?: DispatchEffort;
  employeeId?: string;
}
```

New file `server/src/dispatchTemplateStore.ts` (file-backed,
`~/.pixel-agents/dispatch-templates.json`). **Cap: 20 templates** — reject
save beyond that (UI-sanity number, not a security boundary). CallModal
gets a "Load template ▾" dropdown at the top and a "Save as template"
button next to Send.

### 4.2 Per-employee routing

```ts
function resolveEmployeeDefaults(
  employeeId: string,
  employees: EmployeeStore,
): { machine: string; provider: DispatchProvider; cwd: string; model?: string } | null;
```

Reads exactly the four ASSUMES-§2 fields off the `Employee` record. Used at
THREE call sites: CallModal's "Assign to employee" selector (prefills
machine/provider/cwd/model, all four remain editable — this is a prefill
convenience, never a hard lock), `ChainStepDef.employeeId`, and
`StandingOrder.employeeId`. In all three, if both `employeeId` and explicit
fields are present, **explicit fields win** (an operator overriding the
default for one run does not require unassigning the employee).

**Growth hook:** every `DispatchRecord` that carries an `employeeId` and
reaches `exited` with `exitCode === 0` emits one additional server-side
event, `employeeWorkCompleted({ employeeId, provider, tookMs })`, fired
from the same `clientMessageHandler.ts` broadcast point chainOrchestrator
subscribes to (§2.2) — a second subscriber, not a new channel. The
employee section's store owns what happens with that event (XP, trait
drift); this doc only guarantees the event fires exactly once per
successfully-exited dispatch, whether it came from a manual CALL, a chain
step, or a standing order.

---

## 5. THE RATE-LIMIT BUDGET

### 5.1 Where the real numbers already live (verified this session)

`~/.claude/statusline.js` (Greg-owned, NOT part of this repo) already
renders a live rate-limit meter from `data.rate_limits.five_hour` /
`.seven_day`, each `{ used_percentage: number, resets_at: epoch-seconds
}` (`statusline.js` lines 353-368, function `usageTier`/`fmtReset`). This
object is hand delivered to the statusline command **on every prompt
render** as part of the stdin JSON Claude Code itself passes in — it is
the authoritative, first-party usage number, not an estimate. There is no
standalone `claude usage --json` CLI verified this session (checked
`claude --help`; no usage subcommand) — the statusline hook is the only
observed delivery mechanism, so this design pipes data OUT of it rather
than querying Claude Code independently.

Codex has **no equivalent live signal** (checked `~/.codex/config.toml`,
`~/.codex/session_index.jsonl` — no exposed remaining-quota field for a
ChatGPT-plan-backed `codex exec`). Codex budget is therefore a **manual,
inferred heuristic** (§5.3), explicitly labeled as such in the UI — never
presented with the same visual confidence as the Claude meter.

### 5.2 New: extend `~/.claude/statusline.js` with a snapshot write (Greg approves this edit separately — it's his file)

Add ~10 lines after the existing rate-limit row assembly (around line 367):
on every render where `rl` is present, write (not throttled — cheap, and
freshness is exactly what matters here):

```js
try {
  const snapPath = path.join(os.homedir(), '.pixel-agents', 'rate-limit-snapshot.json');
  fs.mkdirSync(path.dirname(snapPath), { recursive: true });
  fs.writeFileSync(
    snapPath,
    JSON.stringify({
      machine: os.hostname().split('.')[0].toUpperCase(),
      provider: 'claude',
      fiveHour: rl.five_hour
        ? { usedPct: rl.five_hour.used_percentage, resetsAt: rl.five_hour.resets_at }
        : null,
      sevenDay: rl.seven_day
        ? { usedPct: rl.seven_day.used_percentage, resetsAt: rl.seven_day.resets_at }
        : null,
      observedAt: Math.floor(Date.now() / 1000),
    }),
  );
} catch (e) {}
```

This is a **local file**, same machine as the statusline runs on (MACBOOK or
MINI) — it does not reach the server by itself. The needs-input-poller
(`bin/needs-input-poller.mjs`), which already runs per-machine and phones
home over the authed channel, gains one more read-and-forward per poll
tick: read `~/.pixel-agents/rate-limit-snapshot.json` if present and
`observedAt` is within the last 15 minutes, `POST` its contents alongside
the existing poll payload to a **new route**, `POST /api/budget/report`
(Bearer + X-Machine, same auth as every other poller route).

### 5.3 New: `server/src/budgetStore.ts`

File-backed, `~/.pixel-agents/budget-snapshots.json`, keyed by
`machine:provider`.

```ts
interface BudgetSnapshot {
  machine: string;
  provider: 'claude' | 'codex';
  fiveHourUsedPct?: number; // claude only
  fiveHourResetsAt?: number;
  sevenDayUsedPct?: number; // claude only
  sevenDayResetsAt?: number;
  codexWeeklyEstimateUsedPct?: number; // codex only, heuristic (see below)
  observedAt: number; // epoch seconds, from the reporting machine's clock
  receivedAt: number; // epoch ms, server clock — staleness is judged on THIS
}

export const BUDGET_STALE_MS = 900_000; // 15 min — no fresh report => fail-safe pause
export const BUDGET_PAUSE_5H_PCT_BASE = 70; // automation pauses at/above this, before perks
export const BUDGET_PAUSE_7D_PCT_BASE = 80;
export const BUDGET_PAUSE_HARD_CEILING_5H = 95; // NEVER raised by any perk
export const BUDGET_PAUSE_HARD_CEILING_7D = 95; // NEVER raised by any perk
```

`isAutomationPaused(machine, provider, perkFlags): { paused: boolean;
reason?: string }`:

- No snapshot, or `receivedAt` older than `BUDGET_STALE_MS` → `paused: true,
reason: 'stale-snapshot'` (fail-safe deny, matching the dispatch runner's
  own "vanished allowlist = deny everything" rule — same philosophy,
  applied to budget).
- `provider === 'claude'`: pause if `fiveHourUsedPct >=
effectiveThreshold('5h', perkFlags)` OR `sevenDayUsedPct >=
effectiveThreshold('7d', perkFlags)`. `effectiveThreshold` starts at the
  BASE constants and is raised by the "Night Shift Foreman" perk (§6) up to,
  but never past, the HARD_CEILING constants.
- `provider === 'codex'`: pause if `codexWeeklyEstimateUsedPct >= 70`
  (flat, no perk adjustment — heuristic numbers don't get to be raised by
  spending fictional Cash).

**Codex heuristic (§5.1 gap-fill):** Greg enters one number once, in a new
config `~/.war-room/budget.json`: `{ codexWeeklyMessageCap: <int> }` (his
own read of his ChatGPT plan's ballpark weekly Codex allowance — explicitly
a guess he owns, not something the game claims to know). `budgetStore.ts`
increments a `codexCallsThisWeek` counter (reset every Monday 00:00 local,
piggybacked on the same `standingOrderTick`) on every `exited` dispatch
where `provider === 'codex'`, and computes
`codexWeeklyEstimateUsedPct = 100 * codexCallsThisWeek / codexWeeklyMessageCap`.
The UI must render this with a `~` prefix and the word "est." — e.g. `~62%
est.` — never the bare `%` the Claude meter gets, so it visually reads as
less certain (word, not color, per the colorblind hard rule — "est." is the
signal).

### 5.4 What gets paused vs. what never does

- **Paused by budget:** standing-order fires (§3.1 step 3), chain-step
  auto-continuation (§2.2 step 4b). Automation only.
- **Never paused by budget:** a manual CALL from CallModal. A human clicking
  "Send" is a conscious real-limit spend the player owns in the moment —
  gating it would violate "never gate real dashboard function behind game
  progress" (it'd be gating a real action behind a game-computed number in
  the wrong direction). The CallModal instead SHOWS the current budget
  meter (reusing the same glyph+word chip family, e.g. `5H ~72% fair` /
  `WK ~91% ⚠ tight`) next to the Send button as information, never as a
  disabled state.
- **Resume:** the 60s sweep (§2.2, §3.1) re-checks on every tick — no
  separate "resume" action needed. A paused chain or skipped standing order
  picks back up the tick after `isAutomationPaused` returns false again.

---

## 6. Automation perks (Cash-purchased; economy section owns the ledger — see ASSUMES §1)

All four are flags in the shared perk-unlock store (ASSUMES §1),
consumed read-only by `standingOrderStore.ts` / `budgetStore.ts` /
`chainStore.ts` via a passed-in `perkFlags` object — none of these three
stores talk to the economy store directly, keeping the layering one-way.

| Perk                | Cash cost | Effect                                                                               | Never-exceed guardrail                                                     |
| ------------------- | --------- | ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------- |
| Second Shift        | 500       | Standing-order cap 1 → 2                                                             | —                                                                          |
| Chain Gang          | 800       | `CHAIN_MAX_STEPS` 8 → 12, `CHAIN_MAX_CONCURRENT_RUNS` 3 → 5                          | —                                                                          |
| Night Shift Foreman | 1500      | Standing-order cap 2 → 4; 5h pause threshold 70% → 80%, 7d pause threshold 80% → 88% | Hard ceilings (95%/95%, §5.3) never move                                   |
| Autopilot           | 2500      | New standing orders created after purchase skip `requiresFirstFireConfirm` entirely  | Orders that already required confirm before purchase still require it once |

"Raising payroll" = buying Night Shift Foreman: the player is consciously
choosing to let automation eat more of the real rate-limit window before
it self-pauses. This is the one place Cash purchase directly changes real
API spend behavior — call this out in any tutorial/help copy the UI section
writes, in plain words, not buried in a stat tooltip.

---

## 7. New/changed files (exact list for the build agent)

**New:**

- `server/src/chainStore.ts`, `server/src/chainOrchestrator.ts`
- `server/src/standingOrderStore.ts`
- `server/src/dispatchTemplateStore.ts`
- `server/src/budgetStore.ts`
- `server/__tests__/chainStore.test.ts`, `chainOrchestrator.test.ts`,
  `standingOrderStore.test.ts`, `dispatchTemplateStore.test.ts`,
  `budgetStore.test.ts` (mirror existing `dispatchStore.test.ts` structure)
- `webview-ui/src/components/ChainBuilderPanel.tsx`, `ChainTray.tsx`,
  `StandingOrdersPanel.tsx`
- `webview-ui/src/chain.ts`, `standingOrders.ts`, `budget.ts` (pure-logic
  siblings, mirroring `webview-ui/src/dispatch.ts`'s split)
- Routes (in `server/src/httpServer.ts`, alongside existing
  `/api/dispatch/*`): `POST /api/chains`, `GET /api/chains`, `POST
/api/chains/:id/run`, `POST /api/chains/runs/:id/cancel`, `GET
/api/chains/runs`; `POST /api/standing-orders`, `GET
/api/standing-orders`, `POST /api/standing-orders/:id/confirm`, `PATCH
/api/standing-orders/:id` (enable/disable); `GET/POST/DELETE
/api/dispatch-templates`; `POST /api/budget/report` (poller only, Bearer +
  X-Machine), `GET /api/budget` (webview, same-origin).

**Modified:**

- `server/src/dispatchStore.ts` — add optional `chainRunId?: string;
chainStep?: number` to `DispatchRecord` and `DispatchEnqueueInput`
  (additive, existing tests unaffected).
- `server/src/clientMessageHandler.ts` — add the chainOrchestrator +
  employee-growth-event subscriber taps on the existing `dispatchUpdate`
  fan-out (no new WS message type needed for chains internally; ChainTray
  polls `GET /api/chains/runs` same cadence DispatchTray polls today, OR —
  build-agent's call, consistent with existing polling pattern — add
  `chainRunUpdate` as a new WS broadcast type mirroring `dispatchUpdate`
  if the existing poll cadence proves too slow in testing).
- `server/src/timerManager.ts` — add `standingOrderTick` (60s) alongside
  whatever sweep tick already exists.
- `bin/needs-input-poller.mjs` — read+forward the rate-limit snapshot file
  (§5.2), tolerant of absence (file not present = no report this tick, not
  an error).
- `~/.claude/statusline.js` — snapshot write (§5.2). **Greg's own file,
  outside this repo** — flag as a separate, explicitly-approved edit in the
  build plan, not silently bundled into a repo commit.
- `webview-ui/src/components/CallModal.tsx` — template load/save, employee
  assignment selector, budget meter chip next to Send.

---

## 8. Verification commands (per milestone, run by the build agent)

- `chainStore`/`chainOrchestrator`: unit test a 3-step chain where step 2's
  template references `{{step1.result}}`, assert the resolved prompt string
  exactly matches expected substitution; unit test a denied step 2 (mock
  runner deny) asserts `ChainRun.status === 'failed'` and step 3 never
  enqueues (assert `enqueue` call count).
- `standingOrderStore`: unit test the `daily` dedupe guard fires exactly
  once per local date across repeated 60s ticks within the same day.
- `budgetStore`: unit test `isAutomationPaused` returns `paused:true,
reason:'stale-snapshot'` when `receivedAt` is `BUDGET_STALE_MS + 1` old;
  unit test threshold math at exactly the boundary (`usedPct === threshold`
  pauses, per existing `>=` convention matching `DISPATCH_RINGING_CAP`
  wording style).
- Live E2E (mirrors the existing dispatch go-live E2E in `.planning/
STATE.md`): create a 2-step chain targeting an allowlisted root on a real
  runner, run it, watch step 1 `exited` → step 2 auto-enqueue with the
  correct substituted prompt → step 2 `exited` → `ChainRun.status ===
'completed'`. Then repeat with step 1's target root NOT on that machine's
  allowlist, confirm the chain reaches `failed` with the runner's own deny
  reason surfaced, and step 2 never appears in the dispatch queue at all.
- Budget pause E2E: hand-edit a `budget-snapshots.json` entry to
  `fiveHourUsedPct: 95`, confirm a due standing order skips with
  `lastSkipReason: 'budget-paused'` and `lastFiredAt` unchanged.
- Full suite gate, same convention as every prior wave in `.planning/
STATE.md`: server/webview/bin test counts + tsc/lint/build clean before
  calling any milestone done.

---

## Risks

- **Cross-machine snapshot freshness is the weakest link.** The whole
  budget system depends on the statusline running recently enough on the
  SAME machine a standing order targets. A machine that's been idle (no
  active Claude Code session, no statusline renders) for >15 min will show
  every automation on it paused — which is the safe failure mode, but may
  read as "automation broken" rather than "correctly cautious" if the UI
  doesn't say `stale-snapshot` in plain words.
- **Codex budget is a guess wearing a progress bar.** If Greg's manually-
  entered `codexWeeklyMessageCap` is wrong, the `~62% est.` number is
  wrong in either direction — silently over-permissive (spends past the
  real cap, discovered only when Codex itself errors) or over-restrictive
  (pauses automation that had headroom). No code fix closes this; it needs
  a periodic manual recalibration nudge, not attempted here.
- **Chain template substitution is a small string-templating DSL that will
  want to grow.** The moment someone wants a conditional (`{{#if
step1.exitCode}}`) or a loop, this design's flat `{{stepN.field}}`
  replace-only approach breaks down. Explicitly out of scope for v1 — flag
  clearly rather than let a build agent improvise a template engine.

## The 3 things most likely to be wrong

1. **The statusline snapshot-write mechanism.** This assumes editing
   Greg's personal `~/.claude/statusline.js` is acceptable and that its
   `rate_limits` stdin shape (`five_hour`/`seven_day` with
   `used_percentage`/`resets_at`) is stable across Claude Code versions —
   neither was verified against an actual live statusline invocation this
   session (only the script's own code was read). Verify by dumping one
   real stdin payload before building §5.2.
2. **The employee schema ASSUMES (§ASSUMES-2) may not match what the
   employee section actually ships** — `resolveEmployeeDefaults()`'s four
   fields are a guess at the minimum viable shape, not confirmed against
   that section's design.
3. **Whether ChainTray needs a new WS broadcast type or can just poll** —
   left as an explicit build-agent decision (§7) because the existing
   `DispatchTray` polling cadence was not measured for "good enough" versus
   "needs push" under a real multi-step chain; guessed wrong, it's a UX
   lag, not a correctness bug, but should be settled by testing, not by
   this doc's assumption.
