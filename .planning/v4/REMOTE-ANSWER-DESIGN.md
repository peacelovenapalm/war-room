# REMOTE-ANSWER-DESIGN — T2 Phase A security design (v4, 2026-07-11)

Status: **DESIGN — AWAITING GREG APPROVAL (KICKOFF-v4 mid-sprint gate).**
No T2/T4 code exists or may be written until this document is approved.
Decision source: D-21/D-22 (register) — remote-answer plane FUNDED with the
console framing; this is a NEW CONTAINMENT SURFACE and gets its design
gated before implementation. Companion substrate: T4 session launch (the
same managed-session mechanism, built once).

## Objective (one sentence)

From the board (phone or desk), answer or steer a blocked interactive
session — but ONLY sessions the runner itself supervises, with every
keystroke authenticated, one-shot, audited, and rendered honestly where
the capability doesn't exist.

## The founding constraint

**The runner can only ever answer sessions it supervises.** A session
started outside War Room management (Greg typing `claude` in a terminal)
has a pty owned by that terminal; there is no legitimate way to type into
it from another process. Options considered:

1. **Runner-owned tmux sessions (CHOSEN).** New interactive sessions
   launched via War Room (T4 CALL → PERSISTENT SESSION) run inside a tmux
   session the runner creates and therefore owns. `tmux send-keys -l`
   delivers text into exactly that session — no other pty is reachable by
   construction. Managed sessions are otherwise completely normal
   interactive Claude sessions: hooks fire, transcripts write, the T1
   tailer streams them, the poller sees them.
2. **Injecting into an existing pty (REJECTED).** TIOCSTI-style fake
   input is disabled/hardened on modern macOS; attaching a debugger or
   reparenting (reptyr-class tricks) to a session the runner never
   started is exactly the "server reaches into another machine" class
   DISPATCH-6B's founding rule exists to prevent — and it breaks the
   trust story: a compromised server could then type into ANY terminal.
   Never built, at any privilege level.
3. **Answer-via-CLI-restart (REJECTED).** `claude --resume <id>` with an
   injected message abandons the live pty (double-driver risk, terminal
   left wedged) and is indistinguishable from hijacking the session out
   from under the human at the keyboard.

Consequence, stated honestly in the UI: **pre-existing/unmanaged sessions
stay DESK-only forever** — the board says so (the v3 honest-explainer row
stays for them). The ANSWER verb exists only where the plane is real.

## Managed-session model (T4's substrate, specified here)

- Launch: the runner (dispatch-runner, extended — D-26: extend, don't
  duplicate) honors a new `action: 'session'` request by creating
  `tmux new-session -d -s war-room-<dispatchId>` running the provider CLI
  in the validated cwd. Everything rides the EXISTING dispatch pipeline:
  queue → allowlist validation (providers/roots) → accept/deny decision →
  receipts. Session launch is a NEW per-machine capability flag in
  dispatch.json (`"sessions": true`), **absent = deny** (deny-by-default,
  same as focus).
- Registry: the runner records each managed session in
  `~/.war-room/managed-sessions.json` (machine-local manifest:
  dispatchId, tmux session name, cwd, provider, createdAt) written
  atomically on create and pruned on observed death. Answerable =
  **in the manifest AND currently alive in tmux** (`tmux has-session`)
  — both checks at answer time, never cached. A runner restart re-derives
  liveness from tmux itself; sessions survive runner restarts (tmux is
  the supervisor, the runner is the gatekeeper).
- Advertisement: each dispatch poll tick the runner advertises its live
  managed-session list (ids + the sessionIds Claude assigned, once
  known via cwd/transcript correlation). The server marks matching agents
  `managed: true` — the UI's only license to render ANSWER.

## Answer delivery

- Wire (server → runner): `answer: AnswerInstruction[]` drained
  at-most-once on the existing dispatch poll response — the SAME drained
  imperative channel stop[] uses; at-most-once loss is acceptable because
  an undelivered answer simply stays answerable (the human retries from a
  board that still shows BLOCKED — no state lies).
  `AnswerInstruction = { id, managedSessionRef, text, nonce }`.
