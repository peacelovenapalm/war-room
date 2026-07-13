# V6 DESIGN — one glance, one push (AMBIENT rung 1)

Drafted 2026-07-12/13 during the v5R→v7 run (RUN-MAP-v5-v7 §3), while
V5R lanes rendered/built. Register-locked scope: Q1-3, 6-7, 18, 20,
40-41, 45, 49. Design choices that are genuinely Greg's take the
smallest reversible default, recorded here + in SPRINT-STATE.

## Wires verified this session (all read-only)

- `gen_morning_page.py` (nexus, cron `*/15`, 06:00 America/Denver gate):
  payload `{date, generated_at, top3[{n,action,why,source,tags}],
flags: "routine: summary · …", prs: {count, list[{number,title,branch}]}}`
  written to `morning_page/morning.json`; static page self-deploys
  beside it.
- Server push seam exists: `server/src/notifyBark.ts` —
  `notifyMorningDigest` (1/day local-date dedupe) +
  `notifyBigMoment` with a runtime-enforced class allowlist.
  `WAR_ROOM_BARK_URL` absent = silently off.
- Board endpoints on the same host: `/api/ops/review`, `/api/inbox`,
  `/api/agents/answers` (+ needs-input state), `/api/dispatch/machines`.

## V6-1 Board morning surface

- New server module `server/src/morningSurface.ts`: composes
  `GET /api/morning` from (a) the notifier's `morning.json` read off the
  same `:ro` mount pattern the inbox uses (honest ⊘ per-section when the
  file is stale/absent — staleness = generated_at older than the current
  local morning), (b) board state: ⚠ NEEDS-INPUT count + names,
  ◷ held-budget jobs, ✉ open routine PRs, overnight summary (receipts
  since last local 18:00→06:00 window).
- v3 face: MORNING view (own dock entry, modeled on DistrictsView's
  panel shape) rendering those sections + an explicit ALL CALM state —
  a real rendered state with shape+word (✓ ALL CALM — nothing needs
  you), never a blank.
- ONE push at the notifier's cron time: a server-side scheduler tick
  (same process, `notifyMorningDigest`) fires once per local day at the
  configured morning hour with the pre-triaged summary (NEEDS-YOU count
  leads) and a deep link `?open=morning` (the push-landing deep-link
  pattern already exists in `state/launch.ts`).
- **Recorded default (Greg may override):** the old nexus-notifier push
  stays untouched during parallel-run — two morning pushes during
  shakedown beats silently rewiring the old surface; the retirement
  flip (§0.3) later silences the old one. Undo note included in the
  flip prep.

## V6-2 NEEDS-YOU count (Q6)

- The push message BEGINS with the count: "NEEDS YOU: 3 — …names…" so
  the lock screen carries it even truncated. Shape+number, never
  color-only. PWA badge: `navigator.setAppBadge(count)` where
  supported, cleared on morning-view open; silently absent otherwise
  (honest degradation, no fake badge).

## V6-3 Board announces its own sickness (Q49/Q40/Q41)

- New big-moment class `morning-degraded` (allowlist addition): fires
  when the morning tick cannot compose the surface (morning.json
  stale/unreadable, board data sources erroring) — the push SAYS what
  is broken. Edge-triggered once per day, not per tick.
- Data-age instrumentation: `/api/morning` carries `dataAgeSeconds` per
  section; the view renders ◷ STALE beyond the seconds-fine/minutes-not
  bar (default: warn > 120s for board state, > 20h for morning.json
  since it regenerates each morning).
- Offline actions PARK (Q41): any morning-surface action taken while
  the transport is disconnected lands in a visible PARKED DRAFTS list
  (client-side, clearable, never auto-fired on reconnect — explicit
  re-confirm to send).

## V6-4 Autonomy rungs, pre-approved classes (Q18/Q20)

Exactly four action classes, no fifth, no generalization:

1. restart dead runners/daemons
2. refresh stale clones/mirrors
3. mechanical vault fixes
4. re-run failed routines

- Implementation: a `selfHeal` module with a per-class registry —
  each action = {class, target, command/receipt-template, undo-note}.
  EVERY execution writes a verbatim receipt (what ran, when, exit,
  undo path), broadcasts board-visible, and consults the STOP-ALL
  latch FIRST (latched ⇒ no action, receipted as suppressed).
- Standing orders: scheduled + reactive spawns allowed; every spawn
  receipted through the same receipts surface.
- Revocable: per-class enable flags default ON for the four classes,
  flippable via the existing automation config surface; flag state
  visible on the board.

