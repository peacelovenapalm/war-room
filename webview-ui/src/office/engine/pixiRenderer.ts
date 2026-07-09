/**
 * PixiJS scene-graph renderer (G0 engine swap — replaces renderer.ts).
 *
 * Architecture (GAME-DESIGN.md §8.1): `app.stage → world (camera) →
 * floorLayer / sceneLayer / bubbleLayer / crisisLayer / editorOverlayLayer`.
 * `world`'s position/scale carries the pan offset + zoom for the WHOLE tree,
 * so every child below it draws in raw world-tile-pixel coordinates — the
 * same units `Character.x/y`, `FurnitureInstance.x/y`, tile col*TILE_SIZE
 * etc. already use. This eliminates the manual `offsetX + n*zoom` math the
 * old canvas renderer needed at every draw call.
 *
 * Each function below is one draw concern, taking a `PixiRenderContext`
 * (layers + per-entity sprite pools + an injectable SpriteData→Texture
 * resolver) and mutating scene-graph state (create/update/remove Pixi
 * display objects) rather than issuing immediate-mode draw calls. This is
 * what makes the functions unit-testable under plain Node (no canvas/WebGL
 * needed — see pixiRenderer.test.ts): tests inject a stub resolver and
 * assert on children counts / positions / zIndex / visibility.
 */
import type { Texture } from 'pixi.js';
import { Container, Graphics, Sprite, Text } from 'pixi.js';

import type { ColorValue } from '../../components/ui/types.js';
import {
  BUTTON_ICON_COLOR,
  CHARACTER_SITTING_OFFSET_PX,
  CHARACTER_Z_SORT_OFFSET,
  DELETE_BUTTON_BG,
  GHOST_BORDER_HOVER_FILL,
  GHOST_BORDER_HOVER_STROKE,
  GHOST_BORDER_STROKE,
  GHOST_INVALID_TINT,
  GHOST_PREVIEW_SPRITE_ALPHA,
  GHOST_PREVIEW_TINT_ALPHA,
  GHOST_VALID_TINT,
  GRID_LINE_COLOR,
  HOVERED_OUTLINE_ALPHA,
  OUTLINE_Z_SORT_OFFSET,
  OVERLAY_GLYPH_COLOR,
  OVERLAY_GLYPH_OUTLINE_COLOR,
  ROTATE_BUTTON_BG,
  SEAT_AVAILABLE_COLOR,
  SEAT_BUSY_COLOR,
  SEAT_OWN_COLOR,
  SELECTED_OUTLINE_ALPHA,
  SELECTION_HIGHLIGHT_COLOR,
  VOID_TILE_OUTLINE_COLOR,
} from '../../constants.js';
import type { DebrisRecord, ExtinguishEffect } from '../crisis.js';
import { getColorizedFloorSprite, WALL_COLOR } from '../floorTiles.js';
import { getCoworkerBadge } from '../sprites/coworkerSprites.js';
import { getSpriteTexture } from '../sprites/manifestToPixiSpritesheet.js';
import { getPetSprites } from '../sprites/petSpriteData.js';
import { getOutlineSprite } from '../sprites/spriteCache.js';
import {
  BUBBLE_HEART_SPRITE,
  BUBBLE_PERMISSION_SPRITE,
  BUBBLE_WAITING_SPRITE,
  getCharacterSprites,
} from '../sprites/spriteData.js';
import type {
  Character,
  FurnitureInstance,
  Pet,
  Seat,
  SpriteData,
  TileType as TileTypeVal,
} from '../types.js';
import { CharacterState, TILE_SIZE, TileType } from '../types.js';
import { getWallInstances, hasWallSprites, wallColorToHex } from '../wallTiles.js';
import { getCharacterSprite } from './characters.js';
import { getPetSpriteData } from './petEntity.js';
import { renderCrisisEffects as portCrisisEffects } from './pixiCrisisEffects.js';
import { renderMatrixEffect } from './pixiMatrixEffect.js';
import { pooledSprite, sweepSpritePool } from './spritePool.js';

/** Resolves a SpriteData grid to a Pixi Texture. Production code always uses
 *  `getSpriteTexture` (real GPU upload); tests inject a stub so scene-graph
 *  assertions run without `document`/WebGL. */
export type TextureResolver = (sprite: SpriteData) => Texture;

// ── Layers ────────────────────────────────────────────────────────

export interface PixiLayers {
  /** Camera: position = pan offset, scale = zoom. Every layer below draws
   *  in raw world-tile-pixel coordinates. */
  world: Container;
  floorLayer: Container;
  /** Walls + furniture + characters + pets, depth-sorted by zIndex. */
  sceneLayer: Container;
  bubbleLayer: Container;
  crisisLayer: Container;
  editorOverlayLayer: Container;
}

export function createPixiLayers(stage: Container): PixiLayers {
  const world = new Container();
  const floorLayer = new Container();
  const sceneLayer = new Container();
  sceneLayer.sortableChildren = true;
  const bubbleLayer = new Container();
  const crisisLayer = new Container();
  const editorOverlayLayer = new Container();
  world.addChild(floorLayer, sceneLayer, bubbleLayer, crisisLayer, editorOverlayLayer);
  stage.addChild(world);
  return { world, floorLayer, sceneLayer, bubbleLayer, crisisLayer, editorOverlayLayer };
}

// ── Sprite pools (per-entity-id, mirrors officeState.ts's own keying) ──────

