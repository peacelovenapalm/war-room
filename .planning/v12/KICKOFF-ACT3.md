# KICKOFF — Act III orchestration (v12/v13/v14/v15)

Drafted 2026-07-13 by the docs agent, in the format of
`.planning/v8/KICKOFF-ACT2.md`. This is a CONTRACT for whoever
orchestrates Act III builds — not a build itself. No code has been
written for v12–v15 as of this writing.

## Read first, in order

1. `CLAUDE.md` — architecture + the "Codex Delegation (sandboxed
   builds)" section (exact codex invocation, sandbox flags, known
   in-sandbox false failures that must be re-verified unsandboxed).
2. `.planning/v5/HORIZON-v20.md` — Act III's sketch (§Act III, v12–v15)
   and the Act II exit question that gates this act.
3. `.planning/v12/V12-DESIGN.md`, `V13-DESIGN.md`, `V14-DESIGN.md`,
   `V15-DESIGN.md` — this act's design docs. **BUILD-PLANs do not exist
   yet** — they get written per version, only after that version's
   preconditions clear live (house practice: design docs first, build
   plans when a version is actually about to be built, per
   `.planning/v8/KICKOFF-ACT2.md`'s own precedent).
4. `.planning/v8/SPRINT-STATE.md` — Act II's ledger, especially the
   2026-07-14 entry: the distill pipeline was broken for remote
   sessions (V8 P2 clock never started; root cause `fileWatcher.ts:878`
   → `agentRuntime.ts:237-241` → `memoryDistiller.ts:198-206`, external
   MacBook sessions register with `jsonlFile: ''`). A fix is in flight
   on `lane/distill-client` (worktree present as of 2026-07-13; verify
   live state before trusting this note — lanes get merged or abandoned).

## The gate that binds this entire act

Act III **must not start** until Act II's exit question has a real
answer, per `HORIZON-v20.md` §Act II exit: _"after the first autonomous
mistake, was recovery boring? Did the graph answer beat re-derivation
every time it was tried?"_ That requires, at minimum:

- V10's autonomy rung has FIRED at least once (a receipted self-heal or
  auto-requeue actually happened) and Greg has reviewed the recovery as
  boring or not. As of `.planning/v8/SPRINT-STATE.md` (2026-07-13),
  self-heal receipts were empty — this has not happened yet.
- V8's graph-vs-re-derivation tally (`/api/memory/tally`) has ≥5 real
  trials, per V8-DESIGN's exit bet. As of the same ledger, the tally was
  at honest zeros and the distill pipeline itself was broken.

**HALT semantics**: if you are reading this and either condition is
unmet, do not orchestrate ANY v12–v15 build. Record a HALT with the
live values you checked and an unblock date if one is inferable
(V8/V10 have no fixed unblock — they depend on the distill-client fix
landing and on real autonomous mistakes occurring, not on a calendar).
Design work (reading, drafting, discussing) is fine at any time; code
is gated.

## Per-version loop (once Act II clears)

1. **VERIFY preconditions yourself, against live state** — never trust
   this doc or the DESIGN docs' preconditions sections; both may be
   stale by the time you read them. Each DESIGN doc names its
   preconditions; re-check every one live before writing that version's
   BUILD-PLAN.
2. **Write the BUILD-PLAN first**, in the V8/V9/V10-BUILD-PLAN format
   (HALT-on-unmet preconditions, dependency-ordered deliverables,
   acceptance checks, gates, Greg gates) — do not hand a DESIGN doc
   straight to a builder.
3. **Isolated worktree lane** per version:
   `git -C /Users/greg/code/war-room worktree add
/Users/greg/code/war-room-wt/v12 -b lane/v12` (same shape for
   v13/v14/v15).
4. **One fresh codex builder shell per version**, never reused across
   versions, per the CLAUDE.md invocation (gpt-5.6-sol,
   `model_reasoning_effort='"high"'`, stdin brief = the BUILD-PLAN,
   `-C` the worktree, `--output-last-message` to a scratch file).
5. **REVIEW like the v7/v10 flow**: re-run ALL gates unsandboxed
   (`check-types`, `lint`, `test:server`, `test:webview-v3`,
   `test:poller`, `asyncapi:generate` zero-drift); verify protected
   files zero-diff (`bin/dispatch-runner.mjs`, `bin/lib/dispatch-rules.mjs`);
   spot-check the plan's security/containment claims in the actual code
   (this act adds per-device identity and revocation — those claims get
   the same adversarial scrutiny V10's containment review got); commit
   on the lane with explicit paths (never `git add -A`); push the lane
   branch.
6. **Do NOT merge to war-room/v3 or deploy** — merges and deploys stay
   Greg-gated at version boundaries, same as Act II. End each version
   with a ledger entry: verdict, honest gaps, Greg gates awaiting his go.

## Standing gate list (carried from Act II, unchanged)

- Never touch `~/.claude`, `~/.codex`, `~/.war-room`, or any real
  homedir at build/test time (temp-HOME `vi.mock('os')` idiom).
- Production deploys / DB migrations only with Greg's explicit
  per-action go.
- Mask all secrets, always. Bark pushes only through existing
  receipted channels.
- Colorblind rule on anything user-facing: shape + word + symbol
  (✓ / ✗ / ⚠ / ⊘ / ◷), never color alone.
- Honest data invariant: ⊘ NO DATA beats a pretty lie, at every scale.
- The vault stays upstream/read-only except the one Greg-gated write
  path already armed (`WAR_ROOM_VAULT_DIR`, staged mode).

## Act III-specific gates (new this act)

- **Per-device identity + revocation (v12)** is a security-boundary
  change to a system whose current boundary is tailnet-only
  (`tailscale serve`, no public funnel) plus a single shared Bearer
  token (`WAR_ROOM_TOKEN`, `server/src/httpServer.ts:2416-2426`). Any
  change here gets an adversarial containment review before merge,
  same tier as V10's D0 review — this is explicitly Greg-gated, not a
  routine code review.
- **Cloud-hosted execution (v13)** introduces a new trust tier (cloud
  runs vs the MacBook/NEXUS/Mini local pair, per HORIZON-v20 Q25). The
  BUILD-PLAN must state, in writing, what a cloud-hosted session CANNOT
  do that a local one can, before any code ships.
- **Cross-project memory span (v14)** touches districts outside this
  repo (TWE/AMC/sellout). Any write path into another project's data
  needs that project's own review norms honored, not just war-room's.
- **v15 is evidence collection, not a build.** Do not write a
  V15-BUILD-PLAN in the normal sense — see V15-DESIGN.md's rubric.

## Greg's gates (explicit, this act)

- Merges to war-room/v3 and all deploys — every version boundary.
- Per-device identity/revocation design sign-off before v12 code starts
  (security boundary change).
- Cloud-hosted execution trust-tier definition sign-off before v13 code
  starts (what cloud CANNOT do).
- Any write path touching a district outside war-room (v14) — explicit
  per-district go.
- The v15 evidence checkpoint itself — Greg is the one who judges
  whether an external operator "asked in, unprompted."

## Finish

Produce a handoff via the `nexus-handoff` skill at the end of any
autonomous or multi-phase Act III run: per-version verdicts, lane
branches + SHAs, unmet preconditions with unblock dates (or "no
schedulable date" where true), and ≤3 next steps for Greg.
