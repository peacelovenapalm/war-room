# Session Handoff — War Room v4 Phase 2B (2026-07-11, afternoon)

Contract: `.planning/v4/KICKOFF-v4.md` · Ledger: `.planning/v4/STATE-v4.md`
(status `BLOCKED-AWAITING-GREG`) · Design: `.planning/v4/REMOTE-ANSWER-DESIGN.md`

## 1. Verified current state (live commands, not recalled)

- **Branch `war-room/v3` HEAD = `ee4c68e`; local = origin (pushed, in sync).**
- **Working tree clean** (only untracked `.planning/v2/LOOP-LOCK`, the run lock).
- **Deployed NEXUS = `9e08b22`** (`ssh nexus-ts curl /api/version`) — the
  sprint is **NOT deployed**; deploy is Greg's runbook one-liner.
- **Full gate GREEN on the deployable HEAD** (orchestrator re-derived, not
  trusted from lanes): drift CLEAN · types clean · lint clean · server
  **898/898** · webview-ui **293/293** · webview-v3 **330/330** · poller
  **185/185** · e2e:v3 **21/21** · build OK.

## 2. Accomplished this session

- **T2 runner substrate** (`2b461a2`) — `bin/lib/managed-sessions.mjs` +
  runner: managed-session launch + answer delivery. `sessions:true`
  deny-by-default, tmux ≥3.2 argv-exec gate, manifest+alive answerability,
  one-shot nonces, literal `send-keys`, verbatim audit. Fable-authored.
- **T2/T4 server plane** (`e7cb2c2`) — `action:'session'`, managed-session
  advertisement + TTL, answer queue/nonce/drain on the dispatch poll,
  first-outcome-wins replay guard, verbatim receipts, `agentManagedUpdate`
  broadcast + `existingAgents.managed` replay.
- **T4/T2 board UI** (`7856f84` + `5d0097c`, Sonnet lane, orchestrator-verified)
  — ANSWER verb (managed-only) + composer + one-tap options + verbatim
  confirm + DELIVERING…→✓/✗ + receipts; CALL modal PERSISTENT SESSION mode
  (sessions-capability-gated picker, `action:'session'`, no timeout field).
- **T8 Mini compute** (`d655220`, merged via `b0fdf25`) — `shell` provider:
  opaque scriptId + plain-token args, machine-local `compute.scripts`
  registry resolves interpreter/path (server never knows it), deny-by-default,
  `nice`/`cpulimit` argv-wrapping, registry `timeoutSec` → existing T5 cap.
- **codex gpt-5.6-sol cross-model review** — 0 critical / 0 major / 3 minor.
  1 fixed pre-ship (`dd08f15`: server-side per-arg pattern mirror), 2
  deferred → `.planning/v2/TUNING.md`. Orchestrator adversarial self-review
  independently confirmed the containment story end-to-end.

## 3. In progress

Nothing mid-edit — Phase 2B is code-complete and merged. All lanes closed.

## 4. Deferred / gated

- **DEPLOY + all acceptance** — gated on Greg (below). Nothing is live.
- **T6 aesthetics + T7 integrations** (Phase-4 riders) — NOT started; roll
  forward to a future session per contract (capacity-cut, not dropped).
- **T8 Mini onboarding** — code is merged but the Mini isn't set up: needs
  `brew install python@3.12` (+ `cpulimit` only if a script uses it) and a
  hand-edited `compute.scripts` entry in the Mini's `~/.war-room/dispatch.json`.
- **TUNING deferred items** (`.planning/v2/TUNING.md`, Phase 2B section):
  unbounded `consumedNonces`/`answerRequests` growth (resource hygiene);
  pre-existing pid-reuse in `(machine,pid)` addressing (not T2-introduced);
  `checkTmuxVersion` regex for exotic tmux builds. All non-blocking.

## 5. Decisions made

- **Fable authored every containment seam directly** (runner + server
  answer/session/shell) per the contract; Sonnet took only the board UI;
  codex did the second-opinion review. Rationale: containment boundary =
  orchestrator-owned.
- **T8 built in an isolated worktree/branch, merged post-2B-gate** — kept the
  Mini-compute track off the critical path; clean ort merge, one test fixup.
- **`shell` needs no `providers[]` entry** — the `compute.scripts` registry
  entry IS the capability (wire carries intent, local registry carries
  capability). Sessions are LLM-only; `shell` is dispatch-only.
- **Receipts scoped machine-level, not per-agent** (UI lane deviation,
  accepted) — the answer POST response doesn't echo `managedSessionRef`, so
  per-agent filtering isn't reliable; this is the design doc's own fallback.

## 6. Next steps (Greg — max 3)

1. **Deploy** (startable now):
   `! cd /Users/greg/code/war-room && NEXUS_HOST=nexus-ts bash .planning/runbooks/nexus-war-room-deploy.sh -y`
   then verify `ssh nexus-ts "curl -s http://127.0.0.1:3141/api/version"` == `ee4c68e`.
2. **T1 acceptance** — `bash .planning/runbooks/install-transcript-tailer-launchd.sh MACBOOK`,
   then phone-open a MACBOOK session drawer → live tail + real TOKENS.
3. **T2/T4 acceptance** — add `"sessions": true` to MACBOOK
   `~/.war-room/dispatch.json`, launch a PERSISTENT SESSION from the board
   CALL modal, phone-answer its blocked question → watch it resume in the tail.

## 7. Kickoff prompt (next session, verbatim)

```
Continue the War Room v4 sprint as ORCHESTRATOR per .planning/v4/KICKOFF-v4.md;
ledger = .planning/v4/STATE-v4.md. Verify live state first: git log, git
ls-remote, ssh nexus-ts "curl -s http://127.0.0.1:3141/api/version". Phase 2B
(T2 remote-answer + T4 session launch + T8 Mini compute) is CODE-COMPLETE,
merged on war-room/v3 @ ee4c68e, full gate GREEN, codex-reviewed — deployed
NEXUS was 9e08b22 (undeployed) at handoff; RE-CHECK whether Greg has since
deployed + run the three acceptances (deploy, T1 tailer, T2/T4 phone-answer).
If deployed + accepted: close Phase 2B, then pick up Phase-4 riders T6
(aesthetics) or T7 (integrations) as Greg directs. If NOT yet: the work is
done and pushed — the ball is in Greg's court; prep nothing new until he
deploys or asks. Execution rules unchanged: Fable owns containment seams,
delegate scoped UI to Sonnet + review to codex, every phase ends with the
FULL gate re-derived by the orchestrator, maintain STATE-v4.md + push
continuously, NEVER deploy (Greg-only).
```
