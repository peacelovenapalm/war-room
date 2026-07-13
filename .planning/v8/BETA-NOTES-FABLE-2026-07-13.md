# War Room V3 — Beta Notes (Fable, 2026-07-13)

Tester: Claude Fable 5 (independent beta tester #1)
Target: https://nexus.tail722a2e.ts.net:8484/ (live production board, over tailnet)
Method: Real Chrome via claude-in-chrome tools, fresh tab. Read-only surfaces only — no STOP-ALL, DISPATCH, APPROVE, DESK, self-heal DISABLE, or graph feedback buttons were pressed.

---

## Summary verdict

Strong, polished, and unusually honest. Within ~30 seconds it is clear what this is: a live ops board where AI agents render as pixel characters in an isometric office, with a triage drawer, a right-hand panel menu, and a top HUD of real stats. The standout qualities are **data honesty** and **accessibility** — both are not just present but explicitly designed for and documented in-product. Core flows all work against a real backend (12 `/api/*` endpoints all 200, live WebSocket `/ws`). I watched the board escalate a FIRE to an ALARM on schedule and then clear from OFFICE: STRAINED (2) to CALM in real time, and watched the cash ledger stream new turn-completed events — this is genuinely live, not mocked.

Two real bugs stand out against that high bar: the **graph-search DEPTH toggle is non-functional** (always sends `depth=1` while showing DEPTH 2 as active), and the **stat-chip VERBATIM overlay ignores Esc and lets other panels open stacked behind it**. Neither blocks core use. A handful of minor polish issues round out the list.

Overall it reads as a mature, thoughtfully-built product, not a prototype.

---

## What works well

- **Instant learnability.** Top HUD is self-describing (LIVE, $ cash, ★ rep, agent tally, per-host wing, OFFICE MOOD). HELP ("WHAT AM I LOOKING AT?") is an excellent accordion: "Everything on this dashboard is real: real sessions, real tokens, real gates. Press ? anytime." The SIGNALS section documents every state and — critically — states the design rule out loud: "Every desk chip and drawer STATE row is one of these, **shape + word**."
- **Every core panel opened with real data and closed cleanly:** MORNING, SHIFT, OPS REVIEW, DISTRICTS (+ per-district detail), SETTINGS, SEARCH (graph), HELP, BRIEFING, INBOX. All backing requests returned 200.
- **Genuinely live.** Timers tick; FIRE #7 escalated to ALARM #7 exactly at its forecast 4:00; SMOKE #1 → FIRE #1 on schedule; board cleared STRAINED (2) → CALM live; cash ticked 3,549 → 3,551 with a matching new ledger row. Confirmed transport is WebSocket via the VERBATIM drill-down ("SOURCE: economyUpdate over /ws") and the ● LIVE indicator.
- **Data honesty is best-in-class and explicit.** Documented and observed examples:
  - "$ CASH: shows '—' until first economyUpdate — an absent feed and a zero balance are different facts, never conflated."
  - MORNING: "attribution counters are process-local and honestly reset on restart."
  - BRIEFING flag counts: "(sampled — 64 total across maps/*.md, not exhaustive here)."
  - SHIFT efficiency shows its provenance: "Counted from real events today: hook turn-ends, JSONL token usage, poller blocked-episodes."
  - Empty states say so ("no decision receipts", "no matches", "OVERNIGHT (0) no overnight actions") rather than fabricating.
  - Stat chips drill down to **verbatim wire data** with idempotency anchors (e.g. `+25 cash studio-contract-completed:e7e100e0… [studio-contract:…todo:/briefing/todo/2026-07-10.md#L17]`).
- **Accessibility — house rule honored throughout.** Every status uses shape + word + symbol: ⚠ NEEDS INPUT, ▶ WORKING, ✓ DONE, ✗ FAILED, ⏸ WAITING; crisis stages ▲ FIRE / ✱ ALARM / ✗ DEBRIS. SETTINGS toggles show checkbox + word (ON/OFF) + filled/hollow symbol (●/○), never color alone. The **GRAYSCALE** mode strips all color and the entire board remains fully legible — this is the definitive color-only-signal test and it passes. Toggle button labels change text (GRAYSCALE OFF ↔ ON), not just color. Keyboard focus rings are visible on buttons after interaction.
- **Discoverability aids:** hover tooltips explain buttons ("One glance: needs-you count, held jobs…"); DISTRICTS encodes milestone progress as building height plus a status symbol.
- **Pixel aesthetic is consistent:** sharp-cornered dark panels, hard shadows, isometric office with posters (STOP ALL, WAR ROOM, SHIP IT), animated characters. WORKING agents surface their live tool call as a floating label (e.g. `▸ mcp__claude-in-chrome__computer`, `▸ Bash`).

---

## What needs improvement

- Make the graph-search DEPTH control actually work, or remove it (see bug 1).
- Give the VERBATIM stat-chip overlay the same Esc-to-close behavior as every other panel, and prevent panels from opening behind it (see bug 2).
- Add a separator between the WARN severity label and its message text in OPS REVIEW (bug 3).
- Consider single-click panel switching (bug 4).
- Add an explicit STALE marker when district "last activity" is old, and reconcile the Diablito status across MORNING/BRIEFING/DISTRICTS/SEARCH (bug 5).

---

## Bugs & issues (severity + repro)

### ⚠ MAJOR — Graph-search DEPTH toggle is non-functional (dead control that misrepresents its state)

The SEARCH panel shows DEPTH 1 / DEPTH 2 buttons with DEPTH 2 rendered as the active/selected (brighter border) option. Every search request goes out as `depth=1` regardless.

- Repro: open SEARCH; note DEPTH 2 is the highlighted button; type `vault` → network shows `GET /api/graph/search?q=vault&depth=1`. Type `diablito` → `…?q=diablito&depth=1`. Click DEPTH 2 explicitly (no request fires), then type another char → `…?q=diablitox&depth=1`. Depth is stuck at 1 in all cases.
- Why it matters: a control that looks active but does nothing is exactly the kind of dishonest signal this board otherwise works hard to avoid.

### ⚠ MAJOR — VERBATIM stat-chip overlay: Esc dead-end + panels stack behind it

Clicking a HUD stat chip (e.g. `$ 3,551`) opens the "VERBATIM — SOURCE: economyUpdate over /ws" overlay. Unlike every other panel, it does not respond to Esc, and opening a sidebar panel while it is up renders that panel _behind_ the overlay (two modals visible, overlapping).

- Repro: click the `$` cash chip → VERBATIM opens. Press Esc twice → still open. Click INBOX in the sidebar → INBOX content appears behind/around the VERBATIM overlay (overlapping). Esc then closes INBOX but leaves VERBATIM. Only the overlay's own × CLOSE dismisses it.
- Every standard panel (MORNING, SHIFT, OPS, DISTRICTS, SETTINGS, SEARCH, HELP, BRIEFING) closes on Esc, so this overlay is inconsistent.

### ○ MINOR — OPS REVIEW WARN receipts glue label to message

The WARN chips concatenate the severity word directly onto the message with no space: "⚠ WARNagent 7 blocked 4m on MACBOOK", "⚠ WARN1 dispatch run(s) exited nonzero", "⚠ WARNtoday's efficiency: HEAVY (10340 output tokens/turn)". Severity is correctly shown as both ⚠ and the word (good), but the run-together formatting hurts readability.

- Repro: open OPS REVIEW; read the three WARN chips at top.

### ○ MINOR — Switching panels takes two clicks

Clicking a sidebar item while another panel/modal is open first closes the open one (a visible no-op), and a second click opens the new panel. Esc-then-click is a one-step alternative, but direct sidebar-to-sidebar switching is two clicks.

- Repro: open DISTRICTS; click SETTINGS → DISTRICTS closes, SETTINGS does not open; click SETTINGS again → opens.

### ○ MINOR (data honesty) — Stale district data without a STALE marker; cross-surface Diablito inconsistency

DISTRICTS → DIABLITO detail shows "Progress: 100%", "Last activity: 2026-05-05T21:00:00.000Z" — ~2 months stale as of 2026-07-13, with no staleness badge. The raw timestamp is shown (honest), but no ⊘/STALE marker per the house rule. Separately, MORNING and BRIEFING both call Diablito "the single remaining blocker … one `vercel --prod` away", DISTRICTS shows it ✓ 100% done, and graph SEARCH for "diablito" returns "no matches". These four surfaces tell a mildly inconsistent story about the same entity.

- Repro: DISTRICTS → click DIABLITO (see 100% + old timestamp); compare to MORNING TOP 3 and SEARCH "diablito".

### ○ MINOR — HUD host indicator changed mid-session

At load the HUD showed two hosts: "MACBOOK ⚠ 2" and "MINI ✓". Later only "MACBOOK ✓" remained; the MINI indicator was gone. Possibly a host going idle/offline (legitimate), but if MINI dropped it disappeared silently rather than showing an OFFLINE state. Worth a glance.

### (untested) — Narrow-viewport / responsive pass

`resize_window` to 480×800 succeeded, but the screenshot capture resolution is fixed at 1456×833 regardless of window size, so I could not observe reflow. Responsive behavior is **untested** via this tooling, not confirmed either way.

---

## Criteria scorecard (1–5)

| #   | Criterion                        | Score | One-line justification                                                                                                                                      |
| --- | -------------------------------- | ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | First impressions & learnability | 5     | LIVE board is self-explanatory in seconds; HELP explicitly explains every signal.                                                                           |
| 2   | Core flows                       | 4     | Every panel opened with real data and closed; docked one for the overlay-stacking defect.                                                                   |
| 3   | Usability & navigation           | 3     | Two-click panel switching, Esc dead-end on the VERBATIM overlay, and panel-behind-overlay stacking.                                                         |
| 4   | Visual/UI quality                | 4     | Consistent pixel aesthetic; minor WARN label run-together and occasional tool-label overlap.                                                                |
| 5   | Accessibility                    | 5     | Exemplary shape+word+symbol; grayscale mode passes the color-only test; focus rings; rule documented in-product.                                            |
| 6   | Performance                      | 5     | Fast load, smooth live updates, no jank, no request floods, zero app-level console errors.                                                                  |
| 7   | Data honesty                     | 4     | Best-in-class explicit honesty ("—" vs 0, sampled-not-exhaustive, verbatim anchors); docked only for the missing STALE marker on 2-month-old district data. |

---

## Console / network observations

- **Network:** all app requests returned 200 — document, `assets/index-*.js/.css`, `registerSW.js`, `manifest.webmanifest`, sprite sheets (`props.*.sheet.png`, `characters.*.sheet.png`), posters (`imagegen/posters/*`), and all 12 observed `/api/*` endpoints: `standing-orders`, `automation/stop-all-state`, `morning`, `shift`, `briefing` (x2), `ops/review`, `ops/auto`, `ops/self-heal`, `districts`, `graph/search`, `inbox`. No 4xx/5xx, no request floods.
- **Live channel** is a WebSocket at `/ws` (does not appear in the HTTP request list, as expected for WS frames); confirmed by the VERBATIM overlay title "SOURCE: economyUpdate over /ws" and the ● LIVE HUD indicator.
- **Console:** 8 identical `[EXCEPTION]` entries — "A listener indicated an asynchronous response by returning true, but the message channel closed before a response was received" — logged at `:0:0` with no app stack trace, in two bursts (page load ~4:01:35 and ~4:07:35). This is the well-known Chrome-extension messaging error (an extension is loaded in this browser — Adobe Acrobat `efaidnbmnnnibpcajpcglclefindmkaj` was among the content scripts), **not** app-originated. No application errors or warnings were observed.

---

## Interactions performed (interactive round, per updated policy)

Policy was updated mid-session to allow safe, reversible interaction (restore each) plus exactly one STOP-ALL engage→release round trip. Every interaction and its restoration is logged below. Board was left exactly as found: **STOP ALL normal, OFFICE CALM, all settings at defaults.**

| #   | Interaction                                             | Result                                               | Restoration                                                                                                                                                         |
| --- | ------------------------------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Top-bar mute toggle (⊘ MUTED → ♪ SOUND ON)              | Label flips symbol+word, not color-only              | Toggled back to ⊘ MUTED (verified)                                                                                                                                  |
| 2   | SETTINGS → Sound notifications OFF → ON                 | Checkbox + "● ON" updates correctly                  | Toggled back to OFF (verified all 4 settings at original: Sound OFF, Watch ON, Instant OFF, Labels ON)                                                              |
| 3   | GRAYSCALE OFF → ON (earlier round)                      | Whole board desaturates, stays legible               | Toggled back to OFF (verified)                                                                                                                                      |
| 4   | Graph SEARCH queries: `vault`, `diablito`, `diablitox`  | Returned real node / "no matches" honestly           | Read-only; panel closed                                                                                                                                             |
| 5   | Clicked seated characters                               | Surfaces live tool label only (`view_image`, `Bash`) | No state change; **seat-reassignment affordance is not exposed on this board** (that belongs to the separate pixel-agents VS Code extension) — interaction N/A here |
| 6   | FLOOR view toggle (FLOOR → BOARD blank view → back)     | See BUG below — corrupted STOP-ALL button state      | Recovered via page reload (returned to office view + correct STOP ALL)                                                                                              |
| 7   | Opened/closed every panel                               | All open with data; close on Esc except VERBATIM     | Closed cleanly                                                                                                                                                      |
| 8   | **STOP-ALL engage→release round trip (canonical test)** | Works end-to-end (see below)                         | Released immediately; button verified back to STOP ALL                                                                                                              |

**Layout editor place/move/UNDO:** N/A — this board has no layout editor (the "FLOOR" button is a display/view toggle, not an editor; the layout editor described in CLAUDE.md is the separate pixel-agents VS Code extension). Nothing was ever Saved.

### STOP-ALL round trip — result (canonical safety-control test)

Baseline verified clean first: after a page reload the button read "■ STOP ALL" and `GET /api/automation/stop-all-state` showed no active stop — so no external/other-tester stop was in effect when I ran this.

- **Engage:** one click on "■ STOP ALL" → `POST /api/automation/stop-all` → **200**. Button immediately flipped to "▶ RESUME" (tooltip: "Resume automation — a separate explicit action"). STOP is **one-tap** (instant — appropriate for an emergency halt).
- **Observed state while engaged:** the board stayed OFFICE: CALM and agents still rendered ▶ WORKING in the brief (~few-second) window; **the only clear indicator that stop-all was engaged was the button flipping STOP ALL → RESUME.** No prominent on-board "STOP-ALL ENGAGED" banner/toast appeared on the main canvas in that window. (OPS REVIEW likely logs a receipt, but I released immediately per protocol rather than re-opening it.)
- **Release:** click "▶ RESUME" → arms "⚠ CONFIRM RESUME" (two-tap guard) → click confirm → `POST /api/automation/resume` → **200**. Button returned to "■ STOP ALL" (tooltip: "Halts every standing order + running c[hains]").
- **Verified released:** button back to STOP ALL; board CALM; agents WORKING; `MACBOOK · claude — ▶ RUNNING`.
- **Design note (positive):** asymmetric guarding is good — STOP is instant one-tap, RESUME is a guarded two-tap. My controlling browser session was NOT disabled by the engage (clicks kept working throughout), so the release was never at risk.

### ⚠ MAJOR (new) — FLOOR view toggle corrupts the STOP-ALL button's displayed state

Clicking the top-bar **FLOOR** button (a client-side board freeze / FLOOR↔BOARD view toggle that blanks the office) spuriously drives the STOP-ALL control into the "▶ RESUME" state **with no server stop-all** — verified: during that episode there was **no `POST /api/automation/stop-all`** (network showed only the GET), and a page reload restored "■ STOP ALL". Consequences:

- While in FLOOR/paused mode the emergency **STOP ALL control is unavailable** — its slot is replaced by RESUME after merely toggling a display view. That is a real safety-signal concern: an operator who toggled FLOOR could not hit STOP ALL.
- Toggling FLOOR back to the office view does **not** clear the RESUME state — the user is stranded showing RESUME where STOP ALL belongs.
- Clicking that client-fake RESUME arms a genuine "⚠ CONFIRM RESUME" that, if confirmed, would `POST /api/automation/resume` (resuming automation that was never stopped).
- Only a **page reload** cleanly restores the correct STOP ALL state (Esc and neutral clicks do not).
- Repro: from a clean board (button = STOP ALL), click FLOOR → board blanks, button becomes RESUME; click BOARD to return to office → button still RESUME; reload → button correctly STOP ALL again.

### Deploy / reconnect observation (bonus)

Greg ran a deploy during the session. I performed one page reload mid-session: it **reconnected cleanly** (● LIVE returned immediately, board repopulated) and the version stayed **V3** — no visible version bump, no reconnect error banner, no WS failure. Settings persisted across the reload. No reconnect-related issues observed.
