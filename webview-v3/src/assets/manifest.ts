/**
 * Asset-manifest schema — MUST match the KICKOFF-v3.1 WS-B pipeline
 * contract: each sprite entry is `{name, size, anchor, rotations, frames}`.
 * Chunking (which spritesheet a sprite lives in) is manifest-level
 * structure so the loader can fetch sheets lazily, one chunk at a time —
 * never the eager ~1MB full-catalog push that MOBILE-FORENSICS constraint
 * 3 bans.
 */

export interface SpriteEntry {
  /** Unique sprite id, e.g. 'desk', 'walker', 'rework-bin-crate'. */
  name: string;
  /** Frame size in sheet pixels. */
  size: { w: number; h: number };
  /** Ground-anchor offset in frame pixels from the frame's top-left. */
  anchor: { x: number; y: number };
  /** Number of authored rotations (iso pipeline renders 4). */
  rotations: number;
  /** Animation frames per rotation (1 = static). */
  frames: number;
}

export interface ManifestChunk {
  /** Chunk id (stable across manifest versions). */
  id: string;
  /** Spritesheet image URL, resolved relative to the manifest URL. */
  sheet: string;
  entries: SpriteEntry[];
}

export interface AssetManifest {
  version: number;
  chunks: ManifestChunk[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isXY(value: unknown, a: string, b: string): boolean {
  return isRecord(value) && typeof value[a] === 'number' && typeof value[b] === 'number';
}

function isSpriteEntry(value: unknown): value is SpriteEntry {
  return (
    isRecord(value) &&
    typeof value.name === 'string' &&
    value.name.length > 0 &&
    isXY(value.size, 'w', 'h') &&
    isXY(value.anchor, 'x', 'y') &&
    typeof value.rotations === 'number' &&
    value.rotations >= 1 &&
    typeof value.frames === 'number' &&
    value.frames >= 1
  );
}

function isManifestChunk(value: unknown): value is ManifestChunk {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    value.id.length > 0 &&
    typeof value.sheet === 'string' &&
    value.sheet.length > 0 &&
    Array.isArray(value.entries) &&
    value.entries.every(isSpriteEntry)
  );
}

/**
 * Structural validation for a fetched manifest. Returns null when the
 * payload does not match the WS-B schema — the loader then stays on
 * placeholders instead of crashing the face (graceful absence).
 */
export function parseManifest(raw: unknown): AssetManifest | null {
  if (!isRecord(raw)) return null;
  if (typeof raw.version !== 'number') return null;
  if (!Array.isArray(raw.chunks) || !raw.chunks.every(isManifestChunk)) return null;
  return { version: raw.version, chunks: raw.chunks };
}
