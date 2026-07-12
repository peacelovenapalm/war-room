# DATA-SOURCES — every external source the board reads, and its freshness contract

Written 2026-07-12 against `war-room/v3 @ 16d7eee` (the live NEXUS deploy —
verified via `GET /api/version`). Companion to `WIRING.md` (the ingest-path
map) and `docs/ARCHITECTURE.md` (the system in layers). Shared posture,
enforced per-provider: **missing env var / missing file / parse failure
never throws** — that slice of the response is `null` or
`available:false` with one `⚠` log line, and absence of a daemon is
honestly "no data", never a fabricated zero.

Deploy mounts are all `:ro` bind mounts wired in
`.planning/runbooks/nexus-war-room-deploy.sh:150-157`, one env var per
mount. The NEXUS vault clone under `/data/repos/vault-notifier/` is
cron-hard-reset to origin, so every vault-sourced panel is as fresh as
the last committed routine run — not live vault edits.

## Briefing (todo + tracker + digest)

- **Provider**: `server/src/briefingProvider.ts` (header lists all three
  sources). Route: `GET /api/briefing` (`server/src/httpServer.ts:473`).
- **Todo** — `WAR_ROOM_TODO_DIR` → `/briefing/todo` ← NEXUS
  `/data/repos/vault-notifier/vault/vault/_inbox/routines/todo`.
  Lexicographically-latest `YYYY-MM-DD.md` wins (the vault todo-compiler
  routine writes one daily at 07:30).
- **Tracker** — `WAR_ROOM_TRACKER_STATE` → `/briefing/tracker/STATE.md` ←
  the completion-2026-07 tracker's STATE.md (rsynced to NEXUS by the
  runbook, `TRACKER_STATE_LOCAL` at runbook:69). Hand-parsed
  line-by-line; no YAML dependency.
- **Digest** — `WAR_ROOM_ROUTINES_DIR` → `/briefing/routines` (the whole
  `_inbox/routines/` root); the daily-digest fold reads
  `summary/YYYY-MM-DD-digest.md`, latest-filename-wins.
- **Staleness**: 60s TTL cache; content ages with the vault clone's cron
  pull. Honest-empty: any missing source renders that fold `null`.

## Inbox tray

- **Provider**: `server/src/inboxProvider.ts`. Routes: `GET /api/inbox` +
  `GET /api/inbox/content` (`httpServer.ts:523,524`).
- **Source**: same `WAR_ROOM_ROUTINES_DIR` mount as the digest — one
  subdir per vault routine (vault-health, project-pulse, docs-tracker,
  summary, todo, …), listed by mtime with request-time `ageMs`.
- **Hardening**: reads are realpath-contained under the mount root even
  through planted symlinks, dot-segments rejected, size-capped (P5 codex
  findings #1/#3 — provider header). Honest-empty: `available:false`.

## Knowledge graph

- **Provider**: `server/src/graphProvider.ts`. Route:
  `GET /api/graph/search?q=&depth=` (`httpServer.ts:467`).
- **Source**: `WAR_ROOM_GRAPH_DIR` → `/briefing/graph` ← the vault's
  Phase-9 store `vault/_meta/graph/{nodes,edges}.jsonl`. The
  `graph_query.py` logic is ported to TS — no python subprocess.
- **Staleness**: 60s TTL on top of the cron-pulled clone; only as current
  as the last committed `graph_build.py` run (deliberate, documented in
  the provider header). Honest-empty: `available:false`.

## Districts — CURRENTLY UNWIRED (honest NO DATA)

- **Provider**: `server/src/districtsProvider.ts`. Route:
  `GET /api/districts` (`httpServer.ts:514`). Proof slice: exactly two
  hardcoded projects (war-room via `WAR_ROOM_DISTRICT_WARROOM_STATE`, TWE
  via `WAR_ROOM_DISTRICT_TWE_STATE` — `districtsProvider.ts:53-54`).
- **Live state**: NEITHER env var is set on the NEXUS deploy — the mount
  is deliberately commented out in the runbook (runbook:57-67) because
  both candidate sources on nexus are stale or absent (the TWE checkout
  last pulled 2026-03-13; no war-room checkout exists on nexus). Mounting
  a stale STATE.md would render plausible-but-wrong March data, so the
  panel honestly shows `source:'unknown'` for both. Wiring it later
  requires a FRESH auto-pulling source plus uncommenting both runbook
  lines.

## Wiring auto-detect — env var UNSET on the live deploy

- **Provider**: `server/src/wiringProvider.ts`. Route: `GET /api/wiring`
  (`httpServer.ts:547`).
- **Source**: `WAR_ROOM_WIRING_ROOTS` (comma/colon-separated parent dirs)
  — breadth-first scan for `.planning/STATE.md` to depth 3, wall-clock
  bounded 2s (`truncated:true` on cutoff, never a silent partial). Reuses
  `briefingProvider.ts`'s `parseTrackerState` — one parser, two consumers.
- **Live state**: no root is mounted/configured on NEXUS (see
  `WIRING.md`'s closing section) — the response is a zero-roots,
  zero-projects honest empty. 60s cache, so a mid-deploy mount is picked
  up within a minute.

## Dispatch machines + capability advertisements

- **Store**: `server/src/dispatchStore.ts`. Routes:
  `GET /api/dispatch/machines` (`httpServer.ts:995`),
  `POST /api/dispatch/poll` (`httpServer.ts:1007`).
- **Source**: each machine's `bin/dispatch-runner.mjs` re-reads its local
  `~/.war-room/dispatch.json` every tick and advertises
  providers/roots/focus/sessions/scriptIds/skills on its poll.
- **Staleness**: an advertisement older than 30s
  (`DISPATCH_MACHINE_AD_TTL_MS`, `dispatchStore.ts:40`) drops that machine
  from the list entirely — honestly absent, never stale-listed. The same
  sweep clears server-derived `managed` flags so the ANSWER verb never
  renders against a dead runner.

## Token usage + budget

- **Two distinct planes, never conflated:**
- **Fleet token spend** (SHIFT scorecard, T5 daily ceiling): parsed from
  transcript `message.usage` via `applyTokenUsage`
  (`server/src/transcriptParser.ts`) — locally from the JSONL tap, and
  for remote machines via the tailer's `POST /api/agents/output`
  (`httpServer.ts:780-845`), replay-guarded by
  `isRecentEnoughForShiftSpend` so a `fromStart` full-file replay can't
  double-count history. No tailer on a machine = that machine's remote
  spend is honestly uncounted.
- **Claude rate-limit snapshot** (budget guardrail): the needs-input
  poller forwards the file `bin/rate-limit-snapshot-hook.mjs` writes to
  `POST /api/budget/report` (`httpServer.ts:1743`) into
  `server/src/budgetStore.ts`. Freshness = poller tick (~15s); a dead
  poller ages the snapshot rather than faking one.

## Agent presence (poll plane)

- **Route**: `POST /api/agents/poll` (`httpServer.ts:657`), fed by each
  machine's `bin/needs-input-poller.mjs` (`claude agents --json` ~15s).
- **Staleness**: a colocated sweep (`startPollStateSweep`,
  `server/src/pollStateHandler.ts`) clears NEEDS-INPUT badges when a
  poller goes silent — a dead poller must not leave a permanent badge.
