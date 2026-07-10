/**
 * Asset-manifest schemas — the WS-B pipeline contract (tools/asset-pipeline
 * README.md "Manifest schema", verified against the real generated
 * `props.manifest.json` / `characters.manifest.json` / `imagegen/manifest.json`
 * in webview-v3-assets/). This supersedes an earlier, simpler
 * `{name,size,anchor,rotations,frames}` placeholder shape drafted before the
 * real pipeline output existed — the real manifests carry per-rotation frame
 * rects, footprints and (for characters) per-rotation animation-frame
 * arrays, which the renderer needs to draw anything.
 */

export type Rotation = 'N' | 'E' | 'S' | 'W';

export type Point = readonly [number, number];

/** A sprite's rect on its sheet, plus that rotation's absolute sheet-space
 *  anchor (informational — drawing uses the sprite-level frame-relative
 *  `anchor`, per the documented `screenOf(tile) - anchor` rule; see
 *  tools/asset-pipeline/viewer.html's drawSpriteFrame, the reference impl). */
export interface FrameRect {
  x: number;
  y: number;
  anchor: Point;
}

export interface AttachQuads {
  /** TL,TR,BR,BL corners, frame-relative px, per rotation. */
  screen?: Partial<Record<Rotation, readonly [Point, Point, Point, Point]>>;
}

export interface SpriteDef {
  name: string;
  /** Frame size in sheet px — uniform across rotations/frames (union-trim). */
  size: Point;
  /** Ground-anchor offset in frame px from the frame's top-left — uniform
   *  across rotations/frames. */
  anchor: Point;
  rotations: readonly Rotation[];
  /** Tiles occupied — depth-sort input. */
  footprint: Point;
  /** Index into the manifest's top-level `sheets` array. */
  sheet: number;
  /** Per rotation: a single frame (static) or an ordered array (animated —
   *  distinguish with Array.isArray, never a frames/animated flag). */
  frames: Partial<Record<Rotation, FrameRect | readonly FrameRect[]>>;
  /** Animation rate; absent/0 = static. */
  fps?: number;
  /** Optional attach quads (e.g. desk_monitor's screen face for the DOM
   *  tail overlay) — unused by the world renderer itself. */
  attach?: AttachQuads;
}

export interface SpriteSheetManifest {
  version: number;
  sheets: readonly string[];
  sheetSizes: readonly Point[];
  tilePx: number;
  renderScale: number;
  sprites: readonly SpriteDef[];
}

/** Flat rectangular-image manifest (imagegen lane) — no anchor/rotation/
 *  frames, these aren't tile-anchored sprites (posters, portraits, textures). */
export interface ImageAsset {
  name: string;
  /** Path relative to the ASSET ROOT (webview-v3-assets/), not this
   *  manifest's own directory — verified against the real
   *  imagegen/manifest.json, whose `path` values already carry the
   *  `imagegen/` prefix (e.g. `imagegen/posters/poster_stop_all.png`). The
   *  loader needs a root-relative resolveUrl for this store; see
   *  assets/loader.ts's createImageStore call site. */
  path: string;
  size: Point;
  purpose: string;
}

export interface ImageManifest {
  version: number;
  images: readonly ImageAsset[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isPoint(value: unknown): value is Point {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    typeof value[0] === 'number' &&
    typeof value[1] === 'number'
  );
}

function isRotation(value: unknown): value is Rotation {
  return value === 'N' || value === 'E' || value === 'S' || value === 'W';
}

function isFrameRect(value: unknown): value is FrameRect {
  return (
    isRecord(value) &&
    typeof value.x === 'number' &&
    typeof value.y === 'number' &&
    isPoint(value.anchor)
  );
}

function isFrameValue(value: unknown): value is FrameRect | readonly FrameRect[] {
  if (Array.isArray(value)) return value.length > 0 && value.every(isFrameRect);
  return isFrameRect(value);
}

function isFramesMap(value: unknown): value is SpriteDef['frames'] {
  if (!isRecord(value)) return false;
  return Object.entries(value).every(([key, entry]) => isRotation(key) && isFrameValue(entry));
}

function isSpriteDef(value: unknown): value is SpriteDef {
  if (!isRecord(value)) return false;
  if (typeof value.name !== 'string' || value.name.length === 0) return false;
  if (!isPoint(value.size) || !isPoint(value.anchor) || !isPoint(value.footprint)) return false;
  if (!Array.isArray(value.rotations) || !value.rotations.every(isRotation)) return false;
  if (typeof value.sheet !== 'number') return false;
  if (!isFramesMap(value.frames)) return false;
  if (value.fps !== undefined && typeof value.fps !== 'number') return false;
  return true;
}

/** Structural validation for a fetched sprite-sheet manifest (props or
 *  characters). Returns null on any mismatch — the loader then stays on
 *  placeholders instead of crashing the face (graceful absence). */
export function parseSpriteSheetManifest(raw: unknown): SpriteSheetManifest | null {
  if (!isRecord(raw)) return null;
  if (typeof raw.version !== 'number') return null;
  if (!Array.isArray(raw.sheets) || !raw.sheets.every((s) => typeof s === 'string')) return null;
  if (!Array.isArray(raw.sheetSizes) || !raw.sheetSizes.every(isPoint)) return null;
  if (typeof raw.tilePx !== 'number' || typeof raw.renderScale !== 'number') return null;
  if (!Array.isArray(raw.sprites) || !raw.sprites.every(isSpriteDef)) return null;
  return {
    version: raw.version,
    sheets: raw.sheets,
    sheetSizes: raw.sheetSizes,
    tilePx: raw.tilePx,
    renderScale: raw.renderScale,
    sprites: raw.sprites,
  };
}

function isImageAsset(value: unknown): value is ImageAsset {
  return (
    isRecord(value) &&
    typeof value.name === 'string' &&
    value.name.length > 0 &&
    typeof value.path === 'string' &&
    value.path.length > 0 &&
    isPoint(value.size) &&
    typeof value.purpose === 'string'
  );
}

export function parseImageManifest(raw: unknown): ImageManifest | null {
  if (!isRecord(raw)) return null;
  if (typeof raw.version !== 'number') return null;
  if (!Array.isArray(raw.images) || !raw.images.every(isImageAsset)) return null;
  return { version: raw.version, images: raw.images };
}