## V6-5 Cross-model spot checks (Q45)

- Sampled, non-blocking: a `codex exec` lane that receives the morning
  summary text + the raw section data and answers "does the narrative
  match the data?" Discrepancies filed as ops findings (kind
  `narrative`), never blocking the push. Sampling default: 1 in 3
  mornings + any morning after a degraded day.

## V6-6 Parallel-run bookkeeping (§0.3)

- Clean-morning streak counter persisted server-side
  (`~/.war-room/morning-streak.json` on nexus): a morning is CLEAN iff
  push arrived on schedule AND the surface loaded AND data honest (no ⊘
  where real data existed, no stale-presented-as-fresh). Any breach
  resets to 0, with the breach reason receipted.
- Retirement flip PREPARED but not executed: documented config change
  (disable the old notifier push, leave the page) + undo note, gated on
  streak ≥ 5. Streak state hands off to the next session.

## V6-7 Retirement flip — PREPARED, NOT EXECUTED (build session, gated on streak ≥ 5)

Implemented this session: `~/.pixel-agents/morning-streak.json`'s `count`
field (server/src/morningStreakStore.ts), exposed on every
`GET /api/morning` response as `streak.count` and rendered in the MORNING
view's CLEAN-MORNING STREAK section. Check the streak before running
either step below — **do not flip while `count < 5`.**

### Step 1 — silence the OLD notifier push (nexus-notifier side)

The old push is `scripts/nexus-notifier/` (outside this repo, lives in the
vault-notifier clone) firing its own Bark push at the same 06:00
America/Denver cron gate `gen_morning_page.py` already runs on. War
Room's NEW push (`server/src/morningPush.ts`, wired in `httpServer.ts`)
now fires independently on the SAME schedule via `WAR_ROOM_MORNING_PUSH_HOUR`
and `WAR_ROOM_MORNING_TZ` (deploy runbook defaults: `6` / `America/Denver`).
During the parallel-run window BOTH pushes fire — deliberate, per §0.3's
recorded default in this same file.

To silence the OLD push once the streak clears 5, on nexus (wherever
`gen_morning_page.py`'s Bark POST call lives — verify the exact call site
before editing; this was NOT re-verified this session):

```bash
ssh nexus 'grep -n "requests.post\|bark" \
  /data/repos/vault-notifier/scripts/nexus-notifier/gen_morning_page.py'
# comment out (or env-gate) ONLY the Bark POST call — the script must keep
# WRITING morning.json (War Room's GET /api/morning still reads it as
# source (a); killing the whole script breaks the NEW surface too).
```

Prefer an env-gate over a code comment if the script already reads an env
var for its Bark URL (check `WAR_ROOM_BARK_URL`-style config in that
script first) — `unset`ting/removing that one var from the notifier's own
env file is lower-risk than editing Python on a live cron job, and is
trivially reversible.

The morning PAGE itself (the static HTML `gen_morning_page.py` also
writes) stays alive per §0.3 ("old morning page untouched and alive") —
this flip silences only the redundant SECOND phone push, never the file
generation or the page.

### Step 2 (optional, later) — retire `notifyMorningDigest`'s second dedupe consumer

Not needed for the flip itself (War Room's own push is independent of the
old one already). Listed for completeness only: once Greg has lived with
ONE push for a while and is confident in it, the old notifier's Bark
credentials/route can be decommissioned entirely on the nexus-notifier
side — a separate, later decision, not part of this flip.

### UNDO (either step)

- Notifier side: re-enable the commented POST call / restore the removed
  env var. `gen_morning_page.py` was never stopped from writing
  `morning.json`, so nothing on the War Room side needs touching to undo.
- War Room side: nothing to undo — `WAR_ROOM_MORNING_PUSH_HOUR`/
  `WAR_ROOM_MORNING_TZ` are additive env vars; removing them just reverts
  the NEW push to its defaults (still fires), it never depended on the old
  push being silenced.

### Verdict this session

NOT executed — streak starts at 0 on first deploy (no morning has run
yet). This is a live-state gate, not a code gate: the flip is safe to run
the moment `GET /api/morning`'s `streak.count` reports ≥ 5 on a real
deployment. Re-verify the notifier script's actual Bark call site before
editing it — it was described from CROSS-SYSTEM-IDEAS.md's citation, not
re-read this session.

## Exit (falsifiable, from the run map)

Morning = ONE push → ONE surface. Record the before list (Bark push +
morning page + board + PR list + terminal) vs after (push → board
morning view) in the handoff.
