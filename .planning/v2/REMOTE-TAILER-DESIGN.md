# DESIGN NOTE — Remote transcript tailer/forwarder (Phase 2 slice 2.6)

Status: **DESIGN ONLY** (KICKOFF-v2.0 Phase 2, 2026-07-10). Nothing here is
built. Per the kickoff, the remote tailer may settle review-on-return with
this document; building it is a future, explicitly-scoped slice.

## The gap (verified against source, 2026-07-10)

The server strips `transcript_path` from any hook event whose `X-Machine`
label differs from the server's own (`server/src/httpServer.ts:341-345`,
inside `registerHookRoute` — the path points at a file on the remote
machine, so watching it locally would fail). Remote sessions therefore
adopt via the hooks-only path: status/permission telemetry works, but the
slice-2.4 local JSONL tap never sees their transcripts. **Remote
interactive sessions have no live output tail** — the real headline gap
for a multi-machine command center.

## Shape: one opt-in tailer per machine

A new per-machine daemon, `bin/transcript-tailer.mjs`, installed by a
runbook (`install-transcript-tailer-launchd.sh`) exactly like the
needs-input poller and the dispatch runner — same env contract
(`WAR_ROOM_URL`, `WAR_ROOM_TOKEN`, `WAR_ROOM_MACHINE`), same LaunchAgent
lifecycle, same "a machine without the daemon simply doesn't stream"
opt-in posture. No tailer, no tail — honestly absent, never faked.

Responsibilities per tick / per active tail:

1. **Tail assigned transcript files** with the slice-2.4 read discipline:
   offset-tracked incremental reads (64KB read cap per poll, 500ms
   cadence), line-buffered across partial reads — the same proven loop
   `server/src/fileWatcher.ts` `readNewLines()` uses locally.
2. **Filter cheaply on the remote side**: forward only lines that parse as
   `type === 'assistant'` records (fast `"type":"assistant"` substring
   pre-check, then a real `JSON.parse` confirm). Tool results, progress
   records, and file-history snapshots — the bulk of a transcript — never
   cross the wire.
3. **Coalesce + POST via the slice-2.5 forwarder**, reused as-is
   (`bin/lib/output-forwarder.mjs`: ~1s OR ~8KB flush, sequential POST
   chain preserving order, dead-server-drops-chunks resilience, final
   flush on tail-off). Only the route differs (below).

## Wire: raw filtered lines up, server-side rendering

The tailer POSTs **raw assistant JSONL lines** (newline-joined, coalesced)
to a new Bearer-authed route:

```
POST /api/agents/output   { machine, sessionId, lines }
```

The server resolves `(machine, sessionId)` to the live agent's numeric id
(the same mapping hook ingestion already maintains), renders each line
with the slice-2.4 renderer (`server/src/transcriptOutputTap.ts`
`renderTranscriptLine()` — ONE rendering implementation, never forked to
the remote side), and appends into the ring as
`{source:'agent', id:String(agentId), stream:'transcript'}`. An
unresolvable session or a removed agent is a 2xx decision
(`{ok:false, reason}`) — the tailer treats it as tail-off for that
session. Ring eviction on `agentRemoved` (slice 2.4) already covers
remote agents; no new lifecycle site is needed.

Same liveness discipline as `/api/dispatch/:id/output`: appends are gated
on a live agent so a straggler POST can never resurrect an evicted ring
entry.

## Steering: tail-on/off rides the poll-response drain pattern

Which sessions to tail is an **imperative**, and it deliberately reuses
the one existing server→machine imperative channel shape: the poll
response's drained-array pattern (`stop: StopInstruction[]`,
DISPATCH-6B-DESIGN amendment #1). The tailer's poll response carries:

```
tail: TailInstruction[]     // drained at-most-once for this machine
TailInstruction = { kind: 'tail-on' | 'tail-off', sessionId, transcriptPath }
```

- Enqueued server-side when a webview client tailSubscribes/unsubscribes
  an agent whose `machine` differs from the server's own (or via an
  explicit drawer toggle — UI decision deferred to Phase 3).
- **At-most-once drain semantics accepted as-is**: a tailer that dies
  mid-tick loses the instruction; the webview's subscribe is retryable
  and the instruction is idempotent (tail-on for an already-tailed
  session is a no-op). Same recovery posture as a lost stop instruction.
- A tailer restart drops all active tails (in-memory state only) — the
  server re-issues tail-on for sessions with live WS subscribers on the
  tailer's next advertisement, making recovery automatic.

## Containment (unchanged, and the one new imperative is read-only)

- **Runner-decides containment is untouched.** The tailer never spawns,
  signals, or steers a process. Kill paths, the dispatch allowlist, and
  the two kill containment guarantees are not involved anywhere in this
  design.
- **tail-on/off is the only new imperative, and it can only start or stop
  READING a file.** The tailer validates every `transcriptPath` against
  its own local allowlist of transcript roots (default:
  `~/.claude/projects/` only, config-extensible like
  `~/.war-room/dispatch.json`) — a path outside the roots is refused
  locally as a 2xx decision (`tail-denied`, reason as data). The server
  cannot make a tailer read an arbitrary file, mirroring "the server
  cannot override the runner's allowlist."
- **Telemetry only, ephemeral only**: chunks land in the in-memory ring
  (PidKillRecord precedent), evicted on agent removal, never persisted.
  The durable record stays the transcript file on its own machine.
- **Exposure honestly named**: assistant text crosses the tailnet to the
  server over the same Bearer-authed channel dispatch prompts and
  resultTails already use — no new trust tier, but a wider slice of
  session content. Tailnet-only server + per-machine opt-in is the
  accepted mitigation (same as the poller's decision).

## Deliberately rejected alternatives

- **Piggyback output on hook events** — hooks are fire-and-forget
  lifecycle telemetry with a size-capped body; streaming through them
  invites the http-hook class of breakage (DISPATCH-6B rejected this
  shape once already).
- **Remote-side rendering** — forks the render rules across machines and
  versions; raw-lines-up keeps one renderer, server-side.
- **Tail everything always (no imperative)** — streams every remote
  session's text across the tailnet whether or not anyone is watching;
  wasteful and widens exposure for zero UX gain. Subscription-driven
  tail-on is the match for the WS plane's subscription-gated fan-out.
- **Server-initiated SSH/file mount** — the server never reaches into
  another machine (DISPATCH-6B's founding rule).

## Build checklist (when this slice is picked up)

1. `bin/transcript-tailer.mjs` + `bin/lib` reuse (forwarder, line reader
   extraction if shared with nothing else, keep it local to the tailer).
2. Server: `POST /api/agents/output` + session→agent resolution + poll
   advertisement/`tail[]` drain endpoint (extend the existing poller
   advertisement or a sibling `/api/tailer/poll` — decide at build time
   against the poller's real body shape).
3. Runbook: `install-transcript-tailer-launchd.sh` (+ uninstall), ntfy-kill
   pattern.
4. Tests: tailer with injectable fetch/fs fakes (bin/test), server route
   tests (auth, resolution, liveness gate), one integration round trip.
5. DISPATCH-6B amendment #2 already covers the threat-model delta (this
   doc's companion change).
