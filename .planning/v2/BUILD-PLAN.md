# War Room v2 — Autonomous Sonnet Ultracode Build Plan

Status: EXECUTION-READY. Supersedes `.planning/v2/sections/08-milestones-build-plan.md`
wherever they disagree — this document has incorporated every fix from
`GAME-DESIGN.md` §9 (Conflict resolutions). Read `GAME-DESIGN.md` in full
before starting G0; it is the design authority this plan implements.

Grounded at repo HEAD `50f9ef2` (2026-07-08), branch `war-room/v1`:
server 329/329, webview 158/158, bin 63/63, tsc/lint/build clean, dispatch
vertical live + E2E-verified on NEXUS (`:8484`, tailnet-only).

## How to use this document

Each milestone (G0-G6) is self-contained: goal, exact files, pattern
references into the CURRENT repo, verification commands, acceptance
criteria (observable, not "looks right"), an ultracode workflow shape
(sequential vs waves vs worktrees — with the reasoning), a deploy-gate
note, and a literal kickoff prompt you can paste to start that milestone
in a fresh session. **No milestone starts before the previous milestone's
full gate list is green.** This is a strictly linear chain — the repo has
a logged worktree-isolation failure and multiple same-checkout collision
incidents (`.planning/STATE.md`, 2026-07-08 entries); every "wave" below
is a **file-ownership partition run sequentially in one checkout**, not
concurrent agents, except where a milestone explicitly gates on a canary
re-verifying worktree isolation first.

---

## Cross-cutting hard rules (every milestone, not repeated per-G)

1. **Colorblind:** every new UI signal ships shape/glyph + text label.
   Grayscale screenshot required in the acceptance evidence for any
   milestone touching rendering.
2. **No dark patterns on real money:** grep the diff of every milestone
   for new Cash/Reputation/XP award call sites; each must cite an
   OBSERVED real event (turn completed, crisis resolved via real state
   transition, shift grade at real day-close, dispatch exited 0) — never
   token volume, never a bare timer. Required acceptance-criteria line,
   not optional. The one documented exception is the capped
   `flavor_bonus` world event (GAME-DESIGN.md §6.3) — every other hit
   must trace to a real event.
3. **Tailnet-only / gated actions:** no milestone SSHes into NEXUS or
   runs `docker`/`tailscale serve` itself. Every milestone needing a
   NEXUS change updates `.planning/runbooks/nexus-war-room-deploy.sh` and
   stops — Greg runs it. A fresh autonomous session's "Greg authorized
   deploys" from a PRIOR session does not carry over — re-confirm
   explicitly, every milestone, every session.
4. **Git:** atomic commits, conventional-commit + em-dash subject,
   explicit-path staging (never `git add -A`), one commit per file-level
   task group.
5. **Store pattern:** every new server store is its own file in
   `server/src/`, cloning `server/src/progressionStore.ts`'s exact shape
   (lazy `os.homedir()` resolution, `PERSIST_THROTTLE_MS=5_000` throttled
   persist, tolerant JSON load, `onChange()` listener list, `VITEST`
   guard against clobbering the real sidecar in tests). File at
   `~/.pixel-agents/<name>.json`.
6. **WS messages:** added to `core/asyncapi.yaml` FIRST, then
   `npm run asyncapi:generate` — never hand-edit `core/src/messages.ts`.
7. **Budget guardrail (introduced in G3, gates G3+ forever after):** once
   `server/src/budgetStore.ts` exists, every milestone from G3 onward
   that adds an automation/standing-order trigger path MUST route through
   `isAutomationPaused()`. No exceptions.
8. **Every new store, before its first commit, must clone the VITEST
   guard test** from `server/__tests__/progressionStore.test.ts` that
   asserts the real sidecar path is never touched under test.

---

## G0 — Engine Foundation (PixiJS swap-in)

**Goal:** replace the hand-rolled canvas loop/renderer with PixiJS v8
while preserving 100% of existing sim behavior and all existing tests
passing. **This is the only milestone in the plan with zero new
game-design surface** — it's pure infrastructure so every later milestone
renders on the new engine.

### Why PixiJS, not Phaser (settled, not a menu)

`webview-ui/src/office/engine/officeState.ts` is already a pure sim-state
class (no canvas/DOM refs). `renderer.ts` is already a pure function of
state → canvas draw calls. `gameLoop.ts` is a bare 36-line rAF driver.
PixiJS replaces exactly the drawing half (Sprite/AnimatedSprite property
updates instead of `ctx.drawImage`) — a scene-graph swap. Phaser's
opinionated Scene/GameObject lifecycle would fight the existing
state/draw split the 300+ vitest tests depend on, and ships ~5x the
bundle weight (bad for the G6 phone target).

### File-level tasks (execute in order, commit after each)

1. `webview-ui/package.json` — add `pixi.js` v8, pinned exact version, no
   caret. Do NOT add `@pixi/react`, `phaser`, or any physics package.
2. `webview-ui/src/office/engine/pixiApp.ts` **(NEW)** — replaces
   `gameLoop.ts` (a 36-line rAF driver, verified). **Pixi v8 API note:
   construction is async** — `const app = new Application(); await
app.init({ resizeTo: container, antialias: false, roundPixels: true,
backgroundAlpha: 0 })`; the v7 constructor-options form the earlier
   draft showed does not exist in v8. Exposes `start(container,
{ update(dt) })` / `dispose()` mirroring the old `startGameLoop`
   signature (make `start` async or buffer until init resolves — pick one
   and test it). Respects `MAX_DELTA_TIME_SEC` from `constants.ts`
   (verified: `webview-ui/src/constants.ts:181`, value 0.1).
