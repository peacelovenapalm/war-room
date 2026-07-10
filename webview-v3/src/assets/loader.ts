/**
 * Lazy, chunked spritesheet loader — KICKOFF-v3.1 WS-A item (f).
 *
 * Contract (MOBILE-FORENSICS constraint 3, binding):
 * - NOTHING is fetched at construction. The manifest is fetched on the
 *   first request(); each spritesheet (a "chunk" — one manifest.sheets[i],
 *   or one imagegen image) is fetched only when a sprite/image inside it is
 *   actually requested by the renderer.
 * - get() is synchronous and NEVER fails: until (or unless) a sprite's
 *   sheet lands, it resolves to `{kind: 'placeholder'}` and the renderer
 *   keeps drawing procedural placeholder art (engine/placeholder.ts). A
 *   missing/broken manifest therefore degrades to the skeleton world, it
 *   never blanks the canvas.
 *
 * Two stores share this module because the WS-B pipeline ships two manifest
 * shapes (tools/asset-pipeline/README.md "Manifest schema"):
 * - createSpriteStore: props.manifest.json / characters.manifest.json —
 *   tile-anchored sprites with per-rotation (and, for characters,
 *   per-animation-frame) frame rects on N shared sheets.
 * - createImageStore: imagegen/manifest.json — a flat list of standalone
 *   rectangular images (posters/portraits/textures), no anchor/rotation
 *   math; each image IS its own chunk.
 *
 * fetch/image decoding are injected (AssetLoaderDeps) so the chunk-laziness
 * contract is provable in node unit tests; createBrowserLoaderDeps() is the
 * production wiring.
 */

import {
  type ImageAsset,
  parseImageManifest,
  parseSpriteSheetManifest,
  type SpriteDef,
  type SpriteSheetManifest,
} from './manifest';

export type SpriteResolution<TImage> =
  | { kind: 'placeholder'; name: string }
  | { kind: 'sprite'; name: string; sprite: SpriteDef; image: TImage; tilePx: number };

export type ImageResolution<TImage> =
  | { kind: 'placeholder'; name: string }
  | { kind: 'image'; name: string; asset: ImageAsset; image: TImage };

export interface AssetLoaderDeps<TImage> {
  /** GET url -> parsed JSON (manifest). */
  fetchJson: (url: string) => Promise<unknown>;
  /** GET + decode an image (spritesheet or standalone). */
  loadImage: (url: string) => Promise<TImage>;
  /** Resolve a path relative to the manifest's own URL. */
  resolveUrl?: (relativePath: string, manifestUrl: string) => string;
}

export interface AssetStoreStats {
  manifestState: 'idle' | 'loading' | 'ready' | 'failed';
  chunksLoaded: number;
  chunksTotal: number | null;
  spritesKnown: number;
}

export interface AssetStore<TResolution> {
  /**
   * Declare that these names are (about to be) on screen. Idempotent;
   * triggers the manifest fetch on first call and then loads ONLY the
   * chunks containing the named entries.
   */
  request(names: readonly string[]): void;
  /** Synchronous resolve with placeholder fallback — see module header. */
  get(name: string): TResolution;
  /** Fires after the manifest or any chunk lands (or fails). */
  onChange(listener: () => void): () => void;
  stats(): AssetStoreStats;
}

function defaultResolveUrl(relativePath: string, manifestUrl: string): string {
  const base = manifestUrl.slice(0, manifestUrl.lastIndexOf('/') + 1);
  return base + relativePath;
}

interface ChunkState<TImage> {
  status: 'unloaded' | 'loading' | 'loaded' | 'failed';
  image: TImage | null;
}

/** props.manifest.json / characters.manifest.json — sheet-indexed chunking:
 *  one chunk per `manifest.sheets[i]`, many sprites may share a sheet. */
