# DESIGN BRIEF V3 — the new face (seed for the Phase-1 design panel)

Drafted 2026-07-10. Consumed by KICKOFF-v2.0 Phase 1.2's design workflow.
This brief constrains WHAT the concepts must honor; it deliberately does
NOT pick a visual direction — that is the panel's job and Greg's gate.

## What is being designed

A replacement webview for War Room: the client-side face over the
existing, untouched server plane. Greg's verdict on the current face:
the pixel office "is fine," but he is open to something better that
"aligns closer with the office simulator inspiration" — and it must be
polished, functional, and work thoughtfully on his phone.

## Fixed technical frame (non-negotiable inputs)

- **The contract is `core/asyncapi.yaml`.** The new face is a new
  workspace (e.g. `webview-v3/`) depending only on `core/`, speaking the
  existing ServerMessage/ClientMessage unions plus Phase 2's streaming
  messages (`outputChunk`, `tailSubscribe`/`tailUnsubscribe`). No server
  changes may be assumed beyond KICKOFF-v2.0 Phase 2.
- **Data available to render** (all real, none fake): agent states +
  machine labels (hooks/poller), crises with server-authoritative age,
  dispatch/chain/standing-order lifecycles, economy (Cash, Reputation,
  ledger), employees (moods, ranks, traits, quits), perks, world events,
  budget-pause reasons, kill states — and, new this sprint, live output
  chunks per agent/dispatch.
- **Rendering tech is an open question answered by evidence:**
  MOBILE-FORENSICS.md (Phase 1.1) determines what iOS Safari actually
  tolerates (WebGL context behavior, texture limits, asset pipeline).
  Concepts must state their rendering approach and its mobile story.
  Pixi does not automatically carry over.
- Tailnet-only PWA; installability and reconnect behavior (laptop sleep,
  phone background) are part of the design, not an afterthought.

## Hard rules (violating any = concept disqualified)

1. **Deuteranopia-safe:** every signal is SHAPE + TEXT LABEL first;
   color is reinforcement only; grayscale render must be fully readable.
   The existing signal vocabulary (state chips `⚠ NEEDS INPUT` loudest /
   `▶ WORKING` / `✓ DONE` / `✗ FAILED` / `■ STOPPED` / `○ IDLE`; crisis
   silhouettes SMOKE ≋ / FIRE ▲ / ALARM ✱; debris ✗; pause ⏸) may be
   restyled but its shape+word DISCIPLINE is inviolable.
2. **Never gate real function behind game progress.** Dashboard first,
   game second — every data view reachable regardless of unlocks.
3. **No dark patterns on real money.** Token/cost mechanics reward
   efficiency and completion, never volume.
4. **Desktop-primary; mobile thoughtfully designed and implemented.**
   Mobile surface = monitoring, triage, dispatch, kill, live tail — no
   office editing. Touch targets, viewport scale, and asset loading must
   be first-class on a real iPhone, but desktop is the primary canvas
   and the design driver.
5. **Streaming-native:** watching an agent's live output is a core
   surface with a deliberate home, not a modal bolted onto a drawer.

## The inspiration to score against (GAMIFICATION-BRIEF, verbatim intent)

The fantasy: _watching a sprawling, organized workspace run efficiently,
and making meaningful triage decisions when it doesn't._ The office
gamifies Greg's REAL ops — real agents, real tokens, real gates — never
a fake game bolted on top.

The 7 principles (the panel's scoring rubric, equal weight unless a
concept argues otherwise):

1. Constant supply of interesting decisions (trade-offs, not no-brainers).
2. Multiple concurrent crises, never enough resources (SimCity model).
3. Progression = new levers/mechanics, not new skins.
4. Emergent behavior from cheap interacting rules (Dwarf Fortress).
5. Creative expression — "my office is different from yours," persistent.
6. No single dominant strategy — real life supplies the randomness.
7. Efficient feedback loops — fixing a thing visibly, immediately calms
   the office.

## Where the current face falls short (audit-informed, for the panel)

- Broken on mobile (loads poorly, wrong scale, assets never render).
- No live-output surface at all; remote sessions are status-only.
- Sim depth is thin against principles 4/5/7: crises and economy exist,
  but emergence is minimal, expression is desktop-only furniture
  editing, and "the room visibly calms" is mostly a chip changing.
- The upstream-inherited renderer dictated constraints (bay layout,
  sprite pipeline, editor complexity) the design never chose.

## Panel protocol (Phase 1.2 executes this)

- 3–4 independent concepts from DISTINCT lenses — suggested (not
  binding): _living office sim_ (the sim IS the interface), _mission
  control with sim garnish_ (data-forward, office as ambient layer),
  _isometric depth_ (spatial richness, zoom-to-detail), _one-hand
  console_ (a concept that leads with the phone experience while
  keeping desktop primary).
- Each concept delivers: one-page rationale scored against the rubric,
  a rendering-tech statement grounded in MOBILE-FORENSICS.md, the
  streaming surface's home, the colorblind vocabulary mapping, and an
  interactive HTML mockup (desktop + phone viewport).
- Independent judge panel scores all concepts against the rubric +
  hard rules; synthesis takes the winner and grafts runner-up strengths.
- Output: `.planning/v2/GAME-DESIGN-V3.md` + mockups under
  `.planning/v2/mockups-v3/`. Then the GREG GATE — his pick, in a live
  message, before any Phase-3 code.

## Open questions for Greg (carry into the gate review, max 3)

1. Sound: still unanswered from GAMIFICATION-BRIEF (#3) — appetite for
   light office ambience/alarm chirps, or keep it silent?
2. On the phone, when a crisis fires, what does he want FIRST on screen:
   the office view, the triage board, or the blocked agent's live tail?
3. Does "expression" (principle 5) matter enough to keep a layout/decor
   editor in the new face at parity, or can it ship desktop-view-only
   initially with editing later?
