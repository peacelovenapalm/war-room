# KICKOFF v4 — "The Console" (drafted 2026-07-10, evening)

Decision source: `.planning/v4/DEBRIEF-REGISTER-2026-07-10.md` (D-1…D-48,
captured after real-device acceptance of v3.1). Execution model: PLANNED
sprint per D-45 — no burn-the-week fiat; work is decomposed, delegated
across Fable / Sonnet / codex lanes, and gated. This document is the
binding contract once Greg approves it.

## Objective (one sentence)

Make War Room a competent agent-orchestration console Greg reaches for
daily (D-20/D-24): every session visible live, blocked sessions answerable
from the board, sessions launchable from the board, and a system that
notices its own inefficiency — with the game layer riding along as the
reason it stays pleasant.

## Hard rules (carry over, unchanged)

Colorblind shape+label-first · never gate real function behind progress ·
one-tap-real (every number decomposes to verbatim telemetry; NO DATA over
fake zeros — precedent: 645caf4 TOKENS row) · bounded theater (≤2s, never
delays real state) · tailnet-only, never the funnel · deny-by-default
runners, receipts for every action · one agent per checkout · atomic
em-dash commits, explicit-path staging, STAGED_COUNT guards ·
core/src/messages.ts is generated (never hand-edit) · DPR discipline +
permanent DPR-3 e2e · STOP ALL always visible (and now: nothing else may
hide under the z-60 HUD — regression e2e in panels.spec.ts).

**New standing rule (D-43, SaaS seams):** no new Greg-hardcoded paths,
hostnames, or magic strings in product code — machine-local specifics live
in env/config (war-room.env, dispatch.json, WAR_ROOM_* vars). Existing
hardcodes get swept opportunistically when a track touches their file.
Auth stays single-user but flows through one seam (the bearer-token check)
so a future account layer replaces one module, not fifty call sites.

## Tracks

Ordered by Greg's force-rank (D-46 top-3 first). T1–T3 are the sprint's
definition of done; T4–T8 land as capacity allows and roll forward if cut.

### T1 — LIVE VISIBILITY: per-machine tailer + real usage (top-3 #1)

The single biggest gap ("drawer opens, no tail", D-11/D-13; fake-zero
tokens, fixed cosmetically in 645caf4 but the DATA is still missing).

