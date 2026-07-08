# Section 03 — Office Building & Expansion

Status: DRAFT for critique pass. Written against the real repo at branch
`war-room/v1`, HEAD `36098d5` (2026-07-08, "model dropdowns DEPLOYED").

## ASSUMES (flag for critique/reconciliation)

- **A1 (economy, → Section 02):** Currency is `cashBalance` (integer, whole
  Cash units, no decimals) and `reputation` (integer). I invent concrete
  Cash costs/rates below (expansion pricing, furniture prices, sell refund
  %) as placeholders tagged `[ECON]` — Section 02 owns the authoritative
  numbers and balancing; if it disagrees, its numbers win and only the
  _shape_ of the formulas here (geometric cost curve, % refund) should
  survive.
- **A2 (engine, → Section 05/engine section):** The renderer is rewritten
  in PixiJS inside the existing React shell (`OfficeCanvas.tsx` becomes a
  thin mount point for a `PIXI.Application`). This section assumes Pixi's
  `Container`/`ParticleContainer`/`RenderTexture` primitives are available
  and that the **logical grid stays authoritative** (col/row integers,
  16px logical tile) with Pixi doing presentation-layer scaling — i.e. the
  existing `tileMap.ts` BFS pathfinding, `layoutSerializer.ts` blocked-tile
  math, and `types.ts` `OfficeLayout` shape are extended, not replaced.
- **A3 (employees, → Section 04 employee sim):** Employees are persistent
  records with a stable `employeeId` distinct from the ephemeral runtime
  `Character.id` used today for live agent sprites. I assume Section 04
  owns `EmployeeRecord` and exposes `homeDeskUid: string | null` /
  `homeRoomId: string | null` fields that this section's desks/rooms are
  assigned into (see "Real agents inhabit built spaces" below). If
  Section 04 models this differently, only the assignment-pointer contract
  needs reconciling, not the grid/room model.
- **A4 (progression):** `progressionStore.ts`'s existing unlock-flag
  pattern (`~/.pixel-agents/progression.json`, `UNLOCK_KEYS`) is the
  precedent this section's room/furniture unlocks follow. No new unlock
  storage mechanism is introduced.

---

## 1. Grid & tile system spec (Pixi-compatible)

**Keep the logical grid exactly as it exists today** — do not redesign it.
Current source of truth: `webview-ui/src/office/types.ts` (`TileType`,
`OfficeLayout`), `webview-ui/src/constants.ts` (`TILE_SIZE=16`,
`DEFAULT_COLS=20`, `DEFAULT_ROWS=11`, `MAX_COLS=64`, `MAX_ROWS=64`), and
`webview-ui/src/office/layout/tileMap.ts` (BFS `findPath`,
`isWalkable`, 4-connected, no diagonals).

Decisions:

1. **Logical tile stays 16×16px, integer col/row.** Pathfinding,
   blocked-tile sets (`getBlockedTiles`, `getPlacementBlockedTiles`), and
   `OfficeLayout.tiles` flat-array indexing (`row*cols+col`) are UNCHANGED.
   Building-mode code (floor purchase, room placement) operates in this
   same coordinate space — a purchased plot is a rectangle of `(col, row)`
   cells, nothing new.
2. **Pixi render tile is 32×32px (2x the logical tile), sprites drawn at
   2x scale.** Add `RENDER_TILE_SCALE = 2` to `webview-ui/src/constants.ts`.
   The Pixi `Application` stage transform multiplies logical
   `x = col*TILE_SIZE`, `y = row*TILE_SIZE` positions by
   `RENDER_TILE_SCALE` once, at the top-level `Container`, not per-sprite —
   so `layoutSerializer.ts`'s `layoutToFurnitureInstances` (which computes
   `x`, `y`, `zY` in logical pixels) needs zero changes; only the
   Pixi-side mount multiplies.
