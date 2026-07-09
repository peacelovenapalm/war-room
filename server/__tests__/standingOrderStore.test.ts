/**
 * Unit tests for the standing order store (v2 mechanic G3, GAME-DESIGN.md
 * §7.2). Covers: creation + the perk-derived enabled-order cap, the
 * UNCONDITIONAL first-fire confirm gate (never bypassed by any perk), the
 * daily dedupe guard firing exactly once per local date across repeated
 * 60s ticks, interval scheduling, budget-pause skip semantics
 * (lastFiredAt unchanged, lastSkipReason recorded), and STOP ALL/RESUME
 * restoring exactly the prior enabled set.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  standingOrderCap,
  StandingOrderStore,
  standingOrderStore,
} from '../src/standingOrderStore.js';

let vitestGuardHome: string;
vi.mock('os', async () => {
  const actual = await vi.importActual<typeof import('os')>('os');
  return { ...actual, homedir: () => vitestGuardHome };
});

let tmpDir: string;
let statePath: string;

const resolveNoDefaults = () => undefined;
const neverPaused = () => false;
const alwaysPaused = () => true;

function acceptingEnqueue() {
  return { ok: true as const };
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'standing-order-store-'));
  statePath = path.join(tmpDir, 'standing-orders.json');
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

const DAY1_9AM = new Date(2026, 6, 7, 9, 0, 0).getTime();
const DAY1_10AM = new Date(2026, 6, 7, 10, 0, 0).getTime();
const DAY1_NOON = new Date(2026, 6, 7, 12, 0, 0).getTime();
const DAY2_9AM = new Date(2026, 6, 8, 9, 0, 0).getTime();

describe('standingOrderCap', () => {
  it('base cap is 1; Second Shift +1; Night Shift Foreman +2', () => {
    expect(standingOrderCap({})).toBe(1);
    expect(standingOrderCap({ secondShift: true })).toBe(2);
    expect(standingOrderCap({ nightShiftForeman: true })).toBe(3);
    expect(standingOrderCap({ secondShift: true, nightShiftForeman: true })).toBe(4);
  });
});

describe('StandingOrderStore.create', () => {
  it('creates an order that needs first-fire confirm and enforces the cap', () => {
    const s = new StandingOrderStore(statePath);
    const result = s.create(
      {
        name: 'nightly',
        schedule: { kind: 'daily', atLocalHour: 9 },
        machine: 'MACBOOK',
        provider: 'claude',
        cwd: '/tmp',
        prompt: 'go',
      },
      {},
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.order.needsFirstFireConfirm).toBe(true);
    expect(result.order.enabled).toBe(true);

    const second = s.create(
      {
        name: 'second',
        schedule: { kind: 'interval', everyMs: 3_600_000 },
        machine: 'MACBOOK',
        provider: 'claude',
        cwd: '/tmp',
        prompt: 'go',
      },
      {},
    );
    expect(second.ok).toBe(false); // base cap = 1, already at 1 enabled
  });

  it('perk-raised cap allows a second enabled order', () => {
    const s = new StandingOrderStore(statePath);
    s.create(
      {
        name: 'a',
        schedule: { kind: 'interval', everyMs: 1000 },
        machine: 'M',
        provider: 'claude',
        cwd: '/tmp',
        prompt: 'go',
      },
      { secondShift: true },
    );
    const result = s.create(
      {
        name: 'b',
        schedule: { kind: 'interval', everyMs: 1000 },
        machine: 'M',
        provider: 'claude',
        cwd: '/tmp',
        prompt: 'go',
      },
      { secondShift: true },
    );
    expect(result.ok).toBe(true);
  });
});

describe('First-fire confirm — UNCONDITIONAL gate', () => {
  it('tick() never fires an order that has not been confirmed, regardless of perks/schedule due-ness', () => {
    const s = new StandingOrderStore(statePath);
    const created = s.create(
      {
        name: 'x',
        schedule: { kind: 'interval', everyMs: 1 },
        machine: 'M',
        provider: 'claude',
        cwd: '/tmp',
        prompt: 'go',
      },
      { secondShift: true, nightShiftForeman: true }, // every perk owned — still no bypass
    );
    if (!created.ok) throw new Error('unreachable');
    s.tick(DAY1_NOON + 10_000, neverPaused, resolveNoDefaults, acceptingEnqueue);
    const order = s.get(created.order.id);
    expect(order?.needsFirstFireConfirm).toBe(true);
    expect(order?.lastFiredAt).toBeUndefined();
  });

  it('confirmFirstFire fires immediately and unlocks future unattended ticks', () => {
    const s = new StandingOrderStore(statePath);
    const created = s.create(
      {
        name: 'x',
        schedule: { kind: 'interval', everyMs: 1_000 },
        machine: 'M',
        provider: 'claude',
        cwd: '/tmp',
        prompt: 'go',
      },
      {},
    );
    if (!created.ok) throw new Error('unreachable');
    const confirmed = s.confirmFirstFire(
      created.order.id,
      resolveNoDefaults,
      acceptingEnqueue,
      DAY1_9AM,
    );
    expect(confirmed.ok).toBe(true);
    const order = s.get(created.order.id);
    expect(order?.needsFirstFireConfirm).toBe(false);
    expect(order?.lastFiredAt).toBe(DAY1_9AM);
  });
});

describe('Daily schedule dedupe', () => {
  it('fires exactly once per local date across repeated 60s ticks within the same day', () => {
    const s = new StandingOrderStore(statePath);
    const created = s.create(
      {
        name: 'daily',
        schedule: { kind: 'daily', atLocalHour: 9 },
        machine: 'M',
        provider: 'claude',
        cwd: '/tmp',
        prompt: 'go',
      },
      {},
    );
    if (!created.ok) throw new Error('unreachable');
    s.confirmFirstFire(created.order.id, resolveNoDefaults, acceptingEnqueue, DAY1_9AM);

    let fireCount = 0;
    const countingEnqueue = () => {
      fireCount++;
      return { ok: true as const };
    };
    // Repeated ticks every 60s from 9am through noon, same local day.
    for (let t = DAY1_9AM + 60_000; t <= DAY1_NOON; t += 60_000) {
      s.tick(t, neverPaused, resolveNoDefaults, countingEnqueue);
    }
    expect(fireCount).toBe(0); // already fired once today via confirmFirstFire

    // Next day, past the scheduled hour — fires exactly once more.
    for (let t = DAY2_9AM; t <= DAY2_9AM + 3 * 60_000; t += 60_000) {
      s.tick(t, neverPaused, resolveNoDefaults, countingEnqueue);
    }
    expect(fireCount).toBe(1);
  });

  it('does not fire before the scheduled local hour', () => {
    const s = new StandingOrderStore(statePath);
    const created = s.create(
      {
        name: 'daily',
        schedule: { kind: 'daily', atLocalHour: 14 },
        machine: 'M',
        provider: 'claude',
        cwd: '/tmp',
        prompt: 'go',
      },
      {},
    );
    if (!created.ok) throw new Error('unreachable');
    // Clear needsFirstFireConfirm directly (get() returns the live record)
    // to isolate the hour-gate behavior from confirmFirstFire's own
    // immediate-fire side effect, which would otherwise also set
    // lastFiredDate and confound the "not due" assertion below.
    const live = s.get(created.order.id);
    if (live) live.needsFirstFireConfirm = false;
    let fired = false;
    s.tick(DAY1_10AM, neverPaused, resolveNoDefaults, () => {
      fired = true;
      return { ok: true as const };
    });
    expect(fired).toBe(false);
  });
});

describe('Interval schedule', () => {
  it('fires once everyMs has elapsed since the last fire', () => {
    const s = new StandingOrderStore(statePath);
    const created = s.create(
      {
        name: 'hourly',
        schedule: { kind: 'interval', everyMs: 3_600_000 },
        machine: 'M',
        provider: 'claude',
        cwd: '/tmp',
        prompt: 'go',
      },
      {},
    );
    if (!created.ok) throw new Error('unreachable');
    s.confirmFirstFire(created.order.id, resolveNoDefaults, acceptingEnqueue, DAY1_9AM);

    let fireCount = 0;
    const countingEnqueue = () => {
      fireCount++;
      return { ok: true as const };
    };
    s.tick(DAY1_9AM + 30 * 60_000, neverPaused, resolveNoDefaults, countingEnqueue); // +30min, not due
    expect(fireCount).toBe(0);
    s.tick(DAY1_9AM + 61 * 60_000, neverPaused, resolveNoDefaults, countingEnqueue); // +61min, due
    expect(fireCount).toBe(1);
  });
});

describe('Budget-pause skip', () => {
  it('skips a due fire when paused, leaving lastFiredAt unchanged and recording the reason', () => {
    const s = new StandingOrderStore(statePath);
    const created = s.create(
      {
        name: 'x',
        schedule: { kind: 'interval', everyMs: 1_000 },
        machine: 'M',
        provider: 'claude',
        cwd: '/tmp',
        prompt: 'go',
      },
      {},
    );
    if (!created.ok) throw new Error('unreachable');
    s.confirmFirstFire(created.order.id, resolveNoDefaults, acceptingEnqueue, DAY1_9AM);
    const beforeFire = s.get(created.order.id)?.lastFiredAt;

    s.tick(DAY1_9AM + 5_000, alwaysPaused, resolveNoDefaults, acceptingEnqueue);
    const order = s.get(created.order.id);
    expect(order?.lastSkipReason).toBe('budget-paused');
    expect(order?.lastFiredAt).toBe(beforeFire); // unchanged
  });
});

describe('STOP ALL / RESUME', () => {
  it('haltAll disables every enabled order; resumeAll restores exactly that set', () => {
    const s = new StandingOrderStore(statePath);
    const a = s.create(
      {
        name: 'a',
        schedule: { kind: 'interval', everyMs: 1000 },
        machine: 'M',
        provider: 'claude',
        cwd: '/tmp',
        prompt: 'go',
      },
      { secondShift: true },
    );
    const b = s.create(
      {
        name: 'b',
        schedule: { kind: 'interval', everyMs: 1000 },
        machine: 'M',
        provider: 'claude',
        cwd: '/tmp',
        prompt: 'go',
      },
      { secondShift: true },
    );
    if (!a.ok || !b.ok) throw new Error('unreachable');
    s.setEnabled(b.order.id, false); // manually disabled before STOP ALL

    const halted = s.haltAll();
    expect(halted.map((o) => o.id)).toEqual([a.order.id]); // b was already disabled
    expect(s.get(a.order.id)?.enabled).toBe(false);
    expect(s.get(a.order.id)?.stoppedByKillSwitch).toBe(true);

    const resumed = s.resumeAll();
    expect(resumed.map((o) => o.id)).toEqual([a.order.id]);
    expect(s.get(a.order.id)?.enabled).toBe(true);
    expect(s.get(b.order.id)?.enabled).toBe(false); // still disabled — never resurrected
  });
});

describe('StandingOrderStore VITEST guard (cloned from economyStore.test.ts pattern)', () => {
  beforeEach(() => {
    vitestGuardHome = fs.mkdtempSync(path.join(os.tmpdir(), 'standing-order-vitest-guard-'));
  });

  it('never writes the real default sidecar path under VITEST, even via the process-wide singleton', () => {
    standingOrderStore.create(
      {
        name: 'vitest-guard-probe',
        schedule: { kind: 'interval', everyMs: 1000 },
        machine: 'M',
        provider: 'claude',
        cwd: '/tmp',
        prompt: 'go',
      },
      {},
    );
    const expectedPath = path.join(vitestGuardHome, '.pixel-agents', 'standing-orders.json');
    expect(fs.existsSync(expectedPath)).toBe(false);
  });
});
