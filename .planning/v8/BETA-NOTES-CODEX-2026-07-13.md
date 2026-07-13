# War Room live-board beta notes — Codex — 2026-07-13

## Summary verdict

**Strong controlled-beta desktop experience; not yet dependable as a phone-first incident surface.** The board communicates “live operations room” within seconds, the pixel-art office is distinctive, the desktop panels consistently render real or explicitly empty data, STOP-ALL passed its server-authoritative stop/resume round trip, and reload/WS recovery was fast. The current live build was `ca7dd7d4edd2a79e9db2894810bcc63faa898912` (`builtAt: 2026-07-13T23:04:20Z`).

The highest-risk defect is at 390×844: the live triage rows overflow a 26 px-tall triage container and are painted underneath the floor feed, hiding both crisis details and the APPROVE/DESK controls. Tall mobile modals also center underneath the 165 px HUD, which physically covers their title and close button; MORNING is a confirmed example. Desktop has several trust/navigation defects as well: the “Always show labels” setting persists but has no visual effect, a verbatim telemetry sheet ignores Esc and can stack over a normal panel, and a live external STOP-ALL change left a stale, contradictory tooltip receipt.

No blocker was found in the tested desktop path. I would keep the deployment in controlled beta, fix the two mobile layering failures before calling the phone view operational, and then address the safety-tooltip and overlay-navigation inconsistencies.

## What works well

- **Learnability is unusually good for a dense ops surface.** “WAR ROOM · V3,” LIVE, agent tally, machine wing, office mood, STOP ALL, the isometric office, triage, and the labeled dock communicate the product in well under 60 seconds.
- **The pixel-art identity is cohesive.** Office props, sprites, posters, isometric lighting, modal chrome, mono typography, glyph vocabulary, and grayscale mode feel like one system rather than a themed dashboard pasted over a game canvas.
- **Desktop panel coverage is broad and real.** CALL, AUTOMATION, CONTRACTS, SHIFT, BRIEFING, MORNING, OPS REVIEW, SEARCH, DISTRICTS, INBOX, SETTINGS, DEBUG, and HELP all opened and rendered content; each normal modal closed through its explicit close control, and Esc closed the normal modal family.
- **The data-honesty posture is visible.** The drawer used `— NO DATA (no transcript access)` instead of inventing tokens; AUTO said `AUTO: OFF — whitelist empty`; self-heal showed four real enabled classes and honestly rendered no receipt list because there were zero receipts; the search surface has explicit no-match/no-memory patterns; Morning says attribution counters reset on process restart.
- **Status encoding usually survives grayscale.** Agent states, crises, office mood, connection, settings, warnings, and briefing progress generally combine a glyph/shape with a word. The full-board grayscale pass remained readable with good separation between canvas, overlays, and controls.
- **Agent selection and camera framing work.** Clicking a desk chip opened the correct drawer and smoothly reframed the selected desk; closing the drawer returned to a whole-office framing. The drawer exposed provider, project, session ID, honest missing-token state, current tool, and live-tail status without fabricating output.
- **Pinch zoom is responsive and anchored.** A trusted two-touch gesture zoomed in and out without page zoom or obvious jank. Pan/zoom could be returned to fit view through the normal desk/close flow.
- **STOP-ALL passed the authorized round trip.** Engage returned HTTP 200 with `{ok:true, haltedOrders:0, haltedRuns:0}` and `/api/automation/stop-all-state` returned `{engaged:true}`. Resume required the separate `⚠ CONFIRM RESUME` tap, returned HTTP 200 with `{ok:true, resumedOrders:0}`, and state returned to `{engaged:false}`. Engage-to-released time in this run was 444 ms.
- **Reconnect behavior is excellent.** Reload showed `◌ CONNECTING` at 176 ms and `● LIVE` at 295 ms. Reload navigation completed in 115 ms, opened a fresh `wss://.../ws`, restored the live agents/crises, and hydrated the durable STOP-ALL state correctly.
- **The current graph depth control is wired.** After the mid-session deployment/reload, DEPTH 2 changed pressed/disabled states and issued `/api/graph/search?q=war-room&depth=2` (DEPTH 1 had issued `depth=1`).
- **The live crisis escalation is compelling.** During the run the office moved CALM → STRAINED, SMOKE → ALARM, and 0 → 2 open crises with timers and forecast text. On desktop, the triage rows remained clear, inverted, and action-oriented.
- **Read-only health checks were clean.** `/api/version`, `/api/health`, `/api/memory/status`, `/api/automation/stop-all-state`, and the temporary PWA icon all returned HTTP 200. No page error or failed request was captured after reconnect.

