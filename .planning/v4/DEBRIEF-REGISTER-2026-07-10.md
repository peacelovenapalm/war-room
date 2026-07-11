# v3.1 Acceptance Debrief → v4 Seed Register — 2026-07-10

48-question interactive debrief, conducted after real-device acceptance
PASSED (iPhone + MacBook, Safari + Chrome, deployed b86c7ad). Greg's answers
verbatim-in-spirit; free-text preserved where it changed the decision.
This document seeds the v4 plan the same way KICKOFF-v3.1 §1 seeded v3.

## Headline verdict

The world delights ("it's alive") and acceptance passed — but the tool is a
**viewer, not yet a console**. The pull that would make Greg open it without
a push notification: _"a competent and effective agent orchestration and AI
management solution."_ Console capability gets him to use it; aesthetics and
gamification bring him back. That ordering governs v4.

## Decisions (D-1 … D-48)

### First impressions

- D-1 Gut reaction: **delight — it's alive.**
- D-2 Art: **charming, keep direction** — but "all of the agents are balding
  men lol" → diversity pass required.
- D-3 World/panels split: **blend them harder** — panels should feel IN the
  world.
- D-4 Daily utility: **not yet — missing hooks** (see D-5).

### Hooks + mobile

- D-5 What pulls daily use (multi): **live output streaming, morning-page
  integration, push that deep-links.** (Notably NOT multi-machine.)
- D-6 Phone: **gestures need work** (pinch/pan janky). Feel-bug #2.
- D-7 Staff identity: **identity from real data** — look/behavior derives
  from provider/project/machine so appearance MEANS something.
- D-8 World mood: **fleet state** drives lighting/posture (go further than
  current calm-channels); no time-of-day/weather.

### Surfaces

- D-9 Blending treatments (multi): **speech bubbles = real events** +
  **panels as camera moves** (fly to the prop, panel grows out of it).
  Not chosen: desk-monitor tails, status props (bubbles/camera first).
- D-10 Panel triage: **all ported panels are useful, all need work** (Greg
  verbatim: "all could use work but are useful").
- D-11 Tail view: free-text — _"it still feels in build… wouldn't call it
  functional or as easy as the artifacts you built. there's no tail or pop
  up windows"_ → DEFECT: deployed /v3/ drawer opens with NO live tail
  (root cause known: remote sessions are hooks-only; per-machine tailer
  designed in Phase 2 but never built).
- D-12 HUD: works, BUT — free-text — the game layer _"does not affect the
  way the agents perform. if it notices it is inefficient it should come up
  with ideas to get better in a self healing way"_ → SELF-HEALING is a
  first-class v4 concept.

### Defect probing

- D-13 Tap behavior on deployed: **drawer opens, no tail** (confirms D-11).
- D-14 Empty-world vs UI: **both equally** — feed it real data AND finish
  the interaction layer.
- D-15 Self-healing shape: **all three, as a ladder** — (1) advisor reports
  → (2) one-tap proposed gated actions → (3) auto with guardrails +
  receipts.
- D-16 Artifact-vs-face ease gap: **"the terminal and the interactivity was
  missing."**

### Game loops

- D-17 Match Day: **yes — weekly ritual** (tie to weekly-rollup).
- D-18 Contracts: **fine but shallow** — must connect to what he does next.
- D-19 Crisis pitch: **urgent-arcade** — keep the adrenaline.
- D-20 The pull loop: **"a competent and effective agent orchestration and
  ai management solution"** ← the debrief's headline answer.

### Console capabilities

- D-21 Must-haves (ALL FOUR required): **start sessions from it, answer/
  steer from it, full live visibility, fleet-level controls.**
- D-22 Remote-answer plane: **FUND IT — next sprint.** (Supersedes the
  2026-07-10 "parked" ratification in TUNING.md — Greg re-decided with the
  console framing.)
- D-23 Session launch UX: **both, hire = skin** — one mechanism; the hire
  flow is the pretty entry to the same modal.
- D-24 Effort split: free-text — **"console will get me to use it.
  aesthetic polish and gamification will continue to bring me back"** →
  console leads, aesthetics ride along every sprint.

### Infrastructure

- D-25 Docker: **was just probing** (blank page suspicion, now solved).
  Current shape stands: server dockerized on NEXUS, Mac agents launchd.
