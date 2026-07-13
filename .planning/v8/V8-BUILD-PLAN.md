# V8 BUILD PLAN — the graph becomes the long-term store (MEMORY rung 2)

Provenance: authored 2026-07-13 off-board for codex (gpt-5.6-sol) as its
primary build brief. Turns `.planning/v8/V8-DESIGN.md` (LOCKED scope
V8-1..V8-5) into an executable, dependency-ordered plan. House format
mirrors `.planning/v5/C3-BUILD-PLAN.md` and
`.planning/v6/RUN-MAP-v5-v7-2026-07-12.md` (phase/gate discipline,
GATED list, ledger conventions). Every claim about existing code below
was verified by reading the file this session; `file:line` cited where
load-bearing. Symbols carry words (colorblind rule): ✓ pass / ✗ fail /
⚠ caution / ⊘ no-data.

This plan builds ON the V7 implementation — it does not rewrite it. The
V7 chokepoint `MemoryStore.writeNote()` and the denylist filter stay
authoritative and untouched in their guarantees.

---

## PRECONDITIONS (hard, in order — HALT if any is unmet)

Copied verbatim from `V8-DESIGN.md` §Preconditions. Codex MUST verify
all three before writing any V8 code and HALT with an honest report if
any is not satisfied — V8 compounds forward on real notes; building
against an empty or dormant store is a defect.

1. **Memory rung 1 ARMED and accumulating.** V7 shipped dormant:
   `WAR_ROOM_VAULT_DIR` unset, all vault mounts ro. Arming is its own
   gated deploy change (writable clone — NOT the 15-min hard-reset
   vault-notifier clone — + env var + redeploy + `claude/*` push-branch
   verify). Backup freshness re-verified SATISFIED 2026-07-13. V8 needs
   real distilled notes to build on; do not start V8 code against an
   empty store.
2. **≥7 days of staged writes reviewed** — enough corpus to validate
   note shape/topic keys before the graph starts trusting them.
   (Independent of the 7-clean-day direct-write promotion; both clocks
   run from arming day.)
3. `/api/memory/tally` baseline recorded (honest zeros are the point).

**Verification commands (codex runs these first):**

- `echo "${WAR_ROOM_VAULT_DIR:-UNSET}"` on the target host — must be a
  real writable path, not `UNSET`. ✗ UNSET → HALT.
- Count staged notes ≥ (arming_date + 7d) worth: inspect
  `${WAR_ROOM_VAULT_DIR}/_inbox/war-room-distill/*.md` and its
  `_ledger.jsonl` — must show ≥7 distinct `session_date` values with
  `action:"written"`. ⊘ empty → HALT.
- `curl -s $BOARD/api/memory/tally` returns a snapshot (baseline
  recorded). Absent → HALT.

Local dev note: precondition checks run against the LIVE armed host, not
a codex sandbox. If codex cannot reach the host, it HALTS and asks the
reviewing agent to confirm preconditions rather than assuming them.

---

## Required reading for codex (in order, before D1)

1. `.planning/v8/V8-DESIGN.md` — the locked scope. Do not add/remove.
2. `.planning/v6/V7-DESIGN.md` — what rung 1 promised.
3. `server/src/memoryStore.ts` — the `writeNote()` chokepoint, the
   decisions index, `searchDecisions()`, staged/direct modes,
   promotion/revocation. **This is the load-bearing file.**
4. `server/src/memoryDistiller.ts` — `SessionDistiller` interface,
   `DistillContext`, `DistilledNote`, `distillEndedSession()`, the
   `input.distiller` seam and `DISTILLER_SYSTEM_INSTRUCTION`.
5. `server/src/memoryDenylist.ts` — `inspectMemoryText()`, authoritative.
6. `server/src/memoryTallyStore.ts` — process-local instrumentation.
7. `server/src/districtsProvider.ts` — `getDistricts()`, the project
   registry V8-1 attributes against.
8. `server/src/agentRuntime.ts:231-242` — `distillAgent()`, the
   session-end trigger.
9. `server/src/httpServer.ts:494-647` — `/api/graph/search`,
   `/api/districts`, `registerMemoryRoutes()`.
10. `server/src/dispatchStore.ts` — the dispatch plane V8-4 activates
    the LLM through; `getAnswerReceipts()` (the V8-5 timestamp source).