export interface PixiSpritePools {
  /** Floor + wall-fallback tiles, keyed `${row},${col}`. */
  floorTiles: Map<string, Sprite | Graphics>;
  /** Walls/furniture/characters/pets in `sceneLayer`, keyed `w${i}`/`f${i}`/
   *  `c${id}`/`p${id}` (walls+furniture share the combined-array index the
   *  same way `renderScene`'s caller already merges them). */
  sceneItems: Map<string, Container>;
  bubbles: Map<number, Sprite>;
  petBubbles: Map<string, Sprite>;
  seatIndicator: { box: Graphics; glyph: Text } | null;
  gridOverlay: Graphics | null;
  ghostBorder: Graphics | null;
  ghostPreview: { sprite: Sprite; tint: Graphics; invalidMark: Graphics } | null;
  selectionHighlight: Graphics | null;
  deleteButton: { bg: Graphics; mark: Graphics } | null;
  rotateButton: { bg: Graphics; mark: Graphics } | null;
  crisisItems: Map<string, Sprite>;
  /** G2, GAME-DESIGN §5.7 — room-tag drag-rectangle preview. */
  roomTagPreview: Graphics | null;
  /** G2, GAME-DESIGN §5.2 — next-bay LOCKED ghost preview. */
  bayGhost: { border: Graphics; label: Text } | null;
}

export function createSpritePools(): PixiSpritePools {
  return {
    floorTiles: new Map(),
    sceneItems: new Map(),
    bubbles: new Map(),
    petBubbles: new Map(),
    seatIndicator: null,
    gridOverlay: null,
    ghostBorder: null,
    ghostPreview: null,
    selectionHighlight: null,
    deleteButton: null,
    rotateButton: null,
    crisisItems: new Map(),
    roomTagPreview: null,
    bayGhost: null,
  };
}

// ── Floor tiles (viewport-culled — GAME-DESIGN §5.6 / BUILD-PLAN task 4) ──

export interface Viewport {
  canvasWidth: number;
  canvasHeight: number;
  offsetX: number;
  offsetY: number;
  zoom: number;
}

/** World-pixel-space visible rect, expanded by a 1-tile margin, in tile
 *  col/row bounds (clamped to the layout). Tiles outside this range are
 *  skipped entirely — never rasterized, never given a Sprite. */
function visibleTileRange(
  viewport: Viewport,
  tmCols: number,
  tmRows: number,
): { colMin: number; colMax: number; rowMin: number; rowMax: number } {
  const { canvasWidth, canvasHeight, offsetX, offsetY, zoom } = viewport;
  const left = -offsetX / zoom;
  const top = -offsetY / zoom;
  const right = (canvasWidth - offsetX) / zoom;
  const bottom = (canvasHeight - offsetY) / zoom;
  const colMin = Math.max(0, Math.floor(left / TILE_SIZE) - 1);
  const colMax = Math.min(tmCols - 1, Math.ceil(right / TILE_SIZE) + 1);
  const rowMin = Math.max(0, Math.floor(top / TILE_SIZE) - 1);
  const rowMax = Math.min(tmRows - 1, Math.ceil(bottom / TILE_SIZE) + 1);
  return { colMin, colMax, rowMin, rowMax };
}

/** @internal */
export function renderTileGrid(
  floorLayer: Container,
  pool: Map<string, Sprite | Graphics>,
  tileMap: TileTypeVal[][],
  tileColors: Array<ColorValue | null> | undefined,
  cols: number | undefined,
  viewport: Viewport,
  resolveTexture: TextureResolver,
): void {
  const tmRows = tileMap.length;
  const tmCols = tmRows > 0 ? tileMap[0].length : 0;
  const layoutCols = cols ?? tmCols;
  const { colMin, colMax, rowMin, rowMax } = visibleTileRange(viewport, tmCols, tmRows);
  const active = new Set<string>();

  for (let r = rowMin; r <= rowMax; r++) {
    for (let c = colMin; c <= colMax; c++) {
      const tile = tileMap[r][c];
      if (tile === TileType.VOID) continue;
      const key = `${r},${c}`;
      active.add(key);
      const colorIdx = r * layoutCols + c;

      if (tile === TileType.WALL) {
        const wallColor = tileColors?.[colorIdx];
        const fill = wallColor ? wallColorToHex(wallColor) : WALL_COLOR;
        let gfx = pool.get(key);
        if (!(gfx instanceof Graphics)) {
          if (gfx) floorLayer.removeChild(gfx);
          gfx = new Graphics();
          pool.set(key, gfx);
          floorLayer.addChild(gfx);
        }
        gfx.clear();
        gfx.rect(0, 0, TILE_SIZE, TILE_SIZE).fill(fill);
        gfx.position.set(c * TILE_SIZE, r * TILE_SIZE);
        continue;
      }

      // Floor tile
      const color = tileColors?.[colorIdx] ?? { h: 0, s: 0, b: 0, c: 0 };
      const spriteData = getColorizedFloorSprite(tile, color);
      const texture = resolveTexture(spriteData);
      let sprite = pool.get(key);
      if (!(sprite instanceof Sprite)) {
        if (sprite) floorLayer.removeChild(sprite);
        sprite = new Sprite(texture);
        pool.set(key, sprite);
        floorLayer.addChild(sprite);
      }
      sprite.texture = texture;
      sprite.position.set(c * TILE_SIZE, r * TILE_SIZE);
    }
  }

  sweepSpritePool(pool, active, floorLayer);
}

// ── Scene: walls + furniture + characters + pets, z-sorted ────────────────

