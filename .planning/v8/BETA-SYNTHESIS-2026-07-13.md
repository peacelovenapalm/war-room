# BETA SYNTHESIS — War Room live board, 2026-07-13

Two independent testers on the live deployed board (`ca7dd7d`, deploy #4):
**codex gpt-5.6-sol** (headed Chrome for Testing over CDP, 46 screenshots,
desktop 1024×547 + mobile 390×844) and **Claude Fable 5** (Greg's real
Chrome, live-escalation observation + interactive round). Raw notes:
`BETA-NOTES-CODEX-2026-07-13.md`, `BETA-NOTES-FABLE-2026-07-13.md`.
Synthesis by the orchestrating agent, with two findings reconciled
against the code. Symbols: ✗ blocker / ⚠ major / ○ minor / ✓ pass.

## Verdict (both testers, independently)

Strong, polished, unusually honest **desktop** product — "reads as a
mature product, not a prototype" (Fable), "strong controlled-beta
desktop board" (codex). **Not yet reliable as a phone-first incident
surface** (codex, with measured DOM evidence). Zero blockers. Both
testers left the board exactly as found.

Converged strengths: learnability inside 60 s; every panel opens with
real or explicitly-empty data (12+ endpoints, all 200); grayscale mode
passes the full color-only-signal test; data honesty is best-in-class
and documented in-product ("— vs 0 are different facts"); live
escalation genuinely works (FIRE→ALARM on forecast, STRAINED→CALM
clearing in real time); WS reconnect is excellent (LIVE in ~300 ms);
the STOP-ALL engage→release round trip passed for BOTH testers
independently (one-tap stop, guarded two-tap resume — good asymmetry).

## Reconciliations (apparent tester contradictions, resolved in code)

1. **"FLOOR toggle corrupts STOP-ALL" (Fable ⚠) — MISDIAGNOSIS; real
   behavior was correct cross-client sync.** Verified: `StopAllControl`
   renders purely from the `automationStopped` WS-reduced state
   (`App.tsx:322-323, 774`); the FLOOR/BOARD toggle has zero coupling to
   it, and codex explicitly re-ran FLOOR→BOARD→FLOOR on the same build —
   STOP stayed released, no non-GET fired. Timeline shows Fable's
   "corruption" window coincided with CODEX's real STOP-ALL engage:
   Fable's client received the legitimate WS broadcast (no local POST —
   exactly what Fable observed), and it "cleared on reload" because
   codex had resumed by then. **The residual REAL finding: engaged
   state is so under-signaled (button flip only) that a concurrent
   operator diagnosed it as UI corruption.** Folded into ⚠ M3 below.
2. **"Graph DEPTH toggle dead" (Fable ⚠) vs "depth control wired"
   (codex ✓) — the control WORKS; its selected-state affordance is
   inverted.** Verified: internal default is `depth=1`
   (`GraphSearchPanel.tsx:111`) and the ACTIVE depth button is rendered
   `disabled` (`:214`) — so the dimmed/disabled button is the selected
   one, and the brighter enabled button reads as selected. Fable read
   DEPTH 2 as active while requests honestly went out depth=1; codex,
   clicking deliberately, got depth=2 on the wire. Real defect is the
   affordance, not the wiring → ⚠ M7.

## Findings, ranked (deduped across both testers)

### ✗ Blockers — none.

### ⚠ Major

- **M1 — Mobile (390×844): triage rows + APPROVE/DESK controls painted
  under the floor feed.** Triage container collapses to ~26 px; crisis
  rows and action buttons render beneath the scrolling feed. A phone
  user cannot see or press the crisis actions the board says exist.
  Safety-path regression, measured in DOM. (codex; `37-mobile-main.png`)
- **M2 — Mobile: tall modals (MORNING) center under the fixed HUD,
  hiding title + close.** No Esc on phones → practical dead end; only
  short modals escape. (codex; `38-mobile-morning.png`)
