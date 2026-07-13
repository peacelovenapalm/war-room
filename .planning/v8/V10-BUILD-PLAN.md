# V10-BUILD-PLAN — autonomy ladder rung TWO (per-project policies + self-ops)

Status: **EXECUTION PLAN, ready for a build agent (codex gpt-5.6-sol).**
Provenance: turns `.planning/v8/V10-DESIGN.md` (scope LOCKED there) into a
dependency-ordered, per-deliverable-verifiable build. This plan adds NO
scope the design didn't set. Repo `/Users/greg/code/war-room`, branch
`war-room/v3`. House format mirrors `.planning/v5/C3-BUILD-PLAN.md`
(gate table + per-task pass/fail) and `.planning/v6/RUN-MAP-v5-v7`.

V10 is an AUTONOMY version. **Containment discipline IS the deliverable** —
the guard rails below are over-specified on purpose. When a choice is
between "capable" and "contained," contain. Every new capability is
deny-by-default; every side effect is receipted BEFORE it fires; every
classification comes from a CLOSED server-side registry, never prompt text.

---

## PRECONDITIONS (hard — codex HALTs on any unmet one that is not an in-plan deliverable)

Copied verbatim from V10-DESIGN §"Preconditions (hard)":

1. **Rung-1 evidence review.** ≥30 days of self-heal receipts examined:
   how many fires, how many correct, how many undos. If rung 1 has ZERO
   real fires by V10 kickoff, that itself is a finding — arm nothing new
   until we know why (nothing broke? too conservative scoped? flags off in
   practice?).
2. **Fix the inherited receipt-after-enqueue crash window** (logged
   follow-up from the V6-4 codex review: receipts persist AFTER
   dispatchStore.enqueue — a crash in between = live dispatch without audit
   trail). No second rung on top of a known audit-trail gap.
3. First autonomous MISTAKE (if one has occurred) gets a written
   post-incident note answering the act's exit question early: was recovery
   boring?

**HALT semantics for codex:**

