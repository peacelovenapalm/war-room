# WIRING — every way data reaches War Room

v4 T7 (D-44). This is the map: every ingest path into the War Room server,
where it terminates in the code, what carries it, and what trust tier it
runs at. Derived from the code (grep + read), not from memory — file:line
citations below point at the real registration/handler, not a description
of intent.

Two kinds of ingest:

1. **Push** — an opt-in per-machine daemon (poller/tailer/runner) POSTs to
   an authed route. Nothing runs unless a human installed the daemon; its
   absence is honestly "no data", never a fake zero.
2. **Mount** — a read-only bind mount on the NEXUS docker host exposes
   files the server reads on a TTL cache. Absence is the same honest
   "no source configured" posture, never a 500 or a fabricated result.

The auto-detect half of this doc's D-44 mandate is `GET /api/wiring`
(`server/src/wiringProvider.ts`) — point `WAR_ROOM_WIRING_ROOTS` at one or
more parent directories and it discovers every `.planning/STATE.md`
underneath (depth ≤ 3, time-boxed) instead of hand-listing each project.

## Push (daemon → authed POST)

| Daemon                                                                                                                         | Route                                                                           | Auth                                                                                         | Registration                                                                 | Handler                                                                   |
| ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Claude Code hooks (`~/.claude/settings.json` hook config)                                                                      | `POST /api/hooks/:providerId` (`HOOK_API_PREFIX`, `server/src/constants.ts:42`) | none — hooks fire from the same trusted local machine, same-origin posture as the CLI itself | `server/src/httpServer.ts:553` (`registerHookRoute`)                         | `server/src/hookEventHandler.ts`                                          |
| needs-input poller (`bin/needs-input-poller.mjs`) — `claude agents --json` every ~15s                                          | `POST /api/agents/poll`                                                         | Bearer + `X-Machine`                                                                         | `server/src/httpServer.ts:629` (`registerPollRoute`), route at line 636      | `server/src/pollStateHandler.ts`                                          |
| Rate-limit snapshot (same poller tick, `bin/rate-limit-snapshot-hook.mjs` writes the file it reads)                            | `POST /api/budget/report`                                                       | Bearer + `X-Machine`                                                                         | `server/src/httpServer.ts` (grep `budget/report`)                            | `server/src/budgetStore.ts`                                               |
| Transcript tailer (`bin/transcript-tailer.mjs`) — S3 remote live-tail                                                          | `POST /api/tailer/poll`                                                         | Bearer + `X-Machine`                                                                         | `server/src/httpServer.ts:848` (`registerTailerPollRoute`)                   | drains `remoteTailDemand.ts`'s per-machine `TailInstruction` queue        |
| Tailed output chunks (same tailer, once tail-on)                                                                               | `POST /api/agents/output`                                                       | Bearer + `X-Machine`                                                                         | `server/src/httpServer.ts:760`                                               | `server/src/transcriptParser.ts` (token accounting rides this same plane) |
| Dispatch runner (`bin/dispatch-runner.mjs`) — one opt-in instance per machine, own local allowlist `~/.war-room/dispatch.json` | `POST /api/dispatch/poll`                                                       | Bearer + `X-Machine`                                                                         | `server/src/httpServer.ts:951` (`registerDispatchRoutes`), route at line 986 | `server/src/dispatchStore.ts`                                             |
| Coworker adapter / rate-limit hook variants                                                                                    | `bin/coworker-adapter.mjs`, `bin/rate-limit-snapshot-hook.mjs`                  | same Bearer+X-Machine tier                                                                   | —                                                                            | feed the routes above                                                     |

The server never shells out to any of these — it only ever queues a
request and reads what the daemon chooses to POST back. Each daemon
decides locally, against its own machine-local allowlist, whether to honor
anything (see `bin/dispatch-runner.mjs`'s header comment for the full
threat model on that one).

## Mount (read-only bind → cached GET)

All mounts are wired in `.planning/runbooks/nexus-war-room-deploy.sh` as
`docker run -v <host path>:<container path>:ro`, one env var per mount so
the provider code never hardcodes a path. Every provider below is
tolerant: missing env var / missing file / parse failure never throws —
that part of the response is `null` or `available:false` and one `⚠` log
line is emitted.

