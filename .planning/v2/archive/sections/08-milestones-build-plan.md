# 08 — Milestones & the Autonomous Sonnet Ultracode Build Plan

Status: draft for cross-section critique. Grounded against the real repo at
`/Users/greg/code/war-room`, branch `war-room/v1`, HEAD `50f9ef2` (2026-07-08).
All file paths below were verified to exist at that HEAD unless marked `(NEW)`.

---

## ASSUMES (reconcile with other sections)

These are load-bearing guesses this section makes about content owned by
other v2 sections. If those sections land different numbers, the file-level
tasks below still hold — only the constants change.

1. **ASSUMES economy section fixes Cash/Reputation formulas as I've drafted
   them in G2** (base rates: 2 Cash/turn, 10 Cash/crisis-resolved, shift-grade
   bonus 100/40/0 for LEAN/STEADY/HEAVY; Reputation only from streak
   milestones + LEAN-day count, decays 1/day of zero real activity). I
   extended the existing `progressionStore.ts` XP constants (`XP_TURN_COMPLETED
= 5`, `XP_CRISIS_RESOLVED = 15`, `XP_SHIFT_GRADE_BONUS = {LEAN:50,
STEADY:20, HEAVY:0}`) at roughly the same ratios. If the economy section
   defines different numbers, only `server/src/economyStore.ts` constants
   change — no schema/architecture change.
2. **ASSUMES the engine section confirms PixiJS (not Phaser)** — I justify
   the choice in G0 below and design G0's task list around it. If Phaser is
   chosen instead, G0's task list changes (Phaser has an opinionated Scene/
   GameObject model that does NOT map 1:1 to the current hand-rolled
   `officeState.ts`/`renderer.ts` split) but G1–G5's game-logic tasks are
   engine-agnostic and do not change.
3. **ASSUMES the world/art section's asset pipeline is the Diablito
   Codex-`$imagegen` pipeline** (`/Users/greg/code/Diablito/.claude/skills/
gpt-image-2/SKILL.md`, verified working 2026-07-06, ChatGPT-subscription
   cost, no API key) — I reuse its wave-batch pattern (6–9 parallel
   `codex exec` jobs, review gate before saving) in G4. If a different art
   pipeline is chosen there, only G4's asset-generation task changes.
4. **ASSUMES employee identity = the existing agent identity key** (machine
   label + project/cwd, the same tuple `agentStateStore.ts` already uses to
   dedupe sessions) rather than a new identity concept. If the employee
   section defines identity differently (e.g. per-git-author), G1's
   `employeeStore.ts` keying changes but nothing else does.
5. **ASSUMES no fixed map bounds exist today** — grep for `MAP_WIDTH` /
   `GRID_COLS` in `webview-ui/src/office/layout/tileMap.ts` and
   `webview-ui/src/constants.ts` found nothing; the layout appears to be an
   unbounded/dynamic tile map today. G2's "buy floor space" task includes a
   first sub-task to **verify this at kickoff** (`grep -n "bounds\|Width\|
Height" webview-ui/src/office/layout/tileMap.ts`) and derive the actual
   zone-tier numbers from what's found, rather than trusting the guess here.

---

## Locked facts from the repo (verified this session, not guessed)

- **Workspaces:** root `package.json` npm workspaces = `server`, `webview-ui`.
  Root `package.json` itself is the (currently unused-for-v2) VS Code
  extension shell — do not touch its `main`/`bin` fields.
- **Test suites at HEAD `50f9ef2`:** server 329/329 (`cd server && npm test`
  → vitest run), webview 158/158 (`cd webview-ui && npm test`), bin 63/63
  (`npm run test:poller` → `node --test 'bin/test/*.test.mjs'` from root).
  Root `npm test` runs all three in sequence.
- **Type/lint/build gates:** `npm run check-types` (tsc --noEmit twice, root
  - `server/tsconfig.test.json`), `npm run lint` (eslint over
    `adapters/vscode server core` + webview-ui separately), `npm run build`
    (asyncapi:generate → esbuild → webview build).
- **Message contract generation:** `core/asyncapi.yaml` is the source of
  truth; `npm run asyncapi:generate` (`tsx scripts/generate-messages.ts`)
  regenerates `core/src/messages.ts`/`schemas.ts`. Any new WS message type
  (employee hired, room placed, contract accepted, standing order fired,
  etc.) is added to `core/asyncapi.yaml` FIRST, then generated — never
  hand-edit `core/src/messages.ts`.
- **Server store pattern (clone this for every new store):**
  `server/src/progressionStore.ts` (file-backed, `~/.pixel-agents/*.json`,
  5s throttled persistence, lazy-resolved `os.homedir()` for testability,
  pure compute functions exported separately from the stateful store) and
  `server/src/dispatchStore.ts` (same persistence pattern + companion
  append-only JSONL audit log for anything safety-relevant). **Every new
  v2 store (employees, economy, rooms, contracts, standing orders, world
  calendar) is a new file in `server/src/`, same shape, same
  `~/.pixel-agents/<name>.json` convention.**
- **Renderer/engine pattern (what G0 replaces):**
  `webview-ui/src/office/engine/gameLoop.ts` (hand-rolled `requestAnimationFrame`
  loop, `update(dt)` / `render(ctx)` callbacks, `MAX_DELTA_TIME_SEC` clamp),
  `webview-ui/src/office/engine/renderer.ts` (~700+ lines, raw 2D canvas
  draw calls keyed off constants in `webview-ui/src/constants.ts`),
  `webview-ui/src/office/engine/officeState.ts` (1233 lines — the
  authoritative sim state: characters, furniture, seats, crisis debris,
  pets — driven by WS messages via `webview-ui/src/office/agentState.ts`),
  `webview-ui/src/office/components/OfficeCanvas.tsx` (the React
  `<canvas>` host, owns the ref + effect that starts/stops the loop).
- **Build-mode pattern (already exists, G2 extends it, does not invent it):**
  `webview-ui/src/office/layout/furnitureCatalog.ts` (catalog entries with
  category/footprint/rotation groups), `webview-ui/src/office/layout/
tileMap.ts`, `webview-ui/src/office/layout/layoutSerializer.ts`
  (persist/load), `webview-ui/src/office/editor/` (`editorState.ts`,
  `editorActions.ts`, `EditorToolbar.tsx` — placement/rotate/delete UI),
  server-side `server/src/layoutPersistence.ts` (file read/write,
  `~/.pixel-agents/layout.json`).
- **Command/dispatch pattern (G3 extends it):** `server/src/dispatchStore.ts`
  - `bin/dispatch-runner.mjs` + `bin/lib/dispatch-rules.mjs` (deny-by-default
    allowlist, argv-only invocation, realpath containment) + webview
    `webview-ui/src/components/CallModal.tsx` / `DispatchTray.tsx` /
    `webview-ui/src/dispatch.ts`. This is the existing single-shot dispatch
    vertical (`claude -p` / `codex exec`) — G3 adds chaining and standing
    orders ON TOP of it, does not replace it.
- **Coworker/provider pattern (reuse for employee "provider" flavor text):**
  `bin/lib/coworker-map.mjs`, `server/src/providers/index.ts`.