function applyFurnitureSprite(
  container: Container,
  f: FurnitureInstance,
  texture: Texture,
): Sprite {
  let sprite = container.children[0] as Sprite | undefined;
  if (!(sprite instanceof Sprite)) {
    sprite = new Sprite(texture);
    container.removeChildren();
    container.addChild(sprite);
  }
  sprite.texture = texture;
  if (f.mirrored) {
    sprite.anchor.set(1, 0);
    sprite.scale.x = -1;
  } else {
    sprite.anchor.set(0, 0);
    sprite.scale.x = 1;
  }
  sprite.position.set(f.x, f.y);
  container.zIndex = f.zY;
  return sprite;
}

function applyCharacterContainer(
  container: Container,
  ch: Character,
  spriteData: SpriteData,
  resolveTexture: TextureResolver,
  isSelected: boolean,
  isHovered: boolean,
): void {
  const sittingOffset = ch.state === CharacterState.TYPE ? CHARACTER_SITTING_OFFSET_PX : 0;
  const anchorX = ch.x;
  const anchorY = ch.y + sittingOffset;
  const charZY = ch.y + TILE_SIZE / 2 + CHARACTER_Z_SORT_OFFSET;
  container.zIndex = charZY;

  if (ch.matrixEffect) {
    // Per-pixel spawn/despawn sweep — rasterized fresh each frame onto a
    // scratch canvas by the ported matrixEffect algorithm, then uploaded as
    // a one-off texture. Short-lived (MATRIX_EFFECT_DURATION_SEC ≈ 0.3s).
    let sprite = container.getChildByLabel('matrix') as Sprite | undefined;
    if (!sprite) {
      container.removeChildren();
      sprite = new Sprite();
      sprite.label = 'matrix';
      container.addChild(sprite);
    }
    const result = renderMatrixEffect(ch, spriteData);
    if (result) {
      sprite.texture = result.texture;
      // Anchor at TOP (not bottom) — the matrix texture is shorter than the
      // full sprite (see matrixEffect.ts's header note), so bottom-anchoring
      // would shift it up relative to where the normal sprite sits.
      sprite.anchor.set(0.5, 0);
      sprite.position.set(anchorX, anchorY - result.fullSpriteHeight);
    }
    return;
  }

  let main = container.getChildByLabel('main') as Sprite | undefined;
  let outline = container.getChildByLabel('outline') as Sprite | undefined;
  let badge = container.getChildByLabel('badge') as Sprite | undefined;
  if (!main) {
    container.removeChildren();
    outline = new Sprite();
    outline.label = 'outline';
    outline.anchor.set(0.5, 1);
    main = new Sprite();
    main.label = 'main';
    main.anchor.set(0.5, 1);
    badge = new Sprite();
    badge.label = 'badge';
    badge.anchor.set(0.5, 1);
    container.addChild(outline, main, badge);
  }

  const texture = resolveTexture(spriteData);
  main!.texture = texture;
  main!.position.set(anchorX, anchorY);
  main!.zIndex = 1;

  if (isSelected || isHovered) {
    const outlineData = getOutlineSprite(spriteData);
    outline!.texture = resolveTexture(outlineData);
    outline!.alpha = isSelected ? SELECTED_OUTLINE_ALPHA : HOVERED_OUTLINE_ALPHA;
    outline!.position.set(anchorX, anchorY);
    outline!.visible = true;
    outline!.zIndex = 1 - OUTLINE_Z_SORT_OFFSET;
  } else if (outline) {
    outline.visible = false;
  }

  if (ch.provider) {
    const badgeTexture = resolveTexture(getCoworkerBadge(ch.provider));
    badge!.texture = badgeTexture;
    badge!.position.set(anchorX, anchorY - main!.texture.height - 1);
    badge!.visible = true;
  } else if (badge) {
    badge.visible = false;
  }
}

function applyPetSprite(container: Container, pet: Pet, texture: Texture): void {
  let sprite = container.children[0] as Sprite | undefined;
  if (!(sprite instanceof Sprite)) {
    sprite = new Sprite(texture);
    sprite.anchor.set(0.5, 1);
    container.removeChildren();
    container.addChild(sprite);
  }
  sprite.texture = texture;
  sprite.position.set(pet.x, pet.y);
  container.zIndex = pet.y + TILE_SIZE / 2;
}

/** @internal */
export function renderScene(
  sceneLayer: Container,
  pool: Map<string, Container>,
  furniture: FurnitureInstance[],
  characters: Character[],
  selectedAgentId: number | null,
  hoveredAgentId: number | null,
  pets: Pet[],
  resolveTexture: TextureResolver,
): void {
  const active = new Set<string>();

  furniture.forEach((f, i) => {
    const key = `f${i}`;
    active.add(key);
    let container = pool.get(key);
    if (!container) {
      container = new Container();
      pool.set(key, container);
      sceneLayer.addChild(container);
    }
    applyFurnitureSprite(container, f, resolveTexture(f.sprite));
  });

  for (const ch of characters) {
    const key = `c${ch.id}`;
    active.add(key);
    let container = pool.get(key);
    if (!container) {
      container = new Container();
      pool.set(key, container);
      sceneLayer.addChild(container);
    }
    const sprites = getCharacterSprites(ch.palette, ch.hueShift);
    const spriteData = getCharacterSprite(ch, sprites);
    applyCharacterContainer(
      container,
      ch,
      spriteData,
      resolveTexture,
      selectedAgentId !== null && ch.id === selectedAgentId,
      hoveredAgentId !== null && ch.id === hoveredAgentId,
    );
  }

  for (const pet of pets) {
    const key = `p${pet.id}`;
    const petSprites = getPetSprites(pet.petType);
    const spriteData = getPetSpriteData(pet, petSprites);
    if (!spriteData) continue;
    active.add(key);
    let container = pool.get(key);
    if (!container) {
      container = new Container();
      pool.set(key, container);
      sceneLayer.addChild(container);
    }
    applyPetSprite(container, pet, resolveTexture(spriteData));
  }

  sweepSpritePool(pool, active, sceneLayer);
}