## What needs improvement

### Phone reliability and layout

- Treat the 390×844 triage/feed overlap as a safety-path regression, not cosmetic responsiveness. The UI says two incidents are open but paints the rows and action buttons behind the scrolling transcript.
- Keep tall modal headers below the mobile HUD, or raise the modal above the non-STOP HUD while separately pinning STOP-ALL. A phone user has no Esc key, so a covered close control creates a practical dead end.
- The phone office fits the full map, but fixed-size desk chips become larger than the agents and overlap one another and the dispatch chip. Consider a collision/priority scheme for three or more agents at fit zoom, or collapse labels to a count/stack until focus.
- The horizontally scrolling mobile dock works, but it gives little indication that eight more destinations are offscreen. A fade/chevron/page indicator would improve discovery.

### Desktop navigation and density

- At 1024 px width the HUD is 1323–1395 px wide. FLOOR, grayscale, and mute start offscreen and are reachable only through a thin horizontal scrollbar inside a 41 px header. Keep STOP-ALL pinned, then wrap or compact lower-priority controls.
- Give all overlay families the same close semantics. Normal modals honor Esc; the agent drawer and verbatim real-data sheet do not. The real-data sheet can remain above a newly opened HELP modal, producing two close buttons and two active layers.
- When an Inbox row is tapped, scroll/reveal the newly loaded body or show it beside the list. Today the content is appended after the entire long list, so the viewport does not change and the tap appears to do nothing.
- Extreme zoom-out preserves fixed-size labels, causing severe chip overlap over a tiny office. Labels need a zoom-aware density policy even if font size stays fixed for legibility.

### Accessibility and hard house rule

- Most critical state passes shape + word + symbol, but the DISTRICTS overview does not consistently include the state word. `?`, `✓`, `○`, and `◷` sit beside project names, while “unknown,” “complete,” “paused/stale,” etc. are not written until a detail is opened (and sometimes not even then). The overview also relies on building height for progress.
- STOP-ALL engaged state is represented only by the action `▶ RESUME`. Add an explicit persistent state such as `■ STOP-ALL ENGAGED` plus the resume action, and show the halt receipt without requiring hover/title discovery.
- Self-heal rows use `● class-name` plus a `DISABLE` action. The inverse action implies ON, but an explicit `ON`/`OFF` word would match the house rule and the stronger SETTINGS treatment.
- Muted explanatory text remains readable in the tested grayscale pass, but some 11 px, 60%-opacity footnotes are close to the practical limit on the dark modal background.

### Data honesty and information scent

- CONTRACTS showed exact or near-exact Diablito and `hermes-configuration-plan` work both under `18 OPEN` and under `RECENT · DONE`, with no reissued/stale explanation. If these are new daily contracts, label them as reissued; otherwise suppress completed duplicates.
- DISTRICTS showed War Room `◷`, `Phase: RUN COMPLETE`, `Progress: 90%`, and an ISO `Last activity: 2026-07-12T20:20:00Z` without writing what `◷` means or whether that age is stale. Add a state word and human age while retaining the raw timestamp.
- The graph provider returned one `project:war-room` match plus a resolved block for the same node, and the UI rendered two identical War Room rows. This looks like duplicate evidence even though the JSON contains one match.
- Initial navigation timing was 8.767 s, versus 115 ms on reload. The initial observation coincided with active deployment/live-board churn, so this is not enough to call a stable performance regression, but it should be tracked.

## Bugs & issues (severity + repro)

### ⚠ MAJOR — Mobile triage rows and actions are covered by the floor feed

Repro:

1. Have at least one live triage crisis.
2. Resize to 390×844.
3. Observe `TRIAGE — 2 OPEN` below the 280 px office canvas.
4. Look immediately below the triage heading.

Actual: `triage-board` is only 25.8 px tall. Its two `.triage-row` children occupy y=477–574 and y=574–671 via visible overflow, while `floor-feed` begins at y=470.8 and paints its log over the same coordinates. APPROVE and DESK have live boxes at y=521 and y=618 but are visually covered and not usable as visible controls.

