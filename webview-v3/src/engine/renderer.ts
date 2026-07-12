/**
 * Canvas 2D world renderer. Owns the transform stack:
 *
 *   backing store = CSS size x resolution   (resolution.ts — capped DPR)
 *   world pass    = setTransform(resolution * zoom, ..., resolution * offset)
 *
 * Stage-2 contract: the canvas draws ONLY world geometry + glow. ALL text
 * (desk chips, board, tails, HUD) is DOM, positioned by the caller via
 * worldToCanvas — crisp, selectable, decluttered (engine/chipLayout.ts).
 *
 * The camera is computed by the caller from CSS size only; this module
 * never reads display density (it receives `resolution` as a plain number
 * from engine/resolution.ts, the one permitted DPR read).
 *
 * Real sprites (WS-B pipeline, wired KICKOFF-v3.1 "lights on" pass): every
 * world element tries its named sprite via the injected asset stores first
 * and falls back to the stage-1 procedural placeholder box/diamond
 * per-element when that sprite's sheet hasn't landed yet — skeleton-first
 * (MOBILE-FORENSICS constraint 3): a slow/failed sheet degrades that ONE
 * element, never blanks the frame.
 */

import type { ImageResolution, SpriteResolution } from '../assets/loader';
import type { Rotation, SpriteDef } from '../assets/manifest';
import {
  ambientWashColor,
  COLOR_DESK_GLOW,
  COLOR_DESK_LEFT,
  COLOR_DESK_RIGHT,
  COLOR_DESK_TOP,
  COLOR_FLOOR_A,
  COLOR_FLOOR_B,
  COLOR_FLOOR_EDGE,
  COLOR_OCCUPANT_LEFT,
  COLOR_OCCUPANT_RIGHT,
  COLOR_OCCUPANT_TOP,
  COLOR_PROP_LEFT,
  COLOR_PROP_RIGHT,
  COLOR_PROP_TOP,
  COLOR_WALKER_LEFT,
  COLOR_WALKER_RIGHT,
  COLOR_WALKER_TOP,
  COLOR_WORLD_BG,
} from '../constants';
import type { CameraState, Size } from './camera';
import { sortByDepth } from './depthSort';
import { TILE_H, TILE_W, tileToWorld } from './iso';
import { type BoxPalette, drawDiamondTile, drawIsoBox } from './placeholder';
import { drawSprite } from './spriteRenderer';
import { animationFrameIndex, spriteScaleFor } from './sprites';
import {
  CAT_CURL_SPRITE,
  CAT_WALK_SPRITE,
  DESK_CHAIR_SPRITE,
  DESK_MONITOR_SPRITE,
  floorSpriteName,
  occupantPoseFor,
  outfitForAgent,
  PROP_SPRITE_NAMES,
  wallSpriteName,
  workerSpriteName,
  type WorldProp,
} from './world';

export interface AssetStoreLike<TResolution> {
  request(names: readonly string[]): void;
  get(name: string): TResolution;
}

export interface RenderAssets {
  /** Frame timestamp for animation-frame selection (Date.now() at call
   *  time — NOT performance.now(), matching the rest of the app's clock). */
  now: number;
  propStore: AssetStoreLike<SpriteResolution<CanvasImageSource>>;
  characterStore: AssetStoreLike<SpriteResolution<CanvasImageSource>>;
  imageStore?: AssetStoreLike<ImageResolution<CanvasImageSource>>;
}

/** A flavor poster/placard mounted on the back wall — world-anchored so it
 *  pans/zooms with the camera like everything else. Pure decoration (no
 *  signal any hard rule applies to): drawn only once its image lands, no
 *  placeholder needed for an absent poster. */
export interface PosterPlacement {
  name: string;
  tileX: number;
  tileY: number;
  /** Displayed width in world px; height follows the source aspect ratio. */
  worldWidth: number;
}

export interface RenderInput {
  cssSize: Size;
  /** Capped backing-store density from engine/resolution.ts. */
  resolution: number;
  camera: CameraState;
  cols: number;
  rows: number;
  props: readonly WorldProp[];
  /** Calm-channel ambient wash in [0, 1] (engine/calm.ts's displayedWarmth).
   *  Omitted/undefined = no wash drawn (e.g. tests that don't care). */
  warmth?: number;
  /** Real-sprite asset stores; omitted = placeholder-only rendering
   *  (e.g. unit tests that don't care about art). */
  assets?: RenderAssets;
  posters?: readonly PosterPlacement[];
}

const DESK_PALETTE: BoxPalette = {
  top: COLOR_DESK_TOP,
  left: COLOR_DESK_LEFT,
  right: COLOR_DESK_RIGHT,
};
const OCCUPANT_PALETTE: BoxPalette = {
  top: COLOR_OCCUPANT_TOP,
  left: COLOR_OCCUPANT_LEFT,
  right: COLOR_OCCUPANT_RIGHT,
};
const PROP_PALETTE: BoxPalette = {
  top: COLOR_PROP_TOP,
  left: COLOR_PROP_LEFT,
  right: COLOR_PROP_RIGHT,
};
const WALKER_PALETTE: BoxPalette = {
  top: COLOR_WALKER_TOP,
  left: COLOR_WALKER_LEFT,
  right: COLOR_WALKER_RIGHT,
};

