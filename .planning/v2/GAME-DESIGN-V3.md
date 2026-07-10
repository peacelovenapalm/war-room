# GAME DESIGN V3 — Synthesis: The Living Office, Grafted

Synthesized 2026-07-10 from the Phase-1.2 design panel (4 concepts, 3
independent judges). Primary review artifact:
`.planning/v2/mockups-v3/synthesis.html` (desktop + phone toggle,
interactive). This document is the design contract for the GREG GATE —
no Phase-3 code before his pick, in a live message.

---

## 1. Chosen direction and why

**Base concept: `living-office` — the simulation IS the interface.**

Judge totals (sum of 3 independent judges):

| Concept           | Total   | Rank         |
| ----------------- | ------- | ------------ |
| **living-office** | **221** | **1 — BASE** |
| mission-control   | 203.5   | 2            |
| isometric-depth   | 201     | 3            |
| one-hand-console  | 189.5   | 4            |

Why it won (from the judges' own language):

- It is the only concept where the 7 principles exist as **interacting
  mechanics in the running mockup, not prose**: fast-triage REP
  differential, diegetic peek-before-commit (desk monitors render real
  tail lines), kill→debris→ACK feeding back into board space, and a
  multi-channel calm loop (particles, board clear, mood chip, lighting
  lerp, agent posture, tail line). (Judge 2)
- Its emergence is **implemented, not claimed**: idle→coffee drift,
  blocked-agent pacing, smoke wisps, global lighting — each a cheap
  rule on the shared world, composing in one render pass. (Judge 3
  scored it 8 on emergence vs 5 for isometric, whose wandering agents
  were prose only.)
- Streaming is the most diegetic element in any concept: the desk
  monitors ARE the ambient tail surface (zoom in and read the agent's
  screen), so principle 7's "fixing a thing visibly calms the office"
  and hard rule 5 (streaming-native) are the same mechanism.
- Zero-asset procedural Canvas 2D deletes the inherited sprite
  pipeline and the eager ~1MB asset push in one move.

No hard-rule flag stands against living-office. The two flags on the
panel (mission-control's color-only calm figures in the phone ribbon;
isometric-depth's HELP/GRAYSCALE hidden on phone) belong to runners-up
and are **explicitly not carried forward** — see §8.

### Fixes applied to the base (judge-identified defects, closed in synthesis)

1. **No inline approve on the board** (Judge 1: "drawer round-trip per
   crisis"). Fixed: every triage-board crisis row now carries two verbs
   inline — `✓ APPROVE` (answer blind, fast) and `▸ DESK` (walk the
   camera in, peek the tail, then answer). This is isometric-depth's
   two-verb card grafted onto the board (§5).
2. **Flat-ish REP makes blind-approve near-dominant** (Judge 2). Fixed:
   REP is tiered on **measured mean-time-to-unblock** (<1:00 → ★+5,
   <3:00 → ★+3, else ★+1), and the design adds a **bounce rule**: if an
   approved session fails or re-blocks on the same gate within 5
   minutes, the award is clawed back with a labeled ledger entry
   (`★ −N · BOUNCED APPROVAL`). Blind speed still pays, but a wrong
   blind answer costs — peek-vs-commit stays a real decision. (Bounce
   is server-side truth in build; the mockup shows the tiering and the
   ledger copy.)
3. **"Smoke accumulates" was prose inflation** (Judge 2: wisps render,
   nothing accumulates). The claim is withdrawn; what ships is what the
   mockup does: wisps → flame → beacon by real age thresholds, plus
   debris that genuinely persists and occupies board space.
4. **Sub-44px phone touch targets** (Judge 3: 9px-font chips over
   canvas). Fixed: phone board rows and action buttons are ≥44px hit
   targets; chips on the phone office strip get enlarged padded hit
   areas and everything a chip does is reachable redundantly from the
   ≥44px board rows and feed. (One-hand-console's touch grammar, §5.)

---

## 2. The one-line direction

A warm, procedurally-drawn late-night office where every desk is a real
agent session: the wall triage board orders real crises by age ×
severity with inline verbs, desk monitors stream real output, fixing a
thing visibly calms the room through six simultaneous channels, and the
whole face survives a DPR-3 iPhone because no layout value ever touches
`devicePixelRatio`.

---

## 3. Screen-by-screen

### 3.1 Desktop (primary canvas)

Top to bottom, left to right:

- **HUD strip** (DOM, always present, never gated): brand · CASH ·
  REP ★ · agent tally (`▶ n · ⚠ n · ✗/■ n`) · **per-wing ⚠ counts**
  (`⌘ MACBOOK ⚠1 · ▣ NEXUS ⚠1` — grafted from mission-control) ·
  office mood chip (`✓ OFFICE: CALM` / `⚠ OFFICE: STRAINED (n)`) ·
  buttons: `＋ DISPATCH` · `▦ SHIFT` · `? HELP` · `◑ GRAYSCALE` ·
  view toggle.
- **The floor** (Canvas 2D world + DOM chip layer): two wings (one per
  machine; a new machine = a new wing = new crisis sources — the
  progression substrate), desks with live monitors, door, coffee
  machine, plants, wall ticker (cash/REP/crises/rate-limit), warm/cool
  global lighting keyed to calm (reinforcement only). Camera: drag to
  pan, wheel to zoom, click desk to focus. **Wing preset buttons**
  (`⌂ FLOOR / ⌘ MACBOOK / ▣ NEXUS`, grafted from isometric-depth) jump
  the camera.
- **Triage board** (DOM paper panel pinned top-left, diegetically the
  office whiteboard): crisis rows ordered by age × severity, each with
  glyph + stage word + live age, the waiting-for line, an **escalation
  forecast** (`▲ FIRE 2:14 → ✱ ALARM at 4:00`, grafted from
  one-hand-console), and inline `✓ APPROVE` / `▸ DESK` verbs. Debris
  rows (`✗ DEBRIS`) with `ACK`. Empty state: `✓ BOARD CLEAR — the
floor is calm.`
- **Over-the-shoulder drawer** (right panel, opens on desk/chip/row
  click): agent name + `[MACHINE]` `[PROVIDER]` tags + state chip;
  the waiting-for block with `✓ APPROVE / ✗ DENY` and the escalation
  forecast; the full live tail with **⏸ PAUSE + "+N NEW WHILE PAUSED"
  counter and near-bottom-only autoscroll** (grafted from
  one-hand-console); footer verbs `⊞ PIN TAIL` · `⊙ FOCUS DESK` ·
  `■ STOP` · `✗ KILL` (two-tap confirm; kill leaves debris).
- **Pinned-tail dock** (bottom strip over the floor, desktop only,
  grafted from isometric-depth): **exactly 3 slots**. Pinning a 4th
  rejects with `⚠ DOCK FULL — unpin one first`. Each slot: agent name,
  state glyph+word, last tail lines, ✕ unpin; click promotes to the
  drawer. The 3-slot budget is a deliberate attention-scarcity
  decision, not a rendering limit.
- **Shift scorecard** (`▦ SHIFT` overlay, diegetically the back-office
  wall report — grafted from mission-control): crises cleared, mean
  time-to-unblock, clears per 10k tokens, debris acked, ★ REP earned,
  bounced approvals, and a letter grade. Measures the actual
  20-sessions/day job; rewards low burn per clear, never volume.
- **Dispatch slip** (paper overlay): machine + worker (CLAUDE / CODEX /
  GEMINI) + task, with **estimated burn shown BEFORE send** and the
  line "efficiency & completion earn — volume never does" (grafted
  from mission-control; the base's static note under-delivered here).
  Dispatched runners walk in through the door and stream from their
  first line. Real dispatch = gated per-machine runner (2xx +
  `permissionDecision:"deny"`, never open exec) per GAMIFICATION-BRIEF
  mechanic 6b.
- **Help overlay** (`? HELP` button + `?` key): the full signal
  vocabulary table, where the data comes from, what each mechanic
  rewards. Grows with each shipped mechanic; passes grayscale itself.
- **Boot state**: blueprint skeleton + staged `✓` lines
  (`CONNECTING TO FLOOR`) — loading is visually distinct from broken
  by construction.

### 3.2 Phone (≤700px real breakpoint = full-bleed; framed preview on desktop toggle)

Vertical stack, one-hand monitoring, zero office editing:

1. **Compact HUD** — same stats and the same `? HELP` / `◑ GRAYSCALE`
   buttons (never hidden on phone; this is the exact isometric-depth
   flag, not carried).
2. **Office strip** (fixed-fit camera, ~280px): the whole floor at a
   glance — smoke/fire/beacon silhouettes and inverted chips read
   peripherally. No free camera play; 390px triage beats 390px
   sightseeing. Chips have enlarged tap areas; every chip action is
   redundantly reachable from the board below.
3. **Triage board** (scrollable, rows ≥44px): same rows, same inline
   `✓ APPROVE` / `▸ DESK` verbs, same escalation forecasts — a
   4-minute ALARM is answerable from a grocery line without opening
   anything.
4. **FLOOR FEED** (remaining height): all desks' tails merged into one
   live `[agent-name]`-prefixed stream with near-bottom-only
   autoscroll. Glance strip → scan board → watch chatter.
5. **Bottom-sheet drawer** (64% height): same header/waiting-for/tail/
   verbs as desktop, including ⏸ PAUSE + counter. On the phone the
   tail IS the detail view.

Crisis-first-screen default: the strip + board are both above the fold,
board carrying the verbs — pending Greg's answer to gate question 2.

**Invariant (tested, not aspirational): the phone surface fully
functions with the canvas dead.** Board, feed, drawer, dispatch, kill
are all DOM; the strip is garnish. This is Judge 3's graft and becomes
a permanent test (§6).

---

## 4. Streaming surface — the deliberate home

Three nested diegetic depths, one mental model ("look over the agent's
shoulder"), plus a persistence budget:

- **AMBIENT** — every desk monitor renders that agent's real last tail
  lines at world scale; blinking caret while WORKING; `■ NO SIGNAL` /
  `✗ CRASHED` when dead. Zoom in and literally read the screen.
- **FOCUSED** — the over-the-shoulder drawer (desktop right panel /
  phone bottom sheet): full scrolling tail with timestamps, ⏸ PAUSE
  with `+N NEW WHILE PAUSED`, near-bottom-only autoscroll, waiting-for
  block with inline verbs.
- **PERSISTENT** — the desktop 3-slot pinned-tail dock: monitoring
  without commitment, explicit scarcity.
- **AGGREGATE (phone)** — the FLOOR FEED merged stream.

Dispatched runners stream into all of these from their first line —
dispatch and tail share one home. All surfaces are driven by the same
`tailSubscribe`/`tailUnsubscribe` + `outputChunk` lifecycle over the
existing `core/asyncapi.yaml` contract; one ring buffer per agent
(cap ~200 lines) fans out to every mounted surface.

---

## 5. Grafts — what came from which runner-up

| Graft                                                               | Source                    | Judge(s)   | Where it lands                                  |
| ------------------------------------------------------------------- | ------------------------- | ---------- | ----------------------------------------------- |
| Shift scorecard (cleared, MTU, clears/10k tok, debris acked, grade) | mission-control           | J1, J2, J3 | `▦ SHIFT` overlay, diegetic back-office report  |
| Per-machine ⚠ counts in HUD                                         | mission-control           | J2         | HUD `⌘ ⚠n · ▣ ⚠n`                               |
| Est. burn shown BEFORE send + anti-volume copy                      | mission-control           | J2         | Dispatch slip, live per machine/provider        |
| Two-verb crisis card (peek vs commit) → inline board verbs          | isometric-depth           | J1, J2     | `✓ APPROVE` / `▸ DESK` on every board row       |
| 3-slot pinned-tail dock with hard DOCK FULL rejection               | isometric-depth           | J1, J2, J3 | Desktop bottom dock + drawer `⊞ PIN TAIL`       |
| Per-wing camera presets                                             | isometric-depth           | J2         | `⌂ FLOOR / ⌘ MACBOOK / ▣ NEXUS` buttons         |
| ✱ ESCALATION toast on live stage change                             | isometric-depth           | J1         | Already in base; kept and labeled               |
| Tail ⏸ PAUSE + `+N NEW WHILE PAUSED` + near-bottom autoscroll       | one-hand-console          | J1, J2, J3 | Drawer + floor feed                             |
| Escalation forecast line (`→ ✱ ALARM at 4:00`)                      | one-hand-console          | J1, J2     | Board rows + drawer waiting-for block           |
| 44px+ touch grammar                                                 | one-hand-console          | J2, J3     | All phone rows/buttons; enlarged chip hit areas |
| Canvas-dead phone invariant as a permanent test                     | one-hand-console (via J3) | J3         | §6 test plan                                    |

## 5b. Rejected — and why

- **Mission-control's console-first layout** (office as 132px strip):
  loses the inhabitable place and principles 4/5; the judges' totals
  say the sim-led frame wins. Its triage/tails architecture arrives as
  grafts instead.
- **Mission-control's phone ambient ribbon** with color-only calm
  figures: the panel's only hue-carried state distinction — a
  hard-rule-1 near-breach. Not carried in any form; the synthesis phone
  strip keeps full glyph+word chips.
- **Isometric-depth's SVG scene**: solid engineering, but its floor had
  no characters (emergence was prose), and living-office's Canvas 2D
  already satisfies every forensics constraint with characters
  implemented. Two rendering stacks is one too many.
- **Isometric-depth's phone HELP/GRAYSCALE hiding**: hard requirement
  breach (help reachable at all times); the synthesis keeps both
  buttons in the phone HUD.
- **One-hand-console's no-office phone**: the strip earns its ~280px —
  peripheral silhouette reading (beacon/fire shapes) is the fastest
  "how bad is it" signal on the panel; the console's virtues arrive as
  touch grammar + pause mechanics instead.
- **Fake unlock/progression mockups** (all concepts declined; kept
  declined): wings-as-unlockable-territory is the honest substrate —
  new machine = new wing = new crisis sources. Faking unlock theater
  in the mockup would be completion theater.
- **One-hand-console's decorative bezel on real phones**: the synthesis
  uses the base's real-breakpoint rule — framed preview only when
  toggled from a large screen, full-bleed layout on an actual phone.

---

## 6. Rendering tech (decision + forensics constraints as REQUIREMENTS)

**Decision: Canvas 2D world + DOM text layer. No WebGL, no Pixi, no
sprite/asset pipeline.** The world (floor, desks, characters, smoke/
fire/beacon, lighting) is procedural per-frame; all text signals
(chips, board, tails, HUD) are DOM positioned via the world→screen
transform — crisp, selectable, accessible at any zoom. Canvas 2D also
sidesteps WebGL context-loss-on-background, simplifying PWA reconnect.

The MOBILE-FORENSICS constraints are binding REQUIREMENTS on the build,
not guidance:

1. **REQ-R1 — Zoom is fit-to-view math, never DPR.** Camera zoom =
   `min(cssW/mapW, cssH/mapH) × margin`, computed only from viewport
   vs map size. `devicePixelRatio` MUST NOT appear in any layout- or
   framing-affecting expression (the exact `toolUtils.ts:29` class that
   blanked the old face).
2. **REQ-R2 — Backing-store resolution = `min(devicePixelRatio, 2)`**,
   applied only as a GPU-side sampling multiplier via `setTransform`.
   Layout never sees DPR. DPR-3 costs at most 4× fill, never 9×.
3. **REQ-R3 — No eager full-catalog push.** There are no assets: first
   paint needs only agent states + last tail lines (<30KB over the
   existing WS). Sprites/furniture/effects are ~0KB procedural draws.
4. **REQ-R4 — Loading state ≠ broken state.** Boot renders a visually
   distinct blueprint skeleton (`◐ CONNECTING TO FLOOR` + staged ✓
   lines). A blank canvas is never a legitimate state.
5. **REQ-R5 — Permanent DPR-3 regression test, in WebKit.** CI-visible
   e2e asserting non-blank canvas content + interactive board at
   390×664 `deviceScaleFactor: 3` in **Playwright WebKit** (Chromium
   iPhone emulation is the documented false-pass config). Includes the
   canvas-dead invariant: with the canvas element removed, phone board/
   feed/drawer/dispatch/kill still function.
6. **REQ-R6 — SW update strategy is a deliberate decision** (prompt-to-
   reload vs `skipWaiting`), decided in Phase 3, not inherited from
   `autoUpdate`'s default.
7. **REQ-R7 — Real-iPhone acceptance** in Phase 4 regardless of clean
   WebKit-on-Mac runs (per forensics §6).

Epistemics: the concept mockups' "verified via WebKit this session"
claims are REPORTED (Judge 3 found no smoke scripts checked into
`mockups-v3/`); what is VERIFIED by judges is the source itself —
resolution caps, fit-to-view math, absence of DPR references, boot
states. REQ-R5 exists precisely to convert that into a permanent,
re-runnable check.

---

## 7. Colorblind vocabulary (deuteranopia-safe, shape + word first)

Primary signal is always GLYPH + UPPERCASE WORD as real text. Loudness
is encoded by INVERSION (cream-on-black flip) + MOTION (blink, flicker,
rotation), never hue. Color exists only as warm/cool lighting and
accent reinforcement. `◑ GRAYSCALE` button (desktop AND phone) proves
the whole app in one click; the help overlay documents the table and
passes grayscale itself.

| Glyph + word                                      | Meaning                                    | Non-color loudness channel                               |
| ------------------------------------------------- | ------------------------------------------ | -------------------------------------------------------- |
| `▶ WORKING`                                       | agent typing; monitor streams              | desk-lamp pool (reinforcement only)                      |
| `⚠ NEEDS INPUT`                                   | loudest chip                               | inverted + blinking glyph; agent paces                   |
| `✓ DONE`                                          | finished                                   | lamp dims, agent relaxes                                 |
| `✗ FAILED`                                        | leaves labeled debris                      | debris silhouette + board row                            |
| `■ STOPPED`                                       | stopped/killed                             | monitor shows `■ NO SIGNAL`                              |
| `○ IDLE`                                          | present, no work                           | drifts to coffee machine                                 |
| `⏸ PAUSED`                                        | budget pause / tail pause                  | reason on wall ticker; `+N NEW` counter                  |
| `≋ SMOKE`                                         | crisis <1:30                               | rising wisp silhouettes                                  |
| `▲ FIRE`                                          | crisis 1:30–4:00                           | flickering triangle + `!`; forecast line                 |
| `✱ ALARM`                                         | crisis >4:00                               | inverted chip + rotating beacon rays; inverted board row |
| `✗ DEBRIS`                                        | unacked failure                            | pile silhouette + `ACK` verb                             |
| `[MACBOOK]/[NEXUS]` · `[CLAUDE]/[CODEX]/[GEMINI]` | machine/provider                           | bracketed TEXT tags, never color                         |
| `⌘ / ▣`                                           | wing glyphs (HUD counts, presets, plaques) | glyph + wing name text                                   |
| `✓ OFFICE: CALM` / `⚠ OFFICE: STRAINED (n)`       | room mood                                  | labeled HUD chip; lighting is reinforcement              |

Real thresholds from `crisis.ts`: FIRE at 90s, ALARM at 240s.

---

## 8. Economy honesty (hard rule 3)

- REP is earned for measured-fast unblocks (MTU tiers ★5/★3/★1) and
  completions. Bounced approvals claw back. Debris ACK earns nothing —
  it only stops the bleeding.
- The shift scorecard's efficiency axis is clears per 10k tokens —
  LOW burn per completion grades up; nothing anywhere rewards spend or
  session volume.
- Dispatch shows estimated burn before send. The rate-limit meter on
  the wall ticker is informational, never a target.

---

## 9. Questions for Greg at the gate (max 3)

1. **Sound** (carried from GAMIFICATION-BRIEF #3, still open): appetite
   for light office ambience / an alarm chirp when a crisis hits ✱, or
   keep it fully silent?
2. **Phone crisis default** (carried from DESIGN-BRIEF-V3 #2, now with
   a proposal): the synthesis puts strip + triage board above the fold
   with inline verbs — when a push notification lands, is board-first
   right, or do you want it to deep-link straight into the blocked
   agent's tail sheet?
3. **Expression/editor** (carried from DESIGN-BRIEF-V3 #3): synthesis
   ships the office as a persistent viewable place with NO layout
   editor (both viewports); editing arrives later as a desktop-only
   lever. Acceptable for v1, or is decor/layout editing a launch
   requirement?

---

## 10. Review artifact

Open `.planning/v2/mockups-v3/synthesis.html` in a browser. Toggle
`⇄ VIEW`, hit `◑ GRAYSCALE`, watch the 2:14 FIRE escalate to ✱ ALARM
at 4:00 live, approve one crisis from the board and one from the
drawer, pin three tails then try a fourth, open `▦ SHIFT`, and dispatch
a runner — every judged mechanic above is interactive.