3. **Chunked rendering for perf at MAX_COLS×MAX_ROWS=64×64 (4096 tiles).**
   Split the tilemap into 8×8-tile chunks (8 cols × 8 rows of chunks to
   cover 64×64). Each chunk is one Pixi `Container` cached as a
   `RenderTexture` via `container.cacheAsBitmap = true` (Pixi v7) or
   `RenderTexture.create` + `renderer.render()` (Pixi v8, since
   `cacheAsBitmap` is deprecated there — **pin the actual Pixi major
   version during the engine-section spike and confirm the caching API
   name before agents write chunk code**). Only chunks touching a dirty
   tile/furniture edit re-render; static chunks (no furniture edit this
   frame) reuse their cached texture. This is the mechanism that keeps a
   64×64 fully-built office from redrawing 4096 tiles/frame.
4. **VOID tiles are the "not yet purchased" floor-space representation —
   reuse, don't reinvent.** `TileType.VOID = 255` already exists
   (`webview-ui/src/office/types.ts`) and is already excluded from
   walkability (`tileMap.ts: isWalkable` returns false for `VOID`) and
   already renders as empty in `floorTiles.ts`. Unpurchased plots are
   simply `VOID` tiles at office creation; purchasing a plot converts a
   rectangle of `VOID` → a floor `TileType` (default `FLOOR_1`, recolored
   by the player in edit mode same as any floor tile today). No new tile
   type is needed.
5. **World bound stays MAX_COLS×MAX_ROWS = 64×64.** This section does not
   ask for a bigger world; expansion within the existing 64×64 cap is
   sufficient for the v1.0 bar (see §2 for the plot math — the existing
   cap supports 11 expansion tiers before hitting the wall, comfortably
   past what a 20-60min session economy needs at launch).

---

## 2. Floor-space purchase progression

Office starts at the existing default footprint: `DEFAULT_COLS=20 ×
DEFAULT_ROWS=11` (220 tiles) minus the wall border already carved by
`createDefaultLayout()` in `layoutSerializer.ts` — this is "Plot 0," free,
already owned, unchanged.

**Expansion unit: a "bay."** A bay is a fixed 4-col × (current usable
row-height) rectangle appended to the right edge of the currently owned
floor, growing the office horizontally bay-by-bay up to `MAX_COLS=64`.
(Horizontal-only growth keeps the pathfinding/adjacency math in this doc
one-dimensional-simple; vertical growth is an explicit non-goal for v1.0 —
call this out to the critique pass as a scope cut.)

- Bay width: 4 cols (leaves room for one wall-adjacent desk pair + a
  walk aisle at the existing furniture footprint sizes in
  `furnitureCatalog.ts`).
- Max bays: `(MAX_COLS - DEFAULT_COLS) / 4 = (64-20)/4 = 11` bays.
- **Cost formula `[ECON]`:** `cost(n) = 500 * 1.55^n` Cash, where `n` is
  the 0-indexed bay number already owned (bay 0 = the first purchase,
  cost 500). This is a standard idle-game geometric curve; exact base/
  multiplier are Section 02's to tune, but the shape (geometric, not
  linear) is load-bearing — linear costs make late bays trivial relative
  to a growing Cash income rate.