Expected: the triage container participates in layout with the full row height, or it becomes its own scroll region above the feed; crisis copy and actions must remain topmost.

Evidence: `37-mobile-main.png` plus DOM rect measurements.

### ⚠ MAJOR — Tall mobile modal close control is hidden under the HUD

Repro:

1. Resize to 390×844.
2. Open MORNING from the horizontal dock.
3. Try to tap the title-bar close control.

Actual: MORNING is 742.7 px tall and centered at y=101.3. The mobile HUD is fixed/topmost through y=165. The modal title and close button lie under that HUD; hit-testing the close-button center returns the HUD `<header>`, not the button. The content starts below the HUD, making the missing title/close look like an intentional headerless sheet. A phone user has no Esc key.

Expected: tall modal top must start at or below the HUD, or the modal header/close must be placed above the noncritical HUD chrome while STOP-ALL remains pinned separately.

Evidence: `38-mobile-morning.png`. Shorter DISTRICTS centered at y=343 and did not reproduce, so this affects tall panels rather than every modal.

### ⚠ MAJOR — “Always show labels” persists but does not change the V3 board

Repro:

1. Open SETTINGS; confirm `Always show labels ● ON`.
2. Turn it OFF and wait for the state to persist.
3. Close SETTINGS and move the pointer away from the office.

Actual: reopening SETTINGS confirms OFF persisted, but all desk chips and all five hotspot labels remain `display:block/flex`, `visibility:visible`, `opacity:1` at the same coordinates. OFF and restored-ON screenshots are visually identical except crisis timers.

Expected: OFF should hide persistent labels and reveal them only through the intended hover/focus behavior, or the setting should be removed/renamed if it controls a different surface.

Evidence: `43-labels-off-main.png`, `44-labels-restored-main.png`.

### ⚠ MAJOR — Verbatim telemetry sheet ignores Esc and stacks over normal panels

Repro:

1. Click the `$` HUD chip to open `VERBATIM — SOURCE: economyUpdate over /ws`.
2. Press Esc.
3. Open HELP from the dock.

Actual: the real sheet remains after Esc. HELP opens beneath it, leaving both `real-sheet` and `help-modal` active with overlapping rectangles and two close buttons. A subsequent Esc closes HELP behind the sheet, not the frontmost sheet.

Expected: Esc closes the topmost overlay, and opening another panel either replaces or intentionally suspends the existing sheet.

Evidence: `45-verbatim-sheet.png`, `46-sheet-panel-stack.png`.

### ⚠ MAJOR — STOP-ALL tooltip receipt can contradict externally changed state

Repro observed live:

1. Complete a local STOP-ALL resume, leaving the local title `Resumed 0 order(s).`.
2. Let STOP-ALL become engaged through another live client/WS event.
3. Inspect the HUD button and its title.

Actual: the button correctly changed to `▶ RESUME` and `/api/automation/stop-all-state` returned `{engaged:true}`, but the stack title remained `Resumed 0 order(s).` The visible action and hover receipt described opposite states.

Expected: a WS-authoritative state transition must clear or replace client-local receipts; the tooltip should state the current server-authoritative engagement and, ideally, its source/time.

Evidence: `27-automation.png` and the recorded HUD/title/state tuple. I did not release this externally engaged state; it was released externally before the later reload/final audit.

### ⚠ MAJOR — Desktop HUD hides controls behind horizontal scrolling at 1024 px

Repro:

1. Use 1024×547 with two or three agents.
2. Leave HUD scrollLeft at 0.
3. Try to find FLOOR, grayscale, or mute.

Actual: HUD scroll width measured 1323 px with two calm agents and 1395 px with three/strained state against a 1024 px client width. Lower-priority controls are entirely offscreen; a thin horizontal scrollbar consumes the lower portion of the 41 px header. Programmatic focus scrolls the HUD and hides the brand/primary telemetry on the left.

Expected: responsive wrapping/compaction or a clearly designed overflow affordance, while STOP-ALL remains pinned.

Evidence: `01-initial.png`, `19-grayscale-on.png`, `20b-restored-scroll-left.png`, `41-board-view-toggle.png`.

### ○ MINOR — Exact graph search hit renders twice

Repro:

1. Open SEARCH.
2. Search `war-room` at depth 1 or 2.

Actual: two identical `◆ War Room (neighbor, referenced only) project:war-room` rows render. The API JSON has one match and one resolved block for the same node; the component renders both.

