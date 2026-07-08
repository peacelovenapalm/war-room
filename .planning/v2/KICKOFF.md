# War Room v2 — Kickoff Prompt (REV 2, 2026-07-08)

Rev 2 supersedes the paste-per-milestone model: this is now a **single
`/goal` ultracode dynamic run** that executes G0→G6 to completion. Paste
everything below the line into a NEW Claude Code session in
`/Users/greg/code/war-room` with ultracode on, as the argument to
`/goal`.

---

Read these three files in full, in this order, before doing anything else:

1. `/Users/greg/code/war-room/.planning/v2/GAME-DESIGN.md` (REV 2) — the
   merged, contradiction-free design, revised against Greg's 32-question
   interrogation (2026-07-08). Pay special attention to §9 ("Conflict
   resolutions") and the **"Greg interrogation deltas" appendix** — every
   recorded decision is locked; do not re-litigate, do not "improve" on
   them without flagging it in TUNING.md and (if load-bearing) a Bark
   push.
2. `/Users/greg/code/war-room/.planning/v2/BUILD-PLAN.md` (REV 2) — the
   milestone plan (G0-G6), file-level tasks, pattern references,
   verification commands, acceptance criteria, batched deploy gates, and
   kickoff prompts per milestone. This is your literal execution script.
3. `/Users/greg/code/war-room/.planning/STATE.md` — tail the last 5-10
   entries for current verified repo state and the logged
   worktree-isolation/same-checkout-collision incidents referenced
   throughout BUILD-PLAN.md's "ultracode workflow shape" sections.

## Current verified state (one-liner)

Repo `/Users/greg/code/war-room`, branch `war-room/v1`, baseline
`50f9ef2` (2026-07-08): server 329/329, webview 158/158, bin 63/63 (all
three suites re-run green by the Fable review pass, same date),
tsc/lint/build clean. The v1 dispatch vertical is live + E2E-verified on
NEXUS, tailnet-only `:8484`. Chains, standing orders, and employees are
NOT yet built — that is this plan. v2 is entirely new work starting from
this verified-clean baseline. (Commits after `50f9ef2` on this branch are
docs-only planning revisions.)

## Trust order (read before trusting any repo claim)

GAME-DESIGN.md and BUILD-PLAN.md (both REV 2) are the only binding
authorities. The 8 section drafts are ARCHIVED at
`.planning/v2/archive/sections/` — they contain KNOWN-FALSE repo claims
(nonexistent `EFFICIENCY_HEAVY_MAX`, invented renderer function names,
phantom celebrate/break sprite sheets, a nonexistent timerManager tick
primitive, a v7-only Pixi test package, the wrong art transport). The
ONLY archived draft still used as reference is
`archive/sections/07-art-pipeline.md`, and only for its asset
tables/prompt templates, as amended by GAME-DESIGN §8.3. When in doubt,
grep the repo — the repo beats both documents.

## Execution model (rev 2 — how this run operates)

- **One continuous run to completion.** Execute G0 → G1 → G2 → G3 → G4 →
  G5 → G6 strictly linearly. Milestone boundaries are internal gates
  (full gate list green: check-types + lint + test + build + screenshot
  pair), NOT stopping points. Do not stop to ask "proceed to next
  milestone?" — proceed.
- **Sonnet-5-class agents by default** for milestone execution; follow
  each milestone's "Ultracode workflow shape" exactly (sequential vs
  file-partitioned waves vs the single worktree-canary-gated track in
  G5) — this repo has a logged history of collision incidents from
  over-eager parallelism.
- **Self-pace around Greg's real rate limits.** Monitor the 5h/weekly
  windows; pause the run near caps and resume on reset; never compete
  with Greg's own active sessions. Long waits (rate-limit resets, Codex
  art windows) are normal — schedule wakeups rather than burning idle
  context.
- **Delegation allowed:** mechanical, well-specified tasks may go to
  Codex/GPT-5.5. Never delegate award-site logic, budget-guardrail code,
  or anything touching the deny-by-default dispatch boundary.
- **Feel-bad rule: note-and-continue.** Design-feel problems (pacing,
  chore-smell) go to `.planning/v2/TUNING.md` with a `REVIEW-ON-RETURN`
  tag. Never stall the line for a tuning question.