export function createSpriteStore<TImage>(
  manifestUrl: string,
  deps: AssetLoaderDeps<TImage>,
): AssetStore<SpriteResolution<TImage>> {
  const resolveUrl = deps.resolveUrl ?? defaultResolveUrl;
  const listeners = new Set<() => void>();

  let manifestState: AssetStoreStats['manifestState'] = 'idle';
  let manifest: SpriteSheetManifest | null = null;
  const spriteIndex = new Map<string, SpriteDef>();
  let sheetStates: ChunkState<TImage>[] = [];
  const pendingNames = new Set<string>();

  function emit(): void {
    for (const listener of [...listeners]) listener();
  }

  function loadSheet(index: number): void {
    const state = sheetStates[index];
    const sheet = manifest?.sheets[index];
    if (!state || sheet === undefined) return;
    if (state.status === 'loading' || state.status === 'loaded') return;
    state.status = 'loading';
    deps
      .loadImage(resolveUrl(sheet, manifestUrl))
      .then((image) => {
        state.image = image;
        state.status = 'loaded';
        emit();
      })
      .catch(() => {
        state.status = 'failed'; // stays placeholder; a later request() may retry.
        emit();
      });
  }

  function requestLoaded(names: Iterable<string>): void {
    for (const name of names) {
      const sprite = spriteIndex.get(name);
      if (!sprite) continue; // unknown sprite -> permanent placeholder
      const state = sheetStates[sprite.sheet];
      if (state?.status === 'failed') state.status = 'unloaded'; // allow retry
      loadSheet(sprite.sheet);
    }
  }

  function ensureManifest(): void {
    if (manifestState !== 'idle') return;
    manifestState = 'loading';
    deps
      .fetchJson(manifestUrl)
      .then((raw) => {
        const parsed = parseSpriteSheetManifest(raw);
        if (!parsed) {
          manifestState = 'failed';
          emit();
          return;
        }
        manifest = parsed;
        sheetStates = parsed.sheets.map(() => ({ status: 'unloaded', image: null }));
        for (const sprite of parsed.sprites) spriteIndex.set(sprite.name, sprite);
        manifestState = 'ready';
        const queued = [...pendingNames];
        pendingNames.clear();
        requestLoaded(queued);
        emit();
      })
      .catch(() => {
        manifestState = 'failed';
        emit();
      });
  }

  return {
    request(names) {
      if (names.length === 0) return;
      if (manifestState === 'ready') {
        requestLoaded(names);
        return;
      }
      for (const name of names) pendingNames.add(name);
      ensureManifest();
    },
    get(name) {
      const sprite = spriteIndex.get(name);
      if (!sprite || !manifest) return { kind: 'placeholder', name };
      const state = sheetStates[sprite.sheet];
      if (!state || state.status !== 'loaded' || state.image === null) {
        return { kind: 'placeholder', name };
      }
      return { kind: 'sprite', name, sprite, image: state.image, tilePx: manifest.tilePx };
    },
    onChange(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    stats() {
      return {
        manifestState,
        chunksLoaded: sheetStates.filter((state) => state.status === 'loaded').length,
        chunksTotal: manifest ? manifest.sheets.length : null,
        spritesKnown: spriteIndex.size,
      };
    },
  };
}

/** imagegen/manifest.json — one chunk per image (posters/portraits/textures,
 *  rectangular, no tile-anchor math). */
export function createImageStore<TImage>(
  manifestUrl: string,
  deps: AssetLoaderDeps<TImage>,
): AssetStore<ImageResolution<TImage>> {
  const resolveUrl = deps.resolveUrl ?? defaultResolveUrl;
  const listeners = new Set<() => void>();

  let manifestState: AssetStoreStats['manifestState'] = 'idle';
  const imageIndex = new Map<string, ImageAsset>();
  const chunkStates = new Map<string, ChunkState<TImage>>();
  const pendingNames = new Set<string>();

  function emit(): void {
    for (const listener of [...listeners]) listener();
  }

  function loadOne(name: string): void {
    const asset = imageIndex.get(name);
    if (!asset) return;
    let state = chunkStates.get(name);
    if (!state) {
      state = { status: 'unloaded', image: null };
      chunkStates.set(name, state);
    }
    if (state.status === 'loading' || state.status === 'loaded') return;
    state.status = 'loading';
    deps
      .loadImage(resolveUrl(asset.path, manifestUrl))
      .then((image) => {
        state.image = image;
        state.status = 'loaded';
        emit();
      })
      .catch(() => {
        state.status = 'failed';
        emit();
      });
  }

  function requestLoaded(names: Iterable<string>): void {
    for (const name of names) {
      const state = chunkStates.get(name);
      if (state?.status === 'failed') state.status = 'unloaded';
      loadOne(name);
    }
  }

  function ensureManifest(): void {
    if (manifestState !== 'idle') return;
    manifestState = 'loading';
    deps
      .fetchJson(manifestUrl)
      .then((raw) => {
        const parsed = parseImageManifest(raw);
        if (!parsed) {
          manifestState = 'failed';
          emit();
          return;
        }
        for (const asset of parsed.images) imageIndex.set(asset.name, asset);
        manifestState = 'ready';
        const queued = [...pendingNames];
        pendingNames.clear();
        requestLoaded(queued);
        emit();
      })
      .catch(() => {
        manifestState = 'failed';
        emit();
      });
  }

  return {
    request(names) {
      if (names.length === 0) return;
      if (manifestState === 'ready') {
        requestLoaded(names);
        return;
      }
      for (const name of names) pendingNames.add(name);
      ensureManifest();
    },
    get(name) {
      const asset = imageIndex.get(name);
      const state = chunkStates.get(name);
      if (!asset || !state || state.status !== 'loaded' || state.image === null) {
        return { kind: 'placeholder', name };
      }
      return { kind: 'image', name, asset, image: state.image };
    },
    onChange(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    stats() {
      return {
        manifestState,
        chunksLoaded: [...chunkStates.values()].filter((s) => s.status === 'loaded').length,
        chunksTotal: manifestState === 'ready' ? imageIndex.size : null,
        spritesKnown: imageIndex.size,
      };
    },
  };
}

/** Production wiring: fetch + HTMLImageElement decode (browser only). */
export function createBrowserLoaderDeps(): AssetLoaderDeps<HTMLImageElement> {
  return {
    fetchJson: async (url) => {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`GET ${url} -> ${String(response.status)}`);
      return (await response.json()) as unknown;
    },
    loadImage: (url) =>
      new Promise<HTMLImageElement>((resolve, reject) => {
        const image = new Image();
        image.onload = () => {
          resolve(image);
        };
        image.onerror = () => {
          reject(new Error(`Failed to decode image ${url}`));
        };
        image.src = url;
      }),
  };
}
