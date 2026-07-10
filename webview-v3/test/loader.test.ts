import { describe, expect, it, vi } from 'vitest';

import { type AssetLoaderDeps, createImageStore, createSpriteStore } from '../src/assets/loader';
import { parseImageManifest, parseSpriteSheetManifest } from '../src/assets/manifest';

type FakeImage = { url: string };

// Shaped like the REAL WS-B pipeline output (props.manifest.json /
// characters.manifest.json) — two sheets, a static prop and an animated
// character sprite sharing sheet 0, a static prop alone on sheet 1.
const SPRITE_MANIFEST = {
  version: 1,
  sheets: ['office-core.png', 'walkers.png'],
  sheetSizes: [
    [512, 512],
    [256, 256],
  ],
  tilePx: 128,
  renderScale: 2,
  sprites: [
    {
      name: 'desk',
      size: [64, 48],
      anchor: [32, 40],
      rotations: ['N', 'E', 'S', 'W'],
      footprint: [1, 1],
      sheet: 0,
      frames: {
        N: { x: 0, y: 0, anchor: [32, 40] },
        E: { x: 64, y: 0, anchor: [96, 40] },
        S: { x: 128, y: 0, anchor: [160, 40] },
        W: { x: 192, y: 0, anchor: [224, 40] },
      },
    },
    {
      name: 'chair',
      size: [32, 32],
      anchor: [16, 28],
      rotations: ['N', 'E', 'S', 'W'],
      footprint: [1, 1],
      sheet: 0,
      frames: {
        N: { x: 0, y: 48, anchor: [16, 76] },
        E: { x: 32, y: 48, anchor: [48, 76] },
        S: { x: 64, y: 48, anchor: [80, 76] },
        W: { x: 96, y: 48, anchor: [112, 76] },
      },
    },
    {
      name: 'worker_teal.walk',
      size: [32, 48],
      anchor: [16, 44],
      rotations: ['N', 'E', 'S', 'W'],
      footprint: [1, 1],
      sheet: 1,
      fps: 8,
      frames: {
        S: [
          { x: 0, y: 0, anchor: [16, 44] },
          { x: 32, y: 0, anchor: [48, 44] },
        ],
      },
    },
  ],
};

const IMAGE_MANIFEST = {
  version: 1,
  images: [
    {
      name: 'poster_stop_all',
      path: 'posters/poster_stop_all.png',
      size: [1024, 1536],
      purpose: 'wall',
    },
    {
      name: 'poster_ship_it',
      path: 'posters/poster_ship_it.png',
      size: [1024, 1536],
      purpose: 'wall',
    },
  ],
};

function makeDeps(
  manifest: unknown,
  overrides?: Partial<AssetLoaderDeps<FakeImage>>,
): {
  deps: AssetLoaderDeps<FakeImage>;
  fetchJson: AssetLoaderDeps<FakeImage>['fetchJson'] & ReturnType<typeof vi.fn>;
  loadImage: AssetLoaderDeps<FakeImage>['loadImage'] & ReturnType<typeof vi.fn>;
} {
  const fetchJson = (overrides?.fetchJson ??
    vi.fn(() => Promise.resolve<unknown>(manifest))) as AssetLoaderDeps<FakeImage>['fetchJson'] &
    ReturnType<typeof vi.fn>;
  const loadImage = (overrides?.loadImage ??
    vi.fn((url: string) =>
      Promise.resolve<FakeImage>({ url }),
    )) as AssetLoaderDeps<FakeImage>['loadImage'] & ReturnType<typeof vi.fn>;
  return { deps: { fetchJson, loadImage }, fetchJson, loadImage };
}

async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

describe('sprite-sheet manifest schema (WS-B real pipeline contract)', () => {
  it('accepts the real props/characters shape, static and animated frames', () => {
    const parsed = parseSpriteSheetManifest(SPRITE_MANIFEST);
    expect(parsed).not.toBeNull();
    expect(parsed?.sprites[0].name).toBe('desk');
    expect(parsed?.sprites[0].frames.N).toEqual({ x: 0, y: 0, anchor: [32, 40] });
    const animated = parsed?.sprites[2];
    expect(Array.isArray(animated?.frames.S)).toBe(true);
    expect(animated?.fps).toBe(8);
  });

  it('rejects malformed payloads instead of throwing', () => {
    expect(parseSpriteSheetManifest(null)).toBeNull();
    expect(parseSpriteSheetManifest('nope')).toBeNull();
    expect(parseSpriteSheetManifest({ version: 1 })).toBeNull();
    expect(
      parseSpriteSheetManifest({
        version: 1,
        sheets: ['a.png'],
        sheetSizes: [[1, 1]],
        tilePx: 128,
        renderScale: 2,
        sprites: [
          { name: 'x', size: [1, 1], rotations: ['N'], footprint: [1, 1], sheet: 0, frames: {} },
        ],
      }), // missing anchor
    ).toBeNull();
  });
});

