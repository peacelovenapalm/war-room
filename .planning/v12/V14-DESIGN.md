# V14 DESIGN — estate under one roof

Drafted 2026-07-13. Act III, third version per `HORIZON-v20.md` §Act
III: "TWE/AMC/sellout/vault as districts with real event feeds; memory

- ambient now span every project Greg owns, not just this repo." This
  is the version where War Room stops being "the war-room project's
  board" and becomes "Greg's board that happens to live in the war-room
  repo."

## Invariants this version must not violate

The vault stays upstream/read-only except the one Greg-gated write path
already armed (`HORIZON-v20.md` §Invariants #6) — v14 must not create a
SECOND informal write path into vault or any other project just because
it's convenient; capability is local (each project's own machine holds
its own allowlist — war-room does not gain blanket write access to
TWE/AMC/sellout by virtue of rendering their districts); honest data
(a district with no real event feed yet renders ⊘, never a placeholder
that looks like data); Greg gates the irreversible (any write path
touching a project outside war-room is its own gate, per
`KICKOFF-ACT3.md`).

## Current state (evidence, verify live before build)

- **Districts are already data-driven, not hardcoded.**
  `server/src/districtsProvider.ts` reads from `WAR_ROOM_DISTRICTS_DIR`
  — every subdirectory under that root is one project
  (`districtsProvider.ts:11-18`), with two legacy env-var overrides for
  WARROOM/TWE state additively layered in (lines 19-29). The route is
  `GET /api/districts` (`server/src/httpServer.ts:573`), currently
  **unauthenticated**, relying solely on tailnet isolation
  (`districtsProvider.ts:35-37`).
- **Count is whatever's mounted, not a fixed number.** On NEXUS,
  `/data/repos/districts` is bind-mounted read-only at
  `/briefing/districts` (`.planning/runbooks/nexus-war-room-deploy.sh:57-69,202,209`),
  refreshed by a cron pulling repo clones. As of the beta run, this
  registry held **7 districts** (`.planning/v8/SPRINT-STATE.md`, deploy
  #4 live-verify: "districts 7"). Beta findings flagged real gaps in
  this feed's honesty today: Diablito's district shows stale "last
  activity" data with no ◷/STALE marker, and a cross-surface
  inconsistency where MORNING/BRIEFING and DISTRICTS disagree about the
  same project's blocker count (`BETA-SYNTHESIS-2026-07-13.md` ○
  minors). **V14 inherits these as known defects to close, not blank
  slate.**
- **The distill pipeline's client-side redesign is the exact pattern
  v14 needs, already being built for a different reason.** V8's distill
  pipeline broke because hooks-only external sessions have no local
  transcript for the server to read
  (`fileWatcher.ts:878` → `agentRuntime.ts:237-241` →
  `memoryDistiller.ts:198-206`, confirmed live 2026-07-14). The fix in
  flight on `lane/distill-client` — each machine distills its OWN
  sessions and ships the resulting note, rather than the server trying
  to reach across machines for raw transcripts — is structurally
  identical to what "memory spans every project" requires: each
  project distills its OWN sessions and ships notes into the shared
  graph, rather than war-room's server reaching into TWE/AMC/sellout's
  filesystems. **V14 should be understood as `lane/distill-client`'s
  pattern applied across project boundaries, not just across machine
  boundaries** — same shape, one axis further out.
- **`launchd` runners are the existing per-machine execution model**
  (poller, dispatch-runner, transcript-tailer, coworker-adapter —
  `.planning/runbooks/install-*-launchd.sh`) — any project that wants
  to feed the estate's memory/ambient needs the equivalent of these
  running locally to it, or a lighter client-side-distill-only variant.

## Preconditions (checkable, HALT if unmet)

