/**
 * Shared JSON-sidecar persistence for the v3 Living Studio stores —
 * extracts the EXACT persistence discipline economyStore.ts /
 * contractStore.ts / worldEventStore.ts each hand-roll (lazy homedir
 * resolution, 5s-throttled writes with a force override, tolerant load
 * that treats missing/corrupt files as fresh state, and the VITEST
 * default-path guard) so the five v3 skeletons don't fork it five more
 * times. Semantics are byte-for-byte the established pattern:
 *
 *  - The default path under ~/.pixel-agents/ resolves LAZILY on first
 *    access (tests that mock os.homedir() in beforeEach still win).
 *  - `process.env.VITEST` + default path → never write the REAL sidecar;
 *    tests that pass an explicit temp path still persist (that's how
 *    persistence itself is tested).
 *  - Write failures are swallowed — state loss on a failed write is
 *    acceptable; crashing the server is not.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { LAYOUT_FILE_DIR } from './constants.js';

const PERSIST_THROTTLE_MS = 5_000;

export class V3JsonPersistence<TData extends object> {
  private lastPersistAt = 0;
  private resolvedPath: string | undefined;

  constructor(
    private readonly fileName: string,
    private readonly explicitPath: string | undefined,
  ) {}

  private persistPath(): string {
    if (!this.resolvedPath) {
      this.resolvedPath =
        this.explicitPath ?? path.join(os.homedir(), LAYOUT_FILE_DIR, this.fileName);
    }
    return this.resolvedPath;
  }

  /** Tolerant load: `accept` sanity-checks the parsed shape; anything
   *  missing/corrupt/rejected yields a fresh `empty()`. */
  load(accept: (raw: Partial<TData>) => boolean, empty: () => TData): TData {
    try {
      const raw = JSON.parse(fs.readFileSync(this.persistPath(), 'utf8')) as Partial<TData>;
      if (raw && typeof raw === 'object' && accept(raw)) {
        return { ...empty(), ...raw };
      }
    } catch {
      /* missing/corrupt → fresh state */
    }
    return empty();
  }

  persist(data: TData, now: number, force = false): boolean {
    // The VITEST default-path backstop never writes — so it must never
    // CLAIM a durable write. Callers that gate side effects on durability
    // (the D0 intent receipts) fail closed here; tests exercising those
    // paths pass an explicit temp path, which persists for real.
    if (process.env.VITEST && this.explicitPath === undefined) return false;
    if (!force && now - this.lastPersistAt < PERSIST_THROTTLE_MS) return true;
    this.lastPersistAt = now;
    const target = this.persistPath();
    try {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, JSON.stringify(data), 'utf8');
      return true;
    } catch {
      /* state loss on write failure is acceptable — never crash the server */
      return false;
    }
  }
}