3. `webview-ui/src/office/engine/pixiRenderer.ts` **(NEW, replaces
   renderer.ts)** — one function per draw concern. The REAL current
   function list (verified by grep this session — an earlier draft
   invented names like `drawCharacter` that don't exist):
   `renderTileGrid`, `renderScene`, `renderSeatIndicators`,
   `renderGridOverlay`, `renderGhostBorder`, `renderGhostPreview`,
   `renderSelectionHighlight`, `renderDeleteButton`, `renderRotateButton`,
   `renderBubbles`, `renderPetBubbles`, `renderFrame` — port 1:1.
   Each creates/updates a `PIXI.Sprite`/
   `PIXI.AnimatedSprite` in a per-entity-id `Map`, keyed exactly like
   `officeState.ts` keys characters/furniture/pets. Z-order via
   `Container.sortableChildren=true` + `zIndex` from the EXISTING
   `CHARACTER_Z_SORT_OFFSET`/`OUTLINE_Z_SORT_OFFSET` constants — do not
   invent a new z-order scheme.
4. `webview-ui/src/office/engine/pixiChunkRenderer.ts` — **do NOT build
   this.** GAME-DESIGN.md §9.8 resolved chunk-rendering in favor of
   viewport culling; implement `floorLayer` as plain per-tile
   `PIXI.Sprite`s, skipping any tile outside `camera rect + 1 tile margin`
   (compute in `pixiRenderer.ts`'s floor-draw function, not a separate
   file). Log actual FPS at 4096 tiles fully placed in the closing
   STATE.md entry — only build real chunk-caching later if this number
   is bad.
5. `webview-ui/src/office/sprites/manifestToPixiSpritesheet.ts` **(NEW)**
   — thin adapter reading the EXISTING `manifest.json` shape (furniture +
   characters), producing an in-memory Pixi `Spritesheet` atlas. **Keep
   the manifest.json schema unchanged** — this is a renderer swap, not an
   asset-format migration. Set `scaleMode: 'nearest'` per texture at load
   time (Pixi 8 equivalent of `ctx.imageSmoothingEnabled = false`), never
   per-frame.
6. `webview-ui/src/office/colorize.ts` — **gating sub-task, do not skip:**
   port the existing hue-shift recolor mechanism (`adjustSprite`,
   `hueShiftSprites`) to a Pixi-native equivalent — a `ColorMatrixFilter`
   or a one-time render-to-texture per variant. Verify with a visual
   check that at least 2 distinct hue-shifted character variants still
   render distinctly. **Do not delete `core/src/assets/pngDecoder.ts`'s
   decode-to-JSON pipeline or the `decoded/*.json` dev-middleware routes
   in `vite.config.ts` until this task's replacement is verified working**
   — Employees (G1) and Art (G5) both depend on recolor working.
7. `webview-ui/src/office/components/OfficeCanvas.tsx` — swap the
   `startGameLoop`+`renderer.ts` call site for `pixiApp.ts`+
   `pixiRenderer.ts`. External props/contract (what `App.tsx` passes in)
   unchanged.
8. `webview-ui/src/office/engine/matrixEffect.ts`,
   `webview-ui/src/office/engine/crisisEffects.ts` — port to Pixi
   `ParticleContainer` (many-identical-sprite effects: embers, smoke) or
   plain `Container` otherwise. Same trigger API.
9. Input port: `app.stage.eventMode='static'`, federated pointer events
   (`pointerdown`/`pointermove`/`pointerup`/`pointertap`) replace all
   `handleMouse*` DOM handlers in `OfficeCanvas.tsx`. Desktop-only
   interactions get an explicit touch equivalent (this is prep for G6,
   do it now while touching this code once): middle-mouse pan → 2-finger
   drag; ctrl+wheel zoom → pinch; right-click → long-press (≥500ms).
   `touch-action: none` on the canvas container.
10. Delete `webview-ui/src/office/engine/renderer.ts` and
    `webview-ui/src/office/engine/gameLoop.ts` — **only after** tasks 1-9
    pass the full acceptance list below, twice in a row via a temporary
    `WAR_ROOM_ENGINE=canvas2d|pixi` env flag (`constants.ts`, default
    `pixi`) that lets a regression be bisected by flipping the flag. Last
    commit of G0 removes the flag and the old files together.
11. `webview-ui/test/*` — every existing test importing `renderer.ts`
    directly gets a companion test against `pixiRenderer.ts` with the
    same assertions (not a deletion). New `pixiRenderer.test.ts`.
    **Headless-testing note (corrected): Pixi v8 has NO canvas renderer —
    `@pixi/canvas-renderer` is a v7-only package that will not install
    against pixi.js v8.** Under vitest/jsdom, do not try to boot a real
    renderer: structure `pixiRenderer.ts` so its per-concern functions
    take containers/sprite-maps as arguments and assert on scene-graph
    STATE (children counts, positions, textures keyed, zIndex, visible)
    with `Application`/`Assets` mocked. Pixel-level parity is Playwright
    screenshot territory (acceptance list), not vitest territory. Verify
    the chosen approach compiles+runs on the FIRST test before writing
    the rest.

### Verification commands

```bash
cd /Users/greg/code/war-room
npm run check-types && npm run lint
cd webview-ui && npm test && npm run build && cd ..
cd server && npm test && cd ..
npm run test:poller
npm run build
node scripts/run-e2e.mjs
```

### Acceptance criteria

- `grep -r "engine/renderer\|engine/gameLoop" webview-ui/dist` → empty.
- Screenshot diff vs `.planning/evidence/v1-crisis-stages.png` +
  `-grayscale.png` (same fire/smoke/alarm shapes, same sprites, same
  sound-toggle glyph) — new pair `.planning/evidence/g0-pixi-parity.png`
  / `-grayscale.png`.
- Two distinct hue-shifted character variants visually confirmed distinct
  (recolor pipeline task 6 didn't silently degrade to "always the same
  hue").
- `app.ticker.FPS` ≥50 with 20 simulated characters + 3 simultaneous
  crisis effects (manual check, record in STATE.md).
- FPS at the full 4096-tile (64×64) floor with viewport culling active,
  recorded (informs whether chunking is ever needed later).
- All 4 test suites green at counts ≥ pre-migration (server 329,
  webview 158, bin 63) — a deleted test needs an explicit justification
  in the commit message, never a silent drop.

### Ultracode workflow shape

**Sequential, ONE agent, ONE checkout, no parallelism.** This is a single
connected refactor touching the same file family in order — worktree/
multi-agent splitting here directly repeats the collision incidents
already logged in `.planning/STATE.md` 2026-07-08. Commit after each
numbered task (11 commits). Re-run the full gate list after tasks 3, 6,
and 9 (not just at the end) so a regression is caught near its cause.

### Deploy cadence

**No deploy.** Engine swap is invisible externally until G1+. Verify
locally + existing Playwright E2E only. Do not run
`nexus-war-room-deploy.sh` for G0.

### Kickoff prompt

```
Read .planning/v2/GAME-DESIGN.md in full, then .planning/v2/BUILD-PLAN.md
§G0. Also read .planning/STATE.md's last 3 entries for the worktree-
collision incident record. Work in ONE checkout, no worktrees, no parallel
agents. Execute tasks 1-11 in order, committing after each (conventional-
commit + em-dash, explicit path staging, never git add -A). Re-run
`npm run check-types && npm run lint && npm test` after tasks 3, 6, and 9.
Task 6 (colorize.ts Pixi-native recolor) is a GATE — do not proceed to
task 10 (deleting renderer.ts/gameLoop.ts) until it's verified working,
because Employees (G1) and Art (G5) depend on it. Do not delete
renderer.ts/gameLoop.ts until the WAR_ROOM_ENGINE flag has flipped cleanly
both directions twice. Capture the g0-pixi-parity screenshot pair (color +
grayscale) via the playwright-skill before your final commit. Do not
deploy — stop and report at §G0's acceptance criteria, verbatim, including
the two recorded FPS numbers.
```

---

## G1 — Employees (persistent named characters)

**Goal:** every distinct real work identity (machine + project) becomes a
persistent Employee — traits derived from real behavior, level/mood/needs,
verbs hire/assign/train/promote/break/fire/retire/rehire. Implements
GAME-DESIGN.md §4 exactly — that section is the canonical schema/math,
superseding any earlier draft.

### File-level tasks

1. `core/src/leveling.ts` **(NEW)** — extract `xpForLevel`/`computeLevel`
   from `progressionStore.ts:59-77` into pure, parameterizable functions
   (`LevelCurve { base, step }`). Update `progressionStore.ts` to call
   `computeLevel(xp, {base:100, step:50})` — same numbers, zero behavior
   change. **Verify:** `npx vitest run server/__tests__/progressionStore.test.ts`
   stays 100% green with zero test edits.
2. `server/src/employeeNames.ts` **(NEW)** — 120-name flavor array
   (office-sim, PG), no logic.
3. ~~`server/src/assetLoader.ts` — add `getCharacterCount()`~~ —
   **struck (Fable review): do not touch this file.** It is extension-era
   vscode code (imports `vscode`, used only by `cli.ts`) and exposes no
   character count. Instead: `employeeStore` persists `spriteIndex` as a
   raw id hash; the WEBVIEW resolves the sprite via the real, existing
   `getLoadedCharacterCount()` (`webview-ui/src/office/sprites/
spriteData.ts:51`, falls back to `PALETTE_COUNT = 6`). Never hardcode
   `% 6` on the server.
4. `server/src/employeeStore.ts` **(NEW)** — full store per
   GAME-DESIGN.md §4: `employeeId(machine, projectDir)` (no provider
   component — §9.4), `Employee` record, score formulas (§4.3),
   `computeLevel(xp, {base:60, step:30})` (§4.4), mood/needs tick
   function (§4.5), quit mechanic (mulberry32-seeded, halves XP not
   resets to 1 — §4.5/§9.18), ledger writer at
   `~/.pixel-agents/employee-history/<id>.jsonl` (tail-keep at 5000→2500
   lines).
5. `server/__tests__/employeeStore.test.ts` **(NEW)** — minimum coverage:
   key determinism (same machine+project → same id, regardless of
   provider), score formula boundaries (0/50/100 cases, `MIN_SAMPLES=5`
   gate), quit determinism (fixed seed → fixed outcome, unit test the
   halving math explicitly), ledger rotation at 5000 lines, VITEST-guard
   test cloned from `progressionStore.test.ts`.
6. `core/src/messages.ts` + `core/asyncapi.yaml` — add
   `EmployeeSnapshot`/`EmployeeHired`/`EmployeeQuit` message types. Run
   `npm run asyncapi:generate`.
7. `server/src/httpServer.ts` — 10 routes (2 GET + 8 POST verbs — an
   earlier draft miscounted 9): `GET /api/employees`,
   `GET /api/employees/:id/history?limit=50`,
   `POST /api/employees/:id/{train|promote|break|fire|retire|rehire|assign|onboard}`.
   Mutating verbs return `{ok:false, reason}` on a failed gate (200, not
   4xx — "deny is a decision," matching `dispatchStore`'s posture).
8. Wire `recordTurn`/`recordCrisisResolved` calls into the SAME call
   sites `progression.recordTurnEnd()`/`recordCrisisResolved()` already
   use — verified this session: `server/src/hookEventHandler.ts:705-706`
   (turn end) and `server/src/pollStateHandler.ts:167` (crisis resolved,
   via the `CrisisXpSink` pattern — clone that sink pattern for the
   employee store rather than importing it directly) — add alongside,
   not instead of.
9. `webview-ui/src/office/personaBadges.ts` **(NEW)** — badge table
   (§4.3), same shape/pattern as `STATE_CHIPS` — which lives in
   `webview-ui/src/office/agentState.ts:37` (NOT in `crisis.ts` as an
   earlier draft said; `crisis.ts` owns `CRISIS_STAGES`).
10. `webview-ui/src/components/EmployeeRoster.tsx` **(NEW)** — clones
    `AgentDrawer.tsx`'s layout conventions: name, sprite, rank, level,
    mood (bar as TEXT number + bar, never color-only), badges, verb
    buttons wired to the §7 routes.
11. `webview-ui/src/office/engine/officeState.ts` — characters gain a
    stable `employeeId` FK so the SAME sprite/costume persists across an
    employee's sessions.
12. `webview-ui/src/office/mood.ts` **(NEW)** — BURNED_OUT employees move
    slower (multiply the per-frame walk-speed constant) + droop sprite
    frame; add one value to the existing `CharacterState` enum in
    `office/types.ts`, not a parallel state machine.

### Verification commands

```bash
cd /Users/greg/code/war-room
npx vitest run server/__tests__/progressionStore.test.ts
npx vitest run server/__tests__/employeeStore.test.ts
cd webview-ui && npm test -- EmployeeRoster mood && cd ..
npm run check-types && npm run lint && npm test
```

### Acceptance criteria

- `GET /api/employees` returns a stable-named, id-stable record for a
  REAL observed session — verified by actually running a Claude Code
  turn against the dev server and re-querying, not a fixture-only test.
- Firing an employee removes them from the active list; a fresh session
  from the SAME identity creates a NEW `#`-suffixed record ONLY after a
  fire (blacklisted key) — a fresh session from an identity that merely
  quit (not fired) auto-rehires under the SAME id. Both paths verified
  by a server test (§9.5 — this replaces an earlier, internally
  contradictory acceptance line).
- Trait/badge list changes when synthetic stats crossing a threshold are
  fed in (unit test).
- Sending an employee on break does NOT block a real dispatch to their
  project/machine — verified by an explicit test that dispatches while
  `status='on_break'` and confirms it succeeds (§9.6 hard-rule check,
  required, not optional).
- Screenshot: `.planning/evidence/g1-employee-roster.png` + grayscale,
  mood glyphs legible in both.
- Grep the diff for `token` near any new stat-update call site — every
  hit traces to a real completion/crisis event, never raw usage.

### Ultracode workflow shape

**Two sequential waves, one agent, same checkout, no worktrees.** Wave A
(server, tasks 1-8): self-contained, zero webview files touched. Wave B
(webview, tasks 9-12): starts only after Wave A merges (needs the real
route contract). File-ownership partition substitutes for isolation —
zero overlap — but still run sequentially in one checkout per the
project's proven worktree-failure precedent.

### Deploy cadence

Deployable after Wave B. **Re-confirm deploy authorization explicitly**
— a prior session's yes does not carry over. Kickoff prompt must ask
"deploy G1 now? (y/n)" as a literal gate.

### Kickoff prompt

```
Read GAME-DESIGN.md §4 and BUILD-PLAN.md §G1 in full. Wave A first: tasks
1-8 (leveling.ts extraction + employeeNames + spriteIndex-as-raw-hash per
task 3's struck note (do NOT touch server/src/assetLoader.ts)
+ employeeStore.ts + its test suite + asyncapi messages + httpServer
routes + wiring into the real turn/crisis call sites), server-only, commit
each file group separately. Run cd server && npx vitest run
employeeStore progressionStore. Then Wave B: tasks 9-12
(personaBadges.ts, EmployeeRoster.tsx, officeState.ts employeeId FK,
mood.ts), webview-only. Run cd webview-ui && npm test. Full root npm test +
check-types + lint before declaring done. Verify the break-never-blocks-
dispatch hard rule with an explicit test. Capture g1-employee-roster
screenshot pair. STOP before running nexus-war-room-deploy.sh — ask Greg
explicitly, do not assume the standing deploy authorization carries over
to this session.
```

---

## G2 — Economy + Building

**Goal:** dual currency (Cash/Reputation) from real events only; office
expansion (bays), typed rooms, furniture buffs with Chebyshev adjacency.
Implements GAME-DESIGN.md §3 and §5 exactly — **supersedes the
zone-tier/roomAdjacency design in the old 08 draft entirely** (§9.7).

### File-level tasks

**Wave A — Economy (server only):**

1. `server/src/economyConstants.ts` **(NEW)** — the single numeric
   authority: every constant in GAME-DESIGN.md §3.1/§3.2 as named
   exports (`CASH_PER_TURN=2`, `CASH_PER_CRISIS_RESOLVED=10`,
   `CASH_SHIFT_GRADE={LEAN:100,STEADY:40,HEAVY:0}`,
   `REP_SHIFT_GRADE={LEAN:3,STEADY:1,HEAVY:0}`,
   `REP_STREAK_MILESTONE={d3:10,d7:30,d30:120}`,
   `REP_DECAY_DARK_DAY=1`, `CASH_PER_DISPATCH_EXIT_0=5`,
   `DISPATCH_CASH_DAILY_CAP=50` (anti-farming cap, GAME-DESIGN §3.1 —
   dispatching burns real tokens, so uncapped it would pay for volume),
   etc.) — every other file imports from here, never retypes a number.
2. `server/src/economyStore.ts` **(NEW)** — `cash`, `reputation`,
   `grime` (office-wide 0-100, cosmetic + morale-decay-rate multiplier
   when >70), capped ring-buffer ledger (200 entries,
   `{ts, delta, currency, reason}`). `addCash(amount, reason)`/
   `addReputation(amount, reason)` — both require a `reason` string
   (this IS the anti-dark-pattern grep-test surface). No `setInterval`
   — compute-on-demand per GAME-DESIGN.md §2 (real-event award +
   WS-connect catch-up + 5-min live-only interval, reusing
   `httpServer.ts`'s existing `onClose`-cleared-timer pattern at
   `httpServer.ts:191-193`/`239-241`).
3. Wire `economyStore.addCash/addReputation` into the EXACT same call
   sites `progression.recordTurnEnd/recordCrisisResolved/
recordShiftDayClosed` already use — do not create parallel event
   plumbing.
4. `server/__tests__/economyStore.test.ts` **(NEW)** — every number in
   `economyConstants.ts` asserted literally; HEAVY-grade day pays exactly
   0 in both currencies (never negative); the 11th dispatch exit-0 of a
   local day pays 0 (`DISPATCH_CASH_DAILY_CAP` boundary); offline-
   progress-calc (WS reconnect catch-up) tested with fixed clock inputs,
   capped at 72h.

**Wave B — Building (mixed server + webview LAYOUT files — an earlier
draft mislabeled this "server only"; tasks 5-7 are webview-ui files. The
partition property that matters is intact: zero file overlap with Wave A):** 5. `webview-ui/src/office/types.ts` — add `RoomType`, `PlacedRoom`,
`OfficeLayout.rooms?` (additive, migrates to `[]` like `pets` did). 6. `webview-ui/src/office/layout/layoutSerializer.ts` — `migrateLayout()`
rooms-default block, identical shape to the existing `pets` block. 7. `webview-ui/src/office/layout/furnitureBuffs.ts` **(NEW)** — sidecar
table per GAME-DESIGN.md §5.4 (`FurnitureBuff` interface, per-item
entries, `adjacencyRadius`). Do NOT touch the generated asset
manifest/`buildDynamicCatalog()` pipeline. 8. `server/src/buildingBuffs.ts` **(NEW)** — `computeActiveBuffs()` with
the two merged paths from GAME-DESIGN.md §5.5:
`buffsForDesk(layout, deskUid)` (room-membership + furniture
adjacency, Chebyshev distance, same-type non-stacking, cross-type
stacking capped at `ADJACENCY_AND_ROOM_BONUS_CAP_PCT=40`, **one shared
cap pool**, not two) and `globalBuffs(layout)` (Server Room +10% Cash
requiring furniture inside, Kitchen ×0.85 morale-decay). Point-in-time
reads only, computed server-side at award time — no client-side buff
computation, no cache. 9. New routes (pattern-match `dispatchStore.ts`'s route style; decisions
are 200 `{ok:false, reason}`, never 4xx):

- `POST /api/building/expand`: checks `cash >= 500 * 1.55^n`, debits,
  converts next 4×rows `VOID`→floor, opens a doorway procedurally at
  the shared-wall midpoint, persists via `layoutPersistence.ts`,
  broadcasts `officeExpanded` (add to `asyncapi.yaml` first,
  regenerate).
- `POST /api/building/room`, `POST /api/building/furniture`,
  `POST /api/building/sell` — server-side check-debit(-or-refund)-
  persist-broadcast for every other Cash-costing build action
  (GAME-DESIGN §5.7). **The client never mutates Cash** — this closes
  the draft gap where `editorActions.ts` "debited" locally.
- `GET /api/economy` (full state) + `GET /api/economy/summary`
  (check-in digest per GAME-DESIGN §2) — both read-only.

10. `server/__tests__/buildingBuffs.test.ts` **(NEW)** — room-membership
    buff applies only inside rectangle; adjacency same-type non-stacking;
    adjacency+room cross-type stacking capped at exactly 40% (test the
    boundary, not just "under 40"); Server Room/Kitchen global buffs
    apply without a deskUid.
11. New server test posting `/api/building/expand` twice — asserts cost
    formula `500*1.55^n` exactly, asserts correct 4-col rectangle
    conversion, asserts insufficient-Cash returns a rejection without
    mutating the layout.

**Wave C — Webview (depends on A+B route contracts):** 12. `webview-ui/src/office/types.ts` — `EditTool.ROOM_TAG`,
`EditTool.SELL`. 13. `webview-ui/src/office/editor/editorActions.ts` — room-tag commit
action (validate footprint client-side for instant feedback, then
POST `/api/building/room` and apply the layout change only on
`{ok:true}` — the server owns the debit, task 9) + sell action
(POST `/api/building/sell`; 50% flat refund on furniture/rooms,
no-op-with-toast on bays). 14. `webview-ui/src/office/editor/EditorToolbar.tsx` — room-type palette
(5 buttons, icon+text label, no color-only), sell tool button. 15. `webview-ui/src/components/EconomyHUD.tsx` **(NEW)**, sibling to
`ProgressionHUD.tsx` — Cash (coin glyph+number), Reputation (star
glyph+number), glyph+label always. 16. Floor rendering: viewport-culled per-tile sprites (implemented in
G0's `pixiRenderer.ts` — this wave just exercises it against a fully
expanded 64×64 office and confirms the G0-recorded FPS number still
holds with rooms/furniture buffs layered on).

### Verification commands

```bash
cd server && npm test -- economyStore buildingBuffs && cd ..
npm run test -w webview-ui -- layoutSerializer editorActions EconomyHUD
npm run check-types && npm run lint && npm test && npm run build
```

### Acceptance criteria

- A real completed turn (drive one via the dev server) increases Cash by
  exactly 2 in `GET /api/economy` — before/after API read, not just a
  unit test.
- Purchasing a bay deducts the exact `500*1.55^n` cost; new tiles become
  placeable (screenshot: dashed border + "OWNED"/"LOCKED" text, shape not
  color).
- Tagging a Dev Pit room over a desk with an assigned employee, then
  completing one REAL turn, shows the +15% XP bonus in server
  logs/telemetry — a real observed event, not a unit test alone.
- Adjacency + room buffs stacking is capped at exactly 40% combined (not
  40%+40%=80%) — verified by a boundary test.
- `.planning/evidence/g2-build-mode.png` + grayscale.
- Grep every new award call site for the word "token" — zero hits
  outside comments.

### Ultracode workflow shape

**Three waves, file-partitioned, sequential, one checkout.** Wave A
(economy) and Wave B (building) share zero files — could theoretically
run in parallel worktrees, but per the project's proven worktree-failure
precedent, default to sequential. Wave C depends on both route contracts.

### Deploy cadence

Re-confirm deploy authorization explicitly. **Flag to Greg specifically**
that this milestone changes what "spending" means (real Cash-earning
rates go live) — he should review the rate table in
`economyConstants.ts` before it deploys, not just rubber-stamp yes.

### Kickoff prompt

```
Read GAME-DESIGN.md §3 and §5, and BUILD-PLAN.md §G2, in full. Wave A:
economyConstants.ts + economyStore.ts wired to the existing
shiftStats/progressionStore real-event callbacks, server-only. Wave B:
furnitureBuffs.ts + buildingBuffs.ts (computeActiveBuffs with BOTH
buffsForDesk and globalBuffs paths, ONE shared 40% cap) + the
/api/building/expand route, server-only, no file overlap with Wave A.
Wave C: EconomyHUD + EditorToolbar room-tagging/sell tools, webview,
depends on A+B routes. Grep every new award call site for the word
"token" before your final commit — zero hits allowed outside comments.
Capture g2-build-mode screenshot pair. STOP and explicitly ask Greg to
re-confirm deploy authorization, naming that this milestone changes real
Cash-earning rates and he should review economyConstants.ts first.
```

---

## G3 — Command + Automation

**Goal:** dispatch chains, standing orders, automation perks, and the
real-rate-limit budget guardrail. Implements GAME-DESIGN.md §7 exactly
— **supersedes the old 08 draft's "bolt fields onto dispatchStore, no
perk economy" design** (§9.11), with both of Section 04's own
self-identified correctness bugs pre-fixed (GAME-DESIGN §9.12 — the fixes
live in tasks 1, 3 and 4 below: timeout constant, singleton subscription +
expired-as-terminal, and their named regression tests).

### File-level tasks

**Wave A — Chains:**

1. `server/src/chainStore.ts` **(NEW)** — `ChainDef`/`ChainRun`/
   `ChainStepRun` per GAME-DESIGN.md §7.1. File-backed at
   `~/.pixel-agents/chain-defs.json` + `chain-runs.json`, append-only
   audit `chain-audit.jsonl`. `CHAIN_MAX_STEPS=8`,
   `CHAIN_MAX_CONCURRENT_RUNS=3`, `CHAIN_STEP_TIMEOUT_MS=500_000`
   (**not 900_000 — must be strictly less than `DISPATCH_TTL_MS=600_000`**,
   this is bug-fix #2, get the number right the first time).
2. `server/src/dispatchStore.ts` — add optional `chainRunId?: string;
chainStep?: number` to `DispatchRecord`/`DispatchEnqueueInput`
   (additive, existing tests unaffected).
3. `server/src/chainOrchestrator.ts` **(NEW)** — subscribes to
   `dispatchStore.onUpdate()` via **one server-side singleton call made
   once at process startup** (e.g. in `server.ts`'s bootstrap, NOT inside
   `httpServer.ts`'s per-WebSocket-connection handler — this is bug-fix
   #1, verify by grepping every place `dispatchStore.onUpdate` is called
   and confirming exactly one call site outside the WS route). Algorithm
   per GAME-DESIGN.md §7.1: a step reaching `denied` OR `expired` OR
   (`exited` nonzero without `continueOnError`) fails the run immediately,
   never retries, never advances — treat `expired` identically to
   `denied` (this is the actual bug-fix #2 logic, the timeout number in
   task 1 is the backstop). A step reaching `exited` (0, or
   nonzero+continueOnError) with a next step renders
   `{{stepK.result}}`/`{{stepK.exitCode}}` templates (K < current step
   only, validated at save time) and calls `dispatchStore.enqueue()` —
   the ONLY call site that starts a chain step, going through the same
   runner allowlist as any manual dispatch.
4. `server/__tests__/chainStore.test.ts`,
   `server/__tests__/chainOrchestrator.test.ts` **(NEW)** — unit test a
   3-step chain with `{{step1.result}}` substitution; unit test a denied
   step 2 asserts the run fails and step 3 never enqueues (assert
   `enqueue` call count); unit test an `expired` step 2 asserts the SAME
   fail-immediately behavior (this is the regression test for bug #2);
   unit test that subscribing twice (simulating two WS connections) does
   NOT create two chain-advance handlers (regression test for bug #1 —
   assert enqueue is called exactly once per real step transition even
   with 2 simulated connections open).
5. `webview-ui/src/components/ChainBuilderPanel.tsx`,
   `webview-ui/src/components/ChainTray.tsx` **(NEW)** — same
   glyph+word chip convention as `DispatchTray.tsx`.

**Wave B — Standing orders + templates:** 6. `server/src/standingOrderStore.ts` **(NEW)** — two schedule kinds only
(`daily`, `interval`), no cron parser. Base cap 1 enabled order.
`requiresFirstFireConfirm` gate per GAME-DESIGN.md §7.2.
**Tick wiring (corrected — an earlier draft said "reuse
timerManager.ts's tick primitive", but `timerManager.ts` has no
generic tick: it exports only per-agent waiting/permission timers,
verified by grep):** use the repo's real interval idiom — a
`setInterval(standingOrderTick, 60_000)` registered where the dispatch
TTL sweep already lives, cleared via `app.addHook('onClose', ...)`
(pattern at `server/src/httpServer.ts:238-241`, verified). 7. `server/src/dispatchTemplateStore.ts` **(NEW)** — cap 20 templates. 8. `server/src/employeeStore.ts` (from G1) — no new file, just wire
`resolveEmployeeDefaults()` reading the 4 REAL record fields per
GAME-DESIGN §7.3 as corrected: `machine` (target machine),
`projectDir` (dispatch cwd), `defaultProvider`, `defaultModel` (an
earlier draft named `homeMachine`/`defaultCwd`, which do not exist on
the §4.2 record) at the three call sites: CallModal prefill,
`ChainStepDef.employeeId`, `StandingOrder.employeeId`. Explicit fields
always win over the employee default. 9. `server/__tests__/standingOrderStore.test.ts` **(NEW)** — the `daily`
dedupe guard fires exactly once per local date across repeated 60s
ticks within the same day. 10. `webview-ui/src/components/StandingOrdersPanel.tsx` **(NEW)**.

**Wave C — Budget guardrail:** 11. `~/.claude/statusline.js` — **Greg's own file, outside this repo.**
Flag as a SEPARATE, explicitly-approved edit — never silently
bundled into a repo commit. Add the ~10-line snapshot write to
`~/.pixel-agents/rate-limit-snapshot.json` per GAME-DESIGN.md §7.4.
The script's parse sites are verified real this session:
`data.rate_limits` at statusline.js:353, windows `five_hour` /
`seven_day` each read as `{used_percentage, resets_at}`
(statusline.js:357-366, `resets_at` in Unix SECONDS per the comment
at :174). **Still dump one real stdin payload before writing the
snapshot code** — the parse sites prove the script's expectations,
not what the CLI currently sends. 12. `bin/needs-input-poller.mjs` — read+forward the snapshot file,
tolerant of absence, to `POST /api/budget/report`. 13. `server/src/budgetStore.ts` **(NEW)** — `BudgetSnapshot`,
`BUDGET_STALE_MS=900_000`, `BUDGET_PAUSE_5H_PCT_BASE=70`,
`BUDGET_PAUSE_7D_PCT_BASE=80`, hard ceilings 95/95 (never raised by
any perk). `isAutomationPaused(machine, provider, perkFlags)`. Store
file at `~/.pixel-agents/budget.json` per cross-cutting rule 5 (an
earlier draft said `~/.war-room/budget.json` — that dir is the hook
forwarder's home, not a store home; don't fork the store convention).
Codex heuristic: Greg enters `codexWeeklyMessageCap` once (a config
value, never auto-changed); the store keeps a separate
`codexWeeklyUsed` COUNTER incremented on every codex `exited`
dispatch (the draft's "cap incremented per dispatch" wording was
backwards), reset Monday 00:00 local, rendered with `~`/`est.`
prefix — never the bare `%` the Claude meter gets. 14. `server/src/economyStore.ts` (from G2) — add the 4-perk table
(Second Shift 500, Chain Gang 800, Night Shift Foreman 1500,
Autopilot 2500) as `perkFlags`, read-only-consumed by
`standingOrderStore`/`budgetStore`/`chainStore` — none of those three
talk to the economy store directly, one-way layering. 15. `server/__tests__/budgetStore.test.ts` **(NEW)** — `isAutomationPaused`
returns `paused:true, reason:'stale-snapshot'` when `receivedAt` is
`BUDGET_STALE_MS+1` old; boundary test at exactly threshold (`>=`
pauses). 16. Wire the budget gate into BOTH `chainOrchestrator.ts`'s step-4b logic
AND `standingOrderTick`'s step-3 logic — **never** into a manual
CallModal send (hard rule: manual dispatch is never budget-gated,
only shown the meter as information next to Send). 17. `webview-ui/src/components/CallModal.tsx` — budget meter chip next to
Send (glyph+word, e.g. `5H ~72% fair`), never a disabled state.

### Verification commands

```bash
cd server && npm test -- chainStore chainOrchestrator standingOrderStore \
  dispatchTemplateStore budgetStore dispatchStore && cd ..
cd webview-ui && npm test -- ChainBuilder StandingOrders dispatch && cd ..
npm run check-types && npm run lint && npm test && npm run build
```

### Acceptance criteria

- Live E2E: create a 2-step chain targeting an allowlisted root on a
  real runner; run it; watch step 1 `exited` → step 2 auto-enqueue with
  correctly-substituted prompt → step 2 `exited` → `ChainRun.status ===
'completed'`. Repeat with step 1's target root NOT allowlisted on that
  machine — chain reaches `failed` with the runner's own deny reason
  surfaced, step 2 never appears in the dispatch queue.
- Regression test for bug #1: 2 simulated WS connections open, one real
  step transition fires, `enqueue` called exactly once (not twice).
- Regression test for bug #2: a step reaching `expired` fails the chain
  immediately, same as `denied` — no 5-minute stall.
- Budget pause E2E: hand-edit the Mac-side
  `~/.pixel-agents/rate-limit-snapshot.json` (the file task 11's
  statusline edit writes) so the `five_hour.used_percentage` field reads
  `95` — keep the REAL field names from statusline.js's `rate_limits`
  shape, do not invent a `fiveHourUsedPct` spelling (earlier draft
  drift) — let the poller forward it, then confirm a due standing order
  skips with `lastSkipReason: 'budget-paused'`, `lastFiredAt` unchanged.
- A manual CallModal send succeeds regardless of budget state (never
  gated) — explicit test.
- STATE.md entry explicitly labels the Claude/Codex usage-signal check
  as `verified` or `inferred` per what was actually found this session
  — required line, since G3 gates real spend.

### Ultracode workflow shape

**Three waves, file-partitioned, sequential, one checkout.** Wave A
(chains) touches `dispatchStore.ts` (additive fields only) — Wave B
(standing orders/templates) and Wave C (budget) do not touch it, no
cross-wave collision. Run A, B, C strictly in that order.

### Deploy cadence

Highest-stakes deploy in the whole plan — it can spend real API budget
autonomously. Kickoff prompt must require Greg to explicitly review and
approve the 4 perk costs and the base pause thresholds (70%/80%, hard
ceiling 95%/95%) before first deploy — not a rubber-stamp yes.

### Kickoff prompt

```
Read GAME-DESIGN.md §7 and BUILD-PLAN.md §G3 in full. Wave order: A
chainStore + chainOrchestrator (subscribe via ONE singleton call at
process startup, NOT per-WS-connection — this is a named bug fix, verify
by grepping every dispatchStore.onUpdate call site; treat 'expired'
identically to 'denied' in the fail path; CHAIN_STEP_TIMEOUT_MS=500_000,
strictly less than DISPATCH_TTL_MS=600_000). B standingOrderStore +
dispatchTemplateStore + resolveEmployeeDefaults wiring. C budgetStore —
FIRST dump one real ~/.claude/statusline.js stdin payload to verify the
rate_limits shape before writing the parser; the statusline.js edit itself
is Greg's own file outside this repo, flag it as a separate approval, do
not bundle into a repo commit. Write the two named regression tests (bug
#1: double-subscription doesn't double-enqueue; bug #2: expired status
fails the chain, no stall) explicitly — do not skip them. Sequential, one
checkout. Before requesting deploy, print the perk costs and pause
thresholds and require an explicit "approved" from Greg on those numbers
specifically, separate from the general deploy confirmation.
```

---

## G4 — Missions (Contracts + World Events)

**Goal:** real vault todos/gates become Contracts with Cash/Rep rewards;
game-generated dailies/weeklies; a 12-entry ambient World Event table.
Implements GAME-DESIGN.md §6 exactly — **supersedes the old 08 draft's
flat `50+10/subtask` contractStore** (§9.9), with the fiction/real
glyph-collision bug pre-fixed (GAME-DESIGN §9.16 — the fix lives in Wave
B tasks 7-8 below, not task 3 as an earlier draft said).

### File-level tasks

**Wave A — Contracts:**

1. `server/src/contractStore.ts` **(NEW)** — `Contract` schema per
   GAME-DESIGN.md §6.2 (5 sources, exact payout table, 5 completion
   methods). Derives from `briefingProvider.ts`'s existing todo read —
   piggybacks its existing 60s cache tick, no new poll loop.
2. Dispatch-result fast path: add `contractId?: string` to
   `DispatchRequest`/`DispatchEnqueueInput` in `dispatchStore.ts`, set
   **explicitly by the webview's BRIEFING→DISPATCH prefill action** (a
   first-class field, NOT inferred by string-matching the prompt text —
   this is the fix for a brittleness the original draft flagged in its
   own risk list, §9.10). On terminal `exited`+`exitCode 0`, call
   `contractStore.complete(contractId, 'dispatch-result', now)`.
3. Manual-claim rate limit: `MAX_MANUAL_CLAIMS_PER_DAY = 3` enforced in
   `contractStore.ts`'s claim handler — reject the 4th claim of a local
   day with a clear reason, don't silently no-op.
4. Backlog dedupe: before minting, check both currently-open AND
   completed-in-the-last-7-days contracts for the same normalized
   `sourceKey` (not exact-open-only match) — closes the double-pay risk
   the original draft flagged.
5. `shiftStats.ts` — two more subscriber calls in the existing day-close
   path: `contractStore.mintDaily(now)`, and Mondays only,
   `contractStore.mintWeekly(now)`.
6. `server/__tests__/contractStore.test.ts` **(NEW)** — mint/complete/
   expire coverage, all payout numbers asserted literally; the
   manual-claim rate limit rejects the 4th same-day claim; the backlog
   7-day dedupe lookback is tested explicitly (mint, complete, re-mint
   attempt within 7 days → rejected).

**Wave B — World Events:** 7. `webview-ui/src/office/realGlyphs.ts` **(NEW)** — derives the real
glyph set by importing `crisis.ts`'s stage-glyph map and
`dispatch.ts`'s status-glyph map and unioning them — **never hand-typed**. 8. `server/src/worldEventStore.ts` **(NEW)** — 12-entry weighted table
per GAME-DESIGN.md §6.3, with glyphs reassigned off the collision
found in review: `coffee_run`→`✧`, `client_call`→`⟡`,
`mail_delivery`→`⬡` (moved off `○`, which the real dispatch set
already owns for `EXPIRED`). `flavor_bonus` capped at `+5` total Cash
per local day, tracked independently of `economyStore`'s own caps. 9. `webview-ui/src/components/ui/SignalChip.tsx` **(NEW)** — `real:
   boolean` prop, dashed border + `SIM ·` prefix when false. 10. `webview-ui/test/signalChip.test.ts` **(NEW — note the repo's real
webview test home is `webview-ui/test/`, flat, verified; not a
`src/office/__tests__/` subdir as an earlier draft had it)** —
imports `realGlyphs.ts`'s derived set and the SIM event table's
glyph set, asserts disjoint. This is the actual enforcement
mechanism, not a lint rule — must fail the build if anyone reuses a
real glyph for a sim event, including glyphs added after this
milestone. 11. `webview-ui/src/components/ContractsPanel.tsx` **(NEW)** — mirrors
`TriagePanel.tsx` structure, CLAIM button, employee-assign dropdown
(from G1's roster). 12. `webview-ui/src/office/dayNight.ts` **(NEW)** — `getDayPhase()`,
`getSeason()`, pure functions of `Date.now()`. Wire `ambience.ts`'s
existing "night duck" to `getDayPhase()` instead of any ad hoc check. 13. `server/__tests__/worldEventStore.test.ts` **(NEW)** — weight/gap/cap
enforcement, especially the `+5/day` flavor-Cash ceiling and the
online-only skip for `power_surge`/`power_outage_scare`.

### Verification commands

```bash
cd server && npm test -- contractStore worldEventStore && cd ..
cd webview-ui && npm test -- signalChip ContractsPanel dayNight && cd ..
npm run check-types && npm run lint && npm test && npm run build
```

### Acceptance criteria

- Manual E2E: drop a real todo file with a known "Start now" line into a
  test todo dir, confirm a priority contract mints within one reconcile
  tick; delete the line from the next day's file, confirm
  `todo-disappeared` completion within one tick.
- The 4th manual-claim of a local day is rejected with a clear reason.
- A backlog contract completed and then re-triggered for minting within
  7 days does NOT create a second payable contract.
- `signalChip.test.ts` fails if a SIM glyph is manually changed to match
  a real one (verify this negative case once, then revert).
- No world-event code path touches `economyStore`/`employeeStore` stats
  directly except the single `flavor_bonus` call site — grep the diff.
- `.planning/evidence/g4-missions-world.png` + grayscale.

### Ultracode workflow shape

**Two waves, file-partitioned, sequential, one checkout.** Wave A
(contracts) and Wave B (world events) share no files except both reading
`realGlyphs.ts` (Wave B creates it) — run A then B in that order.

### Deploy cadence

Re-confirm deploy authorization. Flag that contracts read real vault todo
files — confirm the todo directory path/env var is correctly scoped to
Greg's real vault before first deploy, not a test fixture path.

### Kickoff prompt

```
Read GAME-DESIGN.md §6 and BUILD-PLAN.md §G4 in full. Wave A:
contractStore.ts (extends briefingProvider, don't build a second todo
reader) + the explicit contractId field on DispatchRequest (not string-
matching) + MAX_MANUAL_CLAIMS_PER_DAY=3 + 7-day backlog dedupe. Wave B:
realGlyphs.ts (derive the real glyph set from crisis.ts + dispatch.ts,
never hand-type it) + worldEventStore.ts with the corrected SIM glyphs
(coffee_run/client_call/mail_delivery moved off ○) + SignalChip.tsx +
signalChip.test.ts (disjointness enforcement — verify it actually fails
if you deliberately introduce a collision, then revert) + ContractsPanel +
dayNight.ts. Sequential, one checkout. Capture g4-missions-world
screenshot pair. STOP and re-confirm deploy authorization, noting
contracts read real vault todo files — verify the path is Greg's actual
vault, not a fixture.
```

---

## G5 — Art + Living World Polish

**Goal:** animated employees (walk/work/celebrate), room/furniture
sprites, weather particles, mood badges, ambient wander. Implements
GAME-DESIGN.md §8.3 exactly — **corrects the old 08 draft's incompatible
72-generation asset-directory scheme in favor of Section 07's spec**
(§9.15).

### File-level tasks

**Track 1 — World sim polish (code, no art dependency, can start
immediately):**

1. `webview-ui/src/office/world/ambientEvents.ts` **(NEW)** — idle
   employees (no active session, mood ≠ BURNED_OUT) chance to walk to
   Break Room or cluster near a same-project coworker. Ticks off the
   existing `pixiApp`/`gameLoop` update loop, not a new timer.
2. `webview-ui/src/components/WorldEventBanner.tsx` **(NEW)** — renders
   `worldEventStore` broadcasts (from G4) via `SignalChip`, shape+text,
   dismissable.
3. `server/src/calendarStore.ts` **(NEW)** — season mapping (meteorological
   quarters), holiday-week gate (Dec 20-31), zero external calendar reads.

**Track 2 — Art generation (see canary gate before running as a
worktree):**
4a. **PREFLIGHT (gating, added by Fable review — the pipeline's tooling
is NOT ready-to-run):**

- Transport: the verified Diablito path is **Codex CLI `$imagegen` on
  the ChatGPT subscription** (`codex exec --skip-git-repo-check
-s workspace-write -i <anchor.png> < prompt.txt`, waves of 6-9
  parallel jobs — see `/Users/greg/code/Diablito/
SESSION-HANDOFF-2026-07-06.md` §7.3, treat as law). It burns the
  REAL Codex plan limits ~3-5x per image turn — check Codex headroom
  with Greg before each wave; on any rate-limit message stop and
  report, never hammer. The Fal `gpt-image-2` skill is a FALLBACK
  only and its `FAL_KEY` is NOT provisioned (verified absent) —
  provisioning is Greg-only.
- Post-processing tools: `rembg` and `sharp` are NOT installed
  (verified this session). Installing them is a **gated action** —
  ask Greg explicitly before any `pip install`/`npm install`; do not
  bury it in a dependency bump.
  4b. **Read `sections/07-art-pipeline.md` in full — canonical spec for
  Track 2, not a re-derivation — as amended by GAME-DESIGN.md §8.3
  (transport + celebrate/break corrections).** Confirm existing sheet
  frame usage first: the slicing is in
  `webview-ui/src/office/sprites/spriteData.ts:136-152`
  (`getCharacterSprites()`: walk renders `[d[0],d[1],d[2],d[1]]`,
  typing `[d[3],d[4]]`, reading `[d[5],d[6]]` — verified; the earlier
  draft's `grep "typing\["` pattern matches nothing, grep for
  `d\[3\]` instead). Desk-work does **NOT** reuse any wired slot.

5. New sheets, same grid contract as existing `char_N.png` — 112×96,
   3 direction rows × 7 frames of 16×32 (`core/src/assets/
pngDecoder.ts:127-128`, do not resize the frame or the sheet grid):
   `char_N_work.png` (desk-work cycle, its OWN new file),
   `char_N_celebrate.png` (down-row only, 4-frame), for all 6 existing
   palettes (N=0..5). **These sheets do not exist yet in any form**
   (verified — only `char_0..5.png` ship today; an earlier draft claimed
   celebrate/break "already do" this, which is false); each new sheet
   needs its own decoder entry point and webview wiring, never a
   modification of `decodeCharacterPng`.
6. `char_N_break.png` — single-row 112×32 (down only). New decoder
   export `decodeSingleRowCharacterPng(buffer, frameCount)` in
   `core/src/assets/pngDecoder.ts` — **add, do not modify** the existing
   3-row decoder (`dev-assets.test.ts` already covers it; a regression
   there blocks the whole asset pipeline).
7. Room/furniture sprites per Section 07 §3's table: `SERVER_RACK`,
   `CABLE_TRAY`, `ESPRESSO_MACHINE`/`VENDING_MACHINE`, `STANDING_DESK`,
   floor tile variants for Server/Break/War rooms. **Gate on confirming
   2×2 footprint support** (`BIG_MAP_TABLE`) in `tileMap.ts` before
   generating that one asset — code dependency, not just an asset one.
8. Weather particle textures (rain streak, snowflake) — small, cheap,
   via Diablito pipeline, wired as Pixi `ParticleContainer` overlays.
9. Mood/trait badge glyph set (4 mood states + ~7 trait icons from G1's
   badge table).
10. Generation workflow: reference-anchor every batch against the
    existing shipped PNGs, structured JSON prompt, generate large via
    the task-4a transport (Codex `$imagegen` waves of 6-9, budget-aware)
    → `rembg` background removal → `sharp` nearest-neighbor downsample +
    palette-quantize (≤16 colors) → dimension/alpha/grayscale-
    distinctness/decoder-smoke-test QA gate (extend
    `webview-ui/test/dev-assets.test.ts`) → 2 failed regens falls back
    to hue-shift-recoloring an existing sprite, logged explicitly in
    `_progress.md` as `[x] (FALLBACK: recolored <source>)`, never
    silently substituted, never blocks the milestone.

### Verification commands

```bash
cd server && npm test -- calendarStore && cd ..
cd webview-ui && npm test -- ambientEvents WorldEventBanner dev-assets && cd ..
npm run check-types && npm run lint && npm test && npm run build
```

### Acceptance criteria

- Idle-wander and clustering visibly happen in a 5-minute unattended
  observation window (before/after character-position screenshot).
- New animated frames render in-game with zero off-model rejects in the
  art-review gate log (attach to the milestone's STATE.md entry).
- Grep the diff for any world-event code path touching
  `economyStore`/`employeeStore` directly — zero (world events are
  flavor, never a Cash/XP backdoor, except the one documented
  `flavor_bonus` site from G4).
- Every new asset passes the decoder smoke test (extend
  `dev-assets.test.ts`) — an asset that looks right but the loader
  rejects is worse than no asset.
- `.planning/evidence/g5-living-world.png` + grayscale.

### Ultracode workflow shape

**Two parallel tracks, worktree-canary-gated.** Before starting Track 2
in a worktree, run a 2-minute canary: have both tracks touch a scratch
file simultaneously and confirm each worktree's changes survive
independently. **If the canary fails, fall back to sequential-in-one-
checkout** like every other milestone in this plan — do not trust
worktree isolation on the strength of this document alone, the repo has
one logged silent failure.

### Deploy cadence

Re-confirm deploy authorization. Flag the asset-size increase — run
`du -sh webview-ui/dist` before deploying, confirm the NEXUS container's
static-asset serving handles it.

### Kickoff prompt

```
Read GAME-DESIGN.md §8.3 and sections/07-art-pipeline.md (canonical art
spec) and BUILD-PLAN.md §G5 in full. Track 1 (code, this checkout):
ambientEvents.ts, WorldEventBanner.tsx, calendarStore.ts. Track 2 (art,
worktree): FIRST run the 2-minute worktree canary described in §G5 before
trusting isolation; if it fails, do Track 2 sequentially in the main
checkout after Track 1 instead. Track 2 itself: run the task-4a PREFLIGHT
first — transport is Codex $imagegen on the ChatGPT subscription per
/Users/greg/code/Diablito/SESSION-HANDOFF-2026-07-06.md §7.3 (burns real
Codex plan limits 3-5x/turn: confirm headroom with Greg before each wave;
FAL fallback has NO key provisioned; rembg/sharp are NOT installed and
installing them is a gated ask). Then read spriteData.ts:136-152 to
reconfirm the wired frame slots (walk [0,1,2,1]/typing 3-4/reading 5-6,
verified 2026-07-08) — desk-work gets its OWN new sheet, never overwrite
an existing wired slot. QA-gate every asset (dimension/alpha/
grayscale-distinctness/decoder-smoke-test) before accepting, fall back to
hue-shift-recolor after 2 failed regens, log fallbacks explicitly. Gate
BIG_MAP_TABLE (2x2 footprint) on confirming tileMap.ts support first.
Grep the full diff for economyStore/employeeStore touches from world-event
code. Capture g5-living-world screenshot pair. Confirm dist bundle size
before requesting deploy re-confirmation.
```

---

## G6 — Phone / PWA

**Goal:** the tailnet-only web dashboard becomes installable and playable
on phone, for the idle check-in loop.

### File-level tasks

1. `webview-ui/vite.config.ts` — add `vite-plugin-pwa`, manifest
   (`name: "War Room"`, icons 192/512 from G5's art set, `display:
'standalone'`), `NetworkOnly` runtime-caching strategy explicitly for
   `/api/*` and the WS upgrade path — **never cache real data**.
2. `webview-ui/src/index.css` + `App.tsx` — responsive breakpoint pass
   below 640px: side panels (`AgentDrawer`, `EmployeeRoster`,
   `ChainBuilderPanel`, HUDs) collapse into bottom-sheet/tab-bar via
   `Modal.tsx`'s existing primitive, not a new component family.
3. `webview-ui/src/office/engine/touchCamera.ts` **(NEW, ≤50 lines)** —
   pinch/pan wiring on top of G0's already-federated pointer events.
4. Touch targets: audit every button in `BottomToolbar.tsx`,
   `EditorToolbar.tsx`, `ZoomControls.tsx` for ≥44×44px hit area at the
   mobile breakpoint (`MOBILE_BUTTON_MIN_RADIUS` sibling constant).
5. `.planning/runbooks/nexus-war-room-deploy.sh` — add a verification
   step: `curl -s https://${TAILNET_FQDN}:${SERVE_PORT}/manifest.webmanifest`
   returns 200, printed as `[OK]`/`[WARN]` in the existing style.

### Verification commands

```bash
cd webview-ui && npm run build && npx vite preview --port 4321 &
curl -sI http://localhost:4321/manifest.webmanifest | head -1
npm test && cd ..
npm run check-types && npm run lint
```

### Acceptance criteria

- Lighthouse PWA category scores "installable" true.
- Manual device test (Chrome DevTools device toolbar emulation minimum;
  real phone over Tailscale if available) — pan/zoom via touch,
  bottom-sheet panels open/close, no mis-tap between adjacent buttons.
- `/api/*` and WS traffic confirmed NOT served from service-worker cache
  (DevTools Network tab, "from ServiceWorker" column empty) — required
  negative check, since a cached real-data response would silently
  violate the no-fake-real-numbers rule.
- `.planning/evidence/g6-mobile.png` (device-emulated) + grayscale.

### Ultracode workflow shape

**Sequential, one agent, one checkout.** Small, tightly coupled
responsive-CSS + PWA-config milestone — no file partition large enough
to justify wave-splitting overhead.

### Deploy cadence

Re-confirm deploy authorization (lowest-risk deploy in the plan — no new
gameplay/economy logic — but still requires the explicit ask, no
milestone is exempt).

### Kickoff prompt

```
Read BUILD-PLAN.md §G6 in full. Sequential, one checkout. Add
vite-plugin-pwa + manifest config (icons from G5's art set if it landed,
otherwise placeholder squares labeled TEMP), NetworkOnly for /api/ and WS
explicitly configured — verify with a DevTools Network tab check showing
empty "from ServiceWorker" for those requests before considering the task
done. Responsive pass: touchCamera.ts, bottom-sheet panels via Modal.tsx,
44px touch targets. Run a device-emulated Lighthouse PWA check. Capture
g6-mobile screenshot pair. Confirm deploy re-authorization with Greg
before running the runbook.
```

---

## Overall sequencing

```
G0 (seq, 1 agent) → G1 (2 waves, seq) → G2 (3 waves, seq) → G3 (3 waves, seq)
  → G4 (2 waves, seq) → G5 (2 tracks, worktree-canary-gated) → G6 (seq, 1 agent)
```

Strictly linear — no milestone starts before the previous milestone's full
gate list (check-types + lint + test + build + screenshot pair) is green.
The only place this plan risks parallelism is G5's art track, gated on a
canary re-verifying worktree isolation. Every other "multiple waves"
mention is a file-ownership partition run sequentially in one checkout,
never concurrent agents.

## Top risks carried into execution

1. **Budget guardrail's usage-API assumption (G3) may not exist** — verify
   at G3 kickoff whether `claude`/`codex` CLI expose any machine-readable
   quota surface; if not, the rolling-counter fallback (already specced)
   is the safety net, but the "reads real headroom" fidelity is weaker
   than the vision asks. Label `verified`/`inferred` in STATE.md, don't
   guess silently.
2. **Pixi-in-vitest may need a headless fallback** (G0) that behaves
   differently enough from production WebGL that pixel-perfect parity is
   hard to unit-test — leaned on Playwright screenshots for this reason.
3. **Viewport-culling perf at 4096 tiles is unverified until G0/G2 profile
   it** — chunk-rendering is the documented fallback if culling proves
   insufficient, not pre-built speculatively.
4. **Art generation quality/consistency across ~40+ jobs** — budget 2-3x
   the job count in regens; the hue-shift-recolor fallback exists
   precisely because this bet might not fully pay off, and is a
   ship-blocking-free escape hatch by design.
5. **Art generation SPENDS the real Codex plan budget** (G5) — the
   verified transport is the ChatGPT subscription at ~3-5x limit burn
   per image turn; ~40 jobs × 2-3x regens can eat a large slice of a
   weekly window. The Fal fallback has no key provisioned, and
   rembg/sharp are not installed (gated installs). G5's task-4a
   preflight exists because of this — do not skip it.
6. **Every milestone's deploy gate depends on a human re-confirming
   authorization fresh, every session** — a fresh autonomous session must
   not treat a prior session's "yes" as standing consent. This is
   deliberately repeated at every G to prevent silent drift.

---

## Appendix: Fable review deltas (2026-07-08 adversarial pass)

Changes applied by the final Fable review after spot-checking every
load-bearing repo claim against the live checkout (baseline re-verified:
server 329/329, webview 158/158, bin 63/63 all re-run green this session):

1. **G0 task 2** — Pixi v8 uses async `app.init({...})`; the draft showed
   the v7 constructor-options API, which would fail on first run.
2. **G0 task 3** — the draft's renderer function list (`drawCharacter`
   etc.) was invented; replaced with the real exports of
   `engine/renderer.ts` (`renderTileGrid`, `renderScene`, `renderFrame`,
   …) verified by grep.
3. **G0 task 11** — `@pixi/canvas-renderer` is v7-only and does not exist
   for pixi.js v8; replaced with a scene-graph-state testing strategy +
   Playwright for pixels.
4. **G1 task 3** — struck the `assetLoader.getCharacterCount()` plan:
   the file is extension-era vscode code and the count lives in the
   webview (`getLoadedCharacterCount()`, spriteData.ts:51). Server stores
   a raw hash instead.
5. **G1 tasks 7-9** — route count corrected 9→10; real call sites pinned
   (`hookEventHandler.ts:705-706`, `pollStateHandler.ts:167` +
   `CrisisXpSink` pattern); `STATE_CHIPS` correctly attributed to
   `office/agentState.ts:37`, not crisis.ts.
6. **G2** — Wave B relabeled (it is webview files, not "server only");
   added server-side debit routes (`/api/building/room|furniture|sell`,
   `GET /api/economy[/summary]`) so the client never mutates Cash —
   task 13's local "debit cost" would have made real Cash a client-side
   variable; added `DISPATCH_CASH_DAILY_CAP=50` + its boundary test
   (anti-farming, see GAME-DESIGN deltas #5).
7. **G3 task 6** — `timerManager.ts` has no generic tick primitive (only
   per-agent waiting/permission timers, verified); standing-order tick now
   uses the real `setInterval` + `onClose` idiom (httpServer.ts:238-241).
8. **G3 tasks 11/13 + acceptance** — statusline parse sites verified
   (`rate_limits.five_hour/seven_day.{used_percentage, resets_at}`,
   statusline.js:353-366); budget store path unified to
   `~/.pixel-agents/budget.json`; cap-vs-counter wording fixed; the
   budget-pause E2E now edits the real snapshot file with the real field
   names instead of the draft's invented `budget-snapshots.json` /
   `fiveHourUsedPct`.
9. **G4 task 10** — test path corrected to the repo's real
   `webview-ui/test/` convention.
10. **G5** — added gating task 4a (art-pipeline preflight): verified
    primary transport is Codex `$imagegen` on the ChatGPT subscription
    (Diablito handoff §7.3), Fal fallback UNPROVISIONED (no FAL_KEY
    anywhere), `rembg`/`sharp` NOT installed (gated installs). Frame-slot
    grep corrected to the real slicing site (spriteData.ts:136-152);
    celebrate/break sheets marked as new files (none exist — draft
    claimed otherwise). New top-risk #5 records the real-budget cost of
    art generation.