- Buying a bay is a single action: `POST /api/building/expand` (new route,
  pattern-matched on `server/src/dispatchStore.ts`'s route style) which
  (a) checks `cashBalance >= cost(n)`, (b) debits Cash via whatever ledger
  Section 02 defines, (c) converts the next 4×rows VOID rectangle to
  floor tiles, (d) appends a wall border update (open the shared wall
  between old/new bay, close the new outer wall), (e) persists via
  `layoutPersistence.ts` (`writeLayoutToFile`), (f) broadcasts a
  `officeExpanded` WS message (new message type, added to the existing
  asyncapi spec — see `asyncapi.yaml` glob fix precedent from the 07-08
  incident log, make sure this new message type IS covered by whatever
  glob/lint catches YAML).
- **No un-purchase of floor space.** Bays are permanent once bought (soft-
  fail pressure applies to morale/reputation/grime — see Stakes in the
  overall design — never to clawing back owned floor).

---

## 3. Room types & buffs

A **room** is a player-drawn rectangular tag over already-purchased floor
tiles — it does not require new tile types, it is metadata layered on top
(same pattern as how `tileColors` is a parallel array layered on `tiles`
today in `OfficeLayout`).

### 3.1 Data shape (new, additive to `OfficeLayout`)

```ts
// webview-ui/src/office/types.ts — ADD
export const RoomType = {
  DEV_PIT: 'dev_pit',
  SERVER_ROOM: 'server_room',
  BREAK_ROOM: 'break_room',
  WAR_ROOM: 'war_room',
  KITCHEN: 'kitchen',
} as const;
export type RoomType = (typeof RoomType)[keyof typeof RoomType];

export interface PlacedRoom {
  uid: string; // crypto.randomUUID(), same pattern as PlacedFurniture.uid
  type: RoomType;
  /** Inclusive tile rectangle this room's buffs apply to. */
  colStart: number;
  rowStart: number;
  colEnd: number;
  rowEnd: number;
  createdAt: number; // epoch ms, for age-based buffs / UI sort only
}
```

Extend `OfficeLayout` (bump `version`? **No** — `version` is already a
migration discriminant (`obj.version === 1` in `deserializeLayout`); rooms
are additive like `pets` was, so follow the `pets` precedent exactly:

```ts
export interface OfficeLayout {
  // ...existing fields unchanged...
  /** Player-designated room rectangles. Optional for backward-compat;
   *  migrateLayout coerces to []. */
  rooms?: PlacedRoom[];
}
```

`layoutSerializer.ts: migrateLayout()` gets one more default-coercion block
identical in shape to the existing `pets` block:

```ts
if (!layout.rooms) {
  layout = { ...layout, rooms: [] };
}
```

### 3.2 Room catalog (v1.0 — 5 types, numbers `[ECON]` placeholders)

| Room type   | Min footprint (cols×rows) | Buy cost (Cash) `[ECON]` | Buff                                                                                                                                                         | Buff scope                                                                                                                                                                      |
| ----------- | ------------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dev Pit     | 4×3                       | 300                      | +15% XP from completed turns for employees whose `homeDeskUid` sits inside the rectangle                                                                     | per-employee, additive, does not stack with a 2nd Dev Pit tag on the same desk (last-tagged room wins if rectangles overlap — overlap is a placement-time warning, not blocked) |
| Server Room | 3×3                       | 800                      | +10% Cash from completions company-wide while ≥1 "server rack" furniture item (new catalog entry, §4) is placed inside it                                    | global, requires furniture inside, not just the rectangle                                                                                                                       |
| Break Room  | 3×3                       | 400                      | Employee mood regen rate ×1.5 while an employee's state is `on_break` and their position is inside the rectangle                                             | per-employee, situational (only while on break)                                                                                                                                 |
| War Room    | 4×4                       | 1200                     | Crisis resolution grants +25% bonus XP (stacks with `XP_CRISIS_RESOLVED` from `progressionStore.ts`) when the resolving agent's seat is inside the rectangle | per-event                                                                                                                                                                       |
| Kitchen     | 3×2                       | 250                      | Passive company-wide morale decay rate ×0.85 (slows the "gets grimy"/morale-decay stake, doesn't reverse it)                                                 | global, ambient (no furniture requirement — a Kitchen is a coffee/snack destination for World-layer wander events, see WORLD assumption)                                        |

Rules, hard (no judgment calls for build agents):

- A room tag requires ALL its rectangle's tiles to be non-`VOID` (already
  purchased) and non-`WALL` at creation time — reject with a validation
  error surfaced in the edit-mode toolbar, same error-toast pattern
  `EditorToolbar.tsx` already uses for invalid placement.
  Note: v1.0 room buffs are computed by rectangle-membership queries at
  the moment they're needed (turn-completed event, crisis-resolved event,
  shift rollover) — NOT a continuously-recomputed cache. This avoids
  needing a reactive buff-recalculation system in v1.0; it's a pure
  point-in-time `isEmployeeInRoom(deskUid, rooms)` lookup, cheap at the
  scale of a few dozen rooms/employees.
- Rectangles MAY overlap (no exclusion enforcement in v1.0 — simplicity
  over correctness here is an explicit scope cut; flag to critique).
- A room's buff is active only while its minimum footprint is intact;
  shrinking below minimum via the "sell" tool (§6) on member tiles auto-
  demotes the `PlacedRoom` back to untyped floor (deleted from `rooms[]`,
  a toast informs the player "Room disbanded: footprint below minimum").
- Room buffs, XP bonuses, and Cash % modifiers are **read at the point an
  event resolves** (turn completed, crisis resolved, day rollover) by a
  single new pure function `computeActiveBuffs(layout: OfficeLayout,
employeeId/deskUid): BuffSet`, added to a NEW file
  `server/src/buildingBuffs.ts` (server-side, alongside
  `progressionStore.ts`, since XP/Cash awarding already lives server-side
  and buffs must be computed where the award happens — never trust a
  client-reported buff).

---

## 4. Furniture catalog extension (buffs + adjacency)

Today's catalog (`webview-ui/src/office/layout/furnitureCatalog.ts`) is
purely visual/footprint metadata sourced from `dist/assets/furniture/*`
manifests (25 items currently: DESK, PC, BOOKSHELF, PLANT, SOFA, CACTUS,
etc. — see the `dist/assets/furniture/` listing). It has **no gameplay
buff fields today.** Two additive changes:

### 4.1 New sidecar table, not a manifest rewrite

Do NOT touch the generated asset manifest / `buildDynamicCatalog()`
pipeline (that's asset-generation owned, see §7 ASSUMES on the Diablito
gpt-image pipeline). Add a hand-authored sidecar:

```ts
// webview-ui/src/office/layout/furnitureBuffs.ts  (NEW FILE)
export interface FurnitureBuff {
  /** Flat Cash-earn % bonus while an employee assigned to this item's desk completes work. 0 if none. */
  cashBonusPct?: number;
  /** Flat XP % bonus, same trigger semantics as cashBonusPct. */
  xpBonusPct?: number;
  /** Passive mood regen delta per idle tick while an employee is near this item (radius below). */
  moodRegenDelta?: number;
  /** Tile radius (Chebyshev distance) for adjacency-bonus purposes. 0 = no adjacency effect. */
  adjacencyRadius?: number;
}

/** Keyed by catalog asset ID (e.g. 'DESK_FRONT', 'PLANT', 'COFFEE_ON'). Unlisted = no buff (decor-only, matches current behavior). */
export const FURNITURE_BUFFS: Record<string, FurnitureBuff> = {
  PLANT: { moodRegenDelta: 1, adjacencyRadius: 2 },
  LARGE_PLANT: { moodRegenDelta: 2, adjacencyRadius: 2 },
  COFFEE_ON: { moodRegenDelta: 3, adjacencyRadius: 1 },
  BOOKSHELF: { xpBonusPct: 3, adjacencyRadius: 1 },
  DOUBLE_BOOKSHELF: { xpBonusPct: 5, adjacencyRadius: 1 },
  WHITEBOARD: { xpBonusPct: 4, adjacencyRadius: 2 },
  // New v2 buffable items (require new sprites — see §7 asset pipeline):
  SERVER_RACK: { cashBonusPct: 8, adjacencyRadius: 1 }, // required for Server Room buff, §3.2
  ESPRESSO_MACHINE: { moodRegenDelta: 4, adjacencyRadius: 1 },
  STANDING_DESK: { xpBonusPct: 5, adjacencyRadius: 0 }, // desk-tier upgrade, no radius (applies to its own seat only)
};
```

`[ECON]` tags apply to every numeric value above — Section 02 owns final
tuning; the _shape_ (per-item flat bonus + adjacency radius) is the
contract build agents implement against.

### 4.2 Adjacency bonus algorithm (deterministic, no judgment calls)

For a given desk tile `(col,row)` whose employee just earned Cash/XP:

1. Compute the desk's footprint tiles (same `entry.footprintW/H` walk
   used in `layoutToSeats`/`getBlockedTiles`).
