/**
 * Scene-graph tests for pixiRenderer.ts. Runs under plain Node (this repo's
 * vitest `environment: 'node'` — no jsdom): Pixi's core Container/Sprite/
 * Graphics/Texture classes construct fine without a canvas/WebGL context;
 * only `Application.init()` and `Texture.from(canvas)` need a browser, and
 * neither is exercised here — a stub `TextureResolver` stands in for
 * `getSpriteTexture` so assertions can check "which SpriteData resolved to
 * which Texture" without ever touching `document`.
 */
import assert from 'node:assert/strict';

import { Container, Texture } from 'pixi.js';
import { test } from 'vitest';

import type { TextureResolver } from '../src/office/engine/pixiRenderer.js';
import {
  createPixiLayers,
  createSpritePools,
  renderGridOverlay,
  renderTileGrid,
} from '../src/office/engine/pixiRenderer.js';
import type { SpriteData, TileType as TileTypeVal } from '../src/office/types.js';
import { TileType } from '../src/office/types.js';

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

// ── SpriteData sanity (unused var guard) ───────────────────────

test('flatSprite helper produces a 1x1 grid', () => {
  assert.deepEqual(flatSprite('opaque'), [['opaque']]);
});
