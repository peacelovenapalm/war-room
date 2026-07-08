/**
 * Scene-graph tests for pixiRenderer.ts. Runs under plain Node (this repo's
 * vitest `environment: 'node'` — no jsdom): Pixi's core Container/Sprite/
 * Graphics/Texture classes construct fine without a canvas/WebGL context;
 * only `Application.init()` and `Texture.from(canvas)` need a browser, and
 * neither is exercised here — a stub `TextureResolver` stands in for
 * `getSpriteTexture` so assertions can check "which SpriteData resolved to
 * which Texture" without ever touching `document`.
 *
 * Coverage note (G0 task 11): the old canvas `renderer.ts` had no direct
 * unit tests to "port" (verified — nothing in this repo ever imported it by
 * path), so the definition-of-done bar here is direct: every one of
 * `pixiRenderer.ts`'s 12 draw-concern functions gets scene-graph assertions,
 * not a 1:1 port of a prior suite.
 */
import assert from 'node:assert/strict';

import { Container, Sprite, Texture } from 'pixi.js';
import { test } from 'vitest';

import type { TextureResolver } from '../src/office/engine/pixiRenderer.js';
import {
  createPixiLayers,
  createSpritePools,
  renderBubbles,
  renderDeleteButton,
  renderFrame,
  renderGhostBorder,
  renderGhostPreview,
  renderGridOverlay,
  renderPetBubbles,
  renderRotateButton,
  renderScene,
  renderSeatIndicators,
  renderSelectionHighlight,
  renderTileGrid,
} from '../src/office/engine/pixiRenderer.js';
import type {
  Character,
  FurnitureInstance,
  Pet,
  Seat,
  SpriteData,
  TileType as TileTypeVal,
} from '../src/office/types.js';
import { CharacterState, Direction, PetState, TileType } from '../src/office/types.js';

/** Distinct Texture per distinct SpriteData reference — lets tests assert
 *  "textures keyed" (two different sprites never share a texture object,
 *  the same sprite reference always resolves to the same texture). */
function stubResolver(): TextureResolver {
  const cache = new WeakMap<SpriteData, Texture>();
  return (sprite: SpriteData) => {
    let texture = cache.get(sprite);
    if (!texture) {
      texture = new Texture();
      cache.set(sprite, texture);
    }
    return texture;
  };
}

function flatSprite(cell: string): SpriteData {
  return [[cell]];
}

// ── First test: verify the mocking approach compiles + runs at all ────────

test('createPixiLayers builds the 5-layer world container without a canvas', () => {
  const stage = new Container();
  const layers = createPixiLayers(stage);
  assert.equal(stage.children.length, 1);
  assert.equal(stage.children[0], layers.world);
  assert.deepEqual(layers.world.children, [
    layers.floorLayer,
    layers.sceneLayer,
    layers.bubbleLayer,
    layers.crisisLayer,
    layers.editorOverlayLayer,
  ]);
});

// ── renderTileGrid ──────────────────────────────────────────────

test('renderTileGrid creates one Sprite per visible floor tile, keyed by row,col', () => {
  const stage = new Container();
  const layers = createPixiLayers(stage);
  const pool = createSpritePools();
  const resolve = stubResolver();

  const tileMap: TileTypeVal[][] = [
    [TileType.FLOOR_1, TileType.FLOOR_1, TileType.VOID],
    [TileType.WALL, TileType.FLOOR_1, TileType.FLOOR_1],
  ];

  renderTileGrid(
    layers.floorLayer,
    pool.floorTiles,
    tileMap,
    undefined,
    3,
    { canvasWidth: 200, canvasHeight: 200, offsetX: 0, offsetY: 0, zoom: 4 },
    resolve,
  );

  // 5 non-VOID tiles (one WALL fallback rect + 4 floor sprites).
  assert.equal(pool.floorTiles.size, 5);
  assert.equal(layers.floorLayer.children.length, 5);
  assert.ok(!pool.floorTiles.has('0,2')); // VOID skipped entirely

  const tile00 = pool.floorTiles.get('0,0')!;
  assert.equal(tile00.position.x, 0);
  assert.equal(tile00.position.y, 0);
  const tile01 = pool.floorTiles.get('0,1')!;
  assert.equal(tile01.position.x, 16); // TILE_SIZE, unscaled — world container carries zoom
});

