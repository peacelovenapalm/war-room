# V13 DESIGN — cloud coworkers

Drafted 2026-07-13. Act III, second version per `HORIZON-v20.md` §Act
III: "hosted sessions/routines render as desks beside launchd runners
(HARVEST posture); the routine fleet's runs go live instead of arriving
as files." Depends on v12's per-device identity work for a clean trust
boundary between local and cloud execution.

## Invariants this version must not violate

Capability is local (this version is the sharpest test of that rule
yet — cloud execution must NOT get more capability than the wire
explicitly grants); honest data (a cloud coworker's state is real or
marked ⊘, never inferred); Greg gates the irreversible (spawning a
cloud-hosted run that costs real money or touches real systems is
exactly the class of action HORIZON-v20 says needs a receipt + undo
path); colorblind-safe on the new "cloud" vs "local" distinction (shape

- word, e.g. a distinct desk glyph, not just a color tint).

## Current state (evidence, verify live before build)

- **launchd runners are the current execution model.** Real,
  file-based: `install-poller-launchd.sh`,
  `install-dispatch-runner-launchd.sh`,
  `install-transcript-tailer-launchd.sh`,
  `install-coworker-adapter-launchd.sh` (under `.planning/runbooks/`)
  install persistent macOS background daemons that POLL the
  Bearer-authed server (dispatch poll/status/decision endpoints) rather
  than the server pushing to them. This is a pull architecture, local
  machine initiates every round trip.