/** Merge wall auto-tile instances with furniture for z-sorted rendering —
 *  mirrors the old renderFrame's `[...wallInstances, ...furniture]` build. */
export function buildWallAndFurnitureList(
  tileMap: TileTypeVal[][],
  furniture: FurnitureInstance[],
  tileColors?: Array<ColorValue | null>,
  layoutCols?: number,
): FurnitureInstance[] {
  const wallInstances = hasWallSprites() ? getWallInstances(tileMap, tileColors, layoutCols) : [];
  return wallInstances.length > 0 ? [...wallInstances, ...furniture] : furniture;
}

// ── Seat indicators ─────────────────────────────────────────────

/** @internal */
export function renderSeatIndicators(
  floorLayer: Container,
  pool: PixiSpritePools,
  seats: Map<string, Seat>,
  characters: Map<number, Character>,
  selectedAgentId: number | null,
  hoveredTile: { col: number; row: number } | null,
): void {
  if (selectedAgentId === null || !hoveredTile) {
    if (pool.seatIndicator) pool.seatIndicator.box.visible = false;
    return;
  }
  const selectedChar = characters.get(selectedAgentId);
  if (!selectedChar) {
    if (pool.seatIndicator) pool.seatIndicator.box.visible = false;
    return;
  }

  for (const [uid, seat] of seats) {
    if (seat.seatCol !== hoveredTile.col || seat.seatRow !== hoveredTile.row) continue;

    if (!pool.seatIndicator) {
      const box = new Graphics();
      const glyph = new Text({
        text: '',
        style: { fontSize: 10, fill: OVERLAY_GLYPH_COLOR, fontWeight: 'bold' },
      });
      glyph.anchor.set(0.5, 0.5);
      floorLayer.addChild(box, glyph);
      pool.seatIndicator = { box, glyph };
    }
    const { box, glyph } = pool.seatIndicator;

    let fill: string;
    let text: string;
    if (selectedChar.seatId === uid) {
      fill = SEAT_OWN_COLOR;
      text = '●';
    } else if (!seat.assigned) {
      fill = SEAT_AVAILABLE_COLOR;
      text = '✓';
    } else {
      fill = SEAT_BUSY_COLOR;
      text = '✗';
    }
    box.clear();
    box.rect(0, 0, TILE_SIZE, TILE_SIZE).fill(fill);
    box.position.set(seat.seatCol * TILE_SIZE, seat.seatRow * TILE_SIZE);
    box.visible = true;
    glyph.text = text;
    glyph.style.stroke = { color: OVERLAY_GLYPH_OUTLINE_COLOR, width: 2 };
    glyph.position.set(
      seat.seatCol * TILE_SIZE + TILE_SIZE / 2,
      seat.seatRow * TILE_SIZE + TILE_SIZE / 2,
    );
    glyph.visible = true;
    return;
  }

  if (pool.seatIndicator) pool.seatIndicator.box.visible = false;
}

// ── Editor overlays ──────────────────────────────────────────────

/** Manual dashed-rect stroke — Pixi v8 Graphics has no native line-dash. */
function dashedRect(
  gfx: Graphics,
  x: number,
  y: number,
  w: number,
  h: number,
  dash: number,
  gap: number,
  color: string,
): void {
  const perimeter = [
    [x, y, x + w, y],
    [x + w, y, x + w, y + h],
    [x + w, y + h, x, y + h],
    [x, y + h, x, y],
  ] as const;
  for (const [x1, y1, x2, y2] of perimeter) {
    const len = Math.hypot(x2 - x1, y2 - y1);
    const dx = (x2 - x1) / len;
    const dy = (y2 - y1) / len;
    let dist = 0;
    let on = true;
    while (dist < len) {
      const step = Math.min(on ? dash : gap, len - dist);
      if (on) {
        gfx.moveTo(x1 + dx * dist, y1 + dy * dist);
        gfx.lineTo(x1 + dx * (dist + step), y1 + dy * (dist + step));
      }
      dist += step;
      on = !on;
    }
  }
  gfx.stroke({ width: 1, color });
}

/** @internal */
export function renderGridOverlay(
  editorOverlayLayer: Container,
  pool: PixiSpritePools,
  cols: number,
  rows: number,
  zoom: number,
  tileMap?: TileTypeVal[][],
): void {
  if (!pool.gridOverlay) {
    pool.gridOverlay = new Graphics();
    editorOverlayLayer.addChild(pool.gridOverlay);
  }
  const gfx = pool.gridOverlay;
  gfx.clear();
  gfx.visible = true;
  const w = cols * TILE_SIZE;
  const h = rows * TILE_SIZE;
  const lineWidth = Math.max(0.25, 1 / zoom);
  for (let c = 0; c <= cols; c++) {
    gfx.moveTo(c * TILE_SIZE, 0);
    gfx.lineTo(c * TILE_SIZE, h);
  }
  for (let r = 0; r <= rows; r++) {
    gfx.moveTo(0, r * TILE_SIZE);
    gfx.lineTo(w, r * TILE_SIZE);
  }
  gfx.stroke({ width: lineWidth, color: GRID_LINE_COLOR });

  if (tileMap) {
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (tileMap[r]?.[c] === TileType.VOID) {
          dashedRect(
            gfx,
            c * TILE_SIZE,
            r * TILE_SIZE,
            TILE_SIZE,
            TILE_SIZE,
            2,
            2,
            VOID_TILE_OUTLINE_COLOR,
          );
        }
      }
    }
  }
}

