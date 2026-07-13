# V8 DESIGN — the graph becomes the long-term store (MEMORY rung 2)

Drafted 2026-07-13 (post-deploy-#3 session, NEXUS @ ef25ffc). Act II
opener per `HORIZON-v20.md`. Register-locked scope: Q8 (answer first,
receipts on tap), Q11 (staleness decay ◷ + contradiction flags), Q12
(learn Greg's patterns, adapt gate timing), Q13/Q14 (whole vault minus
the hard denylist). Spine precedence: memory-compounding outranks
everything else in this version.

## Preconditions (hard, in order)

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

## V8-1 Per-project decision ledgers

- Every distilled decision gets project attribution at distill time:
  session cwd → district mapping (the `/api/districts` project registry
  is the existing source of truth; unknown cwd → `unassigned`, rendered
  honestly, never guessed).
- A per-project decisions index (`decisions/<project>.jsonl` beside the
  graph store) — append-only, receipt ids link back to the distilled
  note + session.
- Board surface: district plaque gains a "decisions: N (M stale ◷)"
  line; clicking opens the ledger filtered to that project, answer-first
  rendering (Q8).

## V8-2 Cross-session identity for recurring work

- Stable topic keys: the distiller assigns/reuses a `topicKey` so
  recurring work ("morning push", "codex hooks") is ONE thread across
  sessions, not N disconnected notes. Deterministic slug first;
  LLM-assisted matching only via V8-4's plug point.
- Thread view: given a topicKey, render the decision history in order
  with receipts — this is the "what did we decide about X, and when did
  it change" query the SEARCH prop must answer in one hop.
- New notes that touch an existing topicKey link to prior notes
  (graphify link conventions).

## V8-3 Staleness ◷ + contradiction flags, generalized

- V7 spec'd decay for decisions; V8 makes it uniform across ALL graph
  knowledge the board renders: `◷ N days unconfirmed` after a
  per-class threshold (decisions 30d default; infra facts 7d;
  thresholds in constants, per-class overridable).
- Contradiction detection: same topicKey + conflicting verdict → BOTH
  render flagged, human arbitrates (Q19 crisis-card pattern reused at
  the knowledge level). Wrong knowledge dies by decay/flag — NEVER
  silent deletion (invariant).
- Reconfirmation is one tap on the SEARCH prop ("still true") →
  receipted, resets the clock.

## V8-4 LLM plug point activation (the distiller learns to read)

- V7 shipped a deterministic extractor with an explicit LLM seam. V8
  plugs a model into it: distillation prompts run as normal DISPATCHES
  through the existing dispatch plane (visible on the board, budgeted,
  receipted) — never a hidden side channel. Default model: claude
  sonnet (cheap tier), cross-model spot checks via codex gpt-5.6-terra
  on a sampled fraction (Q45 pattern).
- The code-level denylist filter REMAINS authoritative at writeNote() —
  LLM output is quarantined by the same chokepoint, no new write path.
- Gate: deterministic vs LLM extraction A/B on the same session
  transcripts; LLM path must strictly dominate on decision recall
  before it becomes default. Receipted comparison, kept in the ledger.

## V8-5 Adaptive gate timing (Q12, smallest honest version)

- The board tracks WHEN Greg actually answers gates (hour-of-day
  histogram from receipt timestamps) and schedules non-urgent gate
  pushes into the observed-responsive windows. No content adaptation,
  no priority inference — timing only, fully inspectable, one flag to
  disable.

## Exit question + falsifiable bet

Act II bet instrumented: **every** "what did we decide" trial goes
through the tally (graph-answered vs re-derived). V8 exits when the
graph answer beats re-derivation in ≥N real trials (N≥5) with zero
silent-deletion incidents. If Greg re-derives from scratch even once
because the graph was wrong-and-confident, that is a V8 defect, not a
data problem.

## Honest seams left

- Vault-wide backfill (distilling PRE-V7 history into the graph) is
  explicitly out of scope — rung 2 compounds forward only.
- Pattern-learning beyond gate timing (Q12 full reading) deferred; the
  histogram is the toe in the water.
- Cross-project contradiction (same topic, different projects) renders
  as separate threads in V8 — merging is a V9+ call.
