import { describe, expect, it, vi } from 'vitest';

import { type AssetLoaderDeps, createAssetStore } from '../src/assets/loader';
import { parseManifest } from '../src/assets/manifest';

type FakeImage = { url: string };

const MANIFEST = {
  version: 1,
  chunks: [
    {
      id: 'office-core',
      sheet: 'office-core.png',
      entries: [
        {
          name: 'desk',
          size: { w: 64, h: 48 },
          anchor: { x: 32, y: 40 },
          rotations: 4,
          frames: 1,
        },
        {
          name: 'chair',
          size: { w: 32, h: 32 },
          anchor: { x: 16, y: 28 },
          rotations: 4,
          frames: 1,
        },
      ],
    },
    {
      id: 'walkers',
      sheet: 'walkers.png',
      entries: [
        {
          name: 'walker',
          size: { w: 32, h: 48 },
          anchor: { x: 16, y: 44 },
          rotations: 4,
          frames: 6,
        },
      ],
    },
  ],
};

function makeDeps(overrides?: Partial<AssetLoaderDeps<FakeImage>>): {
  deps: AssetLoaderDeps<FakeImage>;
  fetchJson: AssetLoaderDeps<FakeImage>['fetchJson'] & ReturnType<typeof vi.fn>;
  loadImage: AssetLoaderDeps<FakeImage>['loadImage'] & ReturnType<typeof vi.fn>;
} {
  const fetchJson = (overrides?.fetchJson ??
    vi.fn(() => Promise.resolve<unknown>(MANIFEST))) as AssetLoaderDeps<FakeImage>['fetchJson'] &
    ReturnType<typeof vi.fn>;
  const loadImage = (overrides?.loadImage ??
    vi.fn((url: string) =>
      Promise.resolve<FakeImage>({ url }),
    )) as AssetLoaderDeps<FakeImage>['loadImage'] & ReturnType<typeof vi.fn>;
  return {
    deps: { fetchJson, loadImage },
    fetchJson,
    loadImage,
  };
}

async function settle(): Promise<void> {
  // Drain the microtask queue a few levels deep (fetch -> parse -> load).
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

describe('manifest schema (WS-B contract)', () => {
  it('accepts the agreed {name, size, anchor, rotations, frames} shape', () => {
    const parsed = parseManifest(MANIFEST);
    expect(parsed).not.toBeNull();
    expect(parsed?.chunks[0].entries[0]).toEqual({
      name: 'desk',
      size: { w: 64, h: 48 },
      anchor: { x: 32, y: 40 },
      rotations: 4,
      frames: 1,
    });
  });

  it('rejects malformed payloads instead of throwing', () => {
    expect(parseManifest(null)).toBeNull();
    expect(parseManifest('nope')).toBeNull();
    expect(parseManifest({ version: 1 })).toBeNull();
    expect(parseManifest({ version: 1, chunks: [{ id: 'x' }] })).toBeNull();
    expect(
      parseManifest({
        version: 1,
        chunks: [
          {
            id: 'x',
            sheet: 's.png',
            // missing anchor
            entries: [{ name: 'desk', size: { w: 1, h: 1 }, rotations: 4, frames: 1 }],
          },
        ],
      }),
    ).toBeNull();
  });
});

describe('lazy chunked asset store', () => {
  it('fetches NOTHING at construction (no eager catalog push)', async () => {
    const { deps, fetchJson, loadImage } = makeDeps();
    createAssetStore('/assets/manifest.json', deps);
    await settle();
    expect(fetchJson).not.toHaveBeenCalled();
    expect(loadImage).not.toHaveBeenCalled();
  });

  it('resolves to placeholder before anything loads and after unknown names', async () => {
    const { deps } = makeDeps();
    const store = createAssetStore('/assets/manifest.json', deps);
    expect(store.get('desk')).toEqual({ kind: 'placeholder', name: 'desk' });
    store.request(['desk']);
    expect(store.get('desk').kind).toBe('placeholder'); // not landed yet
    await settle();
    expect(store.get('no-such-sprite')).toEqual({ kind: 'placeholder', name: 'no-such-sprite' });
  });

  it('loads ONLY the chunk containing the requested sprite', async () => {
    const { deps, fetchJson, loadImage } = makeDeps();
    const store = createAssetStore('/assets/manifest.json', deps);
    store.request(['desk']);
    await settle();
    expect(fetchJson).toHaveBeenCalledTimes(1);
    expect(loadImage).toHaveBeenCalledTimes(1);
    expect(loadImage).toHaveBeenCalledWith('/assets/office-core.png');
    // walkers.png untouched until a walker is actually needed.
    store.request(['walker']);
    await settle();
    expect(loadImage).toHaveBeenCalledTimes(2);
    expect(loadImage).toHaveBeenLastCalledWith('/assets/walkers.png');
    expect(store.stats()).toMatchObject({ chunksLoaded: 2, chunksTotal: 2, spritesKnown: 3 });
  });

  it('resolves real sprite data after its chunk lands, and notifies', async () => {
    const { deps } = makeDeps();
    const store = createAssetStore('/assets/manifest.json', deps);
    const changes = vi.fn();
    store.onChange(changes);
    store.request(['chair']);
    await settle();
    const resolved = store.get('chair');
    expect(resolved.kind).toBe('sprite');
    if (resolved.kind === 'sprite') {
      expect(resolved.entry.name).toBe('chair');
      expect(resolved.chunkId).toBe('office-core');
      expect(resolved.image).toEqual({ url: '/assets/office-core.png' });
    }
    expect(changes).toHaveBeenCalled();
    // Same-chunk sibling is now warm too — no extra fetches for it.
    expect(store.get('desk').kind).toBe('sprite');
  });

  it('is idempotent: repeated requests never refetch', async () => {
    const { deps, fetchJson, loadImage } = makeDeps();
    const store = createAssetStore('/assets/manifest.json', deps);
    store.request(['desk']);
    store.request(['desk', 'chair']);
    await settle();
    store.request(['desk']);
    await settle();
    expect(fetchJson).toHaveBeenCalledTimes(1);
    expect(loadImage).toHaveBeenCalledTimes(1);
  });

  it('degrades to placeholders on manifest failure (graceful absence)', async () => {
    const { deps } = makeDeps({ fetchJson: vi.fn(() => Promise.reject(new Error('offline'))) });
    const store = createAssetStore('/assets/manifest.json', deps);
    store.request(['desk']);
    await settle();
    expect(store.get('desk')).toEqual({ kind: 'placeholder', name: 'desk' });
    expect(store.stats().manifestState).toBe('failed');
  });

  it('degrades to placeholder on sheet failure and allows a retry', async () => {
    let fail = true;
    const { deps, loadImage } = makeDeps({
      loadImage: vi.fn((url: string) =>
        fail ? Promise.reject(new Error('404')) : Promise.resolve({ url }),
      ),
    });
    const store = createAssetStore('/assets/manifest.json', deps);
    store.request(['walker']);
    await settle();
    expect(store.get('walker').kind).toBe('placeholder');
    fail = false;
    store.request(['walker']);
    await settle();
    expect(store.get('walker').kind).toBe('sprite');
    expect(loadImage).toHaveBeenCalledTimes(2);
  });

  it('unsubscribes listeners', async () => {
    const { deps } = makeDeps();
    const store = createAssetStore('/assets/manifest.json', deps);
    const listener = vi.fn();
    const unsubscribe = store.onChange(listener);
    unsubscribe();
    store.request(['desk']);
    await settle();
    expect(listener).not.toHaveBeenCalled();
  });
});