- Precondition **1** is a HUMAN artifact (Greg's receipt review). It is NOT
  a coding deliverable. If no evidence-review note exists in `.planning/v8/`
  (e.g. `V10-RUNG1-EVIDENCE.md`), **HALT and report** — do not build on an
  un-reviewed rung. The zero-fires case is itself a stop condition.
- Precondition **2** IS in-plan: it is **D0** below. Codex builds it FIRST;
  no other deliverable begins until D0's acceptance check is ✓.
- Precondition **3** is a HUMAN artifact, conditional. If an autonomous
  mistake occurred and no post-incident note exists, **HALT and report**.
  If no mistake occurred, this precondition is vacuously satisfied — note
  that in the final message.

---

## REQUIRED READING (codex, in order, before writing any code)

1. `.planning/v8/V10-DESIGN.md` — the locked scope. V10-1 policies, V10-2
   self-ops audit, V10-3 supervisor lane (gate-decided). Note the
   recalibration: rung 1 already shipped as V6 self-heal.
2. `server/src/selfHeal.ts` — the rung-1 implementation V10 extends. Study
   the closed-registry pattern (`SELF_HEAL_CLASSES` + `isSelfHealClass`),
   the guard chain in `runAction` (cooldown → STOP-ALL → budget-pause →
   per-class flag → execute/decline), receipts + undo notes, honest-⊘
   detectors, and the trust-tier header comment.
3. `server/src/dispatchStore.ts` — `enqueue()` (the side effect self-heal
   drives), the `audit()`/`persist()` order, the budget-gate injection
   (`setBudgetGate`), and `DispatchMachineAdvertisement` (the honest
   freshness signal source).
4. `server/src/stopAllLatch.ts` — the durable STOP-ALL flag
   (`stopAllLatch.isEngaged()`). This is the "existing durable flag" the
   design means. It wins over every policy.
5. `server/src/autoExecutor.ts` — `maybeAutoRequeue` shares D0's
   receipt-after-enqueue ordering; fix both sites.
6. `server/src/opsAdvisor.ts` + `server/src/narrativeFindingStore.ts` —
   where V10-2 files findings. Note opsAdvisor's hard rule: ZERO new server
   mutation capability; `proposedActions` only name a verb+params for an
   EXISTING route. That rule IS V10-2's "proposal-only beyond rung scope."
7. `server/src/budgetStore.ts` — `isAutomationPaused()` is the FLEET-wide
   fail-safe spend gate. V10-1 per-project envelopes are a SEPARATE new
   layer; do NOT conflate them.
8. `server/src/districtsProvider.ts` — how a "project" is keyed
   (subdirectory-scanned key/slug). V10-1 policies key on this project key.
9. `CLAUDE.md` — architecture, constants policy, TS constraints, testing
   tiers, and the **"Codex Delegation (sandboxed builds)"** section (the
   sandbox flags every gate below must run under).
10. `.planning/v5/HORIZON-v20.md` §Invariants — capability is local, deny
    by default forever; Greg gates the irreversible; rungs are
    per-action-class, receipts-backed, revocable; recovery stays boring.
11. **PROTECTED FILES — read to know their surface, NEVER edit:**
    `bin/dispatch-runner.mjs`, `bin/lib/dispatch-rules.mjs`. Zero diff. Any
    line changed here is a plan violation (same bar as C3 mechanism (d)).

---

## ⚠ RECONCILE BEFORE BUILD (design references vs. real code — resolve first)

Each item is a place the DESIGN speaks abstractly and the CODE is
concrete. Confirm the mapping (or flag a gap) before writing the
deliverable that depends on it.

- ⚠ **"the human gate" (V10-1 read-lane auto-approval).** The design says
  read-only dispatches "skip the human gate." There is NO per-dispatch
  human-approval step in `dispatchStore.enqueue` — dispatches ring and the
  runner decides locally. The real gate V10 relaxes is the **autonomy guard
  chain** in `selfHeal.runAction` (today most classes decline as
  `proposal-only`/⊘). Read-lane auto-approval means: a read-only class, for
  a policy-opted-in project with envelope remaining, is ALLOWED to execute
  through its existing plane instead of declining. Name the exact guard-chain
  insertion point in D4 before coding; if the mapping is wrong, HALT.
- ⚠ **STOP-ALL module name.** Design says "existing durable flag." It is
  `stopAllLatch` in `server/src/stopAllLatch.ts` (`isEngaged()`), engaged by
  `POST /api/automation/stop-all` (`httpServer.ts:~1975`). Confirmed present.
- ⚠ **V10-2 audit signal sources.** Design lists "runners fresh? clones
  fresh? backups fresh? disk headroom? cert/serve state? container
  restarts?" Only SOME have an honest signal in code today: runner freshness
  = `dispatchStore.getAllMachineAdvertisements()` lastSeenAt; clone freshness
  = routine-inbox newest mtime (`inboxProvider`). Backups/disk/cert/container
  have **no in-code signal yet** (selfHeal's `detectVaultFix` returns `[]`
  honestly for exactly this reason). For each unsourced check: build an
  honest detector from a real signal, or emit ⊘ NO DATA — NEVER fabricate a
  green/red. List which checks are ⊘ in the final message.
- ⚠ **Findings surface.** V10-2 crises file into the EXISTING
  `opsAdvisor`/`narrativeFindingStore` → `GET /api/ops/review`, NOT a new
  panel (same posture as rung-1 self-heal receipts sharing the ops surface).
- ⚠ **Scheduler primitive.** There is no shared cron primitive; self-heal
  runs via a `setInterval` tick in `httpServer.ts` (`runSelfHealTick`).
  V10-2's audit uses the same idiom (a new interval calling an exported
  `runEstateAuditTick`), gated by a Greg-flipped deploy-time flag (see Greg
  gates). Do not invent a new scheduling framework.
- ⚠ **Per-project budget vs. fleet budget.** `budgetStore.isAutomationPaused`
  is the fleet ceiling and stays as the OUTER gate. V10-1 envelopes are an
  INNER per-project counter. Both must pass; neither replaces the other.

