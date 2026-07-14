import { describe, expect, it } from 'vitest';

import { floorDrawRecords } from '../src/engine/renderer';

describe('renderer static geometry cache', () => {
  it('reuses floor records until layout dimensions change', () => {
    const first = floorDrawRecords(14, 10);
    expect(floorDrawRecords(14, 10)).toBe(first);
    expect(first).toHaveLength(140);

    const resized = floorDrawRecords(12, 8);
    expect(resized).not.toBe(first);
    expect(resized).toHaveLength(96);
  });
});