11. `server/src/constants.ts:220-228` — the `MEMORY_*` constants.
12. `.planning/v5/HORIZON-v20.md` §Invariants — all seven bind every
    deliverable.
13. `CLAUDE.md` — architecture, constants policy, TypeScript constraints,
    testing tiers, "Codex Delegation (sandboxed builds)" invocation.

---

## ⚠ Reconcile before build (design references vs live code)

Resolve each with the reviewing agent (or pick the documented default)
BEFORE writing the affected deliverable. Do not paper over.

- **⚠ R1 — cwd → district namespace mismatch.** `V8-DESIGN` V8-1 says
  "session cwd → district mapping (`/api/districts` project registry is
  the existing source of truth)". But `districtsProvider.ts` keys
  projects by the immediate SUBDIRECTORY BASENAME under
  `WAR_ROOM_DISTRICTS_DIR` (e.g. `war-room`, `two-wheel-events`), while
  the session carries `AgentState.projectDir` (`server/src/types.ts:108`)
  which is Claude's normalized `~/.claude/projects/<name>` form
  (`normalizeProjectPath()`, non-alnum → `-`). These are DIFFERENT
  namespaces. No absolute session `cwd` is currently threaded to the
  distiller (`agentRuntime.distillAgent` passes only `sessionId`,
  `transcriptPath`, `model`). D1 must (a) thread the real cwd, and
  (b) add an explicit `resolveDistrict(cwd)` in `districtsProvider.ts`.
  Unknown cwd → `unassigned`, rendered honestly (invariant 1), never
  guessed.
- **⚠ R2 — "beside the graph store" location.** V8-1 wants
  `decisions/<project>.jsonl` "beside the graph store"; V8-3/title say
  "the graph becomes the long-term store". Today V7 writes markdown
  notes into the vault (`_inbox/war-room-distill/` staged →
  `Memory/War Room Distill/` direct) and the decisions index is
  `_decisions.jsonl` in the STAGED dir. The `/api/graph/search` graph
  mount is `:ro` (invariant 6). Per-project ledgers MUST NOT introduce a
  new vault write path: place them under the same env-rooted vault dir,
  written only through the `MemoryStore` chokepoint, OR as a derived
  projection recomputed from `_decisions.jsonl` at read time. Default:
  extend the existing `_decisions.jsonl` writer to also carry `project`,
  and expose per-project views by filtering — no second on-disk write
  path unless the reviewing agent approves one. Confirm before D2.
- **⚠ R3 — staleness threshold numbers.** V8-3 text: decisions 30d
  default, infra facts 7d. Live constant `MEMORY_DECISION_STALE_DAYS =
90` (`constants.ts:223`), used in `searchDecisions()`. The generalized
  per-class thresholds are NEW constants; decide whether to (a) keep 90
  for decisions and treat 30/7 as the new per-class defaults the design
  intends, or (b) migrate the decision threshold to 30. Default: honor
  the design (decisions 30d, infra 7d) as NEW named constants and note
  the change from 90 in the ledger. Confirm before D4.
- **⚠ R4 — dispatch→distiller result path.** V8-4 says distillation runs
  "as normal DISPATCHES through the existing dispatch plane". But
  `dispatchStore.ts` is a QUEUE ONLY — "The server NEVER shells out"
  (`dispatchStore.ts:4`); a runner (`bin/dispatch-runner.mjs`) executes
  and reports back. So an LLM-distillation dispatch's OUTPUT must flow
  back into `distillEndedSession()`/`writeNote()`. There is no existing
  seam that feeds a dispatch result into the distiller. D6 must design
  that return path explicitly (runner posts structured extraction to a
  new bearer-authed ingest route → `writeNote()`), and it must not
  touch `bin/dispatch-runner.mjs`/`bin/lib/dispatch-rules.mjs` (see HARD
  CONSTRAINTS). This is the single largest V8 design risk — confirm the
  return-path shape with the reviewing agent before D6 code.

---

## Deliverables (dependency-ordered; each ✓/✗ by one command or observation)

### D1 — Project attribution threaded to the distiller (foundation)

**Create/modify:**

- `server/src/districtsProvider.ts` — add
  `resolveDistrict(cwd: string): string` returning a district `key` or
  `'unassigned'`. Reuses the same registry `getDistricts()` reads;
  match by absolute-path containment under `WAR_ROOM_DISTRICTS_DIR`
  (subdir whose path is a prefix of `cwd`), plus the legacy-seed keys.
  Pure, tolerant, no throw (mirror existing discipline).
