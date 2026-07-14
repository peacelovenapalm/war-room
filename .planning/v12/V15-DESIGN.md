# V15 DESIGN — evidence checkpoint (not a launch)

Drafted 2026-07-13. Act III closer per `HORIZON-v20.md` §Act III: "a
re-run of the SaaS/OSS assessment against Act-III reality. The product
door opens ONLY if a real external operator wants in; otherwise it
stays a personal instrument and that is success, not failure." This
document is deliberately NOT feature work — it is a checklist and a
decision procedure. If v15 gets a BUILD-PLAN at all, that plan should
be "run this rubric," not "ship these deliverables."

## Why this version is shaped differently

Every other Act III version (v12–v14) has a D1..Dn deliverable list
because it's building something. V15 exists to prevent the single
failure mode HORIZON-v20 names explicitly for the product door: opening
it on a schedule instead of on evidence (§the end-state answer: "the
product door opens on EVIDENCE (someone else wants it), never on a
schedule"). A deliverable list for v15 would itself be evidence of
schedule-thinking. The rubric below is the whole deliverable.

## Invariants this version must not violate

Honest data — above all others here. A checkpoint that fudges its own
verdict to justify the act's momentum is the single worst thing this
version could do. Greg is the sole judge of the "unprompted ask" signal
(§Decision procedure) — no automated heuristic gets to declare product-
readiness on his behalf.

## Preconditions (checkable)

1. v12, v13, v14 have shipped and merged (or Act III has otherwise
   concluded with an honest partial state — v15 can run against
   whatever actually got built, not only against a hypothetical
   complete Act III).
2. At least one full "week in Tbilisi" (or equivalent remote-first
   trial, per v12's exit question) has actually occurred and been
   observed, not simulated.

## What to re-run: the SaaS/OSS assessment

HORIZON-v20's product-door register answers (Q36–Q39) set the bar this
checkpoint re-tests:

- **Imagined operator**: a paying solo dev — not an enterprise team, not
  a hobbyist. Re-ask: has anyone matching that profile, unprompted,
  expressed interest?
- **Pitch**: honest-data × one-room. Re-check: does the pitch still
  hold after Act III's scope growth (multi-project, cloud coworkers,
  per-device identity)? Or has "one-room" quietly become "one estate,"
  changing what the pitch even is?
- **Temp art embarrasses**: re-check current asset/art state against
  this bar — still true, or resolved?
- **Hardcodes block sharing for feedback**: this was flagged as having
  NEAR-TERM value independent of v15 — verify whether de-hardcoding
  work actually happened opportunistically across v12–v14, or was
  deferred every time (an honest finding either way, not a grade).

## Evidence collection checklist (gather DURING v12–v14, not retroactively)

Each item below should be a running log kept alongside the Act III
build ledger (`.planning/v12/SPRINT-STATE.md` or equivalent), not
reconstructed from memory at v15 time:

- [ ] **Unprompted external interest** — any instance of someone outside
      Greg's own use asking about, requesting access to, or expressing
      interest in War Room, with the exact context (who, when, what
      they said, unprompted vs Greg-initiated conversation). This is
      the single decision-driving signal (see below) — log it verbatim,
      every time, no matter how small.
- [ ] **Personal-instrument health** — is Greg opening fewer surfaces
      each morning than at Act II's exit (carry V6's exit metric
      forward)? Falling personal-value is itself a finding, independent
      of the product question.
- [ ] **Product-seam decay or health** — do the "both doors stay open"
      seams (auth, no-hardcodes, tenancy) still hold after Act III's
      real feature pressure, or did expediency erode them? (Per-device
      identity from v12 is the sharpest test — did it stay device-scoped
      per V12-DESIGN R1, or did user-scoping creep in under deadline
      pressure?)
- [ ] **Cost reality** — v13 introduced the first real API-cost surface
      (V13-DESIGN R1). What did it actually cost, and does that number
      change the economics of "someone else running this"?
- [ ] **Autonomy ladder position** — how many rungs are live, how boring
      has recovery actually been (Act II's own exit question, re-asked
      with more data)? A product operator inherits whatever rung height
      Greg has proven safe — this bounds what could honestly be offered.
- [ ] **Remote-first proof** — v12's exit question answered with a real
      week, not a simulated one: zero silent degradation, or specific
      named failures.
- [ ] **Estate-span proof** — v14's exit question: one honest cross-
      project answer surface, working.

## Decision procedure (run at the checkpoint, not before)

1. **Check the unprompted-interest log first.** If it is empty, STOP —
   the product door stays closed, and that is success per the register,
   not a partial failure requiring justification. Do not proceed to
   score the other checklist items as if they were the deciding factor;
   they are context for what a future opening would need, not a
   substitute for the interest signal itself.
2. **If the log has ≥1 real entry**, Greg reviews it personally — was
   it genuinely unprompted (not Greg demoing War Room and someone
   politely nodding)? This judgment is explicitly non-automatable and
   explicitly Greg's alone.
3. **If Greg confirms real unprompted interest**, THEN the other
   checklist items become the readiness assessment: seam health, cost
   reality, ladder position, remote-first proof are the "is it actually
   ready to hand to a second operator" gate — score each honestly,
   named gaps and all.
4. **The outcome is always logged**, even "stayed personal, no interest
   yet" — this checkpoint recurs at future act boundaries if the
   estate keeps growing; v15 is not a one-time verdict, it's the first
   run of a repeatable rubric.

## Open risks

- **R1 — Momentum bias.** After three versions of real feature work,
  there will be a pull to justify that work by finding SOME reading of
  the evidence that opens the door. Default resolution: the decision
  procedure's step 1 (empty log = stop, no scoring) is the structural
  defense against this — it is written to be checked mechanically, not
  argued with in the moment.
- **R2 — "Unprompted" is a judgment call with room for self-deception.**
  Default resolution: the verbatim-log requirement (who/when/exact
  words) exists precisely so this judgment is made against a written
  record, not a remembered impression, months later.
- **R3 — Scope drift makes the original pitch stale before the
  checkpoint runs** (per the SaaS/OSS re-check above — "one-room" may
  no longer describe what's been built). Default resolution: if the
  pitch itself needs rewriting, that rewrite happens explicitly and
  visibly at v15, not silently folded into a "yes, still valid" checkbox.

## Exit question

Not "should we launch" — the checkpoint answers: **did anyone,
unprompted, ask to run this?** If no: personal instrument, success,
next act (if any) plans accordingly. If yes: the readiness scorecard
above is the honest starting point for what opening the door would
actually require.
