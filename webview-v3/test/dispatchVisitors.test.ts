import { describe, expect, it } from 'vitest';

import { dispatchVisitorAnchors, GUEST_SLOTS, outfitForDispatchId } from '../src/engine/world';
import type { DispatchEntry } from '../src/net/dispatchFacts';
import {
  deriveDispatchVisitors,
  isRunningDispatch,
  MAX_DISPATCH_VISITORS,
} from '../src/state/dispatchVisitors';

function entry(overrides: Partial<DispatchEntry> = {}): DispatchEntry {
  return {
    id: 'd1',
    action: 'dispatch',
    status: 'ringing',
    machine: 'MACBOOK',
    receivedAt: 0,
    ...overrides,
  };
}

describe('isRunningDispatch', () => {
  it('RUNNING = answered status with a pid present', () => {
    expect(isRunningDispatch(entry({ status: 'answered', pid: 42 }))).toBe(true);
    expect(isRunningDispatch(entry({ status: 'answered' }))).toBe(false);
    expect(isRunningDispatch(entry({ status: 'ringing', pid: 42 }))).toBe(false);
    expect(isRunningDispatch(entry({ status: 'exited', pid: 42 }))).toBe(false);
  });
});

describe('deriveDispatchVisitors', () => {
  it('only RUNNING dispatches become visitors', () => {
    const entries = [
      entry({ id: 'a', status: 'ringing' }),
      entry({ id: 'b', status: 'answered', pid: 1 }),
      entry({ id: 'c', status: 'answered' }),
      entry({ id: 'd', status: 'exited', pid: 2 }),
    ];
    expect(deriveDispatchVisitors(entries).map((v) => v.id)).toEqual(['b']);
  });

  it('a dispatch leaves the office the same frame its status moves off RUNNING', () => {
    const running = [entry({ id: 'a', status: 'answered', pid: 1, receivedAt: 0 })];
    expect(deriveDispatchVisitors(running).map((v) => v.id)).toEqual(['a']);
    const exited = [entry({ id: 'a', status: 'exited', pid: 1, receivedAt: 0, exitCode: 0 })];
    expect(deriveDispatchVisitors(exited)).toHaveLength(0);
  });

  it('orders oldest-running first and caps at MAX_DISPATCH_VISITORS', () => {
    const entries = Array.from({ length: MAX_DISPATCH_VISITORS + 2 }, (_, i) =>
      entry({ id: `d${String(i)}`, status: 'answered', pid: i, receivedAt: 100 - i }),
    );
    const visitors = deriveDispatchVisitors(entries);
    expect(visitors).toHaveLength(MAX_DISPATCH_VISITORS);
    // receivedAt DESCENDS as i increases above, so the oldest (smallest
    // receivedAt) is the highest-i entries — confirm ascending receivedAt order.
    const ids = visitors.map((v) => v.id);
    expect(ids).toEqual([...ids].sort((x, y) => Number(y.slice(1)) - Number(x.slice(1))));
  });

  it('carries machine + provider through for the office chip label', () => {
    const entries = [
      entry({ id: 'a', status: 'answered', pid: 1, machine: 'NEXUS', provider: 'codex' }),
    ];
    expect(deriveDispatchVisitors(entries)).toEqual([
      { id: 'a', machine: 'NEXUS', provider: 'codex' },
    ]);
  });
});

describe('engine/world.ts: dispatchVisitorAnchors + outfitForDispatchId (T6)', () => {
  it('assigns GUEST_SLOTS in order and drops overflow ids beyond slot count', () => {
    const ids = Array.from({ length: GUEST_SLOTS.length + 1 }, (_, i) => `d${String(i)}`);
    const anchors = dispatchVisitorAnchors(ids);
    expect(anchors).toHaveLength(GUEST_SLOTS.length);
    expect(anchors.map((a) => a.id)).toEqual(ids.slice(0, GUEST_SLOTS.length));
  });

  it('guest-slot anchors are distinct from the desk-slot tile grid', () => {
    // Sanity check the anchors resolve to real, distinct tiles rather than
    // all collapsing onto one point.
    const anchors = dispatchVisitorAnchors(['a', 'b']);
    expect(new Set(anchors.map((a) => `${String(a.tileX)},${String(a.tileY)}`)).size).toBe(2);
  });

  it('outfitForDispatchId is deterministic for the same id, not Math.random', () => {
    expect(outfitForDispatchId('dispatch-123')).toBe(outfitForDispatchId('dispatch-123'));
  });
});