/** @internal */
export function renderGhostBorder(
  editorOverlayLayer: Container,
  pool: PixiSpritePools,
  cols: number,
  rows: number,
  ghostHoverCol: number,
  ghostHoverRow: number,
): void {
  if (!pool.ghostBorder) {
    pool.ghostBorder = new Graphics();
    editorOverlayLayer.addChild(pool.ghostBorder);
  }
  const gfx = pool.ghostBorder;
  gfx.clear();
  gfx.visible = true;

  const ghostTiles: Array<{ c: number; r: number }> = [];
  for (let c = -1; c <= cols; c++) {
    ghostTiles.push({ c, r: -1 });
    ghostTiles.push({ c, r: rows });
  }
  for (let r = 0; r < rows; r++) {
    ghostTiles.push({ c: -1, r });
    ghostTiles.push({ c: cols, r });
  }

  for (const { c, r } of ghostTiles) {
    const x = c * TILE_SIZE;
    const y = r * TILE_SIZE;
    const isHovered = c === ghostHoverCol && r === ghostHoverRow;
    if (isHovered) {
      gfx.rect(x, y, TILE_SIZE, TILE_SIZE).fill(GHOST_BORDER_HOVER_FILL);
    }
    dashedRect(
      gfx,
      x,
      y,
      TILE_SIZE,
      TILE_SIZE,
      2,
      2,
      isHovered ? GHOST_BORDER_HOVER_STROKE : GHOST_BORDER_STROKE,
    );
  }
}

/** Room-tag drag-rectangle preview (G2, GAME-DESIGN §5.7) — a single
 *  dashed rectangle spanning the in-progress drag selection, shape+text
 *  only (colorblind rule: the stroke color is reinforcement, the dashed
 *  pattern + explicit boundary are the primary signal). */
export function renderRoomTagPreview(
  editorOverlayLayer: Container,
  pool: PixiSpritePools,
  rect: { colStart: number; rowStart: number; colEnd: number; rowEnd: number } | null,
): void {
  if (!rect) {
    if (pool.roomTagPreview) pool.roomTagPreview.visible = false;
    return;
  }
  if (!pool.roomTagPreview) {
    pool.roomTagPreview = new Graphics();
    editorOverlayLayer.addChild(pool.roomTagPreview);
  }
  const gfx = pool.roomTagPreview;
  gfx.clear();
  gfx.visible = true;
  const x = rect.colStart * TILE_SIZE;
  const y = rect.rowStart * TILE_SIZE;
  const w = (rect.colEnd - rect.colStart) * TILE_SIZE;
  const h = (rect.rowEnd - rect.rowStart) * TILE_SIZE;
  gfx.rect(x, y, w, h).fill(GHOST_BORDER_HOVER_FILL);
  dashedRect(gfx, x, y, w, h, 3, 2, GHOST_BORDER_HOVER_STROKE);
}

/** Next-bay LOCKED ghost preview (G2, GAME-DESIGN §5.2) — dashed outline +
 *  "LOCKED $cost" text over the 4-col rectangle immediately right of the
 *  currently owned floor. `null` bounds (max bays reached) hides it.
 *  Reuses the same VOID-tile dashed-outline visual language the renderer
 *  already applies to unowned space (colorblind rule: shape+text, never
 *  color alone). */
export function renderBayGhost(
  editorOverlayLayer: Container,
  pool: PixiSpritePools,
  bounds: { col: number; row: number; w: number; h: number; cost: number } | null,
): void {
  if (!bounds) {
    if (pool.bayGhost) {
      pool.bayGhost.border.visible = false;
      pool.bayGhost.label.visible = false;
    }
    return;
  }
  if (!pool.bayGhost) {
    const border = new Graphics();
    const label = new Text({
      text: '',
      style: { fontSize: 10, fill: OVERLAY_GLYPH_COLOR, fontWeight: 'bold', align: 'center' },
    });
    label.anchor.set(0.5, 0.5);
    editorOverlayLayer.addChild(border, label);
    pool.bayGhost = { border, label };
  }
  const { border, label } = pool.bayGhost;
  const x = bounds.col * TILE_SIZE;
  const y = bounds.row * TILE_SIZE;
  const w = bounds.w * TILE_SIZE;
  const h = bounds.h * TILE_SIZE;
  border.clear();
  border.visible = true;
  dashedRect(border, x, y, w, h, 2, 2, VOID_TILE_OUTLINE_COLOR);
  // Pixi re-rasterizes the text texture on every `.text` write, even when
  // the value is unchanged — guard against reassigning it every frame
  // (this pegged the render loop's CPU when tested against a real browser).
  const nextText = `LOCKED\n$${bounds.cost}`;
  if (label.text !== nextText) label.text = nextText;
  label.style.stroke = { color: OVERLAY_GLYPH_OUTLINE_COLOR, width: 2 };
  label.position.set(x + w / 2, y + h / 2);
  label.visible = true;
}

