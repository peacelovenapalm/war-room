/**
 * Lazy, chunked spritesheet loader — KICKOFF-v3.1 WS-A item (f).
 *
 * Contract (MOBILE-FORENSICS constraint 3, binding):
 * - NOTHING is fetched at construction. The manifest is fetched on the
 *   first request(); each spritesheet chunk is fetched only when a sprite
 *   inside it is actually requested by the renderer.
 * - get() is synchronous and NEVER fails: until (or unless) a sprite's
 *   chunk lands, it resolves to `{kind: 'placeholder'}` and the renderer
 *   keeps drawing procedural placeholder art (engine/placeholder.ts). A
 *   missing/broken manifest therefore degrades to the skeleton world, it
 *   never blanks the canvas.
 * - The renderer wires real sprite blitting when the WS-B pipeline's
 *   manifest lands at integration; until then this module is exercised by
 *   unit tests against the agreed schema (assets/manifest.ts).
 *
 * fetch/image decoding are injected (AssetLoaderDeps) so the chunk-laziness
 * contract is provable in node unit tests; createBrowserLoaderDeps() is the
 * production wiring.
 */

import {
  type AssetManifest,
  type ManifestChunk,
  parseManifest,
  type SpriteEntry,
} from './manifest';

export type SpriteResolution<TImage> =
  | { kind: 'placeholder'; name: string }
  | { kind: 'sprite'; name: string; entry: SpriteEntry; image: TImage; chunkId: string };

export interface AssetLoaderDeps<TImage> {
  /** GET url -> parsed JSON (manifest). */
  fetchJson: (url: string) => Promise<unknown>;
  /** GET + decode a spritesheet image. */
  loadImage: (url: string) => Promise<TImage>;
  /** Resolve a sheet URL relative to the manifest URL. */
  resolveUrl?: (sheet: string, manifestUrl: string) => string;
}

export interface AssetStoreStats {
  manifestState: 'idle' | 'loading' | 'ready' | 'failed';
  chunksLoaded: number;
  chunksTotal: number | null;
  spritesKnown: number;
}

export interface AssetStore<TImage> {
  /**
   * Declare that these sprites are (about to be) on screen. Idempotent;
   * triggers the manifest fetch on first call and then loads ONLY the
   * chunks containing the named sprites.
   */
  request(names: readonly string[]): void;
  /** Synchronous resolve with placeholder fallback — see module header. */
  get(name: string): SpriteResolution<TImage>;
  /** Fires after the manifest or any chunk lands (or fails). */
  onChange(listener: () => void): () => void;
  stats(): AssetStoreStats;
}

function defaultResolveUrl(sheet: string, manifestUrl: string): string {
  const base = manifestUrl.slice(0, manifestUrl.lastIndexOf('/') + 1);
  return base + sheet;
}

interface ChunkState<TImage> {
  chunk: ManifestChunk;
  status: 'unloaded' | 'loading' | 'loaded' | 'failed';
  image: TImage | null;
}

export function createAssetStore<TImage>(
  manifestUrl: string,
  deps: AssetLoaderDeps<TImage>,
): AssetStore<TImage> {
  const resolveUrl = deps.resolveUrl ?? defaultResolveUrl;
  const listeners = new Set<() => void>();

  let manifestState: AssetStoreStats['manifestState'] = 'idle';
  let manifest: AssetManifest | null = null;
  /** sprite name -> owning chunk state */
  const spriteIndex = new Map<string, ChunkState<TImage>>();
  const chunkStates: ChunkState<TImage>[] = [];
  /** Names requested before the manifest landed. */
  const pendingNames = new Set<string>();

  function emit(): void {
    for (const listener of [...listeners]) listener();
  }

  function loadChunk(state: ChunkState<TImage>): void {
    if (state.status === 'loading' || state.status === 'loaded') return;
    state.status = 'loading';
    deps
      .loadImage(resolveUrl(state.chunk.sheet, manifestUrl))
      .then((image) => {
        state.image = image;
        state.status = 'loaded';
        emit();
      })
      .catch(() => {
        // Stays placeholder; a later request() may retry.
        state.status = 'failed';
        emit();
      });
  }

  function requestLoaded(names: Iterable<string>): void {
    for (const name of names) {
      const state = spriteIndex.get(name);
      if (!state) continue; // unknown sprite -> permanent placeholder
      if (state.status === 'failed') state.status = 'unloaded'; // allow retry
      loadChunk(state);
    }
  }

  function ensureManifest(): void {
    if (manifestState !== 'idle') return;
    manifestState = 'loading';
    deps
      .fetchJson(manifestUrl)
      .then((raw) => {
        const parsed = parseManifest(raw);
        if (!parsed) {
          manifestState = 'failed';
          emit();
          return;
        }
        manifest = parsed;
        for (const chunk of parsed.chunks) {
          const state: ChunkState<TImage> = { chunk, status: 'unloaded', image: null };
          chunkStates.push(state);
          for (const entry of chunk.entries) spriteIndex.set(entry.name, state);
        }
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
      const state = spriteIndex.get(name);
      if (!state || state.status !== 'loaded' || state.image === null) {
        return { kind: 'placeholder', name };
      }
      const entry = state.chunk.entries.find((candidate) => candidate.name === name);
      if (!entry) return { kind: 'placeholder', name };
      return { kind: 'sprite', name, entry, image: state.image, chunkId: state.chunk.id };
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
        chunksLoaded: chunkStates.filter((state) => state.status === 'loaded').length,
        chunksTotal: manifest ? manifest.chunks.length : null,
        spritesKnown: spriteIndex.size,
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
          reject(new Error(`Failed to decode spritesheet ${url}`));
        };
        image.src = url;
      }),
  };
}