Expected: render the resolved block alone, or visually distinguish “match” from “resolved node.”

Evidence: `23-search-war-room.png`, `42-search-depth2.png`.

### ○ MINOR — Agent drawer does not honor Esc

Repro:

1. Click a desk chip to open the agent drawer.
2. Press Esc.

Actual: the drawer remains open. Its explicit `✕ CLOSE` works and returns camera framing.

Expected: topmost drawer closes on Esc, matching the normal modal family.

Evidence: `03-agent-click-follow.png` and the following Esc/count check.

### ○ MINOR — Inbox row tap appears inert until the user scrolls past the entire list

Repro:

1. Open INBOX at 1024×547.
2. Tap the first `summary 2026-07-13-rollup.md` row.

Actual: the selected body is appended after the full inbox list, but scrollTop stays 0 and the screenshot is visually unchanged. The body becomes visible only after manually scrolling the modal to the bottom.

Expected: scroll the new content into view, reduce/collapse the list, or use a split/master-detail layout.

Evidence: `30-inbox.png`, `31-inbox-detail.png`, `32-inbox-detail-bottom.png`.

### ○ MINOR — District overview labels collide/truncate and omit state words

Repro:

1. Open DISTRICTS at 1024×547.
2. Read the central cluster.

Actual: `AMERICAN...`, `BRAIN2 PLA...`, and `BOSSA PIPE...` collide around very small buildings. Plaques show only state glyph + project name, not the state word. Extreme desktop zoom produces the weakest version; the 390 px layout is paradoxically clearer because the district scene receives more vertical space.

Expected: collision-free plaques with glyph + state word + project name, with detail or tooltip for the full source timestamp.

Evidence: `06-districts.png`, `07-district-detail.png`, `39-mobile-districts.png`.

### ○ MINOR — Contracts can show the same work as OPEN and RECENT DONE

Repro:

1. Open CONTRACTS.
2. Compare the open priority items with the Recent list.

Actual: Diablito’s Vercel block and the deleted `hermes-configuration-plan` decision appear as open work while near-identical items are marked `RECENT · DONE`, without a reissued/stale explanation.

Expected: suppress completed duplicates or mark why a new contract was issued after completion.

Evidence: `28-contracts.png` and captured panel text.

### ○ MINOR — Initial navigation was slow and one console warning remains

Observed: initial navigation timing reported 8,767 ms to DOMContentLoaded/load. Reload completed in 115 ms and WS was LIVE by 295 ms, so the slow first observation may have coincided with the deployment. Console emitted one warning that `apple-mobile-web-app-capable` is deprecated and requested `mobile-web-app-capable`. No page errors or failed requests followed reconnect.

## Criteria scorecard

| Criterion                           | Score | One-line justification                                                                                                                                                                  |
| ----------------------------------- | ----: | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. First impressions & learnability |   4/5 | Purpose, live state, agents, triage, and safety control are clear within 60 seconds; density and hidden HUD overflow keep it from effortless.                                           |
| 2. Core flows work                  |   3/5 | Every desktop dock panel opened with real/honest data, STOP and reconnect passed, but mobile triage and tall-panel close flows are materially broken.                                   |
| 3. Usability & navigation           |   3/5 | Dock, labeled hotspots, close buttons, and modal scrolling are coherent; inconsistent Esc behavior, overlay stacking, Inbox reveal, and horizontal HUD/dock discovery create dead ends. |
| 4. Visual/UI quality                |   4/5 | Excellent cohesive pixel-art direction and modal styling; label collisions, district truncation, extreme-zoom density, and mobile layering need another responsive pass.                |
| 5. Accessibility                    |   3/5 | Grayscale remains readable and most states use glyph + word, but district/self-heal/STOP engaged semantics and covered mobile crisis actions violate the hard-rule intent.              |
| 6. Performance                      |   4/5 | Reload/WS reconnect and interactions were fast with no observed jank or failed requests; the 8.8 s first navigation needs monitoring.                                                   |
| 7. Data honesty                     |   4/5 | Strong explicit NO DATA/OFF/empty/reset receipts overall; stale STOP tooltip, duplicated search node, ambiguous district age, and OPEN-vs-DONE contracts erode trust.                   |
| 8. Bugs                             |   2/5 | Six major issues were reproduced, including two phone safety/navigation failures and a contradictory STOP receipt; desktop remains usable.                                              |

