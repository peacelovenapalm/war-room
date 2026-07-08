# War Room v2 — Kickoff Prompt

Paste everything below the line into a NEW Claude Code session (model:
Sonnet, ultracode workflow on) to begin execution.

---

Read these three files in full, in this order, before doing anything else:

1. `/Users/greg/code/war-room/.planning/v2/GAME-DESIGN.md` — the merged,
   contradiction-free design. This has final authority over the 8 section
   drafts under `.planning/v2/sections/*.md`; those files are reference
   detail only now. Pay special attention to §9 ("Conflict resolutions")
   — every design decision that overrides a section draft is recorded
   there with its reasoning; do not re-litigate them, do not "improve" on
   them without flagging it to Greg first.
2. `/Users/greg/code/war-room/.planning/v2/BUILD-PLAN.md` — the milestone
   plan (G0-G6), file-level tasks, pattern references, verification
   commands, acceptance criteria, and kickoff prompts per milestone. This
   is your literal execution script.
3. `/Users/greg/code/war-room/.planning/STATE.md` — tail the last 5-10
   entries for current verified repo state and the logged
   worktree-isolation/same-checkout-collision incidents referenced
   throughout BUILD-PLAN.md's "ultracode workflow shape" sections.

## Current verified state (one-liner)

Repo `/Users/greg/code/war-room`, branch `war-room/v1`, HEAD `50f9ef2`
(2026-07-08): server 329/329, webview 158/158, bin 63/63 (all three
suites re-run green by the Fable review pass, same date), tsc/lint/build
clean. The v1 dispatch vertical is live + E2E-verified on NEXUS,
tailnet-only `:8484`. Chains, standing orders, and employees are NOT yet
built — that is this plan. v2 is entirely new work starting from this
verified-clean baseline.

## Trust order (read before trusting any repo claim)

GAME-DESIGN.md and BUILD-PLAN.md were adversarially re-verified against
the live repo on 2026-07-08 (see the "Fable review deltas" appendix at
the bottom of each — those corrections are binding). The 8 section drafts
under `.planning/v2/sections/` contain KNOWN-FALSE repo claims that the
main docs correct (nonexistent `EFFICIENCY_HEAVY_MAX`, invented renderer
function names, phantom celebrate/break sprite sheets, a nonexistent
timerManager tick primitive, a v7-only Pixi test package, the wrong art
transport). When a section file and a main doc disagree on a repo fact,
the main doc is right; when in doubt, grep the repo — never trust a
section draft's file/constant claim without checking.

## Hard rules (apply to every milestone, unconditional, no exceptions)

1. Never gate real dashboard function behind game progress/state.
2. No dark patterns on real money: efficiency/completion earn, volume
   never does. Grep every milestone's diff for new Cash/Reputation/XP
   award sites — each must cite an OBSERVED real event, never token
   volume, never a bare timer. The one documented exception is the
   capped `flavor_bonus` world event (GAME-DESIGN.md §6.3) — nothing else.
3. Colorblind-safe: shape + text label is the primary signal everywhere,
   color is reinforcement only. Grayscale screenshot required for any
   milestone touching rendering.
4. Tailnet-only. No new external scopes/funnels, ever.
5. Gated actions (deploy, NEXUS docker/tailscale, installs) stay a
   human-run runbook or an explicit, freshly-reconfirmed Greg
   authorization for THIS session — a prior session's "yes" never
   carries over. Ask literally, every milestone, before running
   `nexus-war-room-deploy.sh`.
6. Atomic conventional commits, em-dash subject, explicit-path staging
   (never `git add -A`). One agent per checkout unless a wave/worktree
   partition is explicitly proven safe first (BUILD-PLAN.md specifies
   exactly where this applies — G0/G6 sequential-only, G1-G4
   file-partitioned-sequential, G5 the only worktree-canary-gated one).

## Execution instructions

Execute BUILD-PLAN.md milestone by milestone, **G0 → G1 → G2 → G3 → G4 →
G5 → G6**, strictly linear. For each milestone:

1. Use that milestone's own kickoff prompt (verbatim, printed in
   BUILD-PLAN.md under each `### Kickoff prompt` heading) as your
   operating instructions for that milestone specifically.
2. Follow its "Ultracode workflow shape" exactly (sequential vs
   file-partitioned waves vs worktree-canary-gated) — do not
   parallelize more aggressively than specified, this repo has a
   logged history of collision incidents from over-eager parallelism.
3. Run every verification command listed; do not mark a milestone done
   until its full acceptance-criteria list is observably true (real
   events driven against the dev server where specified, not fixtures
   alone; screenshots captured where specified).
4. Do not start the next milestone until the current one's full gate
   list (check-types + lint + test + build + screenshot pair) is green.
5. At every milestone's deploy gate: STOP and ask Greg explicitly for
   fresh authorization before running any NEXUS runbook. Do not assume
   consent carries over from this kickoff message or any prior session.
6. Report after each milestone: what was built, the verification command
   outputs, the acceptance criteria checked off, any deviation from
   BUILD-PLAN.md and why, and the next milestone's first step.

Start now with G0's kickoff prompt (BUILD-PLAN.md, top of the G0 section).
G0 has no deploy gate and no design-content risk — it's pure engine
infrastructure — so begin immediately without waiting for further
confirmation.

---

## Appendix: Fable review deltas (2026-07-08)

- Added the "Trust order" section: section drafts contain known-false
  repo claims; the two main docs (as amended by their own review
  appendices) are the only binding authority, and greping the repo beats
  both.
- Baseline test counts re-verified live by the review pass (329/158/63),
  not just carried forward from STATE.md.
- Untangled the "dispatch vertical (chains/standing-orders/employees NOT
  YET built...)" parenthetical into plain sentences so a fresh session
  cannot misread what exists vs what this plan builds.
