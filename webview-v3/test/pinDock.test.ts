import { describe, expect, it } from 'vitest';

import { DOCK_FULL_REASON, MAX_PINS, pinAgent, unpinAgent } from '../src/state/pinDock';

describe('pin dock (exactly 3 slots)', () => {
  it('pins up to MAX_PINS agents in order', () => {
    let pins: readonly number[] = [];
    for (const id of [1, 2, 3]) {
      const result = pinAgent(pins, id);
      expect(result.ok).toBe(true);
      pins = result.pins;
    }
    expect(pins).toEqual([1, 2, 3]);
    expect(pins.length).toBe(MAX_PINS);
  });

  it('REJECTS the 4th pin with the labeled DOCK FULL reason (no silent eviction)', () => {
    const result = pinAgent([1, 2, 3], 4);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe(DOCK_FULL_REASON);
    expect(result.pins).toEqual([1, 2, 3]);
  });

  it('re-pinning an existing agent is a no-op success', () => {
    const result = pinAgent([1, 2, 3], 2);
    expect(result.ok).toBe(true);
    expect(result.pins).toEqual([1, 2, 3]);
  });

  it('unpin frees a slot; unpinning a stranger is same-reference', () => {
    const pins = [1, 2, 3] as const;
    expect(unpinAgent(pins, 2)).toEqual([1, 3]);
    expect(unpinAgent(pins, 9)).toBe(pins);
    const freed = unpinAgent(pins, 1);
    expect(pinAgent(freed, 4).ok).toBe(true);
  });
});
