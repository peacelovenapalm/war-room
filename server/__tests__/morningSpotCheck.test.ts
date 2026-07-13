/**
 * Unit tests for morningSpotCheck.ts (V6-5 sampled, non-blocking spool
 * writer -- see the file's own header for the documented external-runner
 * path this feeds).
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { MORNING_SPOT_CHECK_SAMPLE_RATE } from '../src/constants.js';
import { shouldSpotCheck, writeMorningSpotCheckSpool } from '../src/morningSpotCheck.js';
import type { MorningSurface } from '../src/morningSurface.js';

function makeSurface(overrides: Partial<MorningSurface> = {}): MorningSurface {
  return {
    generatedAt: '2026-07-13T06:00:00.000Z',
    morningJson: {
      available: true,
      stale: false,
      dataAgeSeconds: 60,
      date: '2026-07-13',
      top3: [],
      flags: null,
      prs: { count: 0, list: [] },
    },
    board: {
      dataAgeSeconds: 0,
      needsInput: { count: 0, names: [] },
      heldBudget: { count: 0, jobs: [] },
    },
    overnight: {
      dataAgeSeconds: 0,
      windowStart: '2026-07-12T18:00:00.000Z',
      windowEnd: '2026-07-13T06:00:00.000Z',
      receiptCount: 0,
      receipts: [],
    },
    needsYouCount: 0,
    degraded: false,
    degradedReasons: [],
    streak: { count: 3, lastBreachReason: null, lastBreachAt: null },
    ...overrides,
  };
}

describe('shouldSpotCheck', () => {
  it('is unconditionally true the morning after a degraded morning', () => {
    expect(shouldSpotCheck('2026-07-13', true)).toBe(true);
  });

  it('samples deterministically -- the same date always yields the same verdict', () => {
    const a = shouldSpotCheck('2026-07-13', false);
    const b = shouldSpotCheck('2026-07-13', false);
    expect(a).toBe(b);
  });

  it('over MORNING_SPOT_CHECK_SAMPLE_RATE consecutive dates, at least one samples true', () => {
    let any = false;
    for (let i = 0; i < MORNING_SPOT_CHECK_SAMPLE_RATE * 3; i++) {
      const date = `2026-08-${String((i % 28) + 1).padStart(2, '0')}`;
      if (shouldSpotCheck(date, false)) any = true;
    }
    expect(any).toBe(true);
  });
});

describe('writeMorningSpotCheckSpool', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'morning-spool-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('does nothing when WAR_ROOM_MORNING_SPOOL_DIR is unset', () => {
    writeMorningSpotCheckSpool('2026-07-13', makeSurface(), 'NEEDS YOU: 0 — all calm', {});
    expect(fs.existsSync(tmpDir) && fs.readdirSync(tmpDir).length).toBe(0);
  });

  it('writes a JSON spool file named <date>.json under the configured dir', () => {
    writeMorningSpotCheckSpool('2026-07-13', makeSurface(), 'NEEDS YOU: 0 — all calm', {
      WAR_ROOM_MORNING_SPOOL_DIR: tmpDir,
    });
    const target = path.join(tmpDir, '2026-07-13.json');
    expect(fs.existsSync(target)).toBe(true);
    const parsed = JSON.parse(fs.readFileSync(target, 'utf-8')) as {
      date: string;
      summary: string;
    };
    expect(parsed.date).toBe('2026-07-13');
    expect(parsed.summary).toBe('NEEDS YOU: 0 — all calm');
  });

  it('refuses an unsafe date segment (never writes outside the spool dir)', () => {
    writeMorningSpotCheckSpool('../../etc', makeSurface(), 'x', {
      WAR_ROOM_MORNING_SPOOL_DIR: tmpDir,
    });
    expect(fs.readdirSync(tmpDir).length).toBe(0);
  });
});