- **The `machine` field is the existing seam this version extends.**
  `server/src/types.ts:45` documents it as "Machine identity label
  (e.g. \"MACBOOK\", \"MINI\"). Set for remote agents ingested..." — a
  plain string already threaded through `dispatchStore.ts`,
  `remoteTailDemand.ts`, `dossierDerivation.ts` (defaults to `'LOCAL'`
  at line 354), `chainOrchestrator.ts`, `selfHeal.ts`, and
  `morningSurface.ts`. The deploy script sets `WAR_ROOM_MACHINE=NEXUS`
  for the server's own identity
  (`.planning/runbooks/nexus-war-room-deploy.sh:163`). **A "cloud"
  machine value is not a new mechanism — it's a new value in a field
  that already exists and is already rendered.**
- **Multi-client concurrency is proven, not theoretical.** The beta run
  had two independent testers hitting the same live board
  simultaneously; cross-client STOP-ALL sync worked correctly (verified
  in code: `StopAllControl` renders purely from WS-reduced state,
  `App.tsx:322-323,774`, zero coupling to unrelated UI toggles) but was
  under-signaled — a concurrent legitimate engage read as "corruption"
  to the other tester (`BETA-SYNTHESIS-2026-07-13.md` reconciliation
  #1). Fixed in `lane/beta-fixes` (persistent engaged banner + WS-poll
  clearing, deploy #5). **This is the exact failure mode cloud
  coworkers will re-trigger at higher frequency** (more concurrent
  actors) unless v13 explicitly re-tests the signaling under a cloud
  coworker's own action cadence, not just two human testers.
- **Hosted-session architecture precedent**: the hooks-only external
  session model (real MacBook sessions register via hooks with no
  local server transcript access — this is literally the V8-blocking
  bug: `fileWatcher.ts:878` sets `jsonlFile: ''` for these,
  `agentRuntime.ts:237-241` passes it through, `memoryDistiller.ts`
  fails closed) is the seam a cloud coworker extends one step further:
  a session whose transcript NEVER lives on the server's filesystem at
  all, cloud-native from the start, must solve the same problem
  `lane/distill-client` is solving for MacBook sessions (client-side
  distill, POST the note) — v13 should reuse whatever `lane/distill-client`
  lands on, not invent a second transcript-shipping mechanism.

## Preconditions (checkable, HALT if unmet)

1. v12 D1/D2 (per-device identity + revocation) shipped and merged —
   cloud coworkers need a distinct, revocable trust tier from day one;
   retrofitting identity onto already-running cloud execution is the
   wrong order.
2. `lane/distill-client` (or its successor) merged and the V8 distill
   pipeline demonstrably working end-to-end for at least one real
   remote/external session — verify live via `/api/memory/tally`
   showing non-zero real notes, not the honest-zero baseline recorded
   2026-07-13.
3. A concrete, named hosting target exists (verify: does Greg have an
   account/environment picked — e.g. a specific cloud VM, a specific
   agent-hosting API — before D1 below is designed in code; this
   doc intentionally does not pick one).

## D1 — Trust tier definition (write this down before any code)

- Explicit statement, reviewed by Greg before v13 code starts, of what
  a cloud-hosted session CANNOT do that a local (MacBook/NEXUS/Mini)
  session can — e.g., no filesystem access outside its own workspace,
  no ability to reach the vault write path, dispatch scope allowlisted
  tighter than local by default. This is the KICKOFF-ACT3.md Greg-gate
  for this version, made concrete.
- The existing "deny by default" invariant (`HORIZON-v20.md`
  §Invariants #2) applies with an extra notch: cloud starts MORE
  restricted than local, not equally trusted with a different label.

## D2 — Cloud coworker as a desk, not a special case

- A hosted session/routine run renders as a desk on the board exactly
  like a local agent — same character FSM, same tool-animation
  vocabulary — with the `machine` field (D1's extension point) carrying
  a cloud identity instead of MACBOOK/NEXUS/MINI. No new UI vocabulary;
  reuse `machine` badge rendering wherever it already exists.
- Visually distinct trust tier (HORIZON-v20 Q25: "cloud runs get a
  visibly different trust tier") — shape+word marker on the desk
  (e.g. a badge reading "CLOUD"), never color-only, consistent with the
  colorblind invariant.

## D3 — Routine fleet runs go live

- Today, per the HORIZON-v20 sketch, routine fleet runs "arrive as
  files" (results land, get read later). v13 makes a cloud-hosted
  routine's run visible WHILE it runs — live tool-use events over the
  same hook/dispatch pipe local agents use, not a post-hoc file import.
- This reuses the existing hub-and-spoke event flow
  (`AgentEvent` → `AgentRuntime` → `AgentStateStore` → broadcast,
  per CLAUDE.md §Communication Flow) — a cloud coworker is a new
  `HookProvider`-shaped source feeding the same pipe, not a parallel
  system.

## D4 — Concurrency signaling audit (re-run beta's lesson at scale)

- Before shipping D2/D3, re-test the STOP-ALL / multi-actor signaling
  fixed in `lane/beta-fixes` under a scenario with 3+ concurrent
  actors (a human plus 2 cloud coworkers), not just the 2-human beta
  scenario. If ANY action's only signal is a control flipping state
  (the beta M3 pattern), it needs a persistent banner before v13 ships,
  not after a second misdiagnosis.

## Open risks

- **R1 — Cloud coworkers become a cost surface with no visible ceiling**
  (HORIZON-v20's economy section is explicitly dormant/decoration until
  real API costs exist — v13 is exactly where real API costs start
  existing). Default resolution: v13 must surface real spend per cloud
  run on the board (not itemized to the penny, but not invisible
  either) — this is the moment the register's "force the choice later"
  economy stance gets its first real forcing function; flag it to Greg
  explicitly rather than silently building metering.
- **R2 — A cloud coworker's crash or runaway loop has no local kill
  switch parity** (STOP-ALL today assumes local process control).
  Default resolution: STOP-ALL must extend to cloud coworkers before D2
  ships — a desk that can't be stopped the same way local desks can is
  a capability-is-local violation in spirit even if not in wire format.
- **R3 — Transcript-shipping mechanism forked** if v13 is built before
  `lane/distill-client` lands and invents its own approach. Default
  resolution: precondition 2 is a hard HALT, not a soft one.

## Exit question

Does a cloud coworker's desk look, sound, and stop exactly like a local
one from Greg's seat — except for the trust-tier badge and a visible
cost line? If distinguishing cloud from local requires reading logs
instead of looking at the board, v13 isn't done.

## Honest seams left

- Multi-cloud-provider abstraction — v13 targets ONE hosting mechanism
  first (per precondition 3); a provider-agnostic layer is a v14+ call
  if it's ever needed at all.
- Cost-based auto-throttling — v13 surfaces spend; it does not act on
  it. Any auto-throttle is a v10-style autonomy rung, evaluated on its
  own evidence, not bundled in here.