2. For every `PlacedFurniture` item with a `FURNITURE_BUFFS[type]` entry
   that has `adjacencyRadius > 0`: compute Chebyshev distance
   `max(|dc|, |dr|)` between the buffed item's nearest footprint tile and
   the desk's nearest footprint tile. If `distance <= adjacencyRadius`,
   its `cashBonusPct`/`xpBonusPct`/`moodRegenDelta` applies.
3. **Stacking rule:** same-type items do NOT stack (only the single
   strongest instance of a given `type` in range counts — e.g. two
   `PLANT`s near one desk give one `PLANT` bonus, not double). Different
   types DO stack, additively, capped at `+40%` total Cash bonus and
   `+40%` total XP bonus per desk (hard cap, prevents furniture-stacking
   degenerate strategies; encoded as
   `ADJACENCY_BONUS_CAP_PCT = 40` in `server/src/buildingBuffs.ts`).
4. This computation happens server-side, at the same point room buffs are
   read (§3.2) — one function, `computeActiveBuffs()`, returns the union
   of room-buff + adjacency-buff percentages for a given desk/employee at
   award time. No client-side buff computation, no caching layer, in
   v1.0.

---

## 5. Walk-path / pathfinding implications

No changes to the BFS algorithm itself (`tileMap.ts: findPath` stays
4-connected, unweighted, unchanged). Building-mode implications to encode
explicitly so agents don't improvise:

- **Aisle guarantee is NOT auto-enforced.** The player can wall themselves
  into an unreachable desk by placing furniture badly. This is intentional
  (matches existing behavior — `getPlacementBlockedTiles` already lets you
  block yourself in). The only guardrail: `getBlockedTiles`'s existing
  `backgroundTiles` skip (furniture with `backgroundTiles>0`, e.g. desks
  with a walkable front lip) remains the sole mechanism for "furniture you
  can stand next to" — no new walkability exceptions are introduced by
  rooms or bays.
- **New bays must ship with at least one open doorway tile** connecting to
  the existing floor (encoded in the `/api/building/expand` handler in §2
  — the shared wall segment between old and new bay is opened
  procedurally at server-room-height-midpoint, not left for the player to
  carve by hand). This guarantees new floor is reachable at purchase time;
  the player can still wall it off later (their problem, not a bug).
- **Room tags never affect pathfinding.** A `PlacedRoom` rectangle is a
  buff/metadata overlay only — it does not add walls, does not change
  `isWalkable`. Only actual `PlacedFurniture`/`TileType.WALL` placements
  affect walkability, exactly as today.

---

## 6. Edit mode UX (place / rotate / sell)

Extend the existing `EditorState`/`EditorToolbar`/`editorActions.ts` — do
not build a parallel edit system.

### 6.1 New `EditTool` values (add to `webview-ui/src/office/types.ts`)

```ts
export const EditTool = {
  TILE_PAINT: 'tile_paint',
  WALL_PAINT: 'wall_paint',
  FURNITURE_PLACE: 'furniture_place',
  FURNITURE_PICK: 'furniture_pick',
  SELECT: 'select',
  EYEDROPPER: 'eyedropper',
  ERASE: 'erase',
  PETS: 'pets',
  ROOM_TAG: 'room_tag', // NEW — drag-rectangle to tag/retag a room type
  SELL: 'sell', // NEW — click furniture or a room tag to remove + refund
} as const;
```

### 6.2 Sell mechanic (`[ECON]` refund rate)

- Clicking a `PlacedFurniture` item with `EditTool.SELL` active: removes it
  from `layout.furniture`, refunds `50%` of its original Cash cost
  (rounded down) to `cashBalance`. Furniture cost table lives wherever
  Section 02 puts the item shop/prices (not in scope here) — this section
  only specifies the refund **rate** (50%) and the trigger mechanic.
- Clicking inside a `PlacedRoom` rectangle with `EditTool.SELL` active:
  removes the room tag entirely (does not remove furniture inside it),
  refunds `50%` of the room's `[ECON]` buy cost from §3.2.
- **Bays are never sellable** (§2 — permanent once bought). `EditTool.SELL`
  on a bought bay's floor tile is a no-op with a toast: "Floor space can't
  be sold."