test('renderTileGrid culls tiles outside the viewport + 1-tile margin', () => {
  const stage = new Container();
  const layers = createPixiLayers(stage);
  const pool = createSpritePools();
  const resolve = stubResolver();

  // 8x8 all-floor map; a tiny viewport should only touch a handful of tiles.
  const tileMap: TileTypeVal[][] = Array.from({ length: 8 }, () =>
    Array.from({ length: 8 }, () => TileType.FLOOR_1 as TileTypeVal),
  );

  renderTileGrid(
    layers.floorLayer,
    pool.floorTiles,
    tileMap,
    undefined,
    8,
    // Viewport covers world x in [0,16), y in [0,16) → tile (0,0) only,
    // +1 tile margin brings in the ring around it.
    { canvasWidth: 16, canvasHeight: 16, offsetX: 0, offsetY: 0, zoom: 1 },
    resolve,
  );

  assert.ok(
    pool.floorTiles.size < 64,
    'culling must skip most of an 8x8 map from a 1-tile viewport',
  );
  assert.ok(pool.floorTiles.has('0,0'));
  assert.ok(!pool.floorTiles.has('7,7'), 'far corner must be culled');
});

test('renderTileGrid sweeps sprites for tiles no longer visible', () => {
  const stage = new Container();
  const layers = createPixiLayers(stage);
  const pool = createSpritePools();
  const resolve = stubResolver();
  const tileMap: TileTypeVal[][] = [[TileType.FLOOR_1, TileType.FLOOR_1]];

  const wideViewport = { canvasWidth: 100, canvasHeight: 100, offsetX: 0, offsetY: 0, zoom: 1 };
  renderTileGrid(layers.floorLayer, pool.floorTiles, tileMap, undefined, 2, wideViewport, resolve);
  assert.equal(pool.floorTiles.size, 2);

  // Pan far away — nothing should remain visible, pool should empty out.
  const farViewport = {
    canvasWidth: 10,
    canvasHeight: 10,
    offsetX: -10_000,
    offsetY: -10_000,
    zoom: 1,
  };
  renderTileGrid(layers.floorLayer, pool.floorTiles, tileMap, undefined, 2, farViewport, resolve);
  assert.equal(pool.floorTiles.size, 0);
  assert.equal(layers.floorLayer.children.length, 0);
});

// ── renderGridOverlay ───────────────────────────────────────────

test('renderGridOverlay reuses a single pooled Graphics across frames', () => {
  const stage = new Container();
  const layers = createPixiLayers(stage);
  const pool = createSpritePools();

  renderGridOverlay(layers.editorOverlayLayer, pool, 4, 3, 2);
  const first = pool.gridOverlay;
  assert.ok(first);
  assert.equal(layers.editorOverlayLayer.children.length, 1);
  assert.equal(first!.visible, true);

  renderGridOverlay(layers.editorOverlayLayer, pool, 4, 3, 2);
  assert.equal(pool.gridOverlay, first, 'must reuse the same Graphics object, not recreate it');
  assert.equal(layers.editorOverlayLayer.children.length, 1);
});

// ── Fixture helpers ─────────────────────────────────────────────