- `server/src/memoryDistiller.ts` — add `cwd: string` to
  `DistillEndedSessionInput` and `project: string` to `DistillContext`
  and `DistilledNote`. `distillEndedSession()` calls
  `resolveDistrict(cwd)` and stamps `project` onto the note/context.
- `server/src/agentRuntime.ts:231-242` — `distillAgent()` passes the
  session's real cwd (see ⚠ R1: source the absolute cwd; if only
  `projectDir` is available, document the derivation and its limits).
- `server/src/constants.ts` — `MEMORY_UNASSIGNED_PROJECT = 'unassigned'`.

**Behavior:** every distilled note gains an honest `project` field at
distill time. Unknown/unmappable cwd → `'unassigned'`, never guessed.

**Must NOT change:** `writeNote()` denylist/quarantine semantics; note
shape validation must still pass (extend `noteShapeValid` additively so
old notes without `project` still parse — additive, no migration).

**✓/✗:** new server test `memoryDistillerProject.test.ts` — a note
distilled with a cwd under a known district gets that `key`; a cwd
outside every district gets `'unassigned'`. `npm run test:server` green.

---

### D2 — Per-project decision ledgers (V8-1)

**Create/modify:**

- `server/src/memoryStore.ts` — `appendDecisions()` already writes
  `_decisions.jsonl` (`memoryStore.ts:462-482`); add `project` to
  `DecisionIndexEntry` and every appended row. Add
  `decisionsForProject(project: string)` returning that project's
  entries with receipt ids linking back to note path + session
  (per ⚠ R2: filtered view over the single index by default — no new
  write path).
- `server/src/httpServer.ts` — new read route
  `GET /api/memory/decisions?project=<key>` in `registerMemoryRoutes()`,
  same unauthenticated tailnet-read tier as `/api/memory/status`.
  Answer-first shape (Q8): `{ project, count, staleCount, decisions:
[{ topic, answer, stale, contradiction, receipts:[…] }] }`.

**Behavior:** append-only per-project attribution; receipt ids link
back to the distilled note + session (V8-1 contract).

**Must NOT change:** the `linkSync` no-clobber publish; the deny/quarantine
path; the promotion clean-day accounting.

