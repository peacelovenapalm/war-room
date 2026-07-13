# KICKOFF — Act II orchestration (v8/v9/v10 codex builds)

Written 2026-07-13 by the arming session. You are a fresh Fable agent
orchestrating the War Room Act II builds in /Users/greg/code/war-room
(branch war-room/v3). Greg delegated the builds to codex gpt-5.6-sol —
**one fresh sol agent per version, never reused across versions**. You
are the reviewer/committer; codex builds.

## Read first, in order

1. `CLAUDE.md` — architecture + the **"Codex Delegation (sandboxed
   builds)"** section: the exact codex invocation, sandbox flags, and
   the known in-sandbox false failures (sockets, `ps`, homedir tests)
   that must be re-verified unsandboxed.
2. `.planning/v8/V8-BUILD-PLAN.md`, `V9-BUILD-PLAN.md`,
   `V10-BUILD-PLAN.md` — each is a self-contained codex brief with
   HALT-on-unmet preconditions, dependency-ordered deliverables,
   acceptance checks, gates, and Greg gates. The paired `V*-DESIGN.md`
   files are context; **the BUILD-PLANs are authoritative**.
3. `.planning/v6/SPRINT-STATE.md` — ledger conventions. Append your run
   to a NEW `.planning/v8/SPRINT-STATE.md` in the same format (phase
   table, verbatim Greg verdicts, append-only skips/denials).

## Per-version loop

1. **VERIFY preconditions yourself, against live state** — never trust
   docs or this file. Each BUILD-PLAN names its checks. If unmet:
   record HALT + unblock date in the ledger, build only what the plan
   marks buildable regardless (e.g. V10's D0 receipt-ordering fix),
   move on. Expected as of 2026-07-13:
   - V8 unlocks ~7 days after vault-write arming (armed 2026-07-13 →
     ~2026-07-20), needs ≥7 days of real staged notes + tally baseline.
   - V9 after ≥3 clean live morning round trips + 1 proven
     degraded-state push (streak was 0 on 2026-07-13).
   - V10 full build after ≥30 days of rung-1 self-heal receipts
     (~2026-08-12); **D0 is buildable immediately**.
2. **Isolated worktree lane** per version:
   `git -C /Users/greg/code/war-room worktree add
/Users/greg/code/war-room-wt/v8 -b lane/v8` (same shape for
   v9/v10).
3. **Launch a FRESH codex shell** per the CLAUDE.md invocation:
   gpt-5.6-sol, `model_reasoning_effort='"high"'`, stdin brief = the
   BUILD-PLAN file, `-C` the worktree, `--output-last-message` to a
   scratch file, background shell, wait for exit.
4. **REVIEW like the v7/codex-hooks flow**: re-run ALL gates
   unsandboxed (`check-types`, `lint`, `test:server`,
   `test:webview-v3`, `test:poller`, `asyncapi:generate` zero-drift);
   verify protected files zero-diff (`bin/dispatch-runner.mjs`,
   `bin/lib/dispatch-rules.mjs`); spot-check the plan's containment
   claims in the actual code; commit on the lane with explicit paths
   (**never `git add -A`**); push the lane branch.
   **V10 extra**: the plan's mandatory codex adversarial containment
   review must return SHIP before that lane may ever merge.
5. **Do NOT merge to war-room/v3 or deploy** — merges and deploys are
   Greg-gated at version boundaries. End each version with a ledger
   entry: verdict, honest gaps, Greg gates awaiting his go.

## Hard rules

- Never touch `~/.claude`, `~/.codex`, `~/.war-room`, or any real
  homedir at build/test time (temp-HOME `vi.mock('os')` idiom).
- Production deploys / DB migrations only with Greg's explicit
  per-action go. RUN-MAP GATED-list discipline binds.
- Mask all secrets, always. Bark pushes only through existing
  receipted channels.
- Colorblind rule on anything user-facing: shape + word + symbol
  (✓ / ✗ / ⚠ / ⊘), never color alone.

## Finish

Produce a handoff via the `nexus-handoff` skill: per-version verdicts,
lane branches + SHAs, unmet preconditions with unblock dates, and ≤3
next steps for Greg.