function makeChar(id: number, overrides: Partial<Character> = {}): Character {
  return {
    id,
    state: CharacterState.IDLE,
    dir: Direction.DOWN,
    x: 100,
    y: 100,
    tileCol: 6,
    tileRow: 6,
    path: [],
    moveProgress: 0,
    currentTool: null,
    palette: 0,
    hueShift: 0,
    frame: 0,
    frameTimer: 0,
    wanderTimer: 0,
    wanderCount: 0,
    wanderLimit: 5,
    isActive: false,
    seatId: null,
    bubbleType: null,
    bubbleTimer: 0,
    seatTimer: 0,
    isSubagent: false,
    parentAgentId: null,
    matrixEffect: null,
    matrixEffectTimer: 0,
    matrixEffectSeeds: [],
    inputTokens: 0,
    outputTokens: 0,
    ...overrides,
  };
}

function makePet(id: string, overrides: Partial<Pet> = {}): Pet {
  return {
    id,
    name: 'Claudio',
    petType: 0,
    state: PetState.IDLE,
    dir: Direction.DOWN,
    x: 50,
    y: 50,
    tileCol: 3,
    tileRow: 3,
    path: [],
    moveProgress: 0,
    frame: 0,
    frameTimer: 0,
    wanderTimer: 0,
    followTargetId: null,
    followRecalcTimer: 0,
    followDuration: 0,
    followDurationLimit: 10,
    bubbleType: null,
    bubbleTimer: 0,
    ...overrides,
  };
}

function makeFurniture(overrides: Partial<FurnitureInstance> = {}): FurnitureInstance {
  return {
    sprite: flatSprite('desk-cell'),
    x: 32,
    y: 32,
    zY: 48,
    ...overrides,
  };
}

// ── renderScene ───────────────────────────────────────────────

test('renderScene creates one container per furniture item, positioned and z-sorted', () => {
  const stage = new Container();
  const layers = createPixiLayers(stage);
  const pool = new Map<string, Container>();
  const resolve = stubResolver();
  const desk = makeFurniture({ x: 16, y: 16, zY: 40 });

  renderScene(layers.sceneLayer, pool, [desk], [], null, null, [], resolve);

  assert.equal(pool.size, 1);
  const container = pool.get('f0')!;
  assert.equal(layers.sceneLayer.children.includes(container), true);
  const sprite = container.children[0] as Sprite;
  assert.equal(sprite.position.x, 16);
  assert.equal(sprite.position.y, 16);
  assert.equal(container.zIndex, 40);
});

test('renderScene creates a 3-sprite container per character (outline/main/badge)', () => {
  const stage = new Container();
  const layers = createPixiLayers(stage);
  const pool = new Map<string, Container>();
  const resolve = stubResolver();
  const ch = makeChar(1, { x: 64, y: 64, provider: 'codex' });

  renderScene(layers.sceneLayer, pool, [], [ch], 1, null, [], resolve);

  const container = pool.get('c1')!;
  assert.equal(container.children.length, 3);
  const main = container.getChildByLabel('main') as Sprite;
  const outline = container.getChildByLabel('outline') as Sprite;
  const badge = container.getChildByLabel('badge') as Sprite;
  assert.equal(main.position.x, 64);
  // Selected agent (id 1 === selectedAgentId) shows the outline.
  assert.equal(outline.visible, true);
  // provider='codex' shows the coworker badge.
  assert.equal(badge.visible, true);
});

test('renderScene hides the outline for an unselected, unhovered character', () => {
  const stage = new Container();
  const layers = createPixiLayers(stage);
  const pool = new Map<string, Container>();
  const resolve = stubResolver();
  const ch = makeChar(2);

  renderScene(layers.sceneLayer, pool, [], [ch], null, null, [], resolve);

  const container = pool.get('c2')!;
  const outline = container.getChildByLabel('outline') as Sprite;
  assert.equal(outline.visible, false);
});

test('renderScene creates a pet container only when getPetSpriteData resolves', () => {
  const stage = new Container();
  const layers = createPixiLayers(stage);
  const pool = new Map<string, Container>();
  const resolve = stubResolver();
  // petType out of range of the loaded (likely empty, in this unit-test
  // environment) manifest resolves to null sprite data — renderScene must
  // skip it rather than throw.
  const pet = makePet('pet-1');

  assert.doesNotThrow(() => {
    renderScene(layers.sceneLayer, pool, [], [], null, null, [pet], resolve);
  });
});