/** @internal */
export function renderGhostPreview(
  editorOverlayLayer: Container,
  pool: PixiSpritePools,
  sprite: SpriteData,
  col: number,
  row: number,
  valid: boolean,
  mirrored: boolean,
  resolveTexture: TextureResolver,
): void {
  if (!pool.ghostPreview) {
    const spriteObj = new Sprite();
    const tint = new Graphics();
    const invalidMark = new Graphics();
    editorOverlayLayer.addChild(spriteObj, tint, invalidMark);
    pool.ghostPreview = { sprite: spriteObj, tint, invalidMark };
  }
  const { sprite: spriteObj, tint, invalidMark } = pool.ghostPreview;
  const texture = resolveTexture(sprite);
  spriteObj.texture = texture;
  spriteObj.alpha = GHOST_PREVIEW_SPRITE_ALPHA;
  spriteObj.visible = true;
  const x = col * TILE_SIZE;
  const y = row * TILE_SIZE;
  if (mirrored) {
    spriteObj.anchor.set(1, 0);
    spriteObj.scale.x = -1;
  } else {
    spriteObj.anchor.set(0, 0);
    spriteObj.scale.x = 1;
  }
  spriteObj.position.set(x, y);

  const w = texture.width;
  const h = texture.height;
  tint.clear();
  tint.rect(0, 0, w, h).fill(valid ? GHOST_VALID_TINT : GHOST_INVALID_TINT);
  tint.alpha = GHOST_PREVIEW_TINT_ALPHA;
  tint.position.set(x, y);
  tint.visible = true;

  invalidMark.clear();
  invalidMark.visible = !valid;
  if (!valid) {
    const inset = Math.max(2, 1.5);
    invalidMark.moveTo(x + inset, y + inset);
    invalidMark.lineTo(x + w - inset, y + h - inset);
    invalidMark.moveTo(x + w - inset, y + inset);
    invalidMark.lineTo(x + inset, y + h - inset);
    invalidMark.stroke({ width: 1.5, color: OVERLAY_GLYPH_OUTLINE_COLOR, cap: 'round' });
  }
}

/** @internal */
export function renderSelectionHighlight(
  editorOverlayLayer: Container,
  pool: PixiSpritePools,
  col: number,
  row: number,
  w: number,
  h: number,
): void {
  if (!pool.selectionHighlight) {
    pool.selectionHighlight = new Graphics();
    editorOverlayLayer.addChild(pool.selectionHighlight);
  }
  const gfx = pool.selectionHighlight;
  gfx.clear();
  gfx.visible = true;
  dashedRect(
    gfx,
    col * TILE_SIZE + 1,
    row * TILE_SIZE + 1,
    w * TILE_SIZE - 2,
    h * TILE_SIZE - 2,
    4,
    3,
    SELECTION_HIGHLIGHT_COLOR,
  );
}

export interface ButtonBounds {
  cx: number;
  cy: number;
  radius: number;
}
export type DeleteButtonBounds = ButtonBounds;
export type RotateButtonBounds = ButtonBounds;

const BUTTON_MIN_RADIUS = 6;
const BUTTON_RADIUS_ZOOM_FACTOR = 3;
const BUTTON_ICON_SIZE_FACTOR = 0.45;

/** @internal */
export function renderDeleteButton(
  editorOverlayLayer: Container,
  pool: PixiSpritePools,
  col: number,
  row: number,
  w: number,
  zoom: number,
): DeleteButtonBounds {
  if (!pool.deleteButton) {
    const bg = new Graphics();
    const mark = new Graphics();
    editorOverlayLayer.addChild(bg, mark);
    pool.deleteButton = { bg, mark };
  }
  const { bg, mark } = pool.deleteButton;
  const cx = (col + w) * TILE_SIZE + 1 / zoom;
  const cy = row * TILE_SIZE - 1 / zoom;
  const radius = Math.max(BUTTON_MIN_RADIUS / zoom, BUTTON_RADIUS_ZOOM_FACTOR);

  bg.clear();
  bg.circle(cx, cy, radius).fill(DELETE_BUTTON_BG);
  bg.visible = true;

  const xSize = radius * BUTTON_ICON_SIZE_FACTOR;
  mark.clear();
  mark.moveTo(cx - xSize, cy - xSize);
  mark.lineTo(cx + xSize, cy + xSize);
  mark.moveTo(cx + xSize, cy - xSize);
  mark.lineTo(cx - xSize, cy + xSize);
  mark.stroke({ width: Math.max(1.5 / zoom, 0.5), color: BUTTON_ICON_COLOR, cap: 'round' });
  mark.visible = true;

  return { cx, cy, radius };
}

/** @internal */
export function renderRotateButton(
  editorOverlayLayer: Container,
  pool: PixiSpritePools,
  col: number,
  row: number,
  zoom: number,
): RotateButtonBounds {
  if (!pool.rotateButton) {
    const bg = new Graphics();
    const mark = new Graphics();
    editorOverlayLayer.addChild(bg, mark);
    pool.rotateButton = { bg, mark };
  }
  const { bg, mark } = pool.rotateButton;
  const radius = Math.max(BUTTON_MIN_RADIUS / zoom, BUTTON_RADIUS_ZOOM_FACTOR);
  const cx = col * TILE_SIZE - 1 / zoom;
  const cy = row * TILE_SIZE - 1 / zoom;

  bg.clear();
  bg.circle(cx, cy, radius).fill(ROTATE_BUTTON_BG);
  bg.visible = true;

  const arcR = radius * BUTTON_ICON_SIZE_FACTOR;
  mark.clear();
  mark.arc(cx, cy, arcR, -Math.PI * 0.8, Math.PI * 0.7);
  mark.stroke({ width: Math.max(1.5 / zoom, 0.5), color: BUTTON_ICON_COLOR, cap: 'round' });
  const endAngle = Math.PI * 0.7;
  const endX = cx + arcR * Math.cos(endAngle);
  const endY = cy + arcR * Math.sin(endAngle);
  const arrowSize = radius * 0.35;
  mark.moveTo(endX + arrowSize * 0.6, endY - arrowSize * 0.3);
  mark.lineTo(endX, endY);
  mark.lineTo(endX + arrowSize * 0.7, endY + arrowSize * 0.5);
  mark.stroke({ width: Math.max(1.5 / zoom, 0.5), color: BUTTON_ICON_COLOR, cap: 'round' });
  mark.visible = true;

  return { cx, cy, radius };
}