- Delivery: `tmux send-keys -t <session> -l -- <text>` then a separate
  `send-keys Enter`. Literal mode only; the text is never interpolated
  into a shell string (argv-array exec, spawn shell:false — the dispatch
  spawn discipline). Rejected before sending: control characters (except
  none — Enter is delivered separately, never embedded), text over a cap
  (constant), missing/dead session (2xx deny `session-not-managed` /
  `session-dead`).
- One-shot nonce: the server mints a nonce per answer request; the runner
  keeps a consumed-nonce set (in-memory + audit log line) and denies
  replays (`nonce-replayed`). The server ALSO marks the request answered
  on the first outcome report — a duplicate arriving later is dropped
  server-side. Belt and braces on both ends of the wire.
- Outcome: the runner reports delivered/denied per instruction id (same
  status-POST shape as dispatch decisions). The board renders ✗ FAILED
  honestly on deny — never optimistic.

## Threat model

| Threat                        | Answer                                                                                                                                                                                                                                                               |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Who can type into what?       | Board clients (Bearer-authed, tailnet-only) → server queue → runner → ONLY manifest+alive tmux sessions on machines with `sessions:true`. No path reaches an unmanaged pty, by construction not by policy.                                                           |
| Compromised server            | Can queue answers to managed sessions only; the runner's capability flag + manifest check are machine-local and the server cannot override them (allowlist precedent). Blast radius = text typed into sessions Greg launched via the board, every keystroke audited. |
| Replay                        | One-shot nonce (runner) + answered-state (server). At-most-once drain means duplicates are already rare; both ends still check.                                                                                                                                      |
| Injection through answer text | Literal send-keys, argv-array spawn, control-char reject, length cap. The text lands as keyboard input to Claude, not as shell input — the worst case is a bad ANSWER to the agent's question, which is Greg's prerogative anyway.                                   |
| Cross-machine confusion       | managedSessionRef is scoped by the machine label on the poll (a machine only ever receives its own queue — dispatch precedent).                                                                                                                                      |
| Audit                         | Every answer: runner audit-log line {ts, sessionRef, VERBATIM text, nonce, outcome} + server-side ledger receipt shown in the drawer (one-tap-real: the receipt IS the raw event).                                                                                   |

## UI contract

- ANSWER verb renders ONLY for `managed: true` agents; everything else
  keeps the v3 honest explainer ("DESK-only — not launched via War Room").
- Drawer answer composer: when the poller's waitingFor carries an
  AskUserQuestion option list, options render as one-tap choices; always a
  free-text field; ALWAYS a confirm step showing the exact text that will
  be typed (the verbatim-prompt discipline from CALL).
- After send: the drawer's live tail (T1 plane) shows the session resume —
  the acceptance path (phone-answer a real blocked managed session).
- No fake states: pending answer = "DELIVERING…", runner deny = ✗ with
  the runner's reason as data.

## Explicitly out of scope

Answering unmanaged sessions (permanent, by construction) · multi-user
attribution (single-user auth seam per D-43 — the receipt records the
one bearer identity) · cross-machine tmux attach · answer templates/
macros (post-v4) · any LLM auto-answering (that is T3 rung 2's gated
proposal machinery, never this plane).

## Build order after approval (T2 Phase B + T4, shared substrate)

1. Runner: managed-session launch (`action:'session'`, capability flag,
   manifest, advertisement) + tests.
2. Runner: answer delivery (nonce set, send-keys discipline, outcomes) +
   tests.
3. Server: answer queue + drain on dispatch poll + managed flag on
   agents + receipts + tests.
4. Board: ANSWER verb + composer + confirm + receipts render + e2e.
5. Acceptance: phone-answer a real blocked managed session on the
   deployed instance, watch it resume in the live tail.
