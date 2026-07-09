# DESIGN NOTE — Mechanic #6b: coworker dispatch ("call a coworker")

Status: **DESIGN ONLY** (v1 iteration, 2026-07-07). Nothing here is built.
Per `.planning/GAMIFICATION-BRIEF.md`, 6b touches the parked steering-broker
territory and must be designed deliberately before any code. This note is the
design; building it is a future, explicitly-approved iteration.

## What "dispatch" means

From the dashboard, hand a task to a coworker: pick a provider (Claude /
Codex / Gemini), a machine, a project directory, and a prompt — a real CLI
run starts on that machine and appears in the office as a working agent.

## Threat model (why this is gated)

Dispatch = remote code execution by construction. The dashboard is
tailnet-only, but "anyone on the tailnet can start an agent with arbitrary
prompts in an arbitrary repo" is a real escalation from today's read-mostly
surface. Design accordingly:

1. **No open remote-exec endpoint.** The server NEVER shells out on another
   machine's behalf. Dispatch is a queue: the server stores a signed dispatch
   request; a per-machine **dispatch runner** (opt-in, runbook-installed,
   like the poller/adapter) polls the queue over the same authed channel and
   decides locally whether to run it.
2. **Per-machine allowlist, local to the runner.** The runner's config
   (`~/.war-room/dispatch.json`, installed by a runbook Greg runs) lists
   allowed providers and allowed project roots. A request outside the
   allowlist is refused locally — the server cannot override it.
3. **Deny is a decision, not an error.** Runner refusals report back as
   2xx + `{ decision: "deny", reason }` (the parked steering-broker rule:
   block = 2xx + permissionDecision:"deny", never 403) so the dashboard shows
   "DENIED — path not allowlisted" instead of a transport error.
4. **No privilege on the server.** The queue accepts requests only from the
   dashboard's authed origin; requests carry no shell strings — provider,
   cwd, prompt text only. The runner builds the argv itself
   (`claude -p …`, `codex exec …`, `gemini -p …`) — prompt is data, never
   interpolated into a shell line.
5. **Full audit trail.** Every request/decision/exit lands in an append-only
   log on both ends (server: dispatch log; runner:
   `~/Library/Logs/war-room-dispatch.log`).

## Queue shape (server)

- `POST /api/dispatch` (webview → server, same-origin): `{ provider,
machine, cwd, prompt, requestedBy }` → stored with a UUID, TTL ~10 min.
- `GET /api/dispatch/pending?machine=X` (runner → server, Bearer +
  X-Machine): returns requests for that machine only.
- `POST /api/dispatch/:id/decision` (runner → server, Bearer): `{ decision:
"accept" | "deny", reason?, pid? }`.
- WS broadcast `dispatchUpdate` renders queue state in the office (a
  "phone call" visual at the coworker's desk: RINGING → ANSWERED → DENIED,
  each a distinct silhouette + word).

## UI sketch

- "Call coworker" button on the toolbar (word button) → modal: provider,
  machine (from live machine list), project (from that runner's advertised
  allowlist — the runner publishes its allowed roots when polling), prompt.
- The new agent appears via the existing ingest paths once the CLI starts
  (Claude: hooks; Codex/Gemini: coworker adapter) — dispatch itself renders
  only the call lifecycle, so a dead runner can't fake a running agent.

## Explicitly rejected alternatives

- SSH-from-server (server holds keys to every machine — single point of
  compromise; violates "no open remote-exec").
- Hook-based command channel (hooks are fire-and-forget telemetry; making
  them bidirectional invites the http-hook class of breakage).
- Auto-dispatch on triage rules ("if blocked > 10 min, spawn a fixer") —
  fun later, but violates "never gate real function behind game progress"
  in reverse: game logic must not take real actions unprompted.

## Prerequisites before building

1. Greg answers the brief's open questions (progression storage matters for
   where dispatch history lives).