export function hideEditorOverlays(pool: PixiSpritePools): void {
  if (pool.gridOverlay) pool.gridOverlay.visible = false;
  if (pool.ghostBorder) pool.ghostBorder.visible = false;
  if (pool.ghostPreview) {
    pool.ghostPreview.sprite.visible = false;
    pool.ghostPreview.tint.visible = false;
    pool.ghostPreview.invalidMark.visible = false;
  }
  if (pool.selectionHighlight) pool.selectionHighlight.visible = false;
  if (pool.deleteButton) {
    pool.deleteButton.bg.visible = false;
    pool.deleteButton.mark.visible = false;
  }
  if (pool.rotateButton) {
    pool.rotateButton.bg.visible = false;
    pool.rotateButton.mark.visible = false;
  }
}

// ── Speech bubbles ──────────────────────────────────────────────

const BUBBLE_FADE_DURATION_SEC = 0.5;
const BUBBLE_SITTING_OFFSET_PX = 10;
const BUBBLE_VERTICAL_OFFSET_PX = 24;

/** @internal */
export function renderBubbles(
  bubbleLayer: Container,
  pool: Map<number, Sprite>,
  characters: Character[],
  resolveTexture: TextureResolver,
): void {
  const active = new Set<number>();
  for (const ch of characters) {
    if (!ch.bubbleType) continue;
    if (ch.bubbleType === 'waiting' && ch.waitingAwaitingInput) continue;

    active.add(ch.id);
    const sprite = pooledSprite(pool, bubbleLayer, ch.id, (s) => s.anchor.set(0.5, 1));

    const spriteData =
      ch.bubbleType === 'permission' ? BUBBLE_PERMISSION_SPRITE : BUBBLE_WAITING_SPRITE;
    sprite.texture = resolveTexture(spriteData);

    let alpha = 1.0;
    if (ch.bubbleType === 'waiting' && ch.bubbleTimer < BUBBLE_FADE_DURATION_SEC) {
      alpha = ch.bubbleTimer / BUBBLE_FADE_DURATION_SEC;
    }
    sprite.alpha = alpha;

    const sittingOff = ch.state === CharacterState.TYPE ? BUBBLE_SITTING_OFFSET_PX : 0;
    sprite.position.set(ch.x, ch.y + sittingOff - BUBBLE_VERTICAL_OFFSET_PX - 1);
    sprite.visible = true;
  }
  sweepSpritePool(pool, active, bubbleLayer);
}

/** @internal */
export function renderPetBubbles(
  bubbleLayer: Container,
  pool: Map<string, Sprite>,
  pets: Pet[],
  resolveTexture: TextureResolver,
): void {
  const active = new Set<string>();
  for (const pet of pets) {
    if (!pet.bubbleType) continue;
    active.add(pet.id);
    const sprite = pooledSprite(pool, bubbleLayer, pet.id, (s) => s.anchor.set(0.5, 1));
    sprite.texture = resolveTexture(BUBBLE_HEART_SPRITE);
    let alpha = 1.0;
    if (pet.bubbleTimer < BUBBLE_FADE_DURATION_SEC) {
      alpha = Math.max(0, pet.bubbleTimer / BUBBLE_FADE_DURATION_SEC);
    }
    sprite.alpha = alpha;
    sprite.position.set(pet.x, pet.y - TILE_SIZE - 1);
    sprite.visible = true;
  }
  sweepSpritePool(pool, active, bubbleLayer);
}

// ── Frame orchestrator ──────────────────────────────────────────

export interface PixiSelectionState {
  selectedAgentId: number | null;
  hoveredAgentId: number | null;
  hoveredTile: { col: number; row: number } | null;
  seats: Map<string, Seat>;
  characters: Map<number, Character>;
}

export interface PixiEditorState {
  showGrid: boolean;
  ghostSprite: SpriteData | null;
  ghostMirrored: boolean;
  ghostCol: number;
  ghostRow: number;
  ghostValid: boolean;
  selectedCol: number;
  selectedRow: number;
  selectedW: number;
  selectedH: number;
  hasSelection: boolean;
  isRotatable: boolean;
  deleteButtonBounds: DeleteButtonBounds | null;
  rotateButtonBounds: RotateButtonBounds | null;
  showGhostBorder: boolean;
  ghostBorderHoverCol: number;
  ghostBorderHoverRow: number;
  /** G2, GAME-DESIGN §5.7 — in-progress room-tag drag rectangle, or null. */
  roomTagRect?: { colStart: number; rowStart: number; colEnd: number; rowEnd: number } | null;
  /** G2, GAME-DESIGN §5.2 — next-bay LOCKED ghost bounds + cost, or null
   *  (max bays reached, or not in build mode). */
  bayGhost?: { col: number; row: number; w: number; h: number; cost: number } | null;
}

export interface PixiCrisisState {
  debris: Iterable<DebrisRecord>;
  effects: Iterable<ExtinguishEffect>;
  now: number;
  nightMode?: boolean;
}

/** Orchestrates one frame: positions the world camera, then delegates to
 *  each per-concern function. Returns the same {offsetX, offsetY} the old
 *  renderFrame did (OfficeCanvas.tsx's screen↔world hit-testing still needs
 *  it, even though child draws no longer multiply by it directly). */
