import { describe, expect, it } from 'vitest';

import {
  computeWalkers,
  DRIFT_LOOP_MS,
  JANITOR_LOOP_MS,
  PACE_PERIOD_MS,
  type WalkerAgentInput,
} from '../src/engine/walkers';
import { staticPropTile } from '../src/engine/world';

const DESK: WalkerAgentInput = { agentId: 2, behavior: 'idle', deskTileX: 5, deskTileY: 4 };
const BLOCKED: WalkerAgentInput = { agentId: 7, behavior: 'blocked', deskTileX: 9, deskTileY: 2 };

describe('computeWalkers', () => {
  it('no janitor when disconnected, even with agents present', () => {
    const poses = computeWalkers([DESK], false, 0);
    expect(poses.some((p) => p.kind === 'janitor')).toBe(false);
  });

  it('no janitor when connected but nobody is in the office', () => {
    const poses = computeWalkers([], true, 0);
    expect(poses).toEqual([]);
  });

  it('janitor patrols when connected with at least one agent', () => {
    const poses = computeWalkers([DESK], true, 0);
    expect(poses.filter((p) => p.kind === 'janitor')).toHaveLength(1);
  });

  it('janitor position changes over the loop and returns to start after one full lap', () => {
    const a = computeWalkers([DESK], true, 0).find((p) => p.kind === 'janitor')!;
    const b = computeWalkers([DESK], true, JANITOR_LOOP_MS / 2).find((p) => p.kind === 'janitor')!;
    const c = computeWalkers([DESK], true, JANITOR_LOOP_MS).find((p) => p.kind === 'janitor')!;
    expect(a.tileX !== b.tileX || a.tileY !== b.tileY).toBe(true);
    expect(c.tileX).toBeCloseTo(a.tileX, 6);
    expect(c.tileY).toBeCloseTo(a.tileY, 6);
  });

  it('idle agents produce a drift walker that visits both the desk and the coffee tile across the loop', () => {
    // Per-agent phase offset shifts WHERE in the loop t=0 lands (by design,
    // so agents don't move in lockstep) — sample the whole loop densely
    // instead of asserting a specific instant lines up with either anchor.
    const coffee = staticPropTile('coffee');
    const samples = Array.from(
      { length: 200 },
      (_, i) =>
        computeWalkers([DESK], true, (i / 200) * DRIFT_LOOP_MS).find((p) => p.id === 'drift-2')!,
    );
    const distTo = (t: { tileX: number; tileY: number }) =>
      Math.min(...samples.map((s) => Math.hypot(s.tileX - t.tileX, s.tileY - t.tileY)));
    expect(distTo({ tileX: DESK.deskTileX, tileY: DESK.deskTileY })).toBeLessThan(0.05);
    expect(distTo(coffee)).toBeLessThan(0.05);
  });

  it('blocked agents produce a pace walker oscillating beside (not on top of) their desk', () => {
    const poses = [0, PACE_PERIOD_MS / 4, PACE_PERIOD_MS / 2, (3 * PACE_PERIOD_MS) / 4].map(
      (now) => computeWalkers([BLOCKED], true, now).find((p) => p.id === 'pace-7')!,
    );
    // Never exactly on the desk tile itself (pacing is BESIDE it).
    for (const pose of poses) {
      expect(pose.tileY).not.toBeCloseTo(BLOCKED.deskTileY, 3);
    }
    // Oscillates: not all four samples land at the same tileX.
    const distinctX = new Set(poses.map((p) => Math.round(p.tileX * 1000)));
    expect(distinctX.size).toBeGreaterThan(1);
  });

  it('two idle agents at different desks get independent, non-identical phase (no lockstep)', () => {
    const other: WalkerAgentInput = { agentId: 3, behavior: 'idle', deskTileX: 5, deskTileY: 4 };
    const poses = computeWalkers([DESK, other], true, 1_000);
    const a = poses.find((p) => p.id === 'drift-2')!;
    const b = poses.find((p) => p.id === 'drift-3')!;
    expect(a.tileX === b.tileX && a.tileY === b.tileY).toBe(false);
  });

  it('is a pure function of (inputs, connected, now) — same inputs, same output', () => {
    expect(computeWalkers([DESK, BLOCKED], true, 12_345)).toEqual(
      computeWalkers([DESK, BLOCKED], true, 12_345),
    );
  });

  it('produces exactly one pose per agent input plus the janitor', () => {
    const poses = computeWalkers([DESK, BLOCKED], true, 500);
    expect(poses).toHaveLength(3);
    expect(new Set(poses.map((p) => p.id)).size).toBe(3);
  });
});