- D-26 Daemon trust: **extend existing runner, same deny-by-default rules**
  — per-machine allowlists, every capability opt-in, receipts.
- D-27 Budgets: **the full ladder** — per-dispatch caps, daily fleet
  ceiling, rate-limit awareness (5h/weekly meters), honest display.
- D-28 Mac Mini: **low priority as LLM node** — free-text: repurpose as a
  **compute node for python/non-LLM work** (best processor of the three).

### Aesthetics

- D-29 Sprite pass (multi): **body/hair/skin variety + provider uniforms +
  role outfits** (colorblind-safe: shape+garment, not hue). No seniority
  flair yet.
- D-30 Sound: **full soundscape** — ambience + positional desk sounds +
  mood-reactive music. Make it a feature.
- D-31 Parity priorities: **milestone skyline, decor placement, employee
  roster + verbs.**
- D-32 Onboarding: **legible-by-design first; first-run tour + HELP
  supplement it.**

### Integrations

- D-33 Morning: **War Room IS morning** — the morning push deep-links into
  shift report + briefing; the NEXUS /morning page eventually retires.
- D-34 Vault feeds (ALL FOUR): **daily digest + rollup, project-pulse
  flags, routine PR queue (in-world inbox tray), knowledge graph
  (queryable from a library/search prop).**
- D-35 Projects: **districts = projects** — the city meta becomes real;
  each district IS a project, buildings grow with real milestones.
- D-36 History: **trophy-vault level** — milestones/wins persist,
  operational detail expires.

### Direction

- D-37 Sharing: **revisit commercial later** — and see D-39/D-41: the
  ambition is real now.
- D-38 Tbilisi requirements (ALL): **rock-solid tailnet remote, laptop-
  standalone mode, B2/offsite state backup** + free-text: _"ideally i can
  make and sell this and have this be my saas to support me."_
- D-39 Other dashboards: **feed, don't absorb** + write docs for wiring
  projects in when auto-pickup misses.
- D-40 Anthropic-ships-it test: **keep full stack** — independence
  (consistent with the commercial ambition).

### Commercial

- D-41 Buyer: free-text — **power users AND non-experts** who make money
  with AI but don't know hooks/skills exist. _"I would rather sell the
  shovels than dig for gold myself."_
- D-42 Moat: **honest data + human-usable** (one-tap-real doctrine as
  product).
- D-43 Sequencing: Greg unsure → **resolved as parallel light prep**
  (orchestrator recommendation, accepted): build for Greg, but from v4 on
  make SaaS-compatible choices — auth seams, config isolation, zero
  Greg-hardcoded paths. Multi-tenancy explicitly deferred until real
  users teach the product shape.
- D-44 Wiring docs: **WIRING.md + auto-detect** — doc plus server
  auto-discovery of common shapes (.planning/STATE.md, routine outputs).

### Forced priorities

- D-45 Next sprint mode: free-text — **no mega-burn.** _"Create a detailed
  next version plan and orchestrate it across fable, sonnet, and codex."_
  → v4 is a PLANNED, delegated sprint, not an 8h fiat burn.
- D-46 Non-negotiable top 3: **per-machine live tails, remote-answer
  plane, self-healing advisor v1.**
- D-47 Naming: **rename at OSS moment**; War Room stays the working title.
- D-48 Coverage: **nothing missed.**

## Defects from real-device acceptance (fix in v4, some earlier)

1. **No live tail on deployed /v3/** (D-11/D-13) — per-machine tailer is
   the missing plane; v4 top-3 #1.
2. **Pinch/pan gestures janky on real iPhone** (D-6) — feel-bug, fix early.
3. **Sprite monoculture** ("balding men", D-2) — diversity pass via the
   existing Blender pipeline.

## What v4 planning must produce (per D-45)

A detailed version plan (KICKOFF-v4) with: the top-3 console tracks
(tails / remote-answer / self-healing ladder), aesthetics riding along
(sprites, gestures, bubbles, camera-move panels, soundscape start),
integration track (morning, vault feeds, districts=projects, WIRING.md +
auto-detect), SaaS-compatible seams throughout (D-43), budget-enforcement
ladder (D-27), runner extension under existing deny-by-default rules
(D-26), and Fable/Sonnet/codex delegation lanes per the amended policy.
Remote-answer is a NEW CONTAINMENT SURFACE — it gets its own security
design section before any code.