## Interactions performed

- Connected only to the already-running headed Chrome over CDP; did not launch or close Chromium and did not close the board tab.
- Captured and visually inspected a screenshot after every significant view listed below.
- Initial load: inspected DOM, canvas dimensions, nav/resource timings, buttons, test IDs, and the 1024×547 office.
- Agent: hovered a rendered agent (no additional transient tooltip appeared while persistent labels were on), clicked a desk chip, observed camera follow/reframe, inspected drawer/live tail, and closed through the explicit drawer close control. Did not click FOCUS or KILL.
- Zoom/pan: performed trusted two-touch pinch zoom in and zoom out; restored fit framing through the desk/drawer close flow.
- Opened and closed every dock panel: CALL, AUTOMATION, CONTRACTS, SHIFT, BRIEFING, MORNING, OPS REVIEW, SEARCH, DISTRICTS, INBOX, SETTINGS, DEBUG, HELP. Did not dispatch, call, claim, approve, requeue, kill, save a chain/order, or mutate a policy.
- DISTRICTS: opened overview and War Room detail; no data was changed.
- MORNING/SHIFT: inspected top and scrolled `.modal__body` to the bottom; both were genuinely scrollable on desktop.
- OPS REVIEW: expanded the nonzero-dispatch finding and raw receipt; did not touch its REQUEUE proposal. Inspected AUTO OFF and self-heal flags. Auto receipts: 0. Self-heal receipts: 0. Did not toggle self-heal policy flags.
- **Authorized STOP-ALL round trip (exactly one):** initial state released. Engaged once; HTTP 200 `{ok:true, haltedOrders:0, haltedRuns:0}`; state `{engaged:true}`; HUD `▶ RESUME`; then tapped resume once for `⚠ CONFIRM RESUME`, tapped confirm, HTTP 200 `{ok:true, resumedOrders:0}`, state `{engaged:false}`. Released 444 ms after the engaged observation. Later external STOP engagement was observed but not touched; it returned to released before final audit.
- SETTINGS: toggled `Always show labels` OFF, verified persistence/no visual effect, and restored ON. Initial/final settings observed: Sound notifications OFF, Watch all sessions ON, Instant detection/hooks OFF, Always show labels ON.
- Accessibility: toggled HUD grayscale ON and restored OFF. Soundscape remained `⊘ MUTED`; it was not unmuted.
- SEARCH: queried `ops review`, `Diablito`, and `war-room`; tested depth 1 and 2; did not tap attribution counters.
- INBOX: opened the latest summary read-only and scrolled to its body.
- HUD view: toggled FLOOR → BOARD → FLOOR and independently verified on the current build that STOP remained released and no non-GET request fired.
- Verbatim telemetry: opened economy sheet, tested Esc and panel stacking, then explicitly closed all layers.
- Reload/reconnect: reloaded mid-session; observed CONNECTING → LIVE and a fresh WS. The deployed version after reload was `ca7dd7d`.
- Narrow pass: set viewport to 390×844, inspected main office/triage/feed/dock, MORNING, and DISTRICTS; restored 1024×547.
- Layout editor and manual seat reassignment were not present in the V3 live surface/source paths inspected, so neither was attempted. No layout Save was performed.
- No phone push was fired.

### Final restoration confirmation

- Viewport: **1024×547** (restored from 390×844).
- Board view: **⌂ FLOOR**.
- STOP-ALL: **released**; final `/api/automation/stop-all-state` = `{engaged:false}`.
- Grayscale: **OFF**.
- Soundscape: **⊘ MUTED** (unchanged).
- SETTINGS: Sound OFF; Watch all ON; Hooks OFF; Always show labels ON (all as initially observed).
- HUD scrollLeft: **0**.
- Open modal/drawer/real sheet: **none**.
- Browser/tab: **left open**.

## Screenshot index

All screenshots are under `/tmp/beta-codex/`.