- **Deploy runbook pattern (G-per-milestone deploys clone this):**
  `.planning/runbooks/nexus-war-room-deploy.sh` — gated, `[-y]` flag,
  `[OK]`/`[WARN]` lines, inline undo commands printed at the end, rsync +
  docker + `tailscale serve` (tailnet-only, never funnel).
- **E2E/screenshot tooling:** `scripts/run-e2e.mjs` wraps Playwright
  (`node_modules/playwright/cli.js`); `.planning/evidence/*.png` shows the
  existing convention of a grayscale + color screenshot pair per major
  feature (colorblind proof). New milestones follow this: one color + one
  grayscale screenshot per acceptance criterion that has a visual
  component.

---

## Cross-cutting hard rules (apply to every milestone, not repeated per-G)

- **Colorblind:** every new UI signal (mood icon, Cash/Reputation delta,
  room adjacency glow, contract deadline urgency, standing-order status)
  ships with a shape/glyph + text label. Grayscale screenshot required in
  the acceptance evidence for any milestone that touches rendering.
- **No dark patterns on real money:** grep the diff of every milestone for
  new XP/Cash/Reputation award sites; each one must cite an OBSERVED real
  event (turn completed, crisis resolved via real state transition, shift
  grade at real day-close, dispatch run exited 0) — never token volume,
  never a timer alone. This is a required line in each milestone's
  acceptance criteria, not optional.
- **Tailnet-only / gated actions:** no milestone SSHes into NEXUS or runs
  `docker`/`tailscale serve` itself. Every milestone that needs a NEXUS
  change produces/updates a runbook in `.planning/runbooks/` and stops —
  Greg runs it. "Greg authorized deploys this session" (from the build
  brief) means the ORIGINAL session lead may invoke the existing
  `nexus-war-room-deploy.sh` directly when a milestone finishes and the
  human is present; a fresh autonomous sonnet session must re-confirm this
  authorization explicitly before running it (see "Deploy cadence" per
  milestone below) — do not treat a stale instruction as standing consent.
- **Git:** atomic commits, conventional-commit + em-dash subject, explicit
  path staging (never `git add -A`), one commit per file-level task group.
- **Budget guardrail (G3 introduces the mechanism, but it gates G3+ forever
  after):** once `server/src/budgetGuardrail.ts` exists, every milestone
  from G3 onward that adds an automation/standing-order surface MUST wire
  its trigger path through it. No exceptions, no "just this once" bypass.

---

## G0 — Engine Foundation (PixiJS swap-in)

**Goal:** replace the hand-rolled canvas loop/renderer with PixiJS while
preserving 100% of existing sim behavior (crisis fires, coworkers, decor,
sound, dispatch UI) and all existing tests passing (post-migration test
files may be rewritten, but the FEATURE behavior they assert must not
regress — screenshot diff against `.planning/evidence/v1-*.png` is the
regression oracle).

**Why PixiJS over Phaser (decision, not a menu):** the current architecture
already separates _state_ (`officeState.ts`, a plain-object sim with no
rendering concerns) from _draw_ (`renderer.ts`, a stateless function of
state → canvas calls) from _loop_ (`gameLoop.ts`, a bare rAF driver). PixiJS
is a scene-graph/renderer library with the same shape — a `Container` tree
you mutate and an `Application` ticker — so the state/draw split survives
almost unchanged: `renderer.ts`'s draw calls become Pixi `Sprite`/
`AnimatedSprite` property updates instead of `ctx.drawImage` calls. Phaser
bundles its own Scene lifecycle, physics, input, and asset-loading systems
that would fight the existing `officeState.ts` ownership of truth and the
existing WS-driven state updates (Phaser wants to own the update loop via
its Scene `update()`; we already have one, in `gameLoop.ts`, driven by real
WS events, not a physics step). Verdict: **PixiJS v8**, mounted the same
imperative way the current canvas is (a ref + effect in `OfficeCanvas.tsx`
that creates a `PIXI.Application`, appends its canvas, and disposes on
unmount) — no `@pixi/react` wrapper (it adds a second reconciler on top of
one we don't need; the existing code already proves imperative-canvas-in-a-
React-ref works fine here).

### File-level tasks

1. `webview-ui/package.json` — add `pixi.js` (v8, pinned exact version, no
   caret) as a dependency. Do NOT add `@pixi/react`, `phaser`, or any physics
   package.
2. `webview-ui/src/office/engine/pixiApp.ts` **(NEW)** — replaces
   `gameLoop.ts`'s `startGameLoop`. Creates a `PIXI.Application`
   (`{ resizeTo: canvasContainer, antialias: false, roundPixels: true,
backgroundAlpha: 0 }` — `roundPixels: true` is the Pixi equivalent of the
   existing `ctx.imageSmoothingEnabled = false` pixel-art guarantee, keep
   it). Exposes `start(container: HTMLElement, callbacks: { update(dt): void
})` and a `dispose()`, mirroring the old `startGameLoop` signature so
   `OfficeCanvas.tsx`'s call site changes minimally. Uses
   `app.ticker.add(...)` internally; still respects `MAX_DELTA_TIME_SEC`
   from `webview-ui/src/constants.ts`.
3. `webview-ui/src/office/engine/pixiRenderer.ts` **(NEW, replaces
   `renderer.ts`)** — one function per draw concern, same decomposition as
   today (`drawCharacter`, `drawFurniture`, `drawSeat`, `drawCrisisEffect`,
   `drawGhostPreview`, `drawOverlayGlyph`, etc. — grep `renderer.ts` for the
   full current function list and port 1:1), but each function now
   creates/updates a `PIXI.Sprite` or `PIXI.AnimatedSprite` in a
   per-entity-id `Map` (keyed exactly like `officeState.ts` keys its
   characters/furniture/pets today) instead of issuing draw calls every
   frame. Z-ordering: use Pixi `Container.sortableChildren = true` +
   `zIndex` set from the existing `CHARACTER_Z_SORT_OFFSET` /
   `OUTLINE_Z_SORT_OFFSET` constants — do not invent a new z-order scheme.
4. `webview-ui/src/office/sprites/spriteCache.ts`,
   `webview-ui/src/office/sprites/coworkerSprites.ts`,
   `webview-ui/src/office/sprites/petSpriteData.ts`,
   `webview-ui/src/office/sprites/spriteData.ts` — change the sprite-sheet
   loader from the current PNG-decode-to-canvas approach
   (`webview-ui/src/office/floorTiles.ts`'s `getColorizedFloorSprite`
   pattern, and `core/src/assets/pngDecoder.ts`) to `PIXI.Assets.load` +
   `PIXI.Spritesheet` built from the same `manifest.json` files already in
   `webview-ui/public/assets/furniture/*/manifest.json` and
   `webview-ui/public/assets/characters/`. **Keep the manifest.json schema
   unchanged** — G0 is a renderer swap, not an asset-format migration; write
   a thin adapter (`webview-ui/src/office/sprites/manifestToPixiSpritesheet.ts`
   **(NEW)**) that reads the existing manifest shape and produces a Pixi
   `Spritesheet` atlas definition in memory, so G4's new art (later) can
   just add more manifests in the same shape.
5. `webview-ui/src/office/colorize.ts` — the existing runtime recolor logic
   (used for coworker badge tinting, decor recolor) must be ported to a
   Pixi `ColorMatrixFilter` or manual pixel-tint-to-`Texture` cache — do not
   drop colorblind-safe tinting; it's reinforcement-only already, verify the
   shape/label still renders without the filter applied (filter failure
   must degrade to visible-but-untinted, never invisible).