### 6.3 Room tagging UX

- `EditTool.ROOM_TAG` active → player picks a room type from a new
  palette section in `EditorToolbar.tsx` (5 buttons, one per `RoomType`,
  same button-grid pattern the existing category tabs use), then
  drag-rectangles across owned floor tiles (reuse the existing drag-marquee
  math already implemented for `wallDragAdding` multi-tile drag in
  `editorState.ts`/`editorActions.ts` — same interaction shape, new
  commit action).
- On mouse-up: validate footprint (§3.2 rule — no VOID/WALL tiles inside,
  meets min footprint for the chosen type), debit `[ECON]` cost, push a
  `PlacedRoom` into `layout.rooms`, call `pushUndo()` before commit (same
  undo-stack pattern every other edit action already uses in
  `editorActions.ts`).
- Rotate: unchanged from existing furniture rotate (`getRotatedType` in
  `furnitureCatalog.ts`) — rooms are axis-aligned rectangles only, no
  rotation concept for room tags in v1.0.

### 6.4 Colorblind compliance (hard rule, unconditional)

Every new UI surface (room-type palette buttons, sell-mode cursor,
buff tooltips) uses shape+text-label as primary signal:

- Room-type buttons: distinct icon glyph + text label per type (never
  color-only swatches).
- Sell-mode cursor: a distinct crosshair/X icon, not a red tint.
- Buff tooltips on hover: text always states the % number and source
  ("Server Room: +10% Cash") — never a color-coded icon alone.

---

## 7. Asset generation pipeline (new furniture/room sprites)

Located: `/Users/greg/code/Diablito/.claude/skills/gpt-image-2/SKILL.md` —
this is the gpt-image asset-generation skill Greg referenced ("the chatgpt
image gen 2 system we set up for diablito"). **Read that SKILL.md at build
time** before generating any new sprite (SERVER_RACK, ESPRESSO_MACHINE,
STANDING_DESK, and any Section-05-requested character/animation assets) —
it defines the prompt/style contract that keeps new sprites visually
consistent with the existing 25-item `dist/assets/furniture/*` set. This
section only names the dependency; it does not re-specify that skill's
internals — flag to critique if the engine/art section expects a
different pipeline.

New sprite requirements this section introduces (deliver at existing
16×16 logical tile resolution, matching `dist/assets/furniture/DESK/`
folder shape — sprite JSON grid, not raw PNG, per `SpriteData` type):

- `SERVER_RACK` (server room requirement item, §3.2/§4.1)
- `ESPRESSO_MACHINE` (break room decor+buff item)
- `STANDING_DESK` (desk-tier upgrade, buffed variant of `DESK_FRONT`)

---

## 8. Milestones for autonomous build (file-level, verification-gated)

Each milestone: implement → run the listed verification command → commit
atomically (conventional-commit + em-dash, per repo convention) before
starting the next milestone. One agent per checkout (hard rule from the
07-08 incident).

**B1 — Data model (types + migration).**
Files: `webview-ui/src/office/types.ts` (add `RoomType`, `PlacedRoom`,
`OfficeLayout.rooms?`), `webview-ui/src/office/layout/layoutSerializer.ts`
(`migrateLayout` rooms-default block, per §3.1).
Verify: `npm run test -w webview-ui -- layoutSerializer` (existing test
file pattern) passes with a new test asserting a layout missing `rooms`
migrates to `rooms: []`.

**B2 — Furniture buff sidecar.**
Files: `webview-ui/src/office/layout/furnitureBuffs.ts` (new, §4.1),
`server/src/buildingBuffs.ts` (new — `computeActiveBuffs()`, §3.2/§4.2).
Verify: new unit test file `server/__tests__/buildingBuffs.test.ts`
covering: room-membership buff applies only inside rectangle; adjacency
same-type non-stacking; adjacency cross-type stacking capped at 40%.

**B3 — Floor expansion route.**
Files: new route in server's route table (pattern-match
`server/src/dispatchStore.ts` + wherever routes are registered — grep
`fastify.post` call sites first), `layoutPersistence.ts` unchanged
(reuse `writeLayoutToFile`), new WS message `officeExpanded` added to the
asyncapi spec (remember the 07-08 yaml-glob lint gap — verify the new
message type round-trips through whatever asyncapi codegen step exists:
run that codegen command and confirm no manual drift).
Verify: new server test posting `/api/building/expand` twice — asserts
cost formula `500*1.55^n`, asserts VOID→FLOOR_1 conversion of the correct
4-col rectangle, asserts insufficient-Cash returns a rejection without
mutating the layout.