const PROP_PALETTES: Record<WorldProp['kind'], BoxPalette> = {
  desk: DESK_PALETTE,
  plant: PROP_PALETTE,
  coffee: PROP_PALETTE,
  door: PROP_PALETTE,
  walker: WALKER_PALETTE,
  wall: PROP_PALETTE,
};

export const PROP_SHAPES: Record<WorldProp['kind'], { height: number; footprint: number }> = {
  desk: { height: 18, footprint: 0.8 },
  plant: { height: 22, footprint: 0.35 },
  coffee: { height: 26, footprint: 0.5 },
  door: { height: 30, footprint: 0.6 },
  // Deliberately smaller/rounder than any real prop — a shape difference
  // (not color-only) so ambient walkers read as "a small moving figure"
  // even in grayscale.
  walker: { height: 10, footprint: 0.22 },
  // Tall and thin — reads as a wall segment, not furniture, even before
  // its real sprite lands.
  wall: { height: 46, footprint: 0.96 },
};

/** Monitor-glow ellipse half-extents (world px) under an occupied desk. */
const GLOW_HALF_W = TILE_W * 0.9;
const GLOW_HALF_H = TILE_H * 0.9;

/** Fallback rotation for a prop with no `rotation` set (shouldn't happen
 *  for anything world.ts builds, but keeps drawing well-defined). */
const DEFAULT_ROTATION: Rotation = 'S';

/** Resolve+draw a real sprite by name at a world point; returns whether it
 *  actually drew (a sprite lacking the requested rotation still counts as
 *  "resolved but couldn't draw", callers fall back the same as 'placeholder'). */
function tryDrawSprite(
  ctx: CanvasRenderingContext2D,
  store: AssetStoreLike<SpriteResolution<CanvasImageSource>> | undefined,
  name: string | undefined,
  rotation: Rotation,
  now: number,
  worldX: number,
  worldY: number,
): boolean {
  if (!store || !name) return false;
  store.request([name]);
  const resolved = store.get(name);
  if (resolved.kind !== 'sprite') return false;
  const scale = spriteScaleFor(resolved.tilePx, TILE_W);
  const frameIndex = animationFrameIndex(resolved.sprite as SpriteDef, rotation, now);
  return drawSprite(
    ctx,
    resolved.image,
    resolved.sprite,
    rotation,
    frameIndex,
    worldX,
    worldY,
    scale,
  );
}