| File                           | View / evidence                                                                        |
| ------------------------------ | -------------------------------------------------------------------------------------- |
| `01-initial.png`               | Initial 1024×547 live office.                                                          |
| `02-agent-hover.png`           | Agent hover with persistent labels.                                                    |
| `03-agent-click-follow.png`    | Selected agent drawer and camera reframe.                                              |
| `04a-drawer-closed.png`        | Drawer explicitly closed; whole-office framing.                                        |
| `04-zoom-in.png`               | Pinch zoom-in; fixed labels/hotspots over enlarged office.                             |
| `05-zoom-out.png`              | Extreme zoom-out; fixed labels collide over tiny map.                                  |
| `06-districts.png`             | Desktop districts overview with tiny buildings/colliding plaques.                      |
| `07-district-detail.png`       | War Room district detail, 90%, ISO last-activity timestamp.                            |
| `08-morning.png`               | Desktop Morning top.                                                                   |
| `09-morning-bottom.png`        | First scroll probe on the panel element (unchanged top; correct body scroll is #24).   |
| `10-shift.png`                 | Desktop Shift top.                                                                     |
| `11-ops-review.png`            | Ops Review initial findings/AUTO/self-heal.                                            |
| `12-ops-receipts.png`          | Expanded nonzero-dispatch receipt and gated REQUEUE proposal.                          |
| `13-stop-all-engaged.png`      | Authorized STOP-ALL engaged state (`▶ RESUME`).                                        |
| `14-stop-all-released.png`     | Authorized STOP-ALL released state.                                                    |
| `15-ops-self-heal.png`         | Ops body scrolled to AUTO/self-heal; zero receipt rows.                                |
| `16-settings.png`              | Initial settings values.                                                               |
| `17-settings-labels-off.png`   | Always-labels checkbox OFF inside SETTINGS.                                            |
| `18-settings-restored.png`     | Always-labels restored ON.                                                             |
| `19-grayscale-on.png`          | Full-board grayscale and HUD auto-scrolled right.                                      |
| `20-grayscale-restored.png`    | Color restored; HUD still scrolled right by focus.                                     |
| `20b-restored-scroll-left.png` | HUD returned left; thin overflow scrollbar and hidden right controls.                  |
| `21-search-empty.png`          | Search initial hint/depth controls.                                                    |
| `22-search-results.png`        | `ops review` honest no-match result.                                                   |
| `23-search-diablito.png`       | `Diablito` honest no-match result.                                                     |
| `23-search-war-room.png`       | `war-room` duplicate match/resolved rows.                                              |
| `24-morning-bottom.png`        | Morning body correctly scrolled to memory/reset/refresh footer.                        |
| `25-shift-bottom.png`          | Shift body correctly scrolled to efficiency/ops/yesterday.                             |
| `26-call.png`                  | CALL form, machine choices, disabled CALL with empty form.                             |
| `27-automation.png`            | Automation while an external client had STOP engaged; later stale tooltip measurement. |
| `28-contracts.png`             | 18 open contracts; OPEN-vs-RECENT-DONE comparison source.                              |
| `29-briefing.png`              | Briefing top-three and half-baked progress states.                                     |
| `30-inbox.png`                 | Inbox list.                                                                            |
| `31-inbox-detail.png`          | Immediately after entry tap; viewport appears unchanged.                               |
| `32-inbox-detail-bottom.png`   | Selected inbox body visible only after manual bottom scroll.                           |
| `33-debug.png`                 | Raw live agent table.                                                                  |
| `34-help.png`                  | Help categories.                                                                       |
| `35-help-expanded.png`         | Expanded Signals vocabulary and crisis escalation documentation.                       |
| `36-after-reload.png`          | Reloaded/reconnected live office with two open crises.                                 |
| `37-mobile-main.png`           | 390×844 office; covered triage rows/actions and horizontal dock.                       |
| `38-mobile-morning.png`        | Tall Morning modal with header/close hidden beneath mobile HUD.                        |
| `39-mobile-districts.png`      | Short mobile Districts panel; close remains accessible.                                |
| `40-desktop-restored.png`      | Viewport restored; live ALARM rows on desktop.                                         |
| `41-board-view-toggle.png`     | Full BOARD view; STOP remained released on current build.                              |
| `42-search-depth2.png`         | DEPTH 2 pressed/disabled correctly; duplicate result persists.                         |
| `43-labels-off-main.png`       | Main office with persisted Always-labels OFF; labels remain visible.                   |
| `44-labels-restored-main.png`  | Always-labels ON again; visually identical.                                            |
| `45-verbatim-sheet.png`        | Economy verbatim overlay.                                                              |
| `46-sheet-panel-stack.png`     | Verbatim sheet stacked over HELP after Esc failed to close it.                         |