test('renderScene sweeps a character no longer present in the next frame', () => {
  const stage = new Container();
  const layers = createPixiLayers(stage);
  const pool = new Map<string, Container>();
  const resolve = stubResolver();
  const ch = makeChar(3);

  renderScene(layers.sceneLayer, pool, [], [ch], null, null, [], resolve);
  assert.equal(pool.size, 1);

  renderScene(layers.sceneLayer, pool, [], [], null, null, [], resolve);
  assert.equal(pool.size, 0);
  assert.equal(layers.sceneLayer.children.length, 0);
});

// ── renderSeatIndicators ─────────────────────────────────────────

function makeSeat(overrides: Partial<Seat> = {}): Seat {
  return {
    uid: 'seat-1',
    seatCol: 5,
    seatRow: 5,
    facingDir: Direction.UP,
    assigned: false,
    ...overrides,
  };
}

test("renderSeatIndicators shows the OWN glyph for the selected agent's own seat", () => {
  const stage = new Container();
  const layers = createPixiLayers(stage);
  const pool = createSpritePools();
  const seat = makeSeat({ uid: 'seat-1', assigned: true });
  const ch = makeChar(1, { seatId: 'seat-1' });
  const seats = new Map([['seat-1', seat]]);
  const characters = new Map([[1, ch]]);

  renderSeatIndicators(layers.floorLayer, pool, seats, characters, 1, { col: 5, row: 5 });

  assert.ok(pool.seatIndicator);
  assert.equal(pool.seatIndicator!.box.visible, true);
  assert.equal(pool.seatIndicator!.glyph.text, '●');
});

test('renderSeatIndicators shows the AVAILABLE glyph for an unassigned seat', () => {
  const stage = new Container();
  const layers = createPixiLayers(stage);
  const pool = createSpritePools();
  const seat = makeSeat({ uid: 'seat-2', assigned: false });
  const ch = makeChar(1, { seatId: 'seat-1' });
  const seats = new Map([['seat-2', seat]]);
  const characters = new Map([[1, ch]]);

  renderSeatIndicators(layers.floorLayer, pool, seats, characters, 1, { col: 5, row: 5 });

  assert.equal(pool.seatIndicator!.glyph.text, '✓');
});

test("renderSeatIndicators shows the BUSY glyph for another agent's occupied seat", () => {
  const stage = new Container();
  const layers = createPixiLayers(stage);
  const pool = createSpritePools();
  const seat = makeSeat({ uid: 'seat-2', assigned: true });
  const ch = makeChar(1, { seatId: 'seat-1' });
  const seats = new Map([['seat-2', seat]]);
  const characters = new Map([[1, ch]]);

  renderSeatIndicators(layers.floorLayer, pool, seats, characters, 1, { col: 5, row: 5 });

  assert.equal(pool.seatIndicator!.glyph.text, '✗');
});

test('renderSeatIndicators hides the indicator when nothing is selected', () => {
  const stage = new Container();
  const layers = createPixiLayers(stage);
  const pool = createSpritePools();
  const seat = makeSeat();
  const seats = new Map([['seat-1', seat]]);
  const characters = new Map<number, Character>();

  renderSeatIndicators(layers.floorLayer, pool, seats, characters, null, { col: 5, row: 5 });

  assert.equal(pool.seatIndicator, null);
});

// ── renderGhostBorder ─────────────────────────────────────────────