**B4 — Room tagging edit tool.**
Files: `webview-ui/src/office/types.ts` (`EditTool.ROOM_TAG`,
`EditTool.SELL`), `webview-ui/src/office/editor/editorActions.ts` (commit
room-tag action + sell action), `webview-ui/src/office/editor/
EditorToolbar.tsx` (room-type palette buttons, sell tool button — text
label + icon, no color-only).
Verify: `npm run test -w webview-ui -- editorActions` new cases for
room-tag commit (validates footprint, debits cost, pushes undo) and sell
(refund math, room disband-on-shrink-below-minimum).

**B5 — Pixi chunk renderer scaffold** (blocked on engine section's Pixi
version pin — if that section hasn't landed yet, stub this milestone and
proceed with B1-B4 on the existing canvas renderer; buffs/rooms are
renderer-agnostic metadata).
Files: new `webview-ui/src/office/engine/pixiChunkRenderer.ts` per §1.3.
Verify: manual render smoke — visually confirm chunk boundaries don't
produce seams at 2x scale (screenshot compare against pre-Pixi canvas
render of the same layout).

**B6 — E2E.**
Verify (mirrors the 07-08 go-live E2E pattern): buy a bay → confirm floor
tiles convert + Cash debits + WS broadcast received in a live browser
session; tag a Dev Pit room over a desk with an assigned employee →
complete one real turn → confirm XP award reflects the +15% bonus in the
server log/telemetry (not just a unit test — a real observed event, per
the "never fake real completion numbers" hard rule).

---

## Risks

- **R1 — Buff/economy balance is unverifiable in isolation.** Every
  `[ECON]` number here is a placeholder; if Section 02's actual Cash
  income rate is much lower/higher than assumed, bay costs and room ROI
  could feel either trivial or impossible. Mitigate: Section 02 must own a
  single numbers-authority file that this section's formulas read from
  (`server/src/economyConstants.ts` or similar), not duplicate the numbers
  inline.
- **R2 — Overlapping room rectangles with no exclusion enforcement** could
  let a player double-tag one desk as both Dev Pit and War Room, both
  buffs simultaneously applying (this doc doesn't cap combined per-desk
  room buffs the way it caps adjacency furniture buffs at 40%). This is a
  known gap, not an oversight — flag to critique: should room buffs share
  the same 40% cap pool as furniture adjacency, or a separate cap?
- **R3 — Pixi chunk-caching API differs by major version** (`cacheAsBitmap`
  removed in Pixi v8) and this section can't pin the version — B5 is
  explicitly gated on the engine section's decision.

## 3 things most likely to be wrong

1. **The bay-based horizontal-only expansion model** — Greg's "full build
   mode" vision may expect free-form 2D floor purchase (buy any adjacent
   tile, any direction), not fixed 4-col bays. This doc chose bays for
   determinism (no judgment calls for build agents) but it's a real scope
   cut from "buy floor space" as stated.
2. **Room buffs computed as point-in-time rectangle-membership lookups**
   rather than a live/reactive buff system — likely too simple once the
   colony-sim mood/needs system (Section 04) wants continuous buff
   application (e.g. "mood regens every tick while in a break room," not
   just "at event resolution"). This section's model may need a tick-based
   buff pass added once Section 04 lands, not just event-triggered reads.
3. **The 50% universal sell-refund rate and the 40% adjacency stacking
   cap** are round numbers invented for concreteness, not derived from any
   stated economy target — genuinely likely to be replaced wholesale by
   Section 02.