---

## DELIVERABLES (dependency order — each with paths, behavior, must-NOT-change, pass/fail)

### D0 — Receipt-BEFORE-side-effect (precondition #2, blocks everything)

**Why first:** no second rung on a known audit-trail gap. Today a crash
between `dispatchStore.enqueue(...)` and the receipt write leaves a LIVE
dispatch with NO autonomy audit trail.

**Exact sites (verified):**

- `server/src/selfHeal.ts` `runAction()` — `const enqueued =
dispatchStore.enqueue(...)` (~L334) runs BEFORE `this.appendReceipt(...)`
  (~L353). Reorder to receipt-first.
- `server/src/autoExecutor.ts` `maybeAutoRequeue()` — same ordering
  (`enqueue` then `appendReceipt`, ~L385). Fix identically.

**Behavior:** persist an INTENT receipt (`outcome: 'pending'` or equivalent,
naming class/target/plane/intended action) durably BEFORE the enqueue side
effect; after enqueue returns, UPDATE that receipt in place with the real
outcome (`executed`/`failed`) + `dispatchId`. A crash between the two leaves
a durable intent receipt (honest "we were about to act"), never a silent
live dispatch. Suppressed/declined paths (no side effect) keep writing a
single terminal receipt as today.

**Must NOT change:** the receipt SHAPE consumed by `GET /api/ops/self-heal`
and the ops review (additive field for the pending state only, if needed);
the guard-chain order; any protected file.

**Pass/fail:**

- ✓ New unit test injects a throw immediately after `enqueue` returns (mock)
  and asserts a durable receipt for that action EXISTS after the throw
  (intent recorded). ✗ before D0: no receipt survives the throw.
- ✓ Happy-path test: receipt ends `executed` with the real `dispatchId`.
- ✓ `npm run test:server` green; existing self-heal/autoExecutor receipt
  tests still pass (shape back-compatible).

### D1 — Read-only action-class registry (closed, server-side)

**File:** `server/src/readLaneRegistry.ts` (new).

**Behavior:** a `READ_ONLY_ACTION_CLASSES` `as const readonly string[]` +
`isReadOnlyActionClass(value): value is ReadOnlyActionClass` runtime guard
using `.includes()` — EXACT mirror of `selfHeal.ts`'s `SELF_HEAL_CLASSES` /
`isSelfHealClass`. The set is the ONLY source of read-only truth. Seed it
with the provably-read-only classes only (e.g. a read-only estate probe /
status-read class); a class is read-only iff it is in this array. Deny by
default: unknown class → not read-only.

**Must NOT change:** no dynamic registration, no `eval`, no classification
from prompt/dispatch text, no widening from the TS type alone.

**Pass/fail:**

- ✓ Unit: every seeded member returns true; a non-member (incl. every
  `SELF_HEAL_CLASSES` write-ish member and a random string) returns false.
- ✓ NEGATIVE: a class whose NAME contains "read" but is not in the array
  returns false (no substring/heuristic classification).

### D2 — Per-project policy store (deny-by-default, edits gated+receipted)

**File:** `server/src/projectPolicyStore.ts` (new), `V3JsonPersistence`
(`~/.pixel-agents/project-policies.json`), same tolerant/capped idiom as
`selfHealStore`.

**Policy shape (V10-DESIGN §V10-1):**
`{ projectKey: string; readLaneAutoApprove: boolean;
budgetEnvelope: { perDispatch: number; perDay: number };
allowedClasses: string[] }`. `projectKey` MUST match a real
districts/project key (`districtsProvider`).

**Behavior:** `getPolicy(projectKey)` → policy | undefined. **No policy =
NO autonomy** (undefined is deny, never a permissive default). Policy
create/edit is itself an autonomy-gated + RECEIPTED action: every edit
writes a verbatim policy-edit receipt (who/when/before→after) to the same
ops receipt surface, and is subordinate to STOP-ALL (an edit attempt while
STOP-ALL is engaged is declined + receipted). `allowedClasses` entries are
validated against the closed registries (D1 + `SELF_HEAL_CLASSES`); an
unknown class name is rejected, never stored.