| Source                                                                                                                         | Env var                  | Container path                                                                                                                                                                   | Provider                                                                                   | Route                                                                            | Trust tier                            |
| ------------------------------------------------------------------------------------------------------------------------------ | ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------- | ------------------------------------- |
| todo-compiler daily files (`YYYY-MM-DD.md`)                                                                                    | `WAR_ROOM_TODO_DIR`      | `/briefing/todo`                                                                                                                                                                 | `server/src/briefingProvider.ts`                                                           | `GET /api/briefing`                                                              | unauthenticated (tailnet-only server) |
| Half-baked tracker `STATE.md`                                                                                                  | `WAR_ROOM_TRACKER_STATE` | `/briefing/tracker/STATE.md`                                                                                                                                                     | `server/src/briefingProvider.ts`                                                           | `GET /api/briefing`                                                              | unauthenticated                       |
| Knowledge-graph store (`nodes.jsonl`+`edges.jsonl`, Phase-9)                                                                   | `WAR_ROOM_GRAPH_DIR`     | `/briefing/graph`                                                                                                                                                                | `server/src/graphProvider.ts`                                                              | `GET /api/graph/search`                                                          | unauthenticated                       |
| Vault `_inbox/routines/` root (daily-digest, vault-health, project-pulse, docs-tracker, etc.) — **new, v4 T7**                 | `WAR_ROOM_ROUTINES_DIR`  | `/briefing/routines`                                                                                                                                                             | `server/src/briefingProvider.ts` (digest fold) + `server/src/inboxProvider.ts` (full tray) | `GET /api/briefing` (digest field) + `GET /api/inbox` + `GET /api/inbox/content` | unauthenticated                       |
| Auto-detect scan roots (any dir containing `.planning/STATE.md` projects) — **new, v4 T7, not yet mounted on the live deploy** | `WAR_ROOM_WIRING_ROOTS`  | not yet bound in the runbook — set the env var to a host path already inside the container (e.g. reuse `/briefing/tracker`'s parent once that becomes multi-project) to activate | `server/src/wiringProvider.ts`                                                             | `GET /api/wiring`                                                                | unauthenticated                       |

The routines mount (`WAR_ROOM_ROUTINES_DIR`) is one level above
`WAR_ROOM_TODO_DIR` in the same vault clone — additive, not a replacement;
`WAR_ROOM_TODO_DIR` keeps its own mount so existing wiring is untouched.

## Auto-detect (`GET /api/wiring`)

`server/src/wiringProvider.ts`'s `getWiringSnapshot()`:

1. Parses `WAR_ROOM_WIRING_ROOTS` (comma- or `:`-separated absolute
   paths), keeping only entries that exist and are directories
   (`parseWiringRoots`).
2. For each root, breadth-first walks subdirectories up to depth 3
   (`MAX_SCAN_DEPTH`), checking every visited directory for
   `.planning/STATE.md` and parsing it with the SAME tolerant line parser
   the BRIEFING panel's tracker fold uses (`parseTrackerState`, reused
   from `briefingProvider.ts` — one parser, two consumers).
3. The whole scan is wall-clock bounded (`SCAN_TIME_BUDGET_MS`, 2s) — a
   huge or symlink-cyclic root can never hang the request; a cutoff mid-
   scan sets `truncated: true` on the response rather than silently
   returning a partial list as if it were complete.
4. Result is cached 60s (same TTL discipline as `briefingProvider`/
   `inboxProvider`) — this is "startup-shaped" (nothing per-project to
   configure, one root activates every project underneath) without
   actually being startup-only, so a root mounted/unmounted mid-deploy is
   picked up within a minute, not only on container restart.

Nothing is mounted for `WAR_ROOM_WIRING_ROOTS` on the current NEXUS deploy
— this is honestly a zero-roots, zero-projects response today. Activating
it needs a runbook change (an additional `:ro` mount over a directory that
actually contains multiple `.planning/STATE.md`-shaped projects, e.g. a
`~/code` mirror) — deliberately NOT done in this pass since no such mount
exists yet and mounting one is a scope decision for Greg, not an
engineering default.