test('renderGhostBorder creates and reuses a single pooled Graphics', () => {
  const stage = new Container();
  const layers = createPixiLayers(stage);
  const pool = createSpritePools();

  renderGhostBorder(layers.editorOverlayLayer, pool, 4, 3, 0, -1);
  const first = pool.ghostBorder;
  assert.ok(first);
  assert.equal(first!.visible, true);
  assert.equal(layers.editorOverlayLayer.children.length, 1);

  renderGhostBorder(layers.editorOverlayLayer, pool, 4, 3, 1, -1);
  assert.equal(pool.ghostBorder, first, 'must reuse the same Graphics object');
});

// ── renderGhostPreview ─────────────────────────────────────────────

test('renderGhostPreview marks invalid placement distinctly from valid', () => {
  const stage = new Container();
  const layers = createPixiLayers(stage);
  const pool = createSpritePools();
  const resolve = stubResolver();
  const sprite = flatSprite('ghost-cell');

  renderGhostPreview(layers.editorOverlayLayer, pool, sprite, 2, 2, true, false, resolve);
  assert.ok(pool.ghostPreview);
  assert.equal(pool.ghostPreview!.invalidMark.visible, false);

  renderGhostPreview(layers.editorOverlayLayer, pool, sprite, 2, 2, false, false, resolve);
  assert.equal(pool.ghostPreview!.invalidMark.visible, true);
});

test('renderGhostPreview mirrors the sprite anchor/scale when mirrored=true', () => {
  const stage = new Container();
  const layers = createPixiLayers(stage);
  const pool = createSpritePools();
  const resolve = stubResolver();
  const sprite = flatSprite('ghost-cell');

  renderGhostPreview(layers.editorOverlayLayer, pool, sprite, 2, 2, true, true, resolve);

  assert.equal(pool.ghostPreview!.sprite.scale.x, -1);
});

// ── renderSelectionHighlight ─────────────────────────────────────

test('renderSelectionHighlight creates and reuses a single pooled Graphics', () => {
  const stage = new Container();
  const layers = createPixiLayers(stage);
  const pool = createSpritePools();

  renderSelectionHighlight(layers.editorOverlayLayer, pool, 1, 1, 2, 1);
  const first = pool.selectionHighlight;
  assert.ok(first);
  assert.equal(first!.visible, true);

  renderSelectionHighlight(layers.editorOverlayLayer, pool, 3, 3, 1, 1);
  assert.equal(pool.selectionHighlight, first, 'must reuse the same Graphics object');
});

// ── renderDeleteButton / renderRotateButton ───────────────────────

test('renderDeleteButton scales its radius inversely with zoom and reuses its Graphics', () => {
  const stage = new Container();
  const layers = createPixiLayers(stage);
  const pool = createSpritePools();

  const boundsZoom1 = renderDeleteButton(layers.editorOverlayLayer, pool, 2, 2, 1, 1);
  const firstBg = pool.deleteButton!.bg;
  const boundsZoom4 = renderDeleteButton(layers.editorOverlayLayer, pool, 2, 2, 1, 4);

  assert.equal(pool.deleteButton!.bg, firstBg, 'must reuse the same Graphics object');
  assert.ok(
    boundsZoom4.radius < boundsZoom1.radius,
    'higher zoom must shrink the world-space button radius',
  );
});

test("renderRotateButton returns bounds positioned at the tile's top-left corner", () => {
  const stage = new Container();
  const layers = createPixiLayers(stage);
  const pool = createSpritePools();

  const bounds = renderRotateButton(layers.editorOverlayLayer, pool, 3, 3, 1);

  assert.ok(bounds.cx < 3 * 16, 'rotate button sits left of the tile origin');
  assert.ok(bounds.cy < 3 * 16, 'rotate button sits above the tile origin');
  assert.ok(pool.rotateButton);
});

// ── renderBubbles / renderPetBubbles ──────────────────────────────

test('renderBubbles skips a waiting-for-input agent (handled by the state chip, not a bubble)', () => {
  const stage = new Container();
  const layers = createPixiLayers(stage);
  const pool = new Map<number, Sprite>();
  const resolve = stubResolver();
  const ch = makeChar(1, { bubbleType: 'waiting', waitingAwaitingInput: true });

  renderBubbles(layers.bubbleLayer, pool, [ch], resolve);

  assert.equal(pool.size, 0);
});

