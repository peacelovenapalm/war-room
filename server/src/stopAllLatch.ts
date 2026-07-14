/**
 * Durable STOP-ALL latch (C9-1 — TUNING v3.1 "a durable server latch is
 * future scope", now in scope).
 *
 * Background: STOP ALL's halt was durable only INDIRECTLY — a halted standing
 * order carries `stoppedByKillSwitch`, and the auto-executor persists its own
 * `killSwitchActive`. But a STOP ALL that halted ONLY chain runs (zero enabled
 * standing orders) left NO durable flag a fresh webview could hydrate from
 * (the exact limitation stopAll.ts's header honestly called out). This latch
 * closes that gap: one boolean, persisted the moment STOP ALL engages,
 * survives a full server restart, and is exposed for mount-time hydration so a
 * page reload never silently reads "not stopped".
 *
 * Persistence follows dispatchStore.ts's own file-backed/tolerant idiom (same
 * `~/.pixel-agents/` directory via LAYOUT_FILE_DIR), with an atomic tmp+rename
 * write (a crash mid-write leaves the previous latch intact, never a truncated
 * file). A missing/corrupt file reads as NOT engaged — the safe default is the
 * one that lets automation run; a durable STOP must have been explicitly and
 * successfully written to be honored.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { LAYOUT_FILE_DIR } from './constants.js';

const STOP_ALL_FILE_NAME = 'stop-all-latch.json';

export interface StopAllLatchSnapshot {
  engaged: boolean;
  revision: number;
}

function defaultLatchFile(): string {
  return path.join(os.homedir(), LAYOUT_FILE_DIR, STOP_ALL_FILE_NAME);
}

export class StopAllLatch {
  private state: StopAllLatchSnapshot | null = null;
  private explicitPath: string | undefined;
  private resolvedPath: string | undefined;
  private usingDefaultPath = false;

  constructor(persistPath?: string) {
    this.explicitPath = persistPath;
  }

  private persistPath(): string {
    if (!this.resolvedPath) {
      this.usingDefaultPath = this.explicitPath === undefined;
      this.resolvedPath = this.explicitPath ?? defaultLatchFile();
    }
    return this.resolvedPath;
  }

  private ensureLoaded(): StopAllLatchSnapshot {
    if (!this.state) {
      this.state = this.load() ?? { engaged: false, revision: 0 };
    }
    return this.state;
  }

  private load(): StopAllLatchSnapshot | null {
    try {
      const raw = JSON.parse(fs.readFileSync(this.persistPath(), 'utf8')) as unknown;
      if (
        raw !== null &&
        typeof raw === 'object' &&
        typeof (raw as StopAllLatchSnapshot).engaged === 'boolean'
      ) {
        const parsed = raw as StopAllLatchSnapshot & { updatedAt?: unknown };
        return {
          engaged: parsed.engaged,
          // Migrate the old timestamp field as a high starting revision so
          // the first post-upgrade transition remains strictly monotonic.
          revision:
            typeof parsed.revision === 'number'
              ? parsed.revision
              : typeof parsed.updatedAt === 'number'
                ? parsed.updatedAt
                : 0,
        };
      }
    } catch {
      /* missing/corrupt → not engaged (safe default) */
    }
    return null;
  }

  private persist(): void {
    // Same guard as dispatchStore.persist(): a unit test exercising the
    // process-wide singleton must never write the REAL sidecar; a test with
    // its own explicit path still writes.
    if (process.env.VITEST && this.usingDefaultPath) return;
    const target = this.persistPath();
    const tmp = `${target}.tmp`;
    try {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(tmp, JSON.stringify(this.ensureLoaded()), 'utf8');
      fs.renameSync(tmp, target);
    } catch {
      try {
        fs.rmSync(tmp, { force: true });
      } catch {
        /* best-effort tmp cleanup */
      }
      /* latch-write failure must never crash the server */
    }
  }

  /** Durable STOP-ALL state — the value a fresh webview hydrates from. */
  isEngaged(): boolean {
    return this.ensureLoaded().engaged;
  }

  getSnapshot(): StopAllLatchSnapshot {
    return { ...this.ensureLoaded() };
  }

  /** Engage the latch (idempotent — a second engage is a no-op, never a
   *  redundant write). Called from the SAME stop-all transaction as
   *  standingOrderStore.haltAll()/chainOrchestrator.haltAll(). */
  engage(_now: number = Date.now()): StopAllLatchSnapshot {
    const state = this.ensureLoaded();
    if (!state.engaged) {
      state.engaged = true;
      state.revision += 1;
      this.persist();
    }
    return this.getSnapshot();
  }

  /** Release the latch (idempotent). Called from the SAME resume transaction. */
  release(_now: number = Date.now()): StopAllLatchSnapshot {
    const state = this.ensureLoaded();
    if (state.engaged) {
      state.engaged = false;
      state.revision += 1;
      this.persist();
    }
    return this.getSnapshot();
  }
}

/** Process-wide instance (the server is single-process). */
export const stopAllLatch = new StopAllLatch();