- **On completion:** run the three suites + build one final time, send a
  Bark push ("War Room v2 build complete — 3 deploys live, TUNING.md has
  N review items"), write the final handoff (nexus-handoff conventions),
  and — if usage headroom allows — run a Fable medium review pass over
  the full v2 diff, logging findings to TUNING.md.

## Deploy pre-authorization (rev 2 — read carefully, scope is exact)

Greg pre-authorizes, in writing, for THIS run only: running
`.planning/runbooks/nexus-war-room-deploy.sh` at the THREE batched deploy
gates — after G2, after G4, after G6 — without a fresh per-deploy ask.

This pre-authorization covers ONLY that runbook at those three gates. It
does NOT cover: any other SSH/docker/tailscale action on NEXUS, any tool
install (`rembg`, `sharp`, pip/npm system packages), any edit to
Greg-owned files outside this repo (`~/.claude/statusline.js`,
`~/.claude/settings.json`), or any NEXUS backup-config change. Those stay
gated: when Greg is unreachable, write the exact ready-to-run instruction
into TUNING.md as a `REVIEW-ON-RETURN` item and continue without it. A
future session must not treat this paragraph as standing consent.

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
5. Gated actions: see the deploy pre-authorization scope above —
   everything outside it requires a fresh explicit Greg authorization or
   becomes a REVIEW-ON-RETURN item.
6. Atomic conventional commits, em-dash subject, explicit-path staging
   (never `git add -A`). One agent per checkout unless a wave/worktree
   partition is explicitly proven safe first (BUILD-PLAN.md specifies
   exactly where this applies — G0/G6 sequential-only, G1-G4
   file-partitioned-sequential, G5 the only worktree-canary-gated one).
7. Unattended-run safety net (never weaken, stop-the-line if violated):
   standing-order first-fire confirm is unconditional (no Autopilot perk
   — it is CUT), the budget store fail-safe-pauses without a fresh
   snapshot, and STOP ALL (GAME-DESIGN §7.5) ships in G3 and reaches the
   phone in G6.

## Execution instructions

Execute BUILD-PLAN.md milestone by milestone, **G0 → G1 → G2 → G3 → G4 →
G5 → G6**, strictly linear. For each milestone:

1. Use that milestone's own kickoff prompt (verbatim, printed in
   BUILD-PLAN.md under each `### Kickoff prompt` heading) as your
   operating instructions for that milestone specifically.
2. Follow its "Ultracode workflow shape" exactly — do not parallelize
   more aggressively than specified.
3. Run every verification command listed; do not mark a milestone done
   until its full acceptance-criteria list is observably true (real
   events driven against the dev server where specified, not fixtures
   alone; screenshots captured where specified).
4. Do not start the next milestone until the current one's full gate
   list is green.
5. At the three batched deploy gates (end of G2, G4, G6): run the
   runbook under the pre-authorization above, verify the deployed
   instance per that milestone's deploy-cadence notes, and log the
   listed REVIEW-ON-RETURN items to TUNING.md.
6. Append a STATE.md entry after each milestone: what was built, the
   verification command outputs, the acceptance criteria checked off,
   any deviation from BUILD-PLAN.md and why, and the next milestone's
   first step.

Start now with G0's kickoff prompt (BUILD-PLAN.md, top of the G0
section). G0 has no deploy gate and no design-content risk — it's pure
engine infrastructure — so begin immediately.

---

## Appendix: rev-2 deltas (2026-07-08 interrogation)

- Execution model rewritten: paste-per-milestone → single /goal
  run-to-completion, self-paced, Codex/GPT-5.5 delegation allowed,
  Bark on completion, Fable review at the end.
- Deploys batched 7 → 3 (after G2/G4/G6) and pre-authorized in writing
  above; all other gated actions become REVIEW-ON-RETURN items.
- Design deltas locked (full list: GAME-DESIGN.md "Greg interrogation
  deltas" appendix): needs CUT (mood-only), Autopilot perk CUT, STOP ALL
  added, vacation mode, 1-day Rep-decay grace, contextual HEAVY mood
  hit, template personalities + digest LLM seam, Bark pushes, retire
  ceremony/Hall of Fame, prestige seams, iPhone G6 target, Pixi
  "better is welcome", test bar = definition-of-done coverage.
- Section drafts archived to `.planning/v2/archive/sections/`;
  world-event table inlined into GAME-DESIGN §6.3; only 07's asset
  tables remain referenced, at the archived path.
- Statusline snapshot source flagged OPEN (Greg: "unsure") — default is
  the decoupled hook (GAME-DESIGN §7.4 Option B); never edit
  statusline.js without an explicit pick.

## Appendix: Fable review deltas (2026-07-08, rev 1 — still binding)

- Trust order: section drafts contain known-false repo claims; the two
  main docs (as amended by their review appendices) are the binding
  authority, and greping the repo beats both.
- Baseline test counts re-verified live by the review pass (329/158/63),
  not just carried forward from STATE.md.
- The dispatch vertical exists and is live; chains/standing-orders/
  employees do NOT exist yet — this plan builds them.