**Must NOT change:** no auto-created default policies; no policy for a
project Greg hasn't opted in.

**Pass/fail:**

- ✓ Unit: `getPolicy('never-configured')` → undefined.
- ✓ Every edit produces a receipt with before/after; reading receipts back
  shows the verbatim change.
- ✓ NEGATIVE: an edit adding an unknown class to `allowedClasses` is
  rejected. ✓ NEGATIVE: an edit while `stopAllLatch.isEngaged()` is declined
  - receipted, policy unchanged.

### D3 — Per-project budget envelope counters

**File:** extend `projectPolicyStore.ts` (or a sibling
`projectBudgetStore.ts`) — keep it co-located and receipted.

**Behavior:** per-project spend counters against `budgetEnvelope`
(`perDispatch` cap on a single action, `perDay` rolling daily cap on the
local calendar day, same day-rollover idiom as
`dispatchStore.sweepHeldRollover`). On each auto-approved read-lane action,
increment the project's day counter. **Envelope exhausted → the project
falls back to GATED** (read-lane auto-approval stops; actions decline as
proposal/gated), the state is board-visible, and the transition is
receipted. Ceilings-only (Q34): no itemized spend UI, just the ceiling +
current count + the gated/open state.

**Must NOT change:** does not touch the fleet `budgetStore`; a per-project
envelope is an ADDITIONAL constraint, never a relaxation of the fleet gate.

**Pass/fail:**

- ✓ Unit: an action whose cost exceeds `perDispatch` is gated (not
  auto-approved), receipted.
- ✓ NEGATIVE (re-gate): after `perDay` is reached, the NEXT read-lane action
  for that project auto-approves NO more — it re-gates; a receipt records the
  exhaustion. A local-day rollover restores the envelope (receipted).

### D4 — Policy evaluation in the guard chain (the rung itself)

**File:** new `evaluatePolicy(projectKey, actionClass, cost)` (in
`projectPolicyStore.ts`), CONSUMED inside the existing autonomy guard chain
(`selfHeal.runAction`, and the audit-proposed path from D6).

**Decision function** returns `'allow' | 'gate' | 'deny'`:

- `deny` — no policy for the project (deny-by-default).
- `allow` (read-lane auto-approve) ONLY when ALL hold: policy exists **and**
  `readLaneAutoApprove === true` **and** `isReadOnlyActionClass(actionClass)`
  **and** `actionClass ∈ policy.allowedClasses` **and** the D3 envelope has
  room for `cost`.
- `gate` — everything else (known class, has policy, but not read-only /
  not opted-in / envelope exhausted): behaves exactly as today
  (proposal-only decline / stays human-gated), receipted.

**Guard-chain ORDER (STOP-ALL and fleet budget win over policy):**
`cooldown → STOP-ALL latch → fleet budget-pause → evaluatePolicy → per-class
flag → execute/decline`. STOP-ALL engaged short-circuits to suppress BEFORE
`evaluatePolicy` is ever consulted. This ordering is the containment
guarantee; write it as a test.

**Must NOT change:** the four `SELF_HEAL_CLASSES` semantics for projects
WITHOUT a policy (they behave exactly as V6 shipped); protected files.

**Pass/fail (all NEGATIVE cases are mandatory):**

- ✓ `evaluatePolicy` allows a read-only class for an opted-in project with
  envelope room.
- ✓ NEGATIVE (no policy): a project with no policy → `deny`; action never
  executes.
- ✓ NEGATIVE (non-read class): a write-ish / non-read-only class → never
  `allow`, even for an opted-in project (returns `gate`).
- ✓ NEGATIVE (STOP-ALL wins): with `stopAllLatch.isEngaged()`, even a fully
  opted-in read-only action with envelope room is SUPPRESSED — `runAction`
  short-circuits before `evaluatePolicy`; a suppressed receipt cites
  `stop-all-latch`.