**✓/✗:** server test — write two notes with decisions attributed to
different projects; `decisionsForProject('war-room')` returns only that
project's rows with intact `receiptId`/`notePath`; `curl
/api/memory/decisions?project=war-room` mirrors it. `test:server` green.

---

### D3 — Cross-session topicKey identity + thread view (V8-2)

**Create/modify:**

- `server/src/memoryDistiller.ts` — assign a stable `topicKey` per
  decision: DETERMINISTIC slug first (extend the existing `topicLink()`
  normalization, `memoryDistiller.ts:120-125`, into a canonical slug).
  LLM-assisted matching is DEFERRED to D6's plug point — D3 ships the
  deterministic key only.
- `server/src/memoryStore.ts` — persist `topicKey` on
  `DecisionIndexEntry`; `searchDecisions()` already groups by
  `normalizeDecision(topic)` (`memoryStore.ts:742-780`) — switch the
  grouping key to the stored `topicKey` so recurring work ("morning
  push", "codex hooks") is ONE thread across sessions. Add
  `threadFor(topicKey)` returning the decision history in chronological
  order with receipts (the "what did we decide about X, and when did it
  change" one-hop query).
- `server/src/httpServer.ts` — `GET /api/memory/thread?key=<topicKey>`
  (same read tier), answer-first with ordered receipts.

**Behavior:** new notes touching an existing `topicKey` link to prior
notes (graphify `[[link]]` conventions already emitted by `renderNote`).

**Must NOT change:** `/api/graph/search` decisions-lane response contract
beyond additively surfacing `topicKey` (keep existing fields).

**✓/✗:** server test — two sessions on different dates both decide
topic "morning push"; `threadFor(<key>)` returns both in date order with
distinct receipts and the latest verdict first. `test:server` green.

---

### D4 — Staleness ◷ + contradiction flags, generalized + reconfirm (V8-3)

**Create/modify:**

- `server/src/constants.ts` — per-class staleness thresholds (see ⚠ R3):
  `MEMORY_STALE_DAYS_BY_CLASS = { decision: 30, infra: 7 }` (or the
  reconciled numbers), plus a per-class override hook. Keep constants
  centralized (Constants Policy).
- `server/src/memoryStore.ts` — generalize the `◷ N days unconfirmed`
  computation across ALL rendered graph knowledge classes, not just
  decisions. Contradiction detection already exists
  (`contradictionMap()`, `searchDecisions().contradiction`) — extend it
  to key on `topicKey` (D3) and ensure BOTH sides render flagged, human
  arbitrates (Q19 pattern). Wrong knowledge dies by decay/flag — NEVER
  silent deletion (invariant 1; the `linkSync` no-clobber already
  enforces no overwrite).
- `server/src/httpServer.ts` — reconfirmation route
  `POST /api/memory/reconfirm { topicKey }` → appends a receipted
  "still true" confirmation that RESETS the staleness clock (new dated
  entry, not an in-place edit). Bearer-authed (it is a write), same tier
  as `/api/memory/direct`'s sibling writes.

**Behavior:** one tap on the SEARCH prop reconfirms; the clock resets via
a new receipt, never by mutating history.

**Must NOT change:** no note is ever overwritten or deleted to "resolve"
a contradiction; both remain, flagged.

**✓/✗:** server test — a decision older than its class threshold renders
`stale:true`; `POST /api/memory/reconfirm` appends a receipt and the next
read shows `stale:false` with the reconfirmation receipt present; a
contradicting verdict leaves BOTH entries flagged. `test:server` green.

---

### D5 — Board surface: plaques, ledger view, thread view (V8-1/V8-2 UI)

**Create/modify:**

- `webview-v3/src/net/districtFacts.ts` — extend the district fact type
  with `decisions: number` and `staleDecisions: number` (fed by D2's
  route).
- `webview-v3/src/engine/districtScene.ts` — district plaque gains a
  `decisions: N (M stale ◷)` line (shape+word, colorblind rule; ◷ is the
  staleness glyph already used in V7 rendering).
- `webview-v3/src/components/DistrictsView.tsx` (+ a new
  `DecisionLedgerPanel.tsx` / `DecisionThreadPanel.tsx` under
  `webview-v3/src/components/`) — clicking a plaque opens the ledger
  filtered to that project (D2 route), ANSWER-FIRST, receipts on tap
  (Q8); a topic row opens the thread view (D3 route) rendering decision
  history in order with the reconfirm ("still true") tap wired to D4.
- Webview constants/colors go in the webview constants/`:root` per the
  Constants Policy and the pixel-UI ESLint rules (no inline colors, hard
  shadows, FS Pixel Sans).

**Behavior:** the SEARCH prop answers "what did we decide about X, and
when did it change" in one hop, answer-first, receipts on tap.

**Must NOT change:** existing districts overlap/hit-testing behavior
(V5R-1 fix) — the plaque gains a line, it does not change plot spacing.

**✓/✗:** `webview-v3` unit test for the fact-to-plaque mapping (N /
M-stale rendered with ◷ and the word "stale"); `npm run test:webview-v3`
green. Manual: a rendered board screenshot shows the plaque line and the
ledger panel opening filtered — attach to the final report.

---

### D6 — LLM plug point activation via the dispatch plane (V8-4) [Greg-gated go-live]

**Create/modify:**

- `server/src/memoryDistiller.ts` — a new `SessionDistiller`
  implementation `DispatchLlmDistiller` that PRODUCES a distillation
  DISPATCH (through `dispatchStore` enqueue) rather than shelling out;
  its result is fed back via the return path in ⚠ R4. Default model:
  claude sonnet (cheap tier). The `input.distiller` seam and
  `DISTILLER_SYSTEM_INSTRUCTION` already exist — reuse them.
- `server/src/httpServer.ts` — a bearer-authed ingest route for the
  runner's structured extraction result → normalizes into a
  `DistilledNote` → `memoryStore.writeNote()` (the SAME chokepoint; the
  denylist quarantines LLM output identically — no new write path).
- `core/asyncapi.yaml` — ONLY if a genuinely new wire message is needed
  to carry a distillation dispatch/result (see HARD CONSTRAINTS for the
  regen+drift step). Prefer reusing the existing `DispatchRequest`/
  `DispatchUpdate` shapes with an existing provider; add a message only
  if the reviewing agent confirms the wire truly needs it.
- Cross-model spot check: a sampled fraction re-distilled via codex
  `gpt-5.6-terra` (Q45 pattern), discrepancies filed to the existing
  narrative-finding/spot-check lane, NOT blocking.
- A/B harness (test-tier, `server/__tests__/` or a `scripts/` runner):
  deterministic vs LLM extraction on the SAME session transcripts,
  scoring decision recall; result kept as a receipted comparison in the
  ledger.

**Behavior:** distillation is a VISIBLE, budgeted, receipted dispatch on
the board — never a hidden side channel. The denylist filter REMAINS
authoritative at `writeNote()`.

**Must NOT change:** `writeNote()` deny/quarantine guarantees;
`bin/dispatch-runner.mjs`, `bin/lib/dispatch-rules.mjs` (zero diff);
the deterministic distiller (it stays as the fallback + A/B baseline).

**Gate (Greg-gated, see Greg gates):** the LLM path becomes DEFAULT only
after the A/B shows it STRICTLY DOMINATES on decision recall AND Greg
gives explicit go. Until then it ships behind a flag, deterministic
stays default.

**✓/✗:** server test — an LLM-shaped extraction fed through the ingest
route lands via `writeNote()` and is quarantined if it trips the
denylist (proving the chokepoint still governs); the A/B harness runs
and emits a receipted recall comparison. `test:server` green +
`asyncapi:generate` zero drift (if the wire changed).

---

### D7 — Adaptive gate timing (V8-5) [Greg-gated flag]

**Create/modify:**

- `server/src/` — a new `gateTimingStore.ts` (process-local, mirroring
  `memoryTallyStore.ts`'s "restart returns to honest zero" posture)
  building an hour-of-day histogram from gate-answer receipt timestamps.
  Source: `dispatchStore.getAnswerReceipts()` (the answer receipts
  surfaced at `GET /api/agents/answers`, `httpServer.ts:1534`) — confirm
  these carry an answered/resolved timestamp; if not, use the receipt
  `ts` already present.
- The morning/gate PUSH scheduler — schedule NON-URGENT gate pushes into
  the observed-responsive windows. TIMING ONLY: no content adaptation,
  no priority inference (design V8-5, explicit).
- `server/src/constants.ts` — a single disable flag / env
  (`WAR_ROOM_ADAPTIVE_GATE_TIMING`), default OFF until Greg's go.
- `GET /api/memory/gate-timing` (read tier) exposing the histogram so it
  is fully inspectable.

**Behavior:** fully inspectable, one flag to disable, timing-only.

**Must NOT change:** urgent pushes are never delayed; the ≤3-5/day push
budget and degraded-state honesty (V6-3) are unaffected.

**✓/✗:** server test — receipts across hours build the expected
histogram; a non-urgent push is scheduled into the top window when the
flag is ON and fires immediately when OFF. `test:server` green.

---

## HARD CONSTRAINTS (violating any is a build failure)

- **⊘ Never touch real homedirs at test time.** Use the `vi.mock('os')`
  temp-HOME idiom (the `budgetStore.test.ts` / 2026-07-13
  `claudeTeamProvider.test.ts` fix pattern). `MemoryStore` already
  refuses an env vault when `VITEST` is set unless an explicit temp root
  is passed (`memoryStore.ts:293-298`) — every V8 test passes an
  explicit temp root, never the real `WAR_ROOM_VAULT_DIR`.
- **Zero diff in `bin/dispatch-runner.mjs` and `bin/lib/dispatch-rules.mjs`.**
  `git diff --stat` must show them untouched (C3 mechanism-(d) doctrine
  carried forward). Any diff there is a violation.
- **Denylist filter stays authoritative at `writeNote()`.** No new vault
  write path. All knowledge — deterministic OR LLM-produced — passes
  through `MemoryStore.writeNote()` and is quarantined identically. LLM
  output gets no privileged channel (V8-4, invariant 6).
- **No silent deletion.** Contradictions and stale knowledge render
  flagged; nothing is overwritten or removed to "resolve" them. The
  `linkSync` no-clobber publish (`memoryStore.ts:601-606`) must remain.
- **AsyncAPI discipline.** Change `core/asyncapi.yaml` ONLY if the wire
  genuinely needs a new message. If changed: run
  `npm run asyncapi:generate`, commit the regenerated
  `core/src/messages.ts`, and ensure `git diff --exit-code