test('renderBubbles renders a permission bubble and sweeps it once cleared', () => {
  const stage = new Container();
  const layers = createPixiLayers(stage);
  const pool = new Map<number, Sprite>();
  const resolve = stubResolver();
  const ch = makeChar(1, { bubbleType: 'permission' });

  renderBubbles(layers.bubbleLayer, pool, [ch], resolve);
  assert.equal(pool.size, 1);
  assert.equal(pool.get(1)!.visible, true);

  ch.bubbleType = null;
  renderBubbles(layers.bubbleLayer, pool, [ch], resolve);
  assert.equal(pool.size, 0);
  assert.equal(layers.bubbleLayer.children.length, 0);
});

test('renderPetBubbles renders a heart bubble for a pet with an active bubbleType', () => {
  const stage = new Container();
  const layers = createPixiLayers(stage);
  const pool = new Map<string, Sprite>();
  const resolve = stubResolver();
  const pet = makePet('pet-1', { bubbleType: 'heart', bubbleTimer: 1 });

  renderPetBubbles(layers.bubbleLayer, pool, [pet], resolve);

  assert.equal(pool.size, 1);
  assert.equal(pool.get('pet-1')!.visible, true);
});

// ── renderFrame (orchestrator) ─────────────────────────────────────

test('renderFrame centers the world container from cols/rows/zoom/pan and returns the same offset', () => {
  const stage = new Container();
  const layers = createPixiLayers(stage);
  const pools = createSpritePools();
  const resolve = stubResolver();
  const tileMap: TileTypeVal[][] = [
    [TileType.FLOOR_1, TileType.FLOOR_1],
    [TileType.FLOOR_1, TileType.FLOOR_1],
  ];

  const { offsetX, offsetY } = renderFrame(
    layers,
    pools,
    200,
    200,
    tileMap,
    [],
    [],
    2,
    10,
    -5,
    resolve,
  );

  // mapW = 2*16*2=64, mapH=64; offsetX = floor((200-64)/2) + round(10) = 68+10=78
  assert.equal(offsetX, 78);
  assert.equal(offsetY, 63);
  assert.equal(layers.world.position.x, offsetX);
  assert.equal(layers.world.position.y, offsetY);
  assert.equal(layers.world.scale.x, 2);
});

test('renderFrame without an editor param hides any previously-shown editor overlays', () => {
  const stage = new Container();
  const layers = createPixiLayers(stage);
  const pools = createSpritePools();
  const resolve = stubResolver();
  const tileMap: TileTypeVal[][] = [[TileType.FLOOR_1]];

  // First frame: editor overlay visible (grid shown).
  renderFrame(layers, pools, 100, 100, tileMap, [], [], 1, 0, 0, resolve, undefined, {
    showGrid: true,
    ghostSprite: null,
    ghostMirrored: false,
    ghostCol: -1,
    ghostRow: -1,
    ghostValid: true,
    selectedCol: 0,
    selectedRow: 0,
    selectedW: 0,
    selectedH: 0,
    hasSelection: false,
    isRotatable: false,
    deleteButtonBounds: null,
    rotateButtonBounds: null,
    showGhostBorder: false,
    ghostBorderHoverCol: -999,
    ghostBorderHoverRow: -999,
  });
  assert.equal(pools.gridOverlay!.visible, true);

  // Next frame: no editor state at all (edit mode exited) — overlay hides.
  renderFrame(layers, pools, 100, 100, tileMap, [], [], 1, 0, 0, resolve);
  assert.equal(pools.gridOverlay!.visible, false);
});

// ── SpriteData sanity (unused var guard) ───────────────────────

test('flatSprite helper produces a 1x1 grid', () => {
  assert.deepEqual(flatSprite('opaque'), [['opaque']]);
});
