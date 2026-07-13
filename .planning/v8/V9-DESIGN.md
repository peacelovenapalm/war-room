# V9 DESIGN — eyes-free meaning (AMBIENT rung 2)

Drafted 2026-07-13. Builds directly on V6's ambient rung 1 (one push →
one surface, shipped 5bfeabc). Register-locked scope: Q5 (learnable
sound grammar — Greg's explicit YES), Q4 (wall display, post-move
maybe), Q6 (lock-screen signal = NEEDS-YOU count), Q21b (assertive
needs-you paging — named roadmap item), Q49 (one broken morning kills
the habit — the board announces its own sickness). Anti-friction-death
is THE constraint on every item here.

## Preconditions

1. Morning-push round trip observed live ≥3 mornings (streak counter
   recording honestly — first round trip still pending as of drafting).
2. V6 degraded-state push verified firing on a real degradation at
   least once (the sickness-announcement path must be proven before
   more ambient surface is added on top of it).

## V9-1 Learnable sound grammar

- A SMALL fixed vocabulary (start at 5, hard cap 8 — a grammar nobody
  can learn is noise): needs-you, all-calm confirm, crisis, dispatch
  complete, degraded-state. Distinct musical shapes (interval/rhythm),
  not volume levels.
- HONESTY RULE (the audio analog of colorblind-safe): sound is NEVER
  the sole carrier — every sound mirrors a visible board state that
  says the same thing in shape + word. Missing a sound must never mean
  missing information.
- Learnability aids: Settings panel plays each sound with its label; a
  just-fired sound shows a transient caption on the board ("♪
  needs-you").
- Quiet hours + per-sound toggles, persisted per-namespace (existing
  `notificationSound.ts` Web Audio lifecycle + config.json pattern).

## V9-2 SHIFT replay — "what happened while I slept"

- A timeline over EXISTING receipts + dispatch tails + hook events for
  a time window (default: last sleep window, i.e. last all-calm → now).
  Scrubber + play; agents animate their recorded state changes on the
  office canvas.
- ⊘ HONEST GAPS: windows with no data render as explicit gaps, never
  interpolated activity. Replay is ALWAYS labeled REPLAY on-screen the
  entire time (the honesty invariant's hardest test — a replayed crisis
  must be unmistakable from a live one).
- Morning integration: the morning push's summary line links to the
  replay of the overnight window (Q1 "overnight-ran summary" made
  visual).

## V9-3 Assertive needs-you paging (Q21 fix, part 2)

- Today a needs-you state waits politely. V9 escalates UNANSWERED
  needs-you: board bubble → Bark push (with needs-you count, Q6) →
  repeat-with-backoff (max 3, then park as a morning item). Every
  escalation receipted; per-project mute; STOP-ALL silences all paging.
- Escalation ladder timing lives in constants; V8-5's responsive-window
  histogram (if shipped) informs WHEN to page, never WHETHER.

## V9-4 Wall-display glance mode (post-move, may slip — Q4 "maybe")

- A kiosk route: full-screen, ultra-low-density render — needs-you
  count huge, district health strip, degraded banner. Readable at 3 m.
- Auto-recovers from disconnects without interaction (it's a wall — no
  keyboard). Explicitly SECOND priority to V9-1/2/3; slips to v10+
  without ceremony if the move hasn't happened.

## Exit question

Can Greg tell what the estate needs WITHOUT looking — and did any
morning break silently? (One silent broken morning = V9 regression,
per Q49.) Sound grammar counts as learned when Greg identifies all
five sounds blind after a week of normal use.

## Honest seams left

- Sound on the PHONE (Bark carries its own sounds) — out of scope; the
  grammar is a board/wall feature first.
- Replay of SUB-agent internals limited to what receipts already
  carry; no new telemetry is added just for replay.
- Watch-face complication (Q6 mentions watch) — parked until the phone
  lock-screen count proves itself.
