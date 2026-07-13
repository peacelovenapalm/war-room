# C3-BUILD-PLAN — born-managed wrapper + PROMPT verb

Status: **PLAN, ready for a build agent.** Greg gated the design
2026-07-12 (his §6 answers recorded below, verbatim mapping). Build
execution starts when Greg hands the kickoff prompt (§5) to a session —
that handoff IS the gate-7 "go".

Design source (read it first, it is the contract this plan implements):
`.planning/v5/C3-DESIGN.md`. This plan adds nothing the design didn't
scope; it sequences it.

## 1. Greg's gate decisions (2026-07-12, at his MacBook)

| §6 gate                         | Greg's answer                                                       | Locked meaning for the build                                                                                                                                                                                                                                                                                             |
| ------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1. Wrapper name                 | "wr-claude is fine"                                                 | Command ships as `wr claude` (bin `wr`, subcommand `claude`) per the design's placeholder; a `wr-claude` single-bin alias is acceptable if simpler. Builder picks the mechanically simpler of the two, no bikeshedding.                                                                                                  |
| 2. Opt-in vs opt-out            | "default to opt in"                                                 | Opt-in ONLY. Greg's bare `claude` muscle memory is untouched. NO shell shadowing of `claude`, no opt-out escape hatch built. Revisit opt-out only after daily use, in a future gate.                                                                                                                                     |
| 3. tmux tradeoffs (§3.3)        | "default to recommendation"                                         | Ship with the design's mitigations as BUILD TASKS, not fast-follows: first-run banner naming the scrollback change; verify Ctrl-b collision with Claude Code before shipping (war-room tmux.conf via `-f` if it collides — never touch `~/.tmux.conf`); wrapper re-derives and re-exits with the inner claude exit code. |
| 4. PROMPT wire shape (§4.2)     | "explain the difference" → "go with your recommendation" (same day) | **CLOSED: shared type + `verb: 'answer'\|'prompt'` discriminant** (one queue, guards can't drift). Corollary: T5 must ship runners to all machines before first PROMPT use (stale runner would deliver a prompt but audit it as `answer-delivered`).                                                                     |
| 5. `launchedVia` manifest field | "agree, you can add"                                                | Build it: additive manifest field distinguishing wrapper-born vs CALL-modal-born sessions.                                                                                                                                                                                                                               |
| 6. Launch mechanism (d) vs (c)  | "unsure" → "go with your recommendation" (same day)                 | **CLOSED: (d)** — wrapper as WS dispatch client, zero runner/gate code touched, 2–7 s launch latency accepted. (c) remains the documented fallback ONLY if the build proves the latency unacceptable in daily use, and would need its own gate.                                                                          |
| 7. Build authorization          | "start to build the plan… ready for a new agent to continue/finish" | This document. Code starts when Greg launches a session with §5's kickoff prompt.                                                                                                                                                                                                                                        |

## 2. Non-negotiables carried from the design

- Wrapper is a NEW WS client structurally identical to the browser
  board (`dispatchRequest{action:'session', …}` per
  `server/src/clientMessageHandler.ts:132-171`). Zero changes to
  `bin/dispatch-runner.mjs`, `bin/lib/dispatch-rules.mjs`, or gate/audit
  logic under mechanism (d).
- Fail CLOSED when the server is unreachable: print "war-room server
  unreachable — launch plain `claude` yourself if you want an unmanaged
  session." NEVER silently fall back to an unmanaged launch.
- PROMPT applies every existing guard unchanged: 4000-char cap,
  control-char reject, one-shot nonce, at-most-once drain,
  duplicate-outcome drop, verbatim-confirm in the UI before send.
- PROMPT reaches ONLY manifest-managed sessions. Unmanaged sessions
  stay DESK-only. pty injection stays rejected.
- No new trust tier, bearer scope, or capability flag beyond
  `sessions: true/false`.
- AsyncAPI discipline: any wire change goes through `core/asyncapi.yaml`
  → `npm run asyncapi:generate` → CI drift check.
- Repo doctrine: explicit-path staging + STAGED_COUNT guard; per-phase
  codex cross-model review before merge; secrets masked always.

## 3. Task breakdown (each with its own pass/fail, in order)

**T1 — wrapper skeleton + launch path (mechanism d).**
New `bin/wr.mjs` (or `wr-claude`, see gate 1): parse args, read auth
from `~/.war-room/env` (0600 file from Phase D — NOT plists), open WS,
send `dispatchRequest{action:'session'}` for the local machine with
`cwd` + passthrough claude args, wait for accept/deny broadcast, then
`tmux attach -t war-room-<dispatchId>`.
_Pass:_ running it on MACBOOK produces `tmux ls` showing
`war-room-<id>`, the board shows the session `managed: true` within one
poll tick, and a denied machine (`sessions:false`) gets the runner's
own denial message locally. `git diff --stat` shows zero lines changed
in `dispatch-runner.mjs` / `dispatch-rules.mjs`.

**T2 — UX guarantees (gate 3 tasks).**
(a) Verify whether Claude Code uses Ctrl-b sequences (⊘ NO DATA in the
design — must be checked, not assumed); if collision, ship
`~/.war-room/tmux.conf` loaded via `-f` with a war-room prefix.
(b) Exit-code re-derivation: wrapper exits with the inner claude exit
code (`tmux wait-for` + post-exit marker pattern).
(c) First-run banner naming the scrollback change (tmux `prefix + [`
replaces native scrollback).
_Pass:_ `wr claude -p 'exit nonzero somehow'`-style check shows `$?`
matches the inner code; banner shows exactly once.

**T3 — `launchedVia` manifest field (gate 5).**
Additive field on the manifest entry (`bin/lib/managed-sessions.mjs`),
values `'wrapper' | 'call-modal'`; surfaced read-only wherever the
drawer already shows managed metadata.
_Pass:_ both launch paths write the correct value; old manifests
without the field still parse (additive = no migration).

**T4 — offline/failure hardening for the wrapper.**
Server unreachable → fail-closed message (see §2). Dispatch accepted
but tmux session never appears within a bounded wait → clear error +
pointer to runner logs, non-zero exit.
_Pass:_ kill/mask the server locally and observe the exact fail-closed
message; no unmanaged claude process spawned.

**T5 — PROMPT verb, wire + server + runner.** Gate 4 CLOSED: shared
type — add `verb: 'answer' | 'prompt'` to the existing answer
instruction, one queue, no parallel promptQueue.
`core/asyncapi.yaml` schema change + regen; `dispatchStore.ts`
enqueue/drain path; `bin/lib/managed-sessions.mjs` delivery
(`verb` param or `deliverPrompt` thin wrapper); all ANSWER guards
applied identically. **Ship runners to every machine (MACBOOK + MINI)
before first real PROMPT use** — MINI is a bundle-ship
(`scripts/mini-drift-check.sh` verifies).
_Pass:_ server tests cover mint/consume/replay-deny/duplicate-drop for
PROMPT; drift check green; stale-runner behavior documented.

**T6 — PROMPT UI in the drawer.**
Composer mode toggle (Answer vs Prompt) gated on the same
`managed === true` check (`webview-v3/src/components/AgentDrawer.tsx:187`);
verbatim-confirm before send (MORE important for free-form text — no
question to anchor against). Unmanaged sessions never show the Prompt
entry point.
_Pass:_ e2e or component test proving unmanaged sessions can't reach
the composer in prompt mode; confirm-step shows the exact text.

**T7 — gate + codex + docs.**
Full repo gate (check-types incl. webview-v3, lint, all unit suites,
e2e). Codex cross-model review of the whole C3 diff; reconcile
MAJOR/MINOR before ship. Update CLAUDE.md/handoff with the new command
and the acceptance results against design §5's criteria (all five).
_Pass:_ gate green in one pass, codex verdict SHIP, design §5 criteria
each checked live.

Deploy of the server-side pieces (T5/T6) to NEXUS is Greg-gated as
always — this plan does NOT carry a deploy authorization.

## 4. Explicitly out of scope

Opt-out `claude` shadowing (gate 2), mechanism (c) refactor (unless
Greg flips gate 6), multi-attach resize handling, anything on RUN-MAP
§3's GATED list, WAR_ROOM_TOKEN rotation, districts rendering fixes
(separate ticket — plot-spacing overlap found 2026-07-12).

## 5. Kickoff prompt for the build agent

```
Read .planning/v5/C3-BUILD-PLAN.md and .planning/v5/C3-DESIGN.md in
/Users/greg/code/war-room (branch war-room/v3). Greg has gated the
design; the plan's §1 table is his decision record and ALL gates are
CLOSED (gate 4 = shared verb, gate 6 = mechanism (d)). Execute tasks
T1–T7 in order, each to its stated pass/fail. Mechanism (d) is
locked: zero changes to dispatch-runner.mjs / dispatch-rules.mjs
— treat any diff touching them as a plan violation. Fail closed when
the server is unreachable. Full gate + codex cross-model review at the
end (T7). No NEXUS deploy without Greg's explicit go.
```