- **M3 — STOP-ALL engaged state is under-signaled and can contradict
  itself.** Cluster, three convergent observations: (a) while engaged,
  the ONLY signal is the button flipping to ▶ RESUME — no persistent
  `■ STOP-ALL ENGAGED` banner (both testers, independently); (b) a
  client-local tooltip receipt ("Resumed 0 order(s).") survives an
  external engage and directly contradicts the live state (codex);
  (c) a concurrent operator misdiagnosed a legitimate external engage
  as UI corruption (reconciliation #1) — proof the signaling is
  insufficient in multi-client use. Add a persistent engaged banner
  with source/time, and clear client-local receipts on WS transitions.
- **M4 — VERBATIM stat-chip sheet ignores Esc and stacks over/under
  other panels.** Found INDEPENDENTLY by both testers — strongest
  pure-bug convergence of the run. Esc closes every normal panel but
  not this sheet; opening another panel yields two overlapping modals
  with two close buttons. Agent drawer shares the no-Esc inconsistency
  (codex ○). Unify overlay close semantics: Esc closes topmost, one
  active layer family.
- **M5 — "Always show labels" setting persists but does nothing on the
  V3 board.** OFF and ON are pixel-identical; either wire it or remove
  it (it may belong to the legacy face). (codex; screenshots 43/44)
- **M6 — Desktop HUD overflows horizontally at 1024 px** (1323–1395 px
  content): FLOOR, grayscale, mute start offscreen behind a thin
  scrollbar inside the 41 px header. Wrap/compact; keep STOP-ALL
  pinned. (codex)
- **M7 — Graph SEARCH depth selector: selected state reads inverted**
  (active = disabled/dimmed; unselected = brighter). Misled one tester
  into reporting a dead control. Style aria-pressed as visibly ACTIVE
  (shape+word, per house rule), not merely disabled. (reconciliation #2)

### ○ Minor (deduped)

- OPS REVIEW WARN chips glue severity to message: "⚠ WARNagent 7
  blocked…" — add a separator (Fable).
- Sidebar panel switching takes two clicks (first click only closes the
  open panel) (Fable).
- DISTRICTS: stale data lacks a STALE/⊘ marker (Diablito "last
  activity" 2 months old, War Room shown with unexplained ◷); state
  glyphs appear without state WORDS on plaques — house-rule gap; plaque
  label collisions at desktop zoom (both testers, overlapping finds).
- Cross-surface Diablito inconsistency: MORNING/BRIEFING say "single
  remaining blocker", DISTRICTS says ✓ 100%, SEARCH finds no node
  (Fable).
- Graph search renders the same node twice (match + resolved block)
  (both).
- CONTRACTS shows near-identical items as `18 OPEN` and `RECENT · DONE`
  with no reissued/stale explanation (codex).
- INBOX row tap appears inert — detail body appended below the full
  list, no scroll-into-view (codex).
- Self-heal rows imply ON via a DISABLE action without an explicit
  ON/OFF word (codex).
- MINI host indicator disappeared silently mid-session instead of
  showing an OFFLINE state (Fable).
- Initial navigation once measured 8.8 s (coincided with the deploy;
  reload 115 ms — monitor, don't panic) (codex).
- Deprecated `apple-mobile-web-app-capable` meta warning (codex).
- Mobile dock gives no affordance that ~8 more destinations are
  offscreen (codex).

## Scorecards (1–5)

| Criterion                        | Fable | Codex |
| -------------------------------- | ----- | ----- |
| First impressions / learnability | 5     | 4     |
| Core flows                       | 4     | 3     |
| Usability & navigation           | 3     | 3     |
| Visual / UI quality              | 4     | 4     |
| Accessibility                    | 5     | 3     |
| Performance                      | 5     | 4     |
| Data honesty                     | 4     | 4     |

(Codex's lower accessibility/core-flows scores are mobile-driven; on
desktop-only surface the two scorecards nearly agree.)

## Interaction audit

Both testers confirmed full restoration: STOP-ALL released
(`{engaged:false}` verified), settings at original values, grayscale
off, mute unchanged, viewport restored, no layout Save (no layout
editor exists on V3 — it belongs to the pixel-agents extension), no
dispatches/kills/pushes fired. Codex's hosted browser left open.

## Recommended next 3 (for Greg)

1. Fix the mobile pair M1+M2 (one responsive-layout lane) — it's the
   difference between "desktop product" and "phone incident surface",
   which is the V9 direction anyway.
2. Fix M3+M4 as one overlay/state-signaling lane: persistent
   `■ STOP-ALL ENGAGED` banner + WS-cleared tooltips + unified Esc
   semantics.
3. Sweep the honesty minors (STALE markers, state words on plaques,
   WARN separator, duplicate search row) — small diffs, all serving the
   board's own house rules.