export function renderFrame(
  layers: PixiLayers,
  pools: PixiSpritePools,
  canvasWidth: number,
  canvasHeight: number,
  tileMap: TileTypeVal[][],
  furniture: FurnitureInstance[],
  characters: Character[],
  zoom: number,
  panX: number,
  panY: number,
  resolveTexture: TextureResolver,
  selection?: PixiSelectionState,
  editor?: PixiEditorState,
  tileColors?: Array<ColorValue | null>,
  layoutCols?: number,
  layoutRows?: number,
  pets?: Pet[],
  crisis?: PixiCrisisState,
): { offsetX: number; offsetY: number } {
  const cols = layoutCols ?? (tileMap.length > 0 ? tileMap[0].length : 0);
  const rows = layoutRows ?? tileMap.length;

  const mapW = cols * TILE_SIZE * zoom;
  const mapH = rows * TILE_SIZE * zoom;
  const offsetX = Math.floor((canvasWidth - mapW) / 2) + Math.round(panX);
  const offsetY = Math.floor((canvasHeight - mapH) / 2) + Math.round(panY);

  layers.world.position.set(offsetX, offsetY);
  layers.world.scale.set(zoom, zoom);

  renderTileGrid(
    layers.floorLayer,
    pools.floorTiles,
    tileMap,
    tileColors,
    layoutCols,
    { canvasWidth, canvasHeight, offsetX, offsetY, zoom },
    resolveTexture,
  );

  if (selection) {
    renderSeatIndicators(
      layers.floorLayer,
      pools,
      selection.seats,
      selection.characters,
      selection.selectedAgentId,
      selection.hoveredTile,
    );
  } else if (pools.seatIndicator) {
    pools.seatIndicator.box.visible = false;
    pools.seatIndicator.glyph.visible = false;
  }

  const allFurniture = buildWallAndFurnitureList(tileMap, furniture, tileColors, layoutCols);
  renderScene(
    layers.sceneLayer,
    pools.sceneItems,
    allFurniture,
    characters,
    selection?.selectedAgentId ?? null,
    selection?.hoveredAgentId ?? null,
    pets ?? [],
    resolveTexture,
  );

  renderBubbles(layers.bubbleLayer, pools.bubbles, characters, resolveTexture);
  if (pets && pets.length > 0) {
    renderPetBubbles(layers.bubbleLayer, pools.petBubbles, pets, resolveTexture);
  } else {
    for (const [, sprite] of pools.petBubbles) sprite.visible = false;
  }

  if (crisis) {
    portCrisisEffects(
      layers.crisisLayer,
      pools.crisisItems,
      characters,
      crisis.debris,
      crisis.effects,
      resolveTexture,
      crisis.now,
    );
  }

  if (editor) {
    if (editor.showGrid) {
      renderGridOverlay(layers.editorOverlayLayer, pools, cols, rows, zoom, tileMap);
    } else if (pools.gridOverlay) {
      pools.gridOverlay.visible = false;
    }
    if (editor.showGhostBorder) {
      renderGhostBorder(
        layers.editorOverlayLayer,
        pools,
        cols,
        rows,
        editor.ghostBorderHoverCol,
        editor.ghostBorderHoverRow,
      );
    } else if (pools.ghostBorder) {
      pools.ghostBorder.visible = false;
    }
    renderRoomTagPreview(layers.editorOverlayLayer, pools, editor.roomTagRect ?? null);
    renderBayGhost(layers.editorOverlayLayer, pools, editor.bayGhost ?? null);
    if (editor.ghostSprite && editor.ghostCol >= 0) {
      renderGhostPreview(
        layers.editorOverlayLayer,
        pools,
        editor.ghostSprite,
        editor.ghostCol,
        editor.ghostRow,
        editor.ghostValid,
        editor.ghostMirrored,
        resolveTexture,
      );
    } else if (pools.ghostPreview) {
      pools.ghostPreview.sprite.visible = false;
      pools.ghostPreview.tint.visible = false;
      pools.ghostPreview.invalidMark.visible = false;
    }
    if (editor.hasSelection) {
      renderSelectionHighlight(
        layers.editorOverlayLayer,
        pools,
        editor.selectedCol,
        editor.selectedRow,
        editor.selectedW,
        editor.selectedH,
      );
      editor.deleteButtonBounds = renderDeleteButton(
        layers.editorOverlayLayer,
        pools,
        editor.selectedCol,
        editor.selectedRow,
        editor.selectedW,
        zoom,
      );
      if (editor.isRotatable) {
        editor.rotateButtonBounds = renderRotateButton(
          layers.editorOverlayLayer,
          pools,
          editor.selectedCol,
          editor.selectedRow,
          zoom,
        );
      } else if (pools.rotateButton) {
        pools.rotateButton.bg.visible = false;
        pools.rotateButton.mark.visible = false;
        editor.rotateButtonBounds = null;
      }
    } else {
      if (pools.selectionHighlight) pools.selectionHighlight.visible = false;
      if (pools.deleteButton) {
        pools.deleteButton.bg.visible = false;
        pools.deleteButton.mark.visible = false;
      }
      if (pools.rotateButton) {
        pools.rotateButton.bg.visible = false;
        pools.rotateButton.mark.visible = false;
      }
      editor.deleteButtonBounds = null;
      editor.rotateButtonBounds = null;
    }
  } else {
    hideEditorOverlays(pools);
  }

  return { offsetX, offsetY };
}

export { getSpriteTexture };