describe('imagegen manifest schema', () => {
  it('accepts the flat {name,path,size,purpose} shape', () => {
    const parsed = parseImageManifest(IMAGE_MANIFEST);
    expect(parsed).not.toBeNull();
    expect(parsed?.images[0].name).toBe('poster_stop_all');
  });

  it('rejects malformed payloads instead of throwing', () => {
    expect(parseImageManifest(null)).toBeNull();
    expect(parseImageManifest({ version: 1, images: [{ name: 'x' }] })).toBeNull();
  });
});

describe('createSpriteStore — lazy, sheet-indexed chunking', () => {
  it('fetches NOTHING at construction (no eager catalog push)', async () => {
    const { deps, fetchJson, loadImage } = makeDeps(SPRITE_MANIFEST);
    createSpriteStore('/assets/props.manifest.json', deps);
    await settle();
    expect(fetchJson).not.toHaveBeenCalled();
    expect(loadImage).not.toHaveBeenCalled();
  });

  it('resolves to placeholder before anything loads and after unknown names', async () => {
    const { deps } = makeDeps(SPRITE_MANIFEST);
    const store = createSpriteStore('/assets/props.manifest.json', deps);
    expect(store.get('desk')).toEqual({ kind: 'placeholder', name: 'desk' });
    store.request(['desk']);
    expect(store.get('desk').kind).toBe('placeholder'); // not landed yet
    await settle();
    expect(store.get('no-such-sprite')).toEqual({ kind: 'placeholder', name: 'no-such-sprite' });
  });

  it('loads ONLY the sheet containing the requested sprite', async () => {
    const { deps, fetchJson, loadImage } = makeDeps(SPRITE_MANIFEST);
    const store = createSpriteStore('/assets/props.manifest.json', deps);
    store.request(['desk']);
    await settle();
    expect(fetchJson).toHaveBeenCalledTimes(1);
    expect(loadImage).toHaveBeenCalledTimes(1);
    expect(loadImage).toHaveBeenCalledWith('/assets/office-core.png');
    // walkers.png untouched until a walker sprite is actually needed.
    store.request(['worker_teal.walk']);
    await settle();
    expect(loadImage).toHaveBeenCalledTimes(2);
    expect(loadImage).toHaveBeenLastCalledWith('/assets/walkers.png');
    expect(store.stats()).toMatchObject({ chunksLoaded: 2, chunksTotal: 2, spritesKnown: 3 });
  });

  it('resolves sprite + tilePx after its sheet lands, and notifies', async () => {
    const { deps } = makeDeps(SPRITE_MANIFEST);
    const store = createSpriteStore('/assets/props.manifest.json', deps);
    const changes = vi.fn();
    store.onChange(changes);
    store.request(['chair']);
    await settle();
    const resolved = store.get('chair');
    expect(resolved.kind).toBe('sprite');
    if (resolved.kind === 'sprite') {
      expect(resolved.sprite.name).toBe('chair');
      expect(resolved.tilePx).toBe(128);
      expect(resolved.image).toEqual({ url: '/assets/office-core.png' });
    }
    expect(changes).toHaveBeenCalled();
    // Same-sheet sibling is now warm too — no extra fetches for it.
    expect(store.get('desk').kind).toBe('sprite');
  });

  it('is idempotent: repeated requests never refetch', async () => {
    const { deps, fetchJson, loadImage } = makeDeps(SPRITE_MANIFEST);
    const store = createSpriteStore('/assets/props.manifest.json', deps);
    store.request(['desk']);
    store.request(['desk', 'chair']);
    await settle();
    store.request(['desk']);
    await settle();
    expect(fetchJson).toHaveBeenCalledTimes(1);
    expect(loadImage).toHaveBeenCalledTimes(1);
  });

  it('degrades to placeholders on manifest failure (graceful absence)', async () => {
    const { deps } = makeDeps(SPRITE_MANIFEST, {
      fetchJson: vi.fn(() => Promise.reject(new Error('offline'))),
    });
    const store = createSpriteStore('/assets/props.manifest.json', deps);
    store.request(['desk']);
    await settle();
    expect(store.get('desk')).toEqual({ kind: 'placeholder', name: 'desk' });
    expect(store.stats().manifestState).toBe('failed');
  });

  it('degrades to placeholder on sheet failure and allows a retry', async () => {
    let fail = true;
    const { deps, loadImage } = makeDeps(SPRITE_MANIFEST, {
      loadImage: vi.fn((url: string) =>
        fail ? Promise.reject(new Error('404')) : Promise.resolve({ url }),
      ),
    });
    const store = createSpriteStore('/assets/props.manifest.json', deps);
    store.request(['worker_teal.walk']);
    await settle();
    expect(store.get('worker_teal.walk').kind).toBe('placeholder');
    fail = false;
    store.request(['worker_teal.walk']);
    await settle();
    expect(store.get('worker_teal.walk').kind).toBe('sprite');
    expect(loadImage).toHaveBeenCalledTimes(2);
  });

  it('unsubscribes listeners', async () => {
    const { deps } = makeDeps(SPRITE_MANIFEST);
    const store = createSpriteStore('/assets/props.manifest.json', deps);
    const listener = vi.fn();
    const unsubscribe = store.onChange(listener);
    unsubscribe();
    store.request(['desk']);
    await settle();
    expect(listener).not.toHaveBeenCalled();
  });
});