core/src/messages.ts` is clean (CI drift check). Prefer reusing
  existing dispatch messages.
- **Constants centralized.** All new thresholds/flags/dirs in the
  appropriate `constants.ts` (`server/src/constants.ts` for timing/paths,
  `webview-v3` constants + `:root` for UI). No inline magic numbers/
  colors (pixel-UI ESLint rules are error-level).
- **TypeScript constraints.** `.js` extensions on all relative imports
  (Node16); `import type` for type-only imports; no `enum` (use
  `as const`); `noUnusedLocals`/`noUnusedParameters` strict.
- **Honest data.** ⊘ NO DATA / `unassigned` over guessed attribution;
  colorblind shape+word (◷/⚑ + the word) never color alone; the vault
  stays upstream via the audited `writeNote()` path only.

---

## GATES (exact commands — all must pass in one run before commit of a deliverable group)

Run from repo root `/Users/greg/code/war-room`:

```
npm run check-types          # tsc (server + server test tsconfig + webview-v3 -b)
npm run lint                 # eslint adapters/vscode server core + webview-ui + webview-v3
npm run test:server          # server Vitest (the primary V8 suite)
npm run test:webview-v3      # webview-v3 unit (D5)
npm run test:poller          # bin/test poller suite (must stay green — runner untouched)
npm run asyncapi:generate    # ONLY if asyncapi.yaml changed; then:
git diff --exit-code core/src/messages.ts   # must be clean (drift check)
```

Sandbox caveat (from CLAUDE.md "Codex Delegation"): `test:server` binds
127.0.0.1 sockets — run under `-c sandbox_workspace_write.network_access=true`.
Any socket/`ps`-dependent failure inside the sandbox gets RE-VERIFIED
UNSANDBOXED by the reviewing agent before it is treated as real. Worktree
commits need the main `.git` in `writable_roots`; pushes stay owned by
the reviewing agent, never codex.

---

## Greg gates (explicit go required before these go live)

- **D6 LLM-distillation default flip.** The LLM path ships behind a flag
  with deterministic as default. Flipping the default to LLM requires
  (a) the A/B showing LLM STRICTLY DOMINATES on decision recall, receipted
  in the ledger, AND (b) Greg's explicit go. No auto-flip.
- **D7 adaptive gate timing flag.** `WAR_ROOM_ADAPTIVE_GATE_TIMING`
  ships OFF. Turning it ON is Greg's call — until then the histogram is
  built and inspectable but does not reschedule anything.
- **Deploy to NEXUS.** This plan carries NO deploy authorization (same as
  C3-BUILD-PLAN). Deploy is Greg-gated at the version boundary, after
  full gate green + codex cross-model review + live verification + Bark.

---

## Commit discipline

- Explicit-path staging only — `git add <path> …`, NEVER `git add -A`
  / `git add .`. Watch the STAGED_COUNT before commit.
- One deliverable (or a tight sub-slice) per commit; em-dash conventional
  subjects, e.g. `feat(memory): per-project decision ledgers — V8-2`.
- Trailer on every commit:
  `Co-Authored-By: Codex (gpt-5.6-sol) <noreply@openai.com>`
- Do NOT commit `.planning/` churn alongside code unless asked.
- Pushes are owned by the reviewing agent, not codex (sandbox git
  metadata caveat).

---

## Ledger conventions

Track this run in `.planning/v8/SPRINT-STATE.md` (create from the house
template on first touch; update on EVERY deliverable transition so a
restart/compaction resumes from it). Per deliverable record: status
(built / partial / skipped), the ✓/✗ acceptance observation, test delta,
any ⚠ reconcile resolution taken, and the receipt for Greg-gated items.

---

## FINAL MESSAGE format (what codex returns)

- **Per deliverable D1..D7:** `built` / `partial` / `skipped` + the one
  ✓/✗ acceptance observation that proves it.
- **Test deltas:** server / webview-v3 / poller pass counts before→after;
  asyncapi drift clean or N/A.
- **Reconcile outcomes:** how R1..R4 were resolved (what was chosen).
- **Greg-gated items:** D6 default flip and D7 flag state — left OFF,
  with the A/B result if D6 ran.
- **Honest gaps:** anything partial/skipped, any sandbox failure
  re-verification still pending, any assumption not verifiable from the
  sandbox. No completion theater — an artifact is not an outcome.