6. `webview-ui/src/office/components/OfficeCanvas.tsx` — swap the
   `startGameLoop` + `renderer.ts` call site for `pixiApp.ts` +
   `pixiRenderer.ts`. The component's external props/contract (what
   `App.tsx` passes in) do not change.
7. `webview-ui/src/office/engine/matrixEffect.ts`,
   `webview-ui/src/office/engine/crisisEffects.ts` — port particle/overlay
   effects to Pixi `ParticleContainer` where the effect is many identical
   sprites (embers, smoke), plain `Container` otherwise. Keep the same
   trigger API (`officeState.ts` calls into these the same way).
8. Delete `webview-ui/src/office/engine/renderer.ts` and
   `webview-ui/src/office/engine/gameLoop.ts` only after
   `pixiRenderer.ts`/`pixiApp.ts` pass the full acceptance list below — keep
   both old and new side by side under a `WAR_ROOM_ENGINE=canvas2d|pixi` env
   flag (`webview-ui/src/constants.ts` new const,
   default `pixi`) for one milestone so a regression can be bisected by
   flipping the flag, then remove the flag and old files in G0's LAST
   commit once acceptance passes clean twice in a row.
9. `webview-ui/test/*` — every existing test that imports `renderer.ts`
   directly gets a companion test against `pixiRenderer.ts` with the same
   assertions (state → expected visual property), not a deletion. New test
   file `webview-ui/test/pixiRenderer.test.ts` **(NEW)** using Pixi's
   headless/test mode (`PIXI.Application({ ... })` works under jsdom/vitest
   with `pixi.js`'s software fallback — verify this at task start; if Pixi
   requires a real WebGL context unavailable under vitest's jsdom, use
   `@pixi/canvas-renderer` fallback for the test target only, never in
   production build).

### Verification commands

```bash
cd /Users/greg/code/war-room
npm run check-types
npm run lint
cd webview-ui && npm test && npm run build && cd ..
cd server && npm test && cd ..
npm run test:poller
npm run build
node scripts/run-e2e.mjs   # existing Playwright suite, must stay green
```

### Acceptance criteria (observable)

- `npm run build` produces a `webview-ui/dist` bundle with zero references
  to the deleted `renderer.ts`/`gameLoop.ts` (`grep -r "engine/renderer\|engine/gameLoop" webview-ui/dist` returns nothing).
- Screenshot diff: `node scripts/run-e2e.mjs` (or a manual Playwright script
  using the `playwright-skill`) captures the office view at a fixed seed
  state and visually matches `.planning/evidence/v1-crisis-stages.png` and
  `.planning/evidence/v1-crisis-stages-grayscale.png` (same fire/smoke/alarm
  shapes, same character sprites, same sound-toggle glyph) — new pair saved
  as `.planning/evidence/g0-pixi-parity.png` /
  `.planning/evidence/g0-pixi-parity-grayscale.png`.
- FPS/perf: Pixi's `app.ticker.FPS` logged in a dev overlay stays ≥50 with
  20 simulated characters + 3 simultaneous crisis effects (manual check,
  numbers recorded in the milestone's closing STATE.md entry).
- All four test suites green at counts ≥ the pre-migration counts (never
  fewer tests than before — a deleted test is a coverage regression unless
  explicitly justified in the commit message).

### Ultracode workflow shape

**Sequential, ONE agent, ONE checkout — no parallelism.** This milestone is
a single connected refactor (loop → renderer → sprites → colorize → effects
all touch the same files in the same order) — the STATE.md incident log
shows worktree isolation "silently failed once" and three-agents-one-
checkout caused two swallowed-edit incidents in the very same file family
(`shiftStats`/`httpServer`/`helpContent`) this milestone will touch
(`officeState.ts`, sprite files). Splitting G0 across agents/worktrees
multiplies exactly the collision risk already burned once. Run G0 as **one
long-lived Sonnet session, task list in order 1→9**, committing after each
numbered task (9 commits), gates re-run after every 2–3 tasks (not just at
the end) so a regression is caught near its cause.

### Deploy cadence

No deploy this milestone — engine swap is invisible externally until G1+
adds new gameplay. Verify locally + in the existing Playwright E2E only.
Do NOT run `nexus-war-room-deploy.sh` for G0 alone.

### Kickoff prompt draft

```
Read .planning/v2/sections/08-milestones-build-plan.md §G0 in full, then
.planning/STATE.md tail (last 3 entries) for the worktree-collision
incident. Work in ONE checkout, no worktrees, no parallel agents. Execute
tasks 1-9 in order, committing after each. Re-run `npm run check-types &&
npm run lint && npm test` after tasks 3, 6, and 9. Do not delete
renderer.ts/gameLoop.ts until the WAR_ROOM_ENGINE flag has flipped cleanly
both directions twice. Capture the g0-pixi-parity screenshot pair (color +
grayscale) via the playwright-skill before your final commit. Do not
deploy. Stop and report at the acceptance criteria in §G0, verbatim.
```

---

## G1 — Employees (persistent named characters, traits, verbs)

**Goal:** every distinct real work identity (machine + project/cwd tuple,
same key `agentStateStore.ts` already dedupes sessions by) becomes a
persistent Employee record — survives across sessions, has derived traits
from real behavior stats, a per-employee level, mood, and supports the
verbs hire / assign / train / promote / break / fire-retire.

### Employee schema (decision, not a menu)

`server/src/employeeStore.ts` **(NEW)**, file-backed at
`~/.pixel-agents/employees.json`, cloning `progressionStore.ts`'s shape
exactly (lazy homedir resolution, throttled persist, pure compute
functions exported for testing):

```ts
interface Employee {
  id: string; // `${machine}:${projectKey}` — same identity
  // tuple agentStateStore.ts uses today
  name: string; // generated once, stable (see naming below)
  hiredAt: string; // ISO — first-ever observed session for this id
  level: number; // computed from employeeXp via progressionStore's
  // xpForLevel()/computeLevel() — SAME curve, reused
  // function, not reinvented
  employeeXp: number; // separate pool from account-wide progression XP
  mood: 'THRIVING' | 'STEADY' | 'STRESSED' | 'BURNED_OUT'; // derived, not stored raw —
  // recomputed on every read from the stats below
  traits: Trait[]; // derived, recomputed weekly (see below), NOT
  // player-assigned
  stats: {
    turnsCompleted: number;
    crisesResolved: number;
    crisesCaused: number; // a session that went blocked while THIS employee
    // owned it
    avgTurnDurationMs: number; // rolling average
    nightTurnRatio: number; // fraction of turns 22:00-06:00 local
    leanDayCount: number; // shift-grade days this identity contributed to
    lastActiveAt: string;
  };
  assignment: { roomId: string | null; projectKey: string | null };
  status: 'ACTIVE' | 'ON_BREAK' | 'RETIRED' | 'FIRED';
  trainingInProgress: { skill: string; completesAt: string } | null;
}
```

**Trait derivation (pure function, cron-free — recomputed on every stats
update, not on a timer):** `deriveTraits(stats): Trait[]` in
`server/src/employeeTraits.ts` **(NEW)**, thresholds:

- `avgTurnDurationMs < 90_000` → `FAST`; `> 300_000` → `METHODICAL`.
- `crisesCaused / max(turnsCompleted,1) > 0.15` → `SLOPPY`; `< 0.03` and
  `turnsCompleted >= 20` → `STEADY_HANDS`.
- `nightTurnRatio > 0.3` → `NIGHT_OWL`.
- `leanDayCount / max(daysActive,1) > 0.6` → `FRUGAL` (mirrors the
  no-dark-patterns rule: this trait rewards LOW spend, never high volume).
- Traits are a `Set` capped at 3 most-recently-qualified — do not let the
  list grow unbounded; a trait that stops qualifying (stats regress) is
  dropped on next recompute (traits reflect current behavior, not history —
  matches STAKES: "employees can quit and lose level/traits").
- **Naming:** deterministic from id hash into a fixed 60-name list (30 first
  - word-list combinatoric surname, e.g. "Casey Nakamura") in
    `server/src/employeeNames.ts` **(NEW)** — no LLM call, no external API,
    stable across restarts (same id always yields same name).

### Verbs (server routes + webview actions)

`server/src/httpServer.ts` gets 6 new authed routes (clone the existing
dispatch routes' auth/response-shape pattern from `dispatchStore.ts`'s
`server/__tests__/dispatchRoutes.test.ts` for the contract style):

- `POST /api/employees/:id/assign` `{ roomId }` — no-op until G2 rooms exist;
  build the route now, wire the room FK validation in G2.
- `POST /api/employees/:id/train` `{ skill }` — spends Cash (economy dep,
  G2); STUB in G1 to always 402 "economy not yet live" until G2 lands, but
  ship the route shape now so G2 only adds the Cash-check, not new plumbing.
- `POST /api/employees/:id/promote` — no-op gate until level threshold
  exists (level ≥ 5 required, already computable from `employeeXp` in G1
  alone) — this one IS fully functional in G1.
- `POST /api/employees/:id/break` `{ hours }` — sets `status: 'ON_BREAK'`
  until `now + hours`; a break employee's mood recovers 2x faster (numbers
  live in `server/src/employeeMood.ts` **(NEW)**).