1. v8's graph/memory rung 2 is live and trusted for war-room itself —
   verify `/api/memory/tally` shows real graph-beats-re-derivation
   trials (≥5, per V8-DESIGN's own exit bet) BEFORE extending memory to
   other projects; extending a system that isn't proven for its first
   project is compounding an unproven bet.
2. `lane/distill-client` (or successor) merged and live for at least
   one non-war-room project's sessions as a smoke test — verify a real
   note from a different project's session lands in the graph with
   correct project attribution.
3. Each target project (TWE, AMC, sellout) has an explicit, current
   entry under the districts registry directory already — verify by
   listing `WAR_ROOM_DISTRICTS_DIR` live rather than assuming the 7
   counted at deploy #4 are still current or still the right 7.
4. The beta-flagged district honesty defects (stale-marker gap,
   cross-surface Diablito inconsistency) are fixed — verify live against
   the current deployed board — before adding MORE districts on top of
   a feed that's already been caught lying by omission once.

## D1 — Real event feeds per district (close the beta gap first)

- Every district plaque gets an honest staleness marker (◷ + age),
  closing the beta minor where Diablito showed 2-month-old "last
  activity" data with no signal it was stale.
- Cross-surface consistency: MORNING/BRIEFING and DISTRICTS must derive
  district state from the SAME source of truth, not two independently
  drifting computations (root cause of the Diablito "single remaining
  blocker" vs "✓ 100%" vs "no node found" three-way disagreement,
  `BETA-SYNTHESIS-2026-07-13.md`).
- This is deliberately D1, before D2 — no new district gets added to a
  feed mechanism that's already been shown to lie by omission.

## D2 — TWE/AMC/sellout as real districts

- Each project gets a real event feed (not a static plaque) — actual
  session/dispatch/decision activity from that project's own machine,
  shipped via the client-side-distill pattern (D3 below), not scraped
  by war-room reaching across a filesystem boundary it doesn't own.
- District-level allowlist stays per-project: war-room's board can
  DISPLAY another project's events; it does not gain write/dispatch
  capability into that project by displaying it (capability-is-local,
  applied at the district boundary explicitly).

## D3 — Memory spans every project (extend the distill-client pattern)

- Each project's own machine/environment distills its own sessions
  locally and POSTs the resulting note into the shared graph, exactly
  as `lane/distill-client` does for cross-machine war-room sessions —
  same denylist chokepoint at write time (finances, health, named
  people — `HORIZON-v20.md` Q14), same per-project attribution (V8-1's
  `decisions/<project>.jsonl` pattern), same staleness/contradiction
  handling (V8-3), extended to a `project` dimension that isn't always
  `war-room`.
- Cross-project contradiction (same topic, different projects) was
  explicitly deferred at V8 ("merging is a V9+ call" — V8-DESIGN.md
  honest seams). V14 is the version that actually has to answer it: do
  cross-project topic threads merge, or stay separate forever? Default
  resolution in R2 below.

## D4 — Ambient spans every project

- The morning push, degraded-state announcements, and sound grammar
  (V9's work) extend to cover all districts, not just war-room's own
  state — a degradation in TWE should be as audible/visible as a
  degradation in war-room itself, using the SAME vocabulary (no
  second sound grammar per project).

## Open risks

- **R1 — District write-path creep.** The convenience of "the board is
  right here, just let it fix TWE's broken thing too" is exactly how
  an informal second write path gets created. Default resolution:
  districts outside war-room are DISPLAY-ONLY through v14; any write
  capability into another project is its own future version, its own
  gate, never bundled into "estate under one roof."
- **R2 — Cross-project topic merging is genuinely ambiguous** (is "the
  distill pipeline was broken" one thread across war-room and TWE, or
  two?). Default resolution: keep threads project-scoped by default
  (V8's existing behavior); only merge on an EXPLICIT signal (same
  topicKey deliberately reused across a project boundary at distill
  time), never inferred by content similarity — inferred merging is a
  staleness/contradiction-flag risk multiplier the register never
  signed off on.
- **R3 — Districts registry drift.** The registry is a mounted
  directory refreshed by cron, not a reviewed list — a stale or
  misconfigured mount could silently add or drop districts. Default
  resolution: D1's cross-surface consistency check doubles as a canary;
  any district-count change should be visible on the board, not silent.

## Exit question

Can Greg ask "what's happening across the whole estate" and get one
honest answer from one surface, with per-project staleness/gaps marked
truthfully — and does a real degradation in a non-war-room project page
him exactly like a war-room one would?

## Honest seams left

- Vault-wide backfill across projects (pre-v14 history) — out of scope,
  same stance V8 took for war-room alone: rung compounds forward only.
- A unified cross-project dispatch/autonomy ladder — v10's rungs stay
  per-project; v14 does not merge autonomy policy across projects, only
  visibility and memory.
