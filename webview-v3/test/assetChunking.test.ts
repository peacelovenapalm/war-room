import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { parseSpriteSheetManifest } from '../src/assets/manifest';
import { STATIC_PROP_SPRITE_NAMES, WORKER_OUTFITS } from '../src/engine/world';

function readManifest(name: string) {
  const raw = JSON.parse(
    readFileSync(join(__dirname, '../../webview-v3-assets', `${name}.manifest.json`), 'utf8'),
  ) as unknown;
  const manifest = parseSpriteSheetManifest(raw);
  expect(manifest).not.toBeNull();
  return manifest!;
}

describe('production asset chunking', () => {
  it('keeps deferred furniture out of the two sheets needed by the default world', () => {
    const manifest = readManifest('props');
    const spriteByName = new Map(manifest.sprites.map((sprite) => [sprite.name, sprite]));
    const initialSheets = new Set(
      STATIC_PROP_SPRITE_NAMES.map((name) => spriteByName.get(name)?.sheet),
    );

    expect(initialSheets).toEqual(new Set([0, 2]));
    for (const deferred of [
      'bookshelf',
      'filing_cabinet',
      'rework_bin',
      'sofa',
      'trophy_shelf',
      'whiteboard',
    ]) {
      expect(spriteByName.get(deferred)?.sheet).toBe(1);
    }
  });

  it('stores each worker outfit in its own independently-loadable sheet', () => {
    const manifest = readManifest('characters');
    const spriteByName = new Map(manifest.sprites.map((sprite) => [sprite.name, sprite]));
    const outfitSheets = new Set<number>();

    for (const outfit of WORKER_OUTFITS) {
      const sheets = new Set(
        ['blocked', 'sit', 'type', 'walk'].map(
          (pose) => spriteByName.get(`worker_${outfit}.${pose}`)?.sheet,
        ),
      );
      expect(sheets.size, outfit).toBe(1);
      const sheet = [...sheets][0];
      expect(sheet, outfit).toBeTypeOf('number');
      outfitSheets.add(sheet!);
    }

    expect(outfitSheets.size).toBe(WORKER_OUTFITS.length);
  });
});