export function renderWorld(ctx: CanvasRenderingContext2D, input: RenderInput): void {
  const { cssSize, resolution, camera, cols, rows, props, assets } = input;
  const now = assets?.now ?? Date.now();

  // Background (canvas space).
  ctx.setTransform(resolution, 0, 0, resolution, 0, 0);
  ctx.fillStyle = COLOR_WORLD_BG;
  ctx.fillRect(0, 0, cssSize.width, cssSize.height);

  // World pass.
  const scale = resolution * camera.zoom;
  ctx.setTransform(scale, 0, 0, scale, camera.offsetX * resolution, camera.offsetY * resolution);

  // Floor: row-major is already painter's order for flat tiles, but go
  // through sortByDepth so floor and props share one code path.
  const tiles: { tileX: number; tileY: number; layer: number }[] = [];
  for (let tileY = 0; tileY < rows; tileY++) {
    for (let tileX = 0; tileX < cols; tileX++) {
      tiles.push({ tileX, tileY, layer: 0 });
    }
  }
  for (const tile of sortByDepth(tiles)) {
    const { worldX, worldY } = tileToWorld(tile.tileX, tile.tileY);
    const drew = tryDrawSprite(
      ctx,
      assets?.propStore,
      floorSpriteName(tile.tileX, tile.tileY),
      DEFAULT_ROTATION,
      now,
      worldX,
      worldY,
    );
    if (!drew) {
      const checker = (tile.tileX + tile.tileY) % 2 === 0 ? COLOR_FLOOR_A : COLOR_FLOOR_B;
      drawDiamondTile(ctx, worldX, worldY, checker, COLOR_FLOOR_EDGE);
    }
  }

  // Monitor glow under occupied desks (color is REINFORCEMENT only — the
  // occupancy signal itself is the occupant sprite/block + the DOM chip's
  // text).
  for (const prop of props) {
    if (prop.kind !== 'desk' || !prop.occupant) continue;
    const { worldX, worldY } = tileToWorld(prop.tileX, prop.tileY, prop.elevation ?? 0);
    ctx.beginPath();
    ctx.ellipse(worldX, worldY, GLOW_HALF_W, GLOW_HALF_H, 0, 0, Math.PI * 2);
    ctx.fillStyle = COLOR_DESK_GLOW;
    ctx.fill();
  }

  // Props (painter's order).
  const sortedProps = sortByDepth(props.map((prop) => ({ ...prop, layer: 1 })));
  for (const prop of sortedProps) {
    const { worldX, worldY } = tileToWorld(prop.tileX, prop.tileY, prop.elevation ?? 0);
    const rotation = prop.rotation ?? DEFAULT_ROTATION;

    if (prop.kind === 'desk') {
      // Chair, then desk (monitor), then the occupant on top — all three
      // anchored at the SAME tile-floor-contact point; the pipeline
      // authors seated characters with pelvis/hands pre-offset to that
      // point (webview-v3-assets/README "draw chair first, then person,
      // same tile"), so no manual vertical offsetting is needed here.
      const chairDrew = tryDrawSprite(
        ctx,
        assets?.propStore,
        DESK_CHAIR_SPRITE,
        rotation,
        now,
        worldX,
        worldY,
      );
      const deskDrew = tryDrawSprite(
        ctx,
        assets?.propStore,
        DESK_MONITOR_SPRITE,
        rotation,
        now,
        worldX,
        worldY,
      );
      if (!chairDrew && !deskDrew) {
        const shape = PROP_SHAPES.desk;
        drawIsoBox(ctx, worldX, worldY, shape.height, shape.footprint, DESK_PALETTE);
      }
      if (prop.occupant) {
        const pose = occupantPoseFor(prop.occupant);
        const outfit = outfitForAgent(prop.occupant.agentId);
        const occupantDrew = tryDrawSprite(
          ctx,
          assets?.characterStore,
          workerSpriteName(outfit, pose),
          rotation,
          now,
          worldX,
          worldY,
        );
        if (!occupantDrew) {
          drawIsoBox(ctx, worldX, worldY - PROP_SHAPES.desk.height, 14, 0.4, OCCUPANT_PALETTE);
        }
      }
      continue;
    }

    if (prop.kind === 'walker') {
      const isCat = prop.walkerPoseKind === 'cat-curl' || prop.walkerPoseKind === 'cat-walk';
      // T6 dispatch visitors are a PRESENCE, not an ambient patrol — 'sit'
      // reads as "someone is here right now" rather than mid-stride, the
      // same shape-difference register occupantPoseFor already uses to
      // distinguish desk states.
      const isVisitor = prop.walkerPoseKind === 'visitor';
      const spriteName = isCat
        ? prop.walkerPoseKind === 'cat-walk'
          ? CAT_WALK_SPRITE
          : CAT_CURL_SPRITE
        : workerSpriteName(prop.walkerOutfit ?? 'rust', isVisitor ? 'sit' : 'walk');
      const drew = tryDrawSprite(
        ctx,
        assets?.characterStore,
        spriteName,
        rotation,
        now,
        worldX,
        worldY,
      );
      if (!drew) {
        const shape = PROP_SHAPES.walker;
        drawIsoBox(ctx, worldX, worldY, shape.height, shape.footprint, WALKER_PALETTE);
      }
      continue;
    }

    // wall/plant/coffee/door — a single named sprite (door has none, so
    // PROP_SPRITE_NAMES.door is undefined and this always falls back).
    const spriteName =
      prop.kind === 'wall' ? wallSpriteName(prop.tileX) : PROP_SPRITE_NAMES[prop.kind];
    const drew = tryDrawSprite(ctx, assets?.propStore, spriteName, rotation, now, worldX, worldY);
    if (!drew) {
      const shape = PROP_SHAPES[prop.kind];
      drawIsoBox(ctx, worldX, worldY, shape.height, shape.footprint, PROP_PALETTES[prop.kind]);
    }
  }

  // Wall posters/placards (flavor) — drawn after props so they sit in
  // front of the wall row, world-anchored so they pan/zoom with everything
  // else. No placeholder: an unloaded poster is just absent, not broken.
  if (assets?.imageStore && input.posters) {
    for (const poster of input.posters) {
      assets.imageStore.request([poster.name]);
      const resolved = assets.imageStore.get(poster.name);
      if (resolved.kind !== 'image') continue;
      const [srcW, srcH] = resolved.asset.size;
      const drawWidth = poster.worldWidth;
      const drawHeight = drawWidth * (srcH / srcW);
      const { worldX, worldY } = tileToWorld(poster.tileX, poster.tileY);
      // Mounted above the wall row, bottom-anchored, centered on the tile.
      ctx.drawImage(
        resolved.image,
        worldX - drawWidth / 2,
        worldY - drawHeight,
        drawWidth,
        drawHeight,
      );
    }
  }

  // Calm-channel ambient wash (engine/calm.ts) — screen-space, drawn LAST so
  // it tints the whole painted frame uniformly regardless of zoom/pan.
  // REINFORCEMENT only: state/hud.ts's mood chip (shape + text) is the
  // actual signal; this never gates or gets checked for anything.
  if (input.warmth !== undefined) {
    ctx.setTransform(resolution, 0, 0, resolution, 0, 0);
    ctx.fillStyle = ambientWashColor(input.warmth);
    ctx.fillRect(0, 0, cssSize.width, cssSize.height);
  }
}