- `POST /api/employees/:id/retire` and `.../fire` — both set `status`
  terminal; `retire` keeps traits/level in a read-only "alumni" list (`GET
/api/employees?status=RETIRED`), `fire` does not (matches STAKES:
  neglect → can quit and LOSE level/traits — firing is the harsher,
  deliberate version of the same loss).
- `GET /api/employees` — list, same WS-broadcast-on-change pattern as
  `agentStateStore.ts`'s `AgentCreated`/`AgentPidUpdate` messages: add
  `EmployeeUpdated` to `core/asyncapi.yaml`, regenerate.

### Webview

- `webview-ui/src/components/EmployeeRoster.tsx` **(NEW)** — clones
  `webview-ui/src/components/AgentDrawer.tsx`'s layout conventions (text
  rows, shape+label state) for a roster list: name, level, mood glyph
  (☀ THRIVING / ➖ STEADY / ⚠ STRESSED / ☠ BURNED_OUT — shape+word, no
  color-only), trait chips, assign/train/promote/break/fire buttons.
- `webview-ui/src/office/engine/officeState.ts` — characters gain an
  `employeeId` FK (currently characters are ephemeral per-session; make the
  mapping id-stable so the SAME sprite/costume persists across the
  employee's sessions — this is what makes them feel "the same person").
- Mood → visible office behavior wired into `webview-ui/src/office/crisis.ts`
  equivalent for mood (`webview-ui/src/office/mood.ts` **(NEW)**): BURNED_OUT
  employees move slower (multiply per-frame walk speed constant) and show a
  droop sprite frame — reuse the existing character sprite-state enum
  (`CharacterState` in `webview-ui/src/office/types.ts`) by adding one new
  value, not a parallel state machine.

### Verification commands

```bash
cd server && npm test -- employeeStore employeeTraits employeeMood && cd ..
cd webview-ui && npm test -- EmployeeRoster mood && cd ..
npm run check-types && npm run lint
npm test   # full suite, root
```

### Acceptance criteria

- `GET /api/employees` returns a stable-named, id-stable employee record
  for a real observed session (verified by actually running a Claude Code
  turn against the dev server and re-querying — not a fixture-only test).
- Firing an employee via the roster UI removes them from the active list
  and a fresh session from the same identity creates a NEW employee record
  (fire is real, not soft-hidden) — verified by a server test that fires
  then re-observes the same id.
- Trait list changes when synthetic stats crossing a threshold are fed in
  (unit test, not manual).
- Screenshot: `.planning/evidence/g1-employee-roster.png` +
  `-grayscale.png`, mood glyphs legible in both.
- No XP/Cash/trait ever derived from token count — grep the diff for `token`
  near any of the new stat-update call sites; every hit must trace to a
  real completion/crisis event, never raw usage.

### Ultracode workflow shape

**Two sequential waves, one agent per wave, same checkout (no worktrees).**
Wave A (server): `employeeStore.ts`, `employeeTraits.ts`, `employeeNames.ts`,
`employeeMood.ts`, httpServer routes, asyncapi additions — self-contained,
touches no webview files. Wave B (webview): `EmployeeRoster.tsx`,
`officeState.ts` employeeId FK, `mood.ts` — starts only after Wave A merges
(needs the real route contract, not a guess). This is the file-ownership
partition that substitutes for worktree isolation: Wave A owns
`server/src/*`, Wave B owns `webview-ui/src/*` — zero file overlap, so even
if run back-to-back in the same checkout without a worktree, there is no
collision surface. Do not run A and B concurrently even in separate
worktrees given the repo's proven worktree-isolation failure — sequential
waves, same checkout, is the safer choice here even though A/B don't share
files (a merge/rebase step could still race if concurrent).

### Deploy cadence

Deployable after Wave B (employees are visible + game-relevant), but
**pause and re-confirm with Greg before running `nexus-war-room-deploy.sh`**
— this session's blanket authorization does not survive a NEW autonomous
session; the kickoff prompt must ask "deploy G1 now? (y/n)" as a literal
gate, not assume yes.

### Kickoff prompt draft

```
Read §G1. Wave A first: build employeeStore/employeeTraits/employeeNames/
employeeMood + 6 httpServer routes + asyncapi EmployeeUpdated message,
server-only, commit each file group separately. Run cd server && npm test.
Then Wave B: EmployeeRoster.tsx + officeState.ts employeeId FK + mood.ts,
webview-only. Run cd webview-ui && npm test. Full root npm test + check-
types + lint before declaring done. Capture g1-employee-roster screenshot
pair. STOP before running nexus-war-room-deploy.sh — ask Greg explicitly,
do not assume the standing deploy authorization carries over to this
session.
```

---

## G2 — Economy + Build Mode

**Goal:** dual currency (Cash spendable, Reputation permanent) awarded only
from real events; build mode extended from decor-placement to
purchasable floor space + typed rooms with adjacency bonuses.

### Economy schema

`server/src/economyStore.ts` **(NEW)**, same file-backed pattern:

```ts
interface EconomyState {
  cash: number;
  reputation: number;
  ledger: EconomyLedgerEntry[]; // capped ring buffer, last 200, for the
  // UI's "recent earnings" feed — audit trail
  // mirrors dispatchStore's JSONL pattern but
  // in-memory/ring-buffer since this is UI
  // flavor, not a safety audit
}
interface EconomyLedgerEntry {
  ts: string;
  delta: number;
  currency: 'CASH' | 'REPUTATION';
  reason:
    | 'TURN_COMPLETED'
    | 'CRISIS_RESOLVED'
    | 'SHIFT_GRADE'
    | 'STREAK_MILESTONE'
    | 'NEGLECT_DECAY'
    | 'PURCHASE'
    | 'TRAINING'
    | 'ROOM_UPGRADE';
}
```

**Rates (ASSUMES-flagged, see top of doc):**

- Cash: `+2` per completed turn, `+10` per real crisis resolution, shift-
  grade bonus at day-close `{LEAN:100, STEADY:40, HEAVY:0}` — wired via the
  SAME `ShiftStats.onDayClose` callback `progressionStore.ts` already
  subscribes to (`server/src/shiftStats.ts`), add a second subscriber, don't
  fork the callback mechanism.
- Reputation: `+5` at `streakBronze` (3d), `+15` at `streakSilver` (7d),
  `+50` at `streakGold` (30d) — reuse the EXISTING unlock-flag transitions
  in `progressionStore.ts` (don't recompute streak logic twice; economyStore
  subscribes to the same flag-flip event). `+1` Reputation per LEAN day
  close (small, frequent prestige trickle).
- Neglect decay (STAKES): if zero real turns observed for a full local day,
  `-1` Reputation and mark all ACTIVE employees' mood recompute as if
  `lastActiveAt` aged (moods degrade toward STRESSED/BURNED_OUT
  automatically via the existing mood-recompute-on-read design in G1 — no
  new mechanism, decay is a side effect of time passing without stat
  updates, not a separate cron).
- **Nothing here ever reads token counts.** Every award site cites a real
  completion/resolution/grade/streak event — same guardrail comment style
  as `progressionStore.ts`'s header.

### Build mode extension

1. Verify current bounds first: `grep -n "bounds\|Width\|Height"
webview-ui/src/office/layout/tileMap.ts webview-ui/src/constants.ts` —
   if unbounded (per ASSUMES §5), introduce a **purchasable zone-tier
   model**: `server/src/floorPlanStore.ts` **(NEW)** tracks owned zone tiles
   as a set of rectangular regions, starting with one free starter region
   (whatever the current default layout occupies — read
   `webview-ui/public/assets/default-layout-1.json` for its actual
   footprint and use that as Tier 0, free). Tier 1/2/3 zone purchases cost
   Cash `{500, 2000, 6000}` for successively larger adjacent rectangles
   (exact tile counts derived from what's found in the grep above — do not
   guess a number not grounded in the real tile size, `TILE_SIZE = 16px`
   from `webview-ui/src/constants.ts`).
2. `server/src/roomStore.ts` **(NEW)** — a "room" is a tagged rectangular
   sub-region of owned floor space with `type: 'DEV_PIT' | 'SERVER_ROOM' |
'BREAK_ROOM' | 'WAR_ROOM'`. Extends `layoutPersistence.ts`'s
   persistence, does not replace it — rooms are metadata layered on top of
   the existing furniture/tile layout file, keyed by tile-rect bounds.
3. Adjacency bonus rules (`server/src/roomAdjacency.ts` **(NEW)**, pure
   function, ≤20 lines per the GAMIFICATION-BRIEF's "no rule deeper than
   ~20 lines, fun is combinations" principle): `DEV_PIT` adjacent to
   `SERVER_ROOM` → +10% Cash-per-turn for employees assigned to DEV_PIT;
   `BREAK_ROOM` adjacent to any room → employees assigned there recover
   mood 25% faster; `WAR_ROOM` adjacent to `DEV_PIT` → dispatch chain
   (G3) queue depth +1. These three rules are the full v2.0 rule set —
   do not add more without a design decision; emergence comes from these
   three interacting with employee traits and mood, not from more rules.
4. Webview: extend `webview-ui/src/office/editor/EditorToolbar.tsx` with a
   room-tagging tool (select rect → assign type) and a "buy zone" button
   gated on `economyStore` cash balance (read via existing WS state, same
   place `ProgressionHUD.tsx` reads XP). New component
   `webview-ui/src/components/EconomyHUD.tsx` **(NEW)**, sibling to
   `ProgressionHUD.tsx`, shows Cash (coin glyph + number) and Reputation
   (star glyph + number) — glyph+label, never color-only.

### Verification commands

```bash
cd server && npm test -- economyStore roomStore roomAdjacency floorPlanStore && cd ..
cd webview-ui && npm test -- EconomyHUD EditorToolbar && cd ..
npm run check-types && npm run lint && npm test && npm run build
```

### Acceptance criteria

- A real completed turn (drive one via the dev server, same E2E method as
  G0) increases Cash by exactly 2 in `GET /api/economy` — verified by a
  before/after API read, not just a unit test.
- Purchasing a zone tier deducts the exact Cash cost and the new tiles
  become placeable in the editor (screenshot: zone boundary rendered,
  shape not color — dashed border + "OWNED"/"LOCKED" text per tile group).
- Adjacency bonus is observable: place a `WAR_ROOM` next to a `DEV_PIT`,
  confirm `roomAdjacency.ts`'s computed bonus appears in a room-inspector
  tooltip (text, e.g. "+1 dispatch chain depth (adjacent WAR_ROOM)").
- `.planning/evidence/g2-build-mode.png` + grayscale pair.
- No Cash/Reputation award traces to token volume (same grep-the-diff rule
  as G1, re-run here since this milestone is the highest-risk one for
  violating the no-dark-patterns rule).

### Ultracode workflow shape

**Three waves, file-partitioned, sequential in one checkout:**
Wave A — `economyStore.ts` + wiring into `shiftStats.ts`/`progressionStore.ts`
subscribers (server, economy only). Wave B — `floorPlanStore.ts` +
`roomStore.ts` + `roomAdjacency.ts` (server, build-mode only — no file
overlap with Wave A). Wave C — webview (`EconomyHUD.tsx`,
`EditorToolbar.tsx` extension, room-tagging tool) — depends on both A and B
route contracts existing. Same rationale as G1: partition by file
ownership, run sequentially in one checkout, no worktrees.

### Deploy cadence

Same re-confirmation gate as every milestone after G0. Additionally: this
is the first milestone that changes what "spending" means in the game
(Cash purchases) — flag explicitly to Greg in the deploy-confirmation
prompt that this is live real-Cash-earning logic, not a cosmetic change,
so he reviews the rate table before it goes live.

### Kickoff prompt draft

```
Read §G2. First: grep tileMap.ts/constants.ts for existing bounds per the
ASSUMES block at the top of the doc, and set the zone-tier tile counts from
what you find (do not invent a number). Wave A: economyStore.ts wired to
existing shiftStats/progressionStore callbacks, server-only. Wave B:
floorPlanStore/roomStore/roomAdjacency, server-only, no overlap with A.
Wave C: EconomyHUD + EditorToolbar room-tagging, webview, depends on A+B
routes. Grep every new award call site for the word "token" before your
final commit — zero hits allowed outside comments. Capture
g2-build-mode screenshot pair. STOP and explicitly ask Greg to re-confirm
deploy authorization, noting this milestone changes real Cash-earning
rates.
```

---

## G3 — Contracts + Command Chains

**Goal:** real vault todos become CONTRACTS with rewards/deadlines;
dispatch gains multi-step chains and standing orders; the budget guardrail
(reading real Claude 5h/weekly and Codex ChatGPT-plan headroom) gates all
automation.

### Contracts

`server/src/contractStore.ts` **(NEW)**, file-backed, same pattern.
Contracts are DERIVED from `server/src/briefingProvider.ts`'s existing todo
read (do not build a second todo reader — extend the existing one). Each
open todo item becomes a contract with:

```ts
interface Contract {
  id: string; // stable hash of the todo item's text + source line
  title: string; // todo text, verbatim (never fictionalized —
  // REALNESS rule: only flavor text is invented,
  // not the actual task)
  source: 'VAULT_TODO' | 'HALF_BAKED_GATE'; // briefingProvider's existing categories
  rewardCash: number; // flat 50 + 10 per estimated sub-task (briefingProvider
  // already parses checklist sub-items if present)
  rewardReputation: number; // 0 normally; +5 if the todo is tagged aging/
  // overdue in briefingProvider's existing "aging" bucket
  // (completing an old contract is worth more prestige)
  deadline: string | null; // only set if the source todo has an explicit date;
  // NEVER invent a deadline the human didn't write
  status: 'OPEN' | 'CLAIMED' | 'COMPLETE' | 'EXPIRED';
  claimedByEmployeeId: string | null; // assigning a contract to an employee
  // routes completion XP/Cash to them (G1 tie-in)
}
```

Completion detection: **poll briefingProvider's todo source on the existing
interval it already uses for the BRIEFING panel refresh** (do not add a new
poll loop — find and reuse the interval constant in
`server/src/briefingProvider.ts`); a todo item disappearing from the open
list = contract COMPLETE (same "observed real transition" rule as crisis
resolution — never a timer-based guess). No new filesystem watcher needed
if `briefingProvider.ts` already watches; extend its existing callback.

### Command chains + standing orders

Extends `server/src/dispatchStore.ts` — **do not fork a parallel queue**.

1. `DispatchChain` type added to `core/asyncapi.yaml`: an ordered list of
   dispatch requests where step N+1's prompt template can reference step
   N's `resultTail` (already captured, per STATE.md's resultTail feature).
   Stored as a new field on the existing dispatch queue entries
   (`chainId`, `chainStep`, `chainTotal`) — same file, same store, same
   TTL/audit-log mechanics already proven in production.
2. `StandingOrder` (`server/src/standingOrderStore.ts` **(NEW)**): `{ id,
cronLike: string (e.g. "every morning 07:00"), machineId, provider,
promptTemplate, roots, enabled: boolean }`. A lightweight interval
   checker (reuse the existing `server/src/timerManager.ts` pattern — grep
   it first, it's the file that already manages timed callbacks in this
   codebase, do not add a second timer abstraction) fires
   `dispatchStore.enqueue()` the same way the webview's CallModal does
   today — standing orders are a scheduled CALLER of the existing dispatch
   API, not a new execution path.
3. **Budget guardrail (`server/src/budgetGuardrail.ts` (NEW)) — the hard
   gate.** Reads remaining headroom before every standing-order-triggered
   (not manual/webview-triggered) dispatch enqueue:
   - Claude: no official remaining-quota API exists as of this session: use
     the `ccusage`-style local approach already implicit in the repo's
     Claude Code integration — check `~/.claude` session/transcript
     timestamps against the known 5h rolling window and weekly reset,
     OR (preferred, verify at build time) if `claude usage` / a
     `/usage`-equivalent CLI surface exists in the installed Claude Code
     CLI version, shell out to it and parse. **Verify which surface
     actually exists before writing the parser — this is explicitly
     unverified, flag it in the milestone's STATE.md entry as
     `inferred`, not `verified`, until checked.**
   - Codex: same — check for a `codex usage` or account-status CLI surface;
     ChatGPT-plan limits are opaque from the CLI in general, so a
     conservative fallback is REQUIRED: track a rolling count of
     standing-order-triggered runs per rolling 24h window server-side
     (`budgetGuardrail.ts`'s own counter, independent of any external
     read) and hard-cap standing orders at a configurable
     `MAX_STANDING_ORDER_RUNS_PER_DAY` (default 20, Greg-configurable via
     `~/.pixel-agents/budget-guardrail.json`) as the safety net that works
     even if no CLI usage surface exists.
   - When headroom is below a configurable threshold (default 15%
     remaining, or the daily counter cap hit), standing orders PAUSE
     (status flips to `PAUSED_BUDGET`, visible in the UI with a shape+text
     "⏸ PAUSED — budget guardrail" chip, never silently dropped) and only a
     manual player action ("raise payroll" — an explicit UI button that
     re-enables for the rest of the day) resumes them. This is the literal
     mechanic for "raising payroll consciously = deciding to use more of
     the real limit" from the locked vision.
4. Webview: `webview-ui/src/components/ChainBuilder.tsx` **(NEW)** (extends
   `CallModal.tsx`'s pattern to a multi-step form), `StandingOrdersPanel.tsx`
   **(NEW)**, and a budget-guardrail status chip added to
   `DispatchTray.tsx`.

### Verification commands

```bash
cd server && npm test -- contractStore standingOrderStore budgetGuardrail dispatchStore && cd ..
cd webview-ui && npm test -- ChainBuilder StandingOrdersPanel dispatch && cd ..
npm run check-types && npm run lint && npm test && npm run build
```

### Acceptance criteria

- A real vault todo item appears as an OPEN contract via `GET
/api/contracts` (verified against the actual `briefingProvider.ts` data
  source, not a fixture).
- Completing that todo in the real vault (edit the file, remove/check the
  item) flips the contract to COMPLETE within one briefing-refresh interval
  — verified by editing a real test todo file and polling the endpoint.
- A standing order fires a real dispatch when enabled, and the budget
  guardrail visibly pauses it (chip renders, new dispatches stop enqueuing)
  when the daily counter cap is hit — verified by setting
  `MAX_STANDING_ORDER_RUNS_PER_DAY=1` in a test config and firing twice.
- `.planning/evidence/g3-contracts-chains.png` + grayscale.
- STATE.md entry explicitly labels the Claude/Codex usage-API check as
  `verified` or `inferred` per what was actually found — this is a required
  line, not optional, since G3 gates real spend.

### Ultracode workflow shape

**Four waves, file-partitioned, sequential, one checkout:** A —
`contractStore.ts` (extends briefingProvider, server-only). B —
`standingOrderStore.ts` + `DispatchChain` additions to `dispatchStore.ts`
(server-only, but B touches the SAME file dispatchStore.ts that G3 doesn't
otherwise touch elsewhere — no cross-wave collision since A/C/D don't touch
it). C — `budgetGuardrail.ts` (server-only, standalone new file, but reads
config touched by no one else this milestone). D — webview
(`ChainBuilder.tsx`, `StandingOrdersPanel.tsx`, `DispatchTray.tsx` chip) —
depends on A+B+C route contracts. Run A, B, C, D strictly in that order in
one checkout (B and C could theoretically run in parallel worktrees since
they don't share files — but given this repo's proven worktree failure,
default to sequential unless Greg explicitly wants to spend the calendar
time to try worktrees again with a fresh verification of isolation before
trusting it).

### Deploy cadence

Same re-confirmation gate. This milestone is the highest-stakes deploy of
the whole plan (it can spend real API budget autonomously) — the kickoff
prompt must require Greg to explicitly review and approve the
`MAX_STANDING_ORDER_RUNS_PER_DAY` default and the pause-threshold before
first deploy, not just rubber-stamp "yes deploy."

### Kickoff prompt draft

```
Read §G3. Wave order: A contractStore (extends briefingProvider, don't
build a second todo reader), B standingOrderStore + DispatchChain fields on
dispatchStore, C budgetGuardrail (FIRST verify whether `claude` or `codex`
CLI expose any usage/quota surface — check --help and man pages live, don't
guess; record verified/inferred in STATE.md), D webview. Sequential, one
checkout. Before requesting deploy, print the budget guardrail's default
config (MAX_STANDING_ORDER_RUNS_PER_DAY, pause threshold) and require an
explicit "approved" from Greg on those numbers specifically, separate from
the general deploy confirmation.
```

---

## G4 — Living World + Polish

**Goal:** ambient office life between real events (coffee runs, chats,
birthdays, random events), seasonal calendar, and the art pipeline
integration for the visual upgrade (animated employees, day/night, weather).

### World sim (cheap rules, per GAMIFICATION-BRIEF's "≤20 lines" principle)

`webview-ui/src/office/world/ambientEvents.ts` **(NEW)** — a small
weighted-random table ticked once per real-time minute (via the existing
`gameLoop`/`pixiApp` update loop, not a new timer): idle employees (no
active session, `status: ACTIVE`, mood ≠ BURNED_OUT) have a chance to walk
to the BREAK_ROOM (if one exists, G2) or cluster near a coworker with the
same `projectKey`. Random world events (power surge, inspection, rival
studio poaching one employee — all COSMETIC, never touching real Cash/XP
awards, per REALNESS: only flavor may be invented) fire from
`server/src/worldEventStore.ts` **(NEW)**, broadcast via a new
`WorldEventTriggered` WS message, rendered as a banner
(`webview-ui/src/components/WorldEventBanner.tsx` **(NEW)**, shape+text,
dismissable).

Seasonal calendar: `server/src/calendarStore.ts` **(NEW)** — real
wall-clock date maps to one of 4 seasons (Mar/Jun/Sep/Dec quarter
boundaries, simplest possible mapping, no config) that swaps the floor/wall
tint preset and, once G4's art lands, the outdoor-visible-through-window
sprite (if any window furniture exists in the catalog — check
`furnitureCatalog.ts` for a window entry; if none exists, skip the window
visual and only do the ambient light-level tint).

Day/night: already partially present (`NIGHT_DIM_COLOR` constant exists in
`webview-ui/src/constants.ts`, referenced by `renderer.ts` today) — G4 wires
it to a real local-time gradient (dawn/day/dusk/night, 4 discrete tint
presets, not a continuous shader) rather than a binary day/night flag, if
the flag exists; verify first via `grep -n "NIGHT_DIM\|isNight\|dayNight"
webview-ui/src/office`.

### Art pipeline integration

Reuse the Diablito Codex `$imagegen` pipeline verbatim
(`/Users/greg/code/Diablito/.claude/skills/gpt-image-2/SKILL.md` +
`uploads/el-diablito-canonical.md`'s prompt-shape convention: `type/
subject/pose/style/palette/background/avoid` JSON-slot prompts). For War
Room:

1. Lock ONE canonical employee base sprite style first (pixel-art, same
   `TILE_SIZE`-multiple dimensions as existing `webview-ui/public/assets/
characters/char_0.png`..`char_5.png` — check their actual pixel
   dimensions with `sips -g pixelWidth -g pixelHeight
webview-ui/public/assets/characters/char_0.png` before generating
   anything, match exactly).
2. Generate walk/work/celebrate animation frames per existing character
   slot (6 slots × 3 new animation states × ~4 frames = 72 generations) in
   waves of 6–9 parallel `codex exec` jobs (same batching that worked for
   Diablito's 24-image mascot/card batch and its planned 50-tile gallery
   batch) — spawn an Opus-model management agent for this batch per the
   Diablito handoff's proven pattern (`model: "opus"`, Bash access, review
   gate every tile against off-model/text/style-drift before saving, same
   as Diablito §7.4).
3. Save under `webview-ui/public/assets/characters/animated/<slot>/<state>/
frame_NN.png` **(NEW dir)**, wire into `manifestToPixiSpritesheet.ts`
   (from G0) as `PIXI.AnimatedSprite` frame arrays.
4. Weather (rain/snow overlay, seasonal-gated) as a Pixi
   `ParticleContainer` overlay, cosmetic only, toggled by `calendarStore`.

### Verification commands

```bash
cd server && npm test -- worldEventStore calendarStore && cd ..
cd webview-ui && npm test -- ambientEvents WorldEventBanner && cd ..
npm run check-types && npm run lint && npm test && npm run build
```

### Acceptance criteria

- Idle-wander and clustering visibly happen in a 5-minute unattended
  observation window (screenshot before/after character positions).
- A world event banner fires at least once in a forced-trigger test
  (weight table overridden to 100% for the test) and dismisses cleanly.
- Season tint changes when the system clock is mocked across a quarter
  boundary (unit test on `calendarStore`).
- New animated character frames render in-game (screenshot,
  `.planning/evidence/g4-living-world.png` + grayscale) with zero
  off-model rejects reported (art review gate log attached to the
  milestone's STATE.md entry, same as Diablito's "0 rejects" convention).
- Cosmetic-only check: grep the diff for any world-event code path that
  touches `economyStore`/`employeeStore` stats directly — must be zero
  (world events are flavor, never a backdoor to award Cash/XP).

### Ultracode workflow shape

**Two parallel tracks, each internally sequential, in SEPARATE checkouts
(worktrees) — first re-verify worktree isolation actually holds before
trusting it this time** (STATE.md logged one prior silent failure; do not
repeat the assumption). Track 1 (code): ambientEvents/worldEventStore/
calendarStore/WorldEventBanner — no art dependency, can start immediately.
Track 2 (art): the Opus-managed image-gen batch — fully independent of
Track 1's files (only touches `webview-ui/public/assets/characters/
animated/` and the new `manifestToPixiSpritesheet.ts` wiring, which Track 1
never touches). **Before starting Track 2 in a worktree, run a 2-minute
canary: have both tracks touch a scratch file simultaneously and confirm
each worktree's changes survive independently** — if the canary fails
again, fall back to sequential-in-one-checkout like every other milestone.

### Deploy cadence

Same re-confirmation gate, plus: flag to Greg that this deploy includes the
new animated art (bandwidth/asset-size increase) — confirm the NEXUS
container's static-asset serving handles the larger `webview-ui/dist`
bundle size before deploying (a `du -sh webview-ui/dist` sanity check in
the runbook).

### Kickoff prompt draft

```
Read §G4. Two tracks. Track 1 (code, this checkout): ambientEvents,
worldEventStore, calendarStore, WorldEventBanner — sequential file-order,
grep for existing NIGHT_DIM/isNight constants first, don't duplicate.
Track 2 (art, worktree): FIRST run the 2-minute worktree canary described
in §G4 before trusting isolation; if it fails, do Track 2 sequentially in
the main checkout after Track 1 instead. Track 2 itself: read
/Users/greg/code/Diablito/SESSION-HANDOFF-2026-07-06.md §7 as the literal
runbook template, spawn an Opus agent for the image batch, lock the base
sprite style against existing char_0..5.png pixel dimensions first, batch
in waves of 6-9, review every frame against the off-model gate before
saving. Grep the full diff for economyStore/employeeStore touches from
world-event code — must be zero. Capture g4-living-world screenshot pair.
Confirm dist bundle size before requesting deploy re-confirmation.
```

---

## G5 — Phone / PWA

**Goal:** the existing tailnet-only web dashboard becomes installable and
usably playable on phone, for the idle check-in loop.

### File-level tasks

1. `webview-ui/vite.config.ts` — add `vite-plugin-pwa` (new devDependency,
   pinned exact version), configure `manifest` (name "War Room", icons from
   a new set generated via the same G4 art pipeline at required PWA sizes
   192/512, `display: 'standalone'`), `workbox` runtime caching for the
   static asset routes only — **never cache the WS endpoint or `/api/*`
   routes** (real data must never serve stale from a service worker cache;
   explicit `NetworkOnly` strategy for `/api/` and the WS upgrade path).
2. `webview-ui/src/index.css` + `webview-ui/src/App.tsx` — responsive
   breakpoint pass: below `640px` width, the office canvas becomes
   pannable/pinch-zoomable (Pixi's built-in `EventSystem` handles touch
   already once G0 lands; confirm `app.stage.eventMode = 'static'` and wire
   `wheel`+`pointermove`+pinch via a small `webview-ui/src/office/engine/
touchCamera.ts` **(NEW)**, ≤50 lines), and the side panels (`AgentDrawer`,
   `EmployeeRoster`, `ChainBuilder`, HUDs) collapse into a bottom-sheet /
   tab-bar pattern rather than fixed side columns — reuse
   `webview-ui/src/components/ui/Modal.tsx`'s existing modal primitive for
   the bottom-sheet variant instead of a new component family.
3. Touch targets: audit every button in `BottomToolbar.tsx`,
   `EditorToolbar.tsx`, `ZoomControls.tsx` for a minimum 44×44px hit area
   (standard mobile a11y minimum) — bump `BUTTON_MIN_RADIUS` /
   `ZOOM_CONTROLS`-related constants in `webview-ui/src/constants.ts` for
   the mobile breakpoint only (a `MOBILE_BUTTON_MIN_RADIUS` sibling
   const, applied via the same responsive check as task 2).
4. `.planning/runbooks/nexus-war-room-deploy.sh` — no change needed for
   serving (PWA assets are just more static files under the existing
   `tailscale serve` config) but ADD a verification step to the runbook:
   `curl -s https://${TAILNET_FQDN}:${SERVE_PORT}/manifest.webmanifest`
   returns 200 with the right content-type, printed as an `[OK]`/`[WARN]`
   line in the existing style.

### Verification commands

```bash
cd webview-ui && npm run build && npx vite preview --port 4321 &
curl -sI http://localhost:4321/manifest.webmanifest | head -1
npm test && cd ..
npm run check-types && npm run lint
```

### Acceptance criteria

- Lighthouse PWA category check (via the `web-perf` skill's Chrome DevTools
  MCP tooling, or a manual Chrome DevTools Lighthouse run) scores
  "installable" true.
- Manual device test (Chrome DevTools device toolbar emulation at minimum;
  real phone over Tailscale if available) — office view pans/zooms via
  touch, bottom-sheet panels open/close, every button hits without
  mis-tapping its neighbor.
- `/api/*` and WS traffic confirmed NOT served from service-worker cache
  (DevTools Network tab, "from ServiceWorker" column empty for those
  requests) — this is a required negative-check, not optional, since a
  cached real-data response would violate the no-fake-real-numbers rule
  silently.
- `.planning/evidence/g5-mobile.png` (device-emulated screenshot) +
  grayscale.

### Ultracode workflow shape

**Sequential, one agent, one checkout.** Small, tightly coupled
responsive-CSS + PWA-config milestone — no natural file partition large
enough to justify wave-splitting overhead.

### Deploy cadence

Same re-confirmation gate. Lowest-risk deploy of the plan (no new
gameplay/economy logic) but still requires the explicit ask, per the
cross-cutting hard rule — no milestone is exempt.

### Kickoff prompt draft

```
Read §G5. Sequential, one checkout. Add vite-plugin-pwa + manifest config
(icons from G4's art set if it landed, otherwise placeholder squares
labeled TEMP), NetworkOnly for /api/ and WS explicitly configured — verify
this with a DevTools Network tab check showing empty "from ServiceWorker"
for those requests before considering the task done. Responsive pass:
touchCamera.ts for pan/pinch, bottom-sheet panels via Modal.tsx, 44px touch
targets. Run a device-emulated Lighthouse PWA check. Capture g5-mobile
screenshot pair. Confirm deploy re-authorization with Greg before running
the runbook.
```

---

## Overall sequencing + total ultracode shape

```
G0 (seq, 1 agent) → G1 (2 waves, seq, 1 checkout) → G2 (3 waves, seq, 1 checkout)
  → G3 (4 waves, seq, 1 checkout) → G4 (2 tracks, worktree-canary-gated)
  → G5 (seq, 1 agent)
```

No milestone starts before the previous milestone's full gate list
(check-types + lint + test + build + screenshot pair) is green — this is a
strictly linear chain, not a fan-out, BECAUSE the repo has one proven
worktree-isolation failure and three proven same-checkout collision
incidents (all logged in STATE.md 2026-07-08). The only place this plan
risks parallelism is G4's art track, and only after a canary re-verifies
isolation. Every other "multiple agents" mention above is **file-ownership
partitioned waves run sequentially in one checkout**, not concurrent
agents — this is a deliberate, conservative reading of "ultracode
workflow shape" given this repo's specific proven failure mode, not a
generic recommendation.

## Risks

1. **Budget guardrail's usage-API assumption (G3) may not exist.** Neither
   `claude` nor `codex` CLI is verified in this session to expose a
   machine-readable remaining-quota surface. If neither does, the
   guardrail degrades to the local rolling-counter fallback only — still
   safe (hard cap), but loses the "read real headroom" fidelity the locked
   vision asks for. Flagged `inferred` in G3's own text above; the build
   session must check this for real before trusting the design.
2. **PixiJS in a vitest/jsdom test environment (G0) may need a headless-
   canvas fallback that behaves differently enough from production WebGL
   rendering that pixel-perfect screenshot parity is hard to unit-test** —
   the acceptance criteria leans on Playwright (real browser) screenshots
   for this reason, but if G0's vitest suite can't exercise Pixi at all,
   test COUNT parity (stated as a hard acceptance bar) may force test
   deletions/rewrites larger than expected, which reads as a regression
   even when it isn't one.
3. **The zone-tier/floor-space numbers in G2 are invented against an
   unverified assumption (no fixed map bounds found in this session's
   grep)** — if `tileMap.ts` turns out to have hidden bounds logic
   elsewhere (e.g. computed at runtime from viewport rather than a
   constant), the whole "buy floor space" mechanic's numbers need
   re-deriving at G2 kickoff, not before — this is explicitly built into
   G2's task list as step 1, but is still the single most likely place
   this plan's concrete numbers are wrong.