describe('createImageStore — lazy, one-image-per-chunk', () => {
  it('fetches nothing at construction, loads only the requested image', async () => {
    const { deps, fetchJson, loadImage } = makeDeps(IMAGE_MANIFEST);
    const store = createImageStore('/assets/imagegen/manifest.json', deps);
    await settle();
    expect(fetchJson).not.toHaveBeenCalled();
    store.request(['poster_stop_all']);
    await settle();
    expect(fetchJson).toHaveBeenCalledTimes(1);
    expect(loadImage).toHaveBeenCalledTimes(1);
    expect(loadImage).toHaveBeenCalledWith('/assets/imagegen/posters/poster_stop_all.png');
    // poster_ship_it untouched — only the requested poster loads.
    const shipIt = store.get('poster_ship_it');
    expect(shipIt.kind).toBe('placeholder');
  });

  it('resolves image + size after it lands', async () => {
    const { deps } = makeDeps(IMAGE_MANIFEST);
    const store = createImageStore('/assets/imagegen/manifest.json', deps);
    store.request(['poster_ship_it']);
    await settle();
    const resolved = store.get('poster_ship_it');
    expect(resolved.kind).toBe('image');
    if (resolved.kind === 'image') {
      expect(resolved.asset.size).toEqual([1024, 1536]);
      expect(resolved.image).toEqual({ url: '/assets/imagegen/posters/poster_ship_it.png' });
    }
  });

  it('degrades to placeholder on manifest failure', async () => {
    const { deps } = makeDeps(IMAGE_MANIFEST, {
      fetchJson: vi.fn(() => Promise.reject(new Error('offline'))),
    });
    const store = createImageStore('/assets/imagegen/manifest.json', deps);
    store.request(['poster_stop_all']);
    await settle();
    expect(store.get('poster_stop_all')).toEqual({ kind: 'placeholder', name: 'poster_stop_all' });
  });

  it('honors a custom resolveUrl — the real imagegen/manifest.json ships ASSET-ROOT-relative paths (already carrying the "imagegen/" prefix), which the default manifest-relative resolver would double', async () => {
    const rootRelativeManifest = {
      version: 1,
      images: [
        {
          name: 'poster_stop_all',
          path: 'imagegen/posters/poster_stop_all.png',
          size: [1024, 1536],
          purpose: 'wall',
        },
      ],
    };
    const { deps, loadImage } = makeDeps(rootRelativeManifest, {
      fetchJson: vi.fn(() => Promise.resolve(rootRelativeManifest)),
    });
    const store = createImageStore('/assets/imagegen/manifest.json', {
      ...deps,
      resolveUrl: (relativePath) => `/assets/${relativePath}`,
    });
    store.request(['poster_stop_all']);
    await settle();
    expect(loadImage).toHaveBeenCalledWith('/assets/imagegen/posters/poster_stop_all.png');
  });
});