- ✓ NEGATIVE (exhausted re-gates): a read-only action for a project whose
  D3 envelope is spent returns `gate`, receipted.

### D5 — HTTP + board surface for policies (tailnet tier, receipted edits)

**Files:** routes in `server/src/httpServer.ts`; board render in
`webview-v3/` (co-located with the existing ops/self-heal surface).

**Behavior:** `GET /api/ops/policies` (read: policies + per-project envelope
state + gated/open flag) and a gated+receipted edit route (`POST
/api/ops/policies/:projectKey` or similar). SAME unauthenticated
**tailnet-only webview tier** as `/api/ops/self-heal` and
`/api/automation/stop-all` (Bearer stays reserved for runner/hook ingress —
see selfHeal.ts trust-tier header). The board shows, per project: policy
on/off, read-lane state, envelope ceiling + current count, and the
gated/open indicator. STOP-ALL state is visible and its precedence obvious.

**Must NOT change:** no new bearer scope/trust tier; edit route can only
mutate policy (never trigger an action directly — mirror selfHeal's "routes
can never trigger an action" property).

**Pass/fail:**

- ✓ Server test: GET returns policies + envelope state; edit route writes a
  receipt and the change round-trips.
- ✓ NEGATIVE: the edit route cannot enqueue/execute any dispatch (no action
  entry point on the HTTP surface).
- ✓ Colorblind: board shows gated/open with SHAPE+WORD (`⊘ gated` /
  `✓ open`), never color alone. `webview-v3` lint (no-inline-colors etc.)
  green.

### D6 — Self-ops scheduled estate audit (V10-2)

**File:** `server/src/estateAudit.ts` (new); interval wiring in
`httpServer.ts` (mirror the `runSelfHealTick` `setInterval` idiom), GATED
behind a deploy-time flag Greg flips (default OFF — see Greg gates).

**Behavior:** `runEstateAuditTick(deps)` walks honest estate-health signals:

- Runner freshness — `dispatchStore.getAllMachineAdvertisements()`
  `lastSeenAt` age (same source rung-1 `detectDeadRunners` reads).
- Clone/mirror freshness — routine-inbox newest mtime (`inboxProvider`),
  same source as `detectStaleClone`.
- Backups fresh / disk headroom / cert-serve / container restarts — build an
  honest detector ONLY where a real signal exists; otherwise emit ⊘ NO DATA
  (see the ⚠ reconcile item). NEVER fabricate green or red.

Findings file as **HONEST-RED crises** into the existing
`opsAdvisor`/`narrativeFindingStore` surface (`GET /api/ops/review`), with
severity + receipts citing the raw signal. An ALL-GREEN audit appends ONE
receipt line and pushes NOTHING (Q49: the estate is not allowed to be
quietly sick, but it is also not allowed to nag when healthy).

**PROPOSAL-ONLY beyond rung scope:** the audit MAY propose a rung-1
self-heal action where one honestly applies (routed through D4 →
`selfHeal.runAction`, so STOP-ALL / budget / policy / read-lane all still
gate it). The audit itself gains **ZERO execution classes** — it can name a
verb for an existing plane (opsAdvisor's hard rule), never execute one
directly.

**Must NOT change:** no new server mutation capability in the audit path;
no protected files; the audit never writes to the vault or any project.

**Pass/fail:**

- ✓ Unit: a stale runner / stale clone produces an honest-red finding with a
  receipt citing the real age.
- ✓ Unit: all-signals-healthy → one receipt line, zero findings pushed.
- ✓ NEGATIVE (audit cannot execute): the audit module exposes no path that
  calls `dispatchStore.enqueue` directly — every proposed action goes
  through `selfHeal.runAction` and is subject to its full guard chain
  (assert the audit's proposals are declined when STOP-ALL is engaged).
- ✓ NEGATIVE (no fabrication): a check with no signal source yields ⊘ NO
  DATA, never a green or red finding (assert on the ⊘ path for at least one
  unsourced check).

### D7 — Supervisor lane for ROUTINE blocks (V10-3, **GATE-DECIDED**)

**This deliverable is CONDITIONAL.** It enters the build ONLY if its
containment design gate passes a codex adversarial pass (same bar as C3's
wrapper gate). The gate question: can a supervisor agent unblock a
ROUTINE-plane block (a routine waiting on a trivially-answerable prompt)
WITHIN the blocked project's policy envelope, without ever escalating
capability or auto-arbitrating a conflict?

**If the gate PASSES:** build the supervisor lane. It may only unblock
routine blocks that fall inside the blocked project's D2/D3 policy envelope
(deny-by-default, read-lane discipline, receipted, STOP-ALL wins). Conflicts
stay HUMAN-arbitrated crisis cards (Q19) — the supervisor never resolves a
conflict, only unblocks a trivial routine prompt. Acceptance mirrors D4's
negative battery plus: ✓ NEGATIVE a conflict is NEVER auto-resolved (renders
as a crisis card); ✓ NEGATIVE an unblock outside the project's envelope is
denied.

**If the gate FAILS (NOT-YET path — the honest default):** V10 ships D0–D6
only. Write the NOT-YET verdict into `.planning/v8/V10-BUILD-PLAN.md`'s
ledger / a `V10-SUPERVISOR-NOTYET.md` note: WHY it failed containment, and
that it is re-drafted for v11's multi-model era (a supervisor with a paired
reviewer is a stronger, safer shape — HORIZON Act II v11). Do NOT
half-build it.

**Codex: run the adversarial containment pass on the D7 design FIRST and
report the verdict.** Do not start D7 code before the verdict is recorded.
The default expectation is NOT-YET unless containment is airtight.

### D8 — Gate + mandatory codex adversarial containment review + docs

Full repo gate (below) + a NON-OPTIONAL codex adversarial containment
review of the finished lane before any merge (see GATES). Update `CLAUDE.md`
(new stores, the read-lane registry, the estate-audit tick, the policy
routes) and produce the final-message report (format below).

---

## HARD CONSTRAINTS (violating any is a plan violation)

- ⊘ **Protected files zero-diff:** `bin/dispatch-runner.mjs`,
  `bin/lib/dispatch-rules.mjs`. `git diff --stat` must show ZERO lines in
  either. (Same bar as C3 mechanism (d).)
- ⊘ **Closed registries only.** Every new capability/classification is a
  `readonly` `as const` array + `.includes()` runtime guard (the
  `SELF_HEAL_CLASSES` pattern). NO `eval`, NO dynamic/runtime registration,
  NO classification from prompt or dispatch text.
- ⊘ **Deny by default, forever** (HORIZON invariant 2). Every new capability
  starts OFF: no policy = no autonomy; unknown class = not read-only;
  estate-audit flag default OFF.
- ⊘ **Receipts BEFORE side effects** (the D0 lesson, applied everywhere).
  Any new action that touches an existing plane writes a durable intent
  receipt before the side effect and updates the outcome after.
- ⊘ **No new server execution/mutation capability.** Every action runs
  through an EXISTING plane (self-heal → dispatchStore); the audit only
  proposes. No new host-level power (selfHeal.ts header discipline).
- ⊘ **STOP-ALL wins over every policy, instantly** — checked before
  `evaluatePolicy` in the guard chain (D4).
- ⊘ **Temp-HOME test isolation.** Any test touching `~` uses the
  `vi.mock('os')` temp-HOME idiom (`budgetStore.test.ts` pattern). NEVER
  write the real `~/.pixel-agents` or `~/.claude` from a test (see CLAUDE.md
  Codex Delegation §3).
- ⊘ **AsyncAPI discipline.** Add wire messages ONLY if genuinely needed;
  if so, edit `core/asyncapi.yaml` → `npm run asyncapi:generate` → the CI
  drift check must be green (`git diff --exit-code core/src/messages.ts`).
  Prefer server-side-only state + tailnet REST (like self-heal) over new WS
  messages.
- ⊘ **Constants centralized** — all timings/caps in `server/src/constants.ts`
  (never inline). Webview magic numbers in `webview-v3/src/constants.ts`.
- ⊘ **`.js` extensions** on all relative server imports; `import type` for
  type-only; **no `enum`** (use `as const`); strict unused-locals.
- ⊘ **Colorblind-safe** — every new board signal is SHAPE + WORD +
  symbol (`✓`/`✗`/`⚠`/`⊘`); color is never the sole carrier.
- ⊘ **Honest ⊘** over fabricated data — a check with no signal renders
  ⊘ NO DATA, never a guessed green/red.

---

## GATES (all must pass, in the sandbox from CLAUDE.md's Codex Delegation §)

Run under the documented codex sandbox flags
(`network_access=true`, main `.git` in `writable_roots`). Any
socket/`ps`-related failure that looks sandbox-induced is re-verified
UNSANDBOXED by the reviewing agent, not papered over.

1. `npm run check-types` (includes `webview-v3` tsc).
2. `npm run lint` (server, core, `webview-ui`, `webview-v3`).
3. `npm run test:server`.
4. `npm run test:webview-v3`.
5. `npm run test:poller`.
6. `npm run asyncapi:generate` → zero drift (`git diff --exit-code
core/src/messages.ts`). Only relevant if D-work touched the contract.
7. `git diff --stat bin/dispatch-runner.mjs bin/lib/dispatch-rules.mjs`
   shows ZERO changes.
8. **MANDATORY codex adversarial containment review** of the finished lane
   before merge (non-optional, mirrors C3 T7). The reviewer probes, at
   minimum: no-policy project denied; STOP-ALL beats an opted-in read-only
   action; non-read class never auto-approved; exhausted envelope re-gates;
   audit cannot execute directly; receipts precede every side effect;
   protected files untouched; no prompt-text classification. Reconcile every
   MAJOR/MINOR before ship. A SHIP verdict is required to merge.

---

## Greg gates (human decisions — codex HALTs/defers, never self-authorizes)

- **Policy schema sign-off** before ANY project opts in. Codex builds the
  store + evaluation, but the schema (fields, envelope semantics) is Greg's
  to approve before a real policy is written. Ship with ZERO live policies.
- **First project to receive a policy is Greg's pick.** Codex seeds NO
  project. The store ships empty; Greg names the first opt-in.
- **Supervisor lane (D7) go/no-go is Greg's** — AFTER the containment gate.
  Codex runs the adversarial pass and reports the verdict; Greg decides.
  Default is NOT-YET.
- **Arming the self-ops audit schedule is a deploy-time flag Greg flips.**
  Ships default OFF. Codex wires the flag; Greg turns it on.
- Deploys stay Greg-gated (this plan carries NO deploy authorization).
  Production DB migrations: per-migration approval, always.

---

## Commit discipline

- Explicit-path staging + a staged-count guard. **NEVER `git add -A`.**
- Em-dash commit subjects; one deliverable per commit where practical.
- Trailer: `Co-Authored-By: Codex (gpt-5.6-sol) <noreply@openai.com>`.
- Pushes are owned by the REVIEWING agent, never codex (worktree `.git`
  write access is for commits only — CLAUDE.md Codex Delegation §2).

---

## FINAL MESSAGE (what codex returns)

- **Per deliverable D0–D8:** built ✓ / partial ⚠ / skipped ⊘ (with reason).
  D7 explicitly states the containment-gate verdict (PASS→built /
  FAIL→NOT-YET note written).
- **Test deltas:** before/after counts for `test:server` and
  `test:webview-v3`; every gate's pass/fail.
- **Dedupe / guard rules chosen:** the read-lane registry members; the
  guard-chain insertion point for `evaluatePolicy`; the D0 receipt-first
  mechanism.
- **Honest gaps:** which V10-2 audit checks are ⊘ NO DATA (no signal
  source); any precondition that forced a HALT; anything deferred.
- **Reconciliation:** each ⚠ item above — resolved as expected, or the gap
  found.