- Runner-side tailer: the dispatch runner on each Mac tails the transcript
  files of LOCAL interactive sessions (it already knows pids/session dirs
  via the poller's `claude agents --json` view) and streams chunks to the
  NEXUS server over the authed ingest channel (extends the Phase-2
  outputChunk plane; the remote-tailer design doc from v2.0 Phase 2 is the
  starting point — it was designed, never built).
- Usage extraction rides the same tail: the transcript parser's token
  accounting (server/src/transcriptParser.ts) runs runner-side for remote
  sessions, shipping usage deltas with the chunks — TOKENS row goes real
  everywhere, drawer + HUD burn figures light up.
- Security: transcript content crosses the tailnet only, authed with the
  existing bearer token + X-Machine label; per-machine opt-in flag in the
  runner config (a machine can be poller-only).
- Acceptance: open any MACBOOK session's drawer on the phone → live tail
  scrolls, TOKENS shows real numbers. The e2e mock grows a remote-tail
  fixture.

### T2 — REMOTE-ANSWER PLANE (top-3 #2; D-22 FUNDED, supersedes the parked ratification)

A new containment surface — security design is its own gated artifact
BEFORE implementation (register requirement).

- Phase A (design, Fable): `.planning/v4/REMOTE-ANSWER-DESIGN.md` covering:
  mechanism options (tmux-managed sessions the runner owns and can type
  into vs. injecting into an existing pty — the runner can only ever answer
  sessions it supervises; sessions started outside management stay
  DESK-only and the board says so honestly), threat model (who can type
  into what, replay, the one-shot nonce per answer), audit trail (every
  remote answer is a receipt with verbatim text + source), and the
  UI contract (the v3 honest-explainer row upgrades to a real ANSWER verb
  only where the plane exists — never fake).
  **GREG GATE: approve the design before any code.**
- Phase B (implement): runner "managed session" mode — new interactive
  sessions launched via War Room (see T4) run inside a runner-owned tmux;
  the runner exposes answer/keystroke delivery for THOSE sessions only,
  deny-by-default per machine in dispatch.json. Board APPROVE/ANSWER
  becomes real for managed sessions; drawer gains an answer composer with
  the AskUserQuestion options rendered as one-tap choices when the poller
  surfaces them.
- Acceptance: from the phone, answer a real blocked managed session's
  question and watch it resume in the live tail.

### T3 — SELF-HEALING LADDER (top-3 #3; D-15 all three rungs, in order)

- Rung 1 — Ops Advisor: a server-side analyzer over existing telemetry
  (blocked ages, dead sessions, dispatch retry/failure patterns, budget
  burn vs. limits) produces a periodic OPS REVIEW: observed waste +
  concrete suggestions, rendered as a panel and folded into SHIFT.
  Read-only, receipts cite the raw events (one-tap-real).
- Rung 2 — Proposed actions: each advisor finding that maps to an existing
  verb arrives as a one-tap GATED proposal ("agent 4 blocked 42m →
  [DESK] [KILL] [DISPATCH nudge]") through the normal gate machinery —
  system proposes, Greg disposes.
- Rung 3 — Auto with guardrails: a whitelisted subset (restart dead
  poller, requeue a failed dispatch ≤N times) executes automatically,
  every auto-action a ledger receipt with cause + undo where possible.
  Whitelist lives in server config, empty by default.
- The advisor's analysis prompt-pack may itself be an LLM dispatch (cheap
  Sonnet/Haiku run over the telemetry export) — gated like any dispatch.

### T4 — SESSION LAUNCH (hire = skin, D-23)

- CALL modal grows a PERSISTENT SESSION mode: machine + project + provider
  - brief → the runner launches a managed tmux session (the same
    management T2 needs — build once).
- The hire flow is the diegetic skin: new staff sprite walks in when the
  session registers. Identity-from-real-data (D-7): sprite variant derives
  from provider + project.
- Deny-by-default: session launch is a per-machine dispatch.json
  capability, off until Greg enables it.

### T5 — FLEET CONTROLS + BUDGET LADDER (D-21/D-27)

- Per-dispatch token/time caps become first-class (runner kills at cap,
  honest ✗ CAPPED state).
- Daily fleet spend ceiling: crossing it queues new dispatches instead of
  launching (override verb exists, logged).
- Rate-limit awareness: the poller already ships 5h/weekly meters
  (budgetUpdate) — scheduling hints surface in CALL/DISPATCH ("resets in
  2h — queue for then?"). Display stays honest everywhere.

### T6 — AESTHETICS RIDER (D-24: what brings him back)

- Sprite diversity pass (D-2/D-29): Blender pipeline rerun — body/hair/
  skin variety, provider uniforms, role outfits. Kills the balding-men
  monoculture. (Blender lane; codex imagegen for any new 2D.)
- Gesture fix (D-6): pinch/pan tuning on real-device feel, momentum +
  zoom-limit polish; keep the DPR grep-guard.
- Speech bubbles from real events (D-9): short-lived bubbles over desks
  sourced from real telemetry (block reasons, completions), tap → drawer.
  Bounded theater.
- Camera-move panels (D-9): opening a panel flies the camera to its prop
  and the panel grows from it (≤2s, skippable, DOM content unchanged).
- Soundscape v1 (D-30): ambience bed + event chirps + Match Day sting,
  positional desk sounds where cheap. Mute persists.
- Fleet-state mood deepening (D-8).

### T7 — INTEGRATIONS (D-33/D-34/D-35/D-44)

- War Room IS morning: SHIFT absorbs the daily digest + todo top-3
  (already partially wired via briefing mounts); the morning Bark push
  deep-links to /v3/ shift. The NEXUS /morning page retires only after
  Greg confirms parity.
- Vault feeds: project-pulse flags → contract/crisis material; claude/*
  routine PR queue → in-world inbox tray with one-tap open; knowledge
  graph → search prop (query panel against the Phase-9 graph store).
- Districts = projects (D-35): design + first vertical slice — the world
  gains per-project districts whose buildings reflect real milestone
  state (skyline gap from PARITY.md folds in here). Full build-out is v5
  scope; v4 proves the mapping with 2 districts (war-room, TWE).
- WIRING.md + auto-detect (D-44): document every ingest path; server
  auto-discovers .planning/STATE.md and routine-output shapes in
  configured roots with zero per-project config.

### T8 — MINI COMPUTE NODE (D-28; design folded from the Sonnet lane)

See `.planning/v4/MINI-COMPUTE-NODE.md` (companion doc, same commit or
the one following). Summary contract: the Mini joins the fleet as a
NON-LLM compute node — the dispatch runner grows a "compute" kind that
runs allowlisted python/shell jobs (never arbitrary wire commands) with
the same deny-by-default config, queue lifecycle, output streaming, and
receipts as LLM dispatches; War Room shows compute jobs in the DISPATCH
tray like any other run. LLM sessions on the Mini stay out of scope.

## Delegation lanes (amended policy, TUNING 2026-07-10)

- **Fable:** orchestration, T2 Phase-A security design, adversarial
  verification of every track, merges, anything touching the containment
  boundary (runner capability checks, auth seams).
- **Sonnet:** well-scoped implementation stages (T1 tailer plumbing, T3
  rung 1-2, T4 modal, T5, T6 code, T7 wiring), test authoring.
- **codex (gpt-5.6-sol):** cross-model review lane on every track's diff;
  $imagegen for new 2D assets; mechanical chunks behind review.
- One agent per checkout; parallel tracks = separate worktrees
  (war-room-wt pattern), serialized stages within a track.

## Sequencing + gates

1. **Phase 0 — Contract:** Greg approves this doc (+ the remote-answer
   design gets its own later gate). Riders: FOCUS TCC ✓ done 2026-07-10.
2. **Phase 1 — T1 live visibility** (Sonnet build, Fable verify).
   GATE: real tail + real tokens from MACBOOK on the deployed instance.
3. **Phase 2 — T2 design (Fable) → GREG GATE → T2/T4 build** (managed
   sessions are shared substrate). GATE: phone-answer acceptance.
4. **Phase 3 — T3 ladder + T5 controls.** GATE: advisor report cites only
   verbatim events; auto-whitelist ships EMPTY.
5. **Phase 4 — T6/T7/T8 riders** in parallel worktrees as capacity allows.
6. **Phase 5 — full gate + deploy + real-device acceptance** (both
   Safaris + Chrome, per the v3.1 lesson), TUNING review-on-return sweep.

Every phase ends: full test gate (server/webview-ui/webview-v3/poller/e2e)
re-derived by the orchestrator, not trusted from agent reports (v3.1
lesson: the e2e stale-dist incident).

## Explicitly out of v4

TypeScript 7 · vitest 4 · node 24 (deps Batch 3 triggers stand) · full
districts build-out beyond 2 · multi-tenancy/auth accounts (seams only) ·
OSS naming (D-47: at OSS moment) · desk-monitor mini-terminals and status
props (D-9 chose bubbles + camera moves first) · LLM work on the Mini.

## Open Greg gates at v4 start

1. Approve this contract (edits welcome — it's a draft until you say go).
2. T2 Phase-A design approval (mid-sprint gate).
3. Deploys remain per-run Greg-executed (`! …deploy.sh -y` pattern) unless
   you add a Bash permission rule for the exact runbook invocation.
