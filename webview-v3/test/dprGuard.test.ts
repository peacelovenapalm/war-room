import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * Workspace-wide DPR grep guard (KICKOFF-v3.1 hard rule 7). The ONLY file
 * in webview-v3/src allowed to mention devicePixelRatio is
 * engine/resolution.ts — the single named place where the capped backing-
 * store density is read. Anything else (camera, renderer, app code)
 * referencing DPR is the exact bug class that blanked the v2 mobile canvas.
 */

const SRC_ROOT = fileURLToPath(new URL('../src', import.meta.url));
const ALLOWED = new Set([path.join('engine', 'resolution.ts')]);

function walk(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      files.push(...walk(full));
    } else {
      files.push(full);
    }
  }
  return files;
}

describe('devicePixelRatio containment', () => {
  it('appears in exactly one file: src/engine/resolution.ts', () => {
    const offenders: string[] = [];
    let allowedHits = 0;
    for (const file of walk(SRC_ROOT)) {
      const relative = path.relative(SRC_ROOT, file);
      if (!readFileSync(file, 'utf8').includes('devicePixelRatio')) continue;
      if (ALLOWED.has(relative)) {
        allowedHits += 1;
      } else {
        offenders.push(relative);
      }
    }
    expect(offenders).toEqual([]);
    // The allowed read must actually exist — an empty src would pass vacuously.
    expect(allowedHits).toBe(1);
  });
});
