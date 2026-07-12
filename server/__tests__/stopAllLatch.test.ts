/**
 * C9-1: durable STOP-ALL latch. The whole point is survival across a
 * fresh load / server restart — so the load-bearing test engages the latch on
 * one instance and reads it back true on a SECOND instance pointed at the same
 * file (the restart-equivalent), never resetting to the default false.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { StopAllLatch } from '../src/stopAllLatch.js';

let tmpDir: string;
let latchPath: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stop-all-latch-'));
  latchPath = path.join(tmpDir, 'stop-all-latch.json');
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('StopAllLatch durability (C9-1)', () => {
  it('defaults to NOT engaged when no file exists', () => {
    expect(new StopAllLatch(latchPath).isEngaged()).toBe(false);
  });

  it('engaged state survives a fresh instance reading the same file (restart-equivalent)', () => {
    const first = new StopAllLatch(latchPath);
    first.engage();
    expect(first.isEngaged()).toBe(true);
    // A brand-new instance = a restarted server / a freshly hydrated page.
    const reloaded = new StopAllLatch(latchPath);
    expect(reloaded.isEngaged()).toBe(true);
  });

  it('release clears it durably too', () => {
    const first = new StopAllLatch(latchPath);
    first.engage();
    first.release();
    expect(new StopAllLatch(latchPath).isEngaged()).toBe(false);
  });

  it('engage is idempotent — a corrupt file reads as not-engaged (safe default)', () => {
    fs.writeFileSync(latchPath, 'not json{', 'utf8');
    expect(new StopAllLatch(latchPath).isEngaged()).toBe(false);
    const latch = new StopAllLatch(latchPath);
    latch.engage();
    latch.engage(); // no throw, no double-write concern
    expect(new StopAllLatch(latchPath).isEngaged()).toBe(true);
  });

  it('writes atomically (no leftover .tmp after a successful engage)', () => {
    new StopAllLatch(latchPath).engage();
    expect(fs.existsSync(latchPath)).toBe(true);
    expect(fs.existsSync(`${latchPath}.tmp`)).toBe(false);
  });
});
