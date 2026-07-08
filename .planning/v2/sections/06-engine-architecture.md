# 06 — Engine Port & Technical Architecture

Grounded in the real v0.5 repo (`/Users/greg/code/war-room`, branch `war-room/v1`, HEAD at go-live commits `24d3286`…`36098d5`, gates: server 329/329, webview 158/158, bin 63/63). Every decision below names the file/pattern it extends or replaces.

## ASSUMES (for the critique pass to reconcile against other sections)

1. **Economy numbers are owned elsewhere.** Cash/Reputation accrual formulas, employee trait derivation thresholds, and room/furniture buff magnitudes are placeholders here (labeled `PROVISIONAL`) — the Economy and Employees sections own the real tuning. I only fix the _shape_ (schema, tick cadence, persistence) needed so the engine can be built without waiting on final numbers.
2. **Rate-limit headroom source is unconfirmed.** I assume the automation budget guardrail reads (a) Claude Code's local session/usage state (5h + weekly windows) via whatever surface Anthropic exposes locally (files under `~/.claude/` or `claude usage`-style output — **not yet verified to exist in a scriptable form**) and (b) `bin/dispatch-runner.mjs`'s own `~/.pixel-agents/dispatch-audit.jsonl` as the ground truth for _codex_ ChatGPT-plan spend (we already log every dispatch there). If Claude Code has no local scriptable usage surface, the automation-pause feature degrades to codex-only headroom tracking — flag this back to whichever section owns COMMAND/automation.
3. **Employee identity model is provisional.** I assume one `Employee` record per (machine, folderName) pair persists across sessions (an employee is "the person who works on project X on machine Y"), separate from the ephemeral `Character` (a live Claude/codex session sitting at a desk _right now_). Multiple concurrent `Character`s can map to the same `Employee` (same project, two sessions) — the Employees section may want a different mapping (per named identity across projects); if so, `employeeId` on `Character` (§4 below) is the join point to change, not the render/sim architecture.
4. **PixiJS version:** v8.x (current stable, WebGPU-capable with WebGL fallback, ESM-only, Node ≥18 — matches this repo's `engines.node >=18`).

---

## 1. Engine choice: PixiJS — not Phaser

**Decision: PixiJS v8.** Justification, made against the actual codebase:

- The current renderer is **already architected as a pure-render-function over a pure-sim-state class** — `webview-ui/src/office/engine/officeState.ts` (`OfficeState.update(dt)`, no DOM/canvas references anywhere in the class) feeding `webview-ui/src/office/engine/renderer.ts` (`renderFrame(ctx, ...)`, a pure function taking a Canvas2D context and plain data, returning `{offsetX, offsetY}`). `webview-ui/src/office/components/OfficeCanvas.tsx` wires them together via a hand-rolled `startGameLoop` (`gameLoop.ts`, 36 lines, rAF-based, `update` then `render`).
- **PixiJS is a renderer, not a framework.** It replaces exactly the drawing half (`renderer.ts`'s `ctx.drawImage`/`ctx.fillRect` calls) with a scene graph of `Container`/`Sprite`/`AnimatedSprite`, while `gameLoop.ts` and `officeState.ts` keep their current shapes almost unchanged. This is a **renderer swap**, not a rewrite.
- **Phaser is rejected** because it is opinionated about the game loop, scene lifecycle (`Scene.create/update`), and input — adopting it means reshaping `OfficeState` into Phaser `GameObject`s and giving up the current `update(dt)`-is-pure-and-unit-tested property that 300+ of the existing vitest tests depend on (`webview-ui/test/*.test.ts` imports `OfficeState`/`officeState` functions directly, zero DOM, `environment: 'node'` per `webview-ui/vitest.config.ts`). Phaser also ships ~1.2MB min+gzip vs PixiJS's ~250KB — worse for phone/PWA cold-load.
- PixiJS's federated pointer events (`pointerdown`/`pointermove`/`pointerup`) unify mouse **and** touch under one event model, which directly serves the phone-play requirement.

**What does NOT change:** `OfficeState` stays the single source of sim truth, `update(dt)` stays pure and stays tested exactly as today. Only `renderer.ts` and the imperative parts of `OfficeCanvas.tsx` (canvas ref, resize, input handlers) get rewritten against Pixi's API.

## 2. Scene graph

Replace the single `<canvas>` + 2D context with one `PIXI.Application` (`autoStart: false`, we drive ticking ourselves — see §7 perf budget) mounted into the same container div `OfficeCanvas.tsx` already renders (`containerRef`).

```
app.stage                                   // root, screen-space
├── worldContainer                          // camera: position=offset, scale=zoom
│   ├── floorLayer      (Container, sortableChildren=false)
│   ├── sceneLayer       (Container, sortableChildren=true)  ← walls+furniture+characters+pets, zIndex = zY (same formula as today's ZDrawable.zY in renderer.ts:114-256)
│   ├── bubbleLayer      (Container)         ← speech/heart bubbles, always drawn after sceneLayer
│   ├── crisisLayer      (Container)         ← fire/smoke/debris/extinguish (crisisEffects.ts port)
│   └── editorOverlayLayer (Container)       ← grid, ghost preview, selection box, delete/rotate buttons — screen-space children positioned in world coords but never camera-culled
└── hudLayer (screen-space, NOT inside worldContainer)  ← reserved for future always-on-top screen elements; v1.0 keeps HUD in DOM (ProgressionHUD.tsx etc. stay React/DOM, unchanged)
```

- **`floorLayer` vs `sceneLayer` split** mirrors today's two-pass render (`renderTileGrid` then `renderScene` in `renderer.ts`) — floor tiles never need z-sorting against characters, so keep them in a separate non-sorted layer for a cheap perf win Pixi's sort step doesn't have to touch every frame.
- **z-sort key**: reuse the exact existing formulas unchanged — `CHARACTER_Z_SORT_OFFSET`, `charZY = ch.y + TILE_SIZE/2 + CHARACTER_Z_SORT_OFFSET` (renderer.ts:173), `petZY = pet.y + TILE_SIZE/2` (renderer.ts:240), furniture's own `f.zY`. Set `sprite.zIndex = zY` each frame instead of building the `ZDrawable[]` array and `.sort()`; Pixi's `sortableChildren=true` container does the sort internally (same O(n log n), same visible result).
- **Camera** = `worldContainer.position.set(offsetX, offsetY); worldContainer.scale.set(zoom)`. `offsetX/offsetY` computed with the **same formula** as `renderFrame` (renderer.ts:716-720): `offsetX = floor((canvasWidth - mapW)/2) + round(panX)`. Camera-follow lerp (`OfficeCanvas.tsx:257-280`, `CAMERA_FOLLOW_LERP`/`CAMERA_FOLLOW_SNAP_THRESHOLD`) is unchanged — it only ever wrote to `panRef.current`, which still feeds the same formula.

## 3. Sprite & animation system

- **Texture loading replaces the decode-to-JSON pipeline for the render path.** Today `webview-ui/vite.config.ts`'s `browserMockAssetsPlugin` decodes every PNG to raw pixel JSON (`decoded/characters.json` etc., via `core/src/assets/loader.ts` + `pngDecoder.ts`) so the hand-rolled Canvas2D renderer can build `ImageData`. PixiJS loads PNGs **directly as GPU textures** — `PIXI.Assets.load('/assets/characters/char_0.png')`. Keep `core/src/assets/build.ts`'s `buildFurnitureCatalog`/`buildAssetIndex` (metadata, footprints, animation-frame lists — non-pixel data other consumers like `furnitureCatalog.ts` still need), but the `decoded/*.json` pixel-dump endpoints in `vite.config.ts` become dead code for the renderer and should be deleted once the Pixi renderer ships (smaller dev payload, smaller prod bundle — net bundle effect of adding Pixi is closer to neutral than the ~250KB gzip alone suggests).
- **Per-zoom raster cache is deleted.** `webview-ui/src/office/sprites/spriteCache.ts`'s `getCachedSprite(sprite, zoom)` exists solely because Canvas2D needs a pre-scaled bitmap per zoom level to stay crisp/fast. PixiJS's GPU scaling makes this whole cache (and its zoom-bucket invalidation logic) unnecessary — one `Texture` per sprite, `worldContainer.scale` handles all zoom levels. `getOutlineSprite` (selection/hover outline generation) ports to a Pixi filter (`OutlineFilter` from `pixi-filters`, or a hand-rolled 1px-offset duplicate sprite with `tint` — cheaper, matches the existing "draw the sprite again 1px offset at alpha" technique in renderer.ts:190-208 almost exactly, so port that technique as-is rather than adding a filter dependency).
- **Nearest-neighbor / pixel art scaling**: `gameLoop.ts` sets `ctx.imageSmoothingEnabled = false` every frame (line 11, 24) to keep the pixel art crisp. Pixi equivalent: `PIXI.Texture.source.scaleMode = 'nearest'` set once per texture at load time (or globally via `PIXI.TextureSource.defaultOptions.scaleMode = 'nearest'`) — do this in the asset-loading step, not per-frame.
- **Animation**: character walk/type/idle frame cycling currently lives in `office/engine/characters.ts` (`updateCharacter`, frame index math) driving `renderer.ts`'s manual `drawImage` of the correct frame. Keep `updateCharacter`'s frame-index computation **exactly as-is** (it's pure logic, unit-tested) but have the render step assign `animatedSprite.currentFrame = ch.frame` instead of picking a raw bitmap — i.e. wrap each character's frame set in a `PIXI.AnimatedSprite` built once (textures array from the sprite sheet) and driven by setting `.currentFrame`/`.gotoAndStop(frame)` from the existing `ch.frame` value every render tick. Do **not** use Pixi's built-in autoplay ticker for character animation — `ch.frame`/`ch.frameTimer` stays the single source of truth (sim-driven, not render-driven), same separation of concerns as today.
- **Furniture animation frames** (`FURNITURE_ANIM_INTERVAL_SEC`, `getAnimationFrames` in `furnitureCatalog.ts`, `officeState.ts:772-795`'s `rebuildFurnitureInstances`) — same pattern, `OfficeState` still computes which frame/type string is active; the Pixi layer just swaps which `Sprite`'s texture is displayed (or which of N pre-built sprites is visible) rather than recomputing a full `FurnitureInstance[]` array via `layoutToFurnitureInstances`. Consider caching one `Sprite` per placed furniture item (not rebuilding the array every animation tick as today's `rebuildFurnitureInstances` does) — this is a genuine perf improvement PixiJS enables (mutate `.texture` in place instead of reallocating).

## 4. Input: desktop + phone/touch

`OfficeCanvas.tsx` currently hand-rolls every input path off raw DOM mouse events (`handleMouseMove/Down/Up/Click/Wheel/ContextMenu`, `screenToWorld`/`screenToTile` coordinate math, manual circle hit-tests for delete/rotate buttons at renderer.ts:640-651). Port plan:

- Set `app.stage.eventMode = 'static'`, `app.stage.hitArea = app.screen`. Use Pixi's federated events (`pointerdown`, `pointermove`, `pointerup`, `pointertap`, `pointerupoutside`) which **fire identically for mouse, touch, and pen** — this collapses the desktop/phone code fork rather than requiring a separate touch handler tree.
- **Coordinate conversion**: replace `screenToWorld`'s manual DPR math with `worldContainer.toLocal(event.global)` — Pixi handles devicePixelRatio internally when `resolution` is set correctly (see §6 responsive/PWA). Keep `screenToTile` as a thin wrapper: `floor(local.x / TILE_SIZE)`.
- **Click/tap → agent selection**: same `getCharacterAt(worldX, worldY)` hit-test logic in `officeState.ts:1213-1232` is reused verbatim (it's pure, sim-side) — only the caller changes from a raw `onClick` DOM handler to a Pixi `pointertap` listener on `sceneLayer`.
- **Desktop-only interactions get an explicit touch equivalent, not a silent drop:**
  - Middle-mouse pan (`handleMouseDown` button===1) → **two-finger drag** on touch (track two active pointer IDs, average delta). New: `isPanningRef` logic generalizes from "middle button" to "≥2 active pointers, none over a UI hit target."
  - `Ctrl+wheel` zoom (`handleWheel`) → **pinch gesture**: track distance between two pointer IDs, `zoomDelta = (newDist - prevDist) / PINCH_ZOOM_SENSITIVITY_PX` (new constant, tune ≈ 80px per zoom step to start, alongside existing `ZOOM_SCROLL_THRESHOLD`), same `ZOOM_MIN`/`ZOOM_MAX` clamp (`constants.ts`).
  - Plain trackpad/wheel pan → **one-finger drag** on touch (already the natural mapping — single active pointer moves `panRef.current` exactly like the existing wheel-pan branch).
  - Right-click erase / walk-to-tile (`handleContextMenu`) → **long-press** (touch-and-hold ≥500ms without movement) triggers the same action as right-click; implement via a `setTimeout` armed on `pointerdown`, cleared on `pointermove`-beyond-threshold or `pointerup`.
- **Hit-testing for delete/rotate buttons** (`hitTestDeleteButton`/`hitTestRotateButton`, circle-radius math against `deleteButtonBoundsRef`) — port as-is; these become Pixi `Graphics` objects with their own `eventMode='static'` and a native `hitArea = new PIXI.Circle(0,0,radius)`, letting Pixi's hit-test replace the manual `dx*dx+dy*dy <= r*r` check (same math, Pixi does it internally now).
- **CSS**: add `touch-action: none` on the canvas container (currently just `className="block"` on the `<canvas>` in `OfficeCanvas.tsx:875-886`) so the browser doesn't hijack pan/pinch as a page-zoom/scroll gesture — required for phone play to work at all.

## 5. Responsive / PWA for phone

- `resizeCanvas` (`OfficeCanvas.tsx:103-114`) already does `ResizeObserver`-driven backing-store sizing off `container.getBoundingClientRect()` and `devicePixelRatio` — this pattern **stays**, just retargeted: `app.renderer.resize(cssWidth, cssHeight)` with `app.renderer.resolution = window.devicePixelRatio || 1` set once at `Application.init()` (Pixi handles the DPR backing-store math internally instead of the manual `canvas.width = round(rect.width * dpr)`).
- **PWA**: add `vite-plugin-pwa` to `webview-ui/vite.config.ts`'s plugin list (alongside `tailwindcss()`, `react()`, `browserMockAssetsPlugin()`). Concrete manifest additions needed under `webview-ui/public/`: `manifest.json` (`display: "standalone"`, `orientation: "any"` — office view should work portrait or landscape), new app icons (192/512px — **art task, not engine task**, generate via the gpt-image-2 pipeline, §8). Service worker precaches the built JS/CSS/asset-index but **not** the WS connection or live telemetry — offline phone opens show the last-rendered office frozen with a `⚠ OFFLINE — showing last sync HH:MM` banner (colorblind-safe text label, matches the existing `⚠ STALE` pattern already used in `ShiftPanel.tsx`).
- **Layout**: the existing DOM overlay panels (`BottomToolbar`, `ProgressionHUD`, `TriagePanel`, etc.) are plain React/CSS (Tailwind) siblings of the canvas, not inside it — they already benefit from normal responsive CSS. Phone-specific work is bottom-sheet/collapsible variants of these panels (a UI/UX-section concern, not engine) — the engine section's job is only to guarantee the canvas itself resizes correctly and touch input works underneath whatever panel layout the UI section designs.

## 6. Server-authoritative sim: what's new

**Principle (matches existing `progressionStore.ts` precedent — server-side, one user many screens, survives cache clears): the new economy/employee/office-life sim is server-authoritative, not client-simulated.** The client is a renderer of server state, same relationship the client already has to `progressionStore`/`shiftStats`/`dispatchStore`.

### 6.1 New server module: `server/src/economyEngine.ts`

Mirrors `progressionStore.ts`'s exact shape (constructor takes optional persist path, `ensureLoaded()`/lazy load, throttled `persist()`, `onChange()` listener list, `VITEST` guard against clobbering the real file in tests):

```ts
interface EconomyData {
  schemaVersion: 1; // NEW — none of the legacy stores have this; start clean
  cash: number; // PROVISIONAL formula, Economy section owns tuning
  reputation: number;
  lastTickAt: number; // epoch ms — anchors offline-progress calc
  employees: Record<string, EmployeeRecord>; // keyed by employeeId (see §6.3)
  rooms: RoomRecord[];
  standingOrders: StandingOrderRecord[];
  eventLog: OfficeEventRecord[]; // capped ring buffer, last 50
}
```

Persists to `~/.pixel-agents/economy.json` (same `LAYOUT_FILE_DIR` constant as every other store — `server/src/constants.ts`). **One file, not several** — keeps the "file-backed stores" pattern's blast radius small (one `fs.readFileSync` failure mode to reason about, matching `progressionStore.ts`'s own doc-comment rationale).

### 6.2 Tick cadence: hybrid, not a running simulation loop

**Decision: no server-side `setInterval` tick loop running the full sim every N seconds while nothing is happening — compute-on-demand instead.** Rationale: this is a single-user always-on-but-idle-most-of-the-time app; a naive `setInterval(tick, 60_000)` running forever burns a wakeup every minute for a system that's usually not being watched. Instead:

1. **On every real event that already flows through the system** (turn completed, crisis resolved, shift day closed — the exact same hooks `progressionStore.recordTurnEnd`/`recordCrisisResolved`/`recordShiftDayClosed` already receive from `pollStateHandler.ts`/`shiftStats.ts`), also call into `economyEngine` to award Cash/Reputation deltas (PROVISIONAL: same shape as `XP_TURN_COMPLETED = 5` — e.g. `CASH_PER_TURN = 2`, `REP_PER_LEAN_DAY = 5`). This piggybacks on wiring that already exists — no new telemetry surface needed for the "real work earns currency" half.
2. **On WS client connect** (`registerWebSocketRoute` in `httpServer.ts:339-442`, where `progressionUpdate`/`dispatchUpdate` already get an initial replay send), compute **offline progress in one jump**: `elapsedMs = now - economy.lastTickAt`; apply mood/morale/grime decay functions of `elapsedMs` (PROVISIONAL linear decay, e.g. `moraleDelta = -elapsedMs / MS_PER_MORALE_POINT`, clamped) to every employee and room; roll for any day-boundary random events that fell inside the gap (max one event per **calendar day** skipped, not one per elapsed hour, to keep a week-long absence from generating a week of events); set `lastTickAt = now`; broadcast `economyUpdate`.
3. **A cheap `setInterval` only while ≥1 socket is connected** (mirrors the existing `startPollStateSweep`/dispatch sweep-timer pattern — `httpServer.ts:191-193`, `239-241` — both already do `app.addHook('onClose', () => clearInterval(...))`), at a coarse cadence (**PROVISIONAL: 5 min**) to keep morale/grime visibly ticking down during a long live session without waiting for a reconnect. Stop the timer when the last socket disconnects (no polling into the void).

This gives "sim runs freely between real events" (offline progress, §6.2.2) **and** "check-in idle loop" cadence (5-min live ticks) without an always-on background loop when nobody's watching.

### 6.3 Employee schema (provisional — Employees section may revise)

```ts
interface EmployeeRecord {
  employeeId: string; // `${machine}:${folderName}` — see ASSUMES #3
  displayName: string; // fictional flavor name, generated once, stable
  hireDate: string; // YYYY-MM-DD
  level: number;
  xp: number; // per-employee XP, separate from global progression XP
  traits: string[]; // derived, e.g. 'fast' | 'sloppy' | 'night-owl' — computed from real behavior stats below, not player-assigned
  stats: {
    turnsCompleted: number;
    avgTurnDurationMs: number;
    nightTurnFraction: number; // fraction of turns completed 22:00–06:00 local
    leanDayRate: number; // fraction of that employee's shift-days graded LEAN
  };
  mood: number; // 0-100, decays over time (§6.2.2), restored by 'break'/room buffs
  assignedRoomId: string | null;
  status: 'working' | 'on_break' | 'quit' | 'retired';
}
```

`traits` are **recomputed from `stats` on every tick**, never hand-set — this is the "traits DERIVED from real behavior" requirement made literal: e.g. `avgTurnDurationMs < FAST_THRESHOLD_MS → 'fast'`, `nightTurnFraction > 0.3 → 'night-owl'`. Thresholds PROVISIONAL, Employees section's job.

### 6.4 New WS messages

**Must be added to `core/asyncapi.yaml`** (`components.messages` + the `receiveServerMessage`/`sendClientMessage` operations at lines 48-61) and regenerated via the existing `npm run asyncapi:generate` (`scripts/generate-messages.ts`) — **never hand-write the TS message types**, that pipeline is the existing contract-generation step and every current message (`agentCreated`, `progressionUpdate`, `dispatchUpdate`, etc.) already goes through it.

New server→client messages (discriminated on `type`, same convention as `progressionUpdate`):

- `economyUpdate` — `{ type, cash, reputation, employees: EmployeeRecord[], rooms: RoomRecord[] }` (full snapshot, broadcast on every mutation — economy state is small, snapshot-broadcast is simpler than diffing and matches `progressionUpdate`'s existing full-snapshot approach)
- `officeEventFired` — `{ type, eventId, kind: 'coffee_run' | 'birthday' | 'power_surge' | 'inspection' | 'rival_poach' | ..., at, employeeIds: number[], flavorText: string }` — flavor-only, never carries real money/deadline data (STANDING HARD RULE: fictional flavor only)
- `standingOrderUpdate` — `{ type, orders: StandingOrderRecord[] }`
- `automationBudgetUpdate` — `{ type, provider: 'claude' | 'codex', windowLabel: '5h' | 'weekly' | 'plan', usedFraction: number, paused: boolean }` — feeds the BUDGET GUARDRAIL; `paused` flips true when `usedFraction` crosses a threshold (PROVISIONAL 0.9) and standing orders stop firing until it drops

New client→server messages: `hireEmployee`, `assignEmployee { employeeId, roomId }`, `trainEmployee { employeeId }`, `fireEmployee { employeeId }`, `createStandingOrder {...}`, `placeRoom {...}` — same shape convention as the existing `saveAgentSeats`/dispatch client messages already handled in `clientMessageHandler.ts`.

### 6.5 What is explicitly NOT new / stays exactly as-is

Fastify (`httpServer.ts`), `AgentStateStore` (`agentStateStore.ts`), hook ingest (`hookEventHandler.ts`, `providers/hook/claude/*`), `dispatchStore.ts` + dispatch runner chain (`bin/dispatch-runner.mjs`, `bin/lib/dispatch-rules.mjs`), `FileStateAdapter`/`configPersistence.ts`, `progressionStore.ts`/`shiftStats.ts` (economy is additive alongside these, not a replacement — XP/level/streak keep meaning what they mean today; Cash/Reputation are a parallel currency layer, not a rename), the telemetry plane (poller/coworker-adapter/hooks), `core/asyncapi.yaml`'s existing message set, the `~/.pixel-agents/*.json` file-store convention itself.

## 7. Perf budget — always-on second screen

Current implementation runs `requestAnimationFrame` unconditionally at display refresh rate (`gameLoop.ts:30`, no visibility check, no idle throttle) with a full canvas `clearRect` + full redraw every frame regardless of whether anything moved. This is the thing most likely to visibly regress (fan noise, battery drain) once art gets "HUGE visual upgrade" — set explicit budgets now:

- **Ticker control**: drive `PIXI.Ticker` manually (`app.ticker.autoStart = false`), default `app.ticker.maxFPS = 30`. Bump to 60 only while ≥1 character has `state === WALK` or a matrix-spawn/despawn/crisis effect is mid-animation (cheap check already computable from `OfficeState`); drop back to 30 the instant nothing is animating.
- **Visibility throttle**: `document.addEventListener('visibilitychange', ...)` → when hidden (tab backgrounded, which is the common "second screen but not looking at it" case), drop to `maxFPS = 2` (just enough to keep sim-time-dependent visuals from jumping on return) instead of fully stopping the ticker (stopping entirely would let WS message backlog build up rendering assumptions — keep ticking slowly instead).
- **Numeric targets** (M2 Mac Mini / M-series MacBook, Chrome/Safari): steady-state CPU **≤3% single core** when the office is idle (no active agents, no crisis, camera static); **≤15%** during a burst (crowd gathering, multiple crisis fires, celebration effects). GPU texture memory **≤80MB** budget for all loaded sprite sheets (current raw PNG asset set is well under 5MB uncompressed — plenty of headroom for the "HUGE visual upgrade," but re-check after new art lands before committing to more simultaneous on-screen animated employees than the office can hold).
- **Sprite count ceiling**: office grid is small (current default layout, tens of tiles per side) — no need for `@pixi/tilemap`'s batched-tile-rendering plugin; plain per-tile `Sprite` objects in `floorLayer` are fine at this scale (dozens to low hundreds of sprites, far under Pixi's practical single-batch ceiling of several thousand). Re-evaluate only if BUILDING mode's floor-space expansion pushes grids past ~100×100 tiles.
- **Network**: WS message volume is unchanged by this port (telemetry ingest rate is what it is); the new `economyUpdate` full-snapshot broadcast is small (few KB, infrequent — bounded by the 5-min tick + real-event triggers, not per-frame) and won't be a bottleneck.

## 8. Test strategy

**Hold the existing boundary exactly: pure sim/logic is unit-tested, rendering is not — and the new economy code must obey the same boundary.**

- `OfficeState` (`webview-ui/src/office/engine/officeState.ts`) and its siblings (`decor.ts`, `crisis.ts`, `layoutSerializer.ts`, `tileMap.ts`) have **zero imports of canvas/DOM/Pixi** and are tested under `webview-ui/vitest.config.ts` (`environment: 'node'`, `include: ['test/*.test.ts']`) — this pattern is why 158 webview tests run fast with no jsdom overhead. **New economy/employee client-mirror code must follow the identical rule**: any new `webview-ui/src/office/engine/economyState.ts` (client-side read-only mirror of server `economyUpdate` snapshots) must import nothing from `renderer.ts` or `pixi.js`, so it stays testable the same way.
- **Server-side**: `economyEngine.ts` follows `progressionStore.ts`'s exact test pattern (`server/__tests__/progressionStoreTest-style`: construct with an explicit temp persist path, exercise `recordX`/tick methods directly, assert on `getSnapshot()` — no HTTP, no WS). Offline-progress-calc (§6.2.2) is the single highest-value new pure function to test exhaustively: given `(lastTickAt, now, employees[])` → deterministic decay/event output, fully unit-testable with fixed clock inputs, no real time dependency (same style as `progressionStore.test.ts`'s date-math tests around `daysBetween`).
- **PixiJS-touching code is explicitly out of the automated-test surface**, matching current practice — `renderer.ts` has no dedicated unit tests today either (it's exercised indirectly through manual verification + the `.planning/evidence/*.png` screenshot record, e.g. `v1-crisis-stages-grayscale.png`). Keep doing exactly that for the Pixi renderer: screenshot-driven manual verification, not pixel-diff automation, for v1.0. If a future milestone wants automated visual regression, that's a new, explicitly-scoped decision — not assumed here.
- **`tsconfig.node.json` DOM-lib gap (as flagged in-brief) — confirmed real, scope it correctly:** `webview-ui/tsconfig.node.json` sets `"lib": ["ES2023"]` (no `DOM`) and its `include` is `["vite.config.ts", "../core/src/assets/**/*.ts", "test/**/*.ts"]` — meaning **every file under `webview-ui/test/`** is type-checked against a no-DOM lib set. This works today only because every existing test file avoids DOM types (plain objects, `Map`, `Date`, `JSON`). **New pure-logic test files (economy, employee, offline-progress) must keep obeying this constraint** — no `HTMLCanvasElement`, no `document`, no importing anything that transitively imports Pixi. This is a lint-by-convention rule, not tsconfig-enforced (nothing currently greps for violations) — **new hard rule for the build agents: before adding a test file under `webview-ui/test/`, run `cd webview-ui && npx tsc -b tsconfig.node.json` and confirm it still passes; a DOM-typed leak here fails silently as a _build_ error, not a test failure, and is easy to miss.** Do **not** attempt to fix the gap by adding `DOM` to `tsconfig.node.json`'s lib — that's out of scope for this port and risks masking the exact separation this section is protecting.
- Any test that genuinely needs to mount a Pixi `Application` (e.g. testing texture-load wiring) is **out of v1.0 scope** — no `tsconfig.dom-test.json`/jsdom setup is being added. Manual verification only for the render layer, same as today.

## 9. Bundle / build implications

- `webview-ui/package.json`: add `"pixi.js": "^8"` to `dependencies`. Approx +250KB gzip to the JS bundle — offset by **removing** the `decoded/*.json` pixel-dump build step (`vite.config.ts`'s `closeBundle` hook + the four `decoded/*` dev middleware routes) once the Pixi renderer ships, since Pixi loads PNGs directly. Net bundle delta: roughly neutral, possibly smaller.
- `vite.config.ts` structure is unchanged — `browserMockAssetsPlugin` keeps serving `furniture-catalog.json`/`asset-index.json` (metadata other consumers, e.g. the editor's furniture picker, still need) but the `decoded/{characters,floors,walls,furniture}.json` routes and their `DecodedCache` become dead code to delete post-port.
- `webview-ui/tsconfig.app.json` already has `"lib": ["ES2022", "DOM", "DOM.Iterable"]` — sufficient for Pixi's browser API usage (Canvas, WebGL context, ResizeObserver), no tsconfig change needed there.
- PWA: add `vite-plugin-pwa` as a new devDependency + plugin entry in `vite.config.ts`'s `plugins: [tailwindcss(), react(), browserMockAssetsPlugin(), VitePWA({...})]`. New static assets needed: `manifest.json`, 192/512px icons (art task, §5).
- `npm run build:webview` (root `package.json`, unchanged script) still works — `vite build` in `webview-ui/`, output to `../dist/webview` — no path changes required.

## 10. Milestones (file-level, for autonomous Sonnet execution)

1. **M0 — Pixi scaffold, no visual change.** Add `pixi.js` dep. New `webview-ui/src/office/engine/pixiRenderer.ts` replacing `renderer.ts`'s render calls one-for-one (floor tiles, furniture, characters, no bubbles/crisis yet). Wire into `OfficeCanvas.tsx` behind the existing `startGameLoop` shape (or a Pixi-native ticker with the same `update`/`render` callback signature so the diff is small). **Verify:** `npm run test` (webview) still 158/158 green (no sim logic touched); manual screenshot compared against `.planning/evidence/v1-all-clear.png` for visual parity.
2. **M1 — Full render parity + input port.** Bubbles, crisis effects, matrix spawn/despawn, editor overlays (grid/ghost/selection/delete/rotate). Federated pointer events replace all `handleMouse*` DOM handlers; touch pinch/pan/long-press added. **Verify:** every existing manual interaction (select agent, drag furniture in edit mode, right-click walk-to-tile) works via mouse AND via Chrome DevTools touch emulation.
3. **M2 — PWA + phone responsive.** `vite-plugin-pwa`, manifest, touch-action CSS, DPR/resolution correctness on a real phone (Tailscale to the NEXUS-hosted server, per the tailnet-only rule). **Verify:** load on an actual phone over tailnet, pinch-zoom and pan work, `touch-action: none` prevents page-level scroll hijack.
4. **M3 — `economyEngine.ts` + `economy.json` store + WS messages.** Add to `core/asyncapi.yaml`, run `npm run asyncapi:generate`, implement store per §6.1-6.4, wire into existing `recordTurnEnd`-style call sites. **Verify:** unit tests for offline-progress calc with fixed clock inputs; `npm run check-types` clean; manual WS inspection shows `economyUpdate` broadcasts.
5. **M4 — Client economy mirror + perf throttle.** New `economyState.ts` (client, DOM-free per §8's rule), ticker maxFPS/visibility throttle per §7. **Verify:** `npx tsc -b tsconfig.node.json` passes with new test files in place; CPU profile idle vs burst against the §7 numeric targets.

## Risks

- **Rate-limit headroom (ASSUMES #2) may have no scriptable local source for Claude specifically.** If so, the BUDGET GUARDRAIL's Claude-side pause can only be estimated (e.g. counting dispatch calls against a configured assumed cap) rather than read from ground truth — this weakens the "reads the real rate limits" promise and needs a decision from whoever owns that section before M3 locks its schema.
- **Offline-progress decay math (§6.2.2) is the one place a bug is silent and irreversible** per the operating doctrine — a sign error in the decay formula could zero out morale/reputation on the very first reconnect after a long weekend away, which is exactly the kind of soft-fail-but-recoverable stakes the vision wants, not a punitive surprise. Needs a hard ceiling (e.g. decay never drops mood below some floor per single reconnect-gap, only over many gaps) before it ships.
- **PixiJS v8 is ESM-only and ships WebGPU-first with WebGL fallback** — verify the actual target browsers (NEXUS webview's embedded browser context, phone Safari/Chrome) all get a working fallback; not yet verified against a real device in this pass.

## 3 things most likely to be wrong

1. **The employee identity model (ASSUMES #3, `${machine}:${folderName}` as the join key).** This is a guess to unblock the schema — the Employees section may define identity completely differently (e.g. a named character that follows Greg across projects rather than staying pinned to one folder), which would change `EmployeeRecord.employeeId` and every place that derives it, though not the surrounding architecture.
2. **The "no always-on tick loop, compute-on-demand" cadence (§6.2) trades simplicity for a subtlety**: if `lastTickAt` bookkeeping has an edge case (e.g. server restart between two real-event triggers with no client ever reconnecting to run the catch-up calc), Cash/mood could silently stop accruing for a real gap and nobody notices until a socket connects — worth an explicit "on server startup, if `now - lastTickAt > STARTUP_CATCHUP_THRESHOLD`, run the catch-up calc immediately rather than waiting for the first WS connect" safeguard that isn't spelled out above.
3. **The perf budget numbers in §7 are estimates, not measurements** — no PixiJS build exists yet to profile against; the ≤3%/≤15% CPU and ≤80MB texture targets are reasonable-sounding placeholders that should be re-measured against M1's actual build before being treated as a pass/fail gate.