2. MINI hooks + pollers installed and soaking (dispatch to a machine whose
   telemetry isn't wired renders blind).
3. A runbook for the dispatch runner (install/uninstall + allowlist editing),
   following the ntfy-kill.sh pattern.

## Amendment (KICKOFF v1.1 item 3, 2026-07-09) — worker session kill: the

## FIRST server->runner IMPERATIVE

Everything above this line describes a runner-POLLS-and-DECIDES model: the
server only ever queues a request; the runner alone decides whether to act,
against its own local allowlist. Worker session kill breaks that pattern —
it is the first case where the server tells a runner to act on something
ALREADY RUNNING, not just approve/deny something new. This is explicitly
Greg's spec: "when I click a button on the worker, I should be able to end
their session," reach = any worker with a known pid, not just runner-spawned
dispatches.

**Stop-instruction channel.** `POST /api/dispatch/poll`'s response gained a
second array alongside `pending`: `stop: StopInstruction[]`
(`server/src/dispatchStore.ts`), drained (popped, at-most-once delivery) for
that machine on every poll. Two targeting kinds, NEVER conflated on the
wire or in code:

- `{ kind: 'dispatch', id }` — kill a child THIS runner itself spawned via
  the existing dispatch queue.
- `{ kind: 'pid', id, pid }` — kill an OBSERVED session (any worker with a
  known pid, including one this runner never spawned — e.g. an interactive
  terminal Greg is watching in the office).

**Containment guarantee 1 — dispatch-id kill is registry-only, no
exceptions.** The runner (`bin/dispatch-runner.mjs`) keeps an in-memory
`state.children` Map, keyed by dispatch id, populated in `runDispatch()`
right after a real `spawn()` and cleared unconditionally on that same
child's own `'exit'` event. A `{kind:'dispatch'}` stop instruction is
honored ONLY if its `id` is a live entry in that Map. No match reports a
`'not-found'` outcome (`dispatchStore.ts`'s `reportStatus` treats this as
audit-only — it never invents a state transition for a dispatch the runner
didn't actually touch) — the runner NEVER falls back to a raw
`process.kill(pid)` on an unregistered id. This registry is per-process,
per-machine: a runner only ever knows about dispatches it itself spawned
since it started.

**Containment guarantee 2 — observed-pid kill is verification-gated, no
exceptions.** A `{kind:'pid'}` stop instruction is honored ONLY after the
runner's own `verifyClaudeProcess(pid)` confirms locally (via
`ps -p <pid> -o command=`) that the target is actually a claude process —
a verification failure denies with a reason (2xx + `{decision:'denied',
reason}`, the same "deny is a decision, not an error" posture point 3 of
this doc already established for dispatch/focus). The runner NEVER signals
a raw, unverified pid off the wire, and this check is NEVER skipped even if
the same pid happens to also be present in the dispatch registry — the two
containment mechanisms are deliberately kept independent, with no
cross-shortcut between them (confirmed by a 2026-07-09 adversarial review
panel, 4 independent reviewers, distinct lenses: spoofing/cross-machine
targeting, registry containment, STOP-ALL regression, guardrail
weakening — all four returned PASS).

**Terminal semantics.** A killed dispatch gets a DISTINCT terminal status
(`'killed'`, never conflated with a natural `'exited'`) on both the
dispatch record and, if it belonged to a chain step, on the step itself
(`ChainStepStatus` gained `'killed'`). A killed chain step halts its own
run via a new single-run `chainStore.haltRun(runId, reason, now)` — the
same terminal, never-resumed semantics STOP ALL's `haltAllRunning()`
already uses, scoped to one run instead of every running run; the two
halt paths are independent and don't interact (STOP ALL still halts every
OTHER running run correctly after an individual kill has already
happened).

**Still true, unchanged by this amendment:** the server never shells out
(the runner builds and sends every signal locally); the allowlist governs
NEW work only (dispatch/focus) and is deliberately NOT consulted for kill
at all — kill's containment is these two independent mechanisms instead;
full audit trail on both ends (server: dispatch/pid-kill audit log; runner:
its own append-only audit log, `kill-signal-sent`/`pid-killed`/
`pid-kill-denied`/etc.).
