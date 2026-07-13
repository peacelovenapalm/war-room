# V10 DESIGN — ladder rung TWO (recalibrated)

Drafted 2026-07-13. ⚠ RECALIBRATION vs `HORIZON-v20.md`: the horizon
doc wrote v10 as "the first ladder rung," but Q18's pre-approval pulled
that rung forward — V6 self-heal SHIPPED it (4 classes: restart dead
runners/daemons, refresh stale clones, mechanical vault fixes, re-run
failed routines; closed registry, guard chain, receipts + undo, live
since 5bfeabc). V10 is therefore the SECOND rung. Ladder doctrine
unchanged: at most ONE new rung per version, receipts + undo mandatory,
climb exactly as far as recovery stays boring, revocable per
action-class, and no rung is ever a prerequisite for the next version's
features.

## Preconditions (hard)

1. **Rung-1 evidence review.** ≥30 days of self-heal receipts examined:
   how many fires, how many correct, how many undos. If rung 1 has
   ZERO real fires by V10 kickoff, that itself is a finding — arm
   nothing new until we know why (nothing broke? too conservative
   scoped? flags off in practice?).
2. **Fix the inherited receipt-after-enqueue crash window** (logged
   follow-up from the V6-4 codex review: receipts persist AFTER
   dispatchStore.enqueue — a crash in between = live dispatch without
   audit trail). No second rung on top of a known audit-trail gap.
3. First autonomous MISTAKE (if one has occurred) gets a written
   post-incident note answering the act's exit question early: was
   recovery boring?

## V10-1 Per-project policies (the rung itself)

- A policy object per district/project — capability-is-local invariant
  applied to autonomy: `{ readLaneAutoApprove: bool, budgetEnvelope:
{ perDispatch, perDay }, allowedClasses: [...] }`. Deny by default;
  a project with no policy has NO autonomy.
- **Read-lane auto-approval**: dispatches whose action class is
  provably read-only (classification lives server-side in a closed
  registry, same pattern as self-heal — never inferred from the prompt
  text) skip the human gate for opted-in projects. Everything else
  gates as today.
- **Budget envelopes**: per-project spend counters; envelope exhausted
  → back to gated, board shows the state, receipted. Ceilings-only
  mindset (Q34) — no itemized spend UI.
- Policy edits are themselves gated + receipted; STOP-ALL overrides
  every policy instantly (existing durable flag).

## V10-2 Self-ops: the estate audits itself

- A scheduled audit routine (server-side, receipted) walks the estate's
  own health: runners fresh? clones fresh? backups fresh (the
  nightly/rsync checks the 2026-07-13 vault audit did by hand become
  code)? disk headroom? cert/serve state? container restarts?
- Findings file as HONEST-RED crises on the board — the estate is not
  allowed to be quietly sick (Q49 generalized from mornings to
  everything). All-green audits append one receipt line, no push.
- PROPOSAL-ONLY beyond rung scope: the audit may PROPOSE a rung-1
  self-heal action where one applies; it never gains new execution
  classes by being an audit.

## V10-3 Supervisor lane for ROUTINE blocks (Q15) — gate-decided

- Design-gate question this version answers (HOW, possibly NOT-YET):
  a supervisor agent may unblock ROUTINE-plane blocks (a routine
  waiting on a trivially-answerable prompt) within the blocked
  project's policy envelope. Conflicts stay human-arbitrated crisis
  cards (Q19).
- Enters the build ONLY if the design gate passes containment review
  (codex adversarial pass mandatory, same bar as C3's wrapper gate).
  If it fails, V10 ships rung + self-ops only, and the lane is
  re-drafted for v11's multi-model era (a supervisor with a reviewer
  is a stronger shape anyway).

## Exit question (the act's, asked for real)

After the first autonomous mistake under V10 policies: **was recovery
boring?** Concretely — undo used, receipt complete, cause identified,
no data lost, under 15 minutes of Greg's attention. If recovery was
exciting even once, the ladder STOPS here until it isn't (and per the
horizon doc, "this high and no higher" is an acceptable permanent
answer at the v18 review).

## Honest seams left

- Auto-failover MacBook→Mini when the MacBook sleeps (Q26) is FLEET
  topology, not an autonomy rung — deliberately parked for the
  post-move version (v12 remote-first hardening is its natural home).
- The one self-stakes contract experiment (Q35) stays dormant with the
  rest of the economy until real costs exist (Q33).
- Cloud-runs trust tier (Q25) — v13's problem; V10 policies apply to
  local machines only.
