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
