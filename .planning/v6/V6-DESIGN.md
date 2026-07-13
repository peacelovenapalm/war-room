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

## Exit (falsifiable, from the run map)

Morning = ONE push → ONE surface. Record the before list (Bark push +
morning page + board + PR list + terminal) vs after (push → board
morning view) in the handoff.
