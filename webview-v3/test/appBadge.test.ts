import { describe, expect, it, vi } from 'vitest';

import { badgeSupported, clearAppBadge, setAppBadgeCount } from '../src/state/appBadge';

describe('badgeSupported', () => {
  it('is false with no navigator or no setAppBadge', () => {
    expect(badgeSupported(undefined)).toBe(false);
    expect(badgeSupported({})).toBe(false);
  });

  it('is true when setAppBadge exists', () => {
    expect(badgeSupported({ setAppBadge: vi.fn() })).toBe(true);
  });
});

describe('setAppBadgeCount', () => {
  it('is a silent no-op when unsupported', () => {
    expect(() => setAppBadgeCount(undefined, 3)).not.toThrow();
    expect(() => setAppBadgeCount({}, 3)).not.toThrow();
  });

  it('calls setAppBadge with a positive count', () => {
    const setAppBadge = vi.fn().mockResolvedValue(undefined);
    setAppBadgeCount({ setAppBadge }, 5);
    expect(setAppBadge).toHaveBeenCalledWith(5);
  });

  it('calls clearAppBadge for a zero count', () => {
    const clearAppBadge = vi.fn().mockResolvedValue(undefined);
    setAppBadgeCount({ setAppBadge: vi.fn(), clearAppBadge }, 0);
    expect(clearAppBadge).toHaveBeenCalled();
  });

  it('never throws even if the underlying API rejects', async () => {
    const setAppBadge = vi.fn().mockRejectedValue(new Error('nope'));
    expect(() => setAppBadgeCount({ setAppBadge }, 2)).not.toThrow();
  });
});

describe('clearAppBadge', () => {
  it('is a silent no-op when unsupported', () => {
    expect(() => clearAppBadge(undefined)).not.toThrow();
    expect(() => clearAppBadge({ setAppBadge: vi.fn() })).not.toThrow();
  });

  it('calls the real clearAppBadge when supported', () => {
    const fn = vi.fn().mockResolvedValue(undefined);
    clearAppBadge({ setAppBadge: vi.fn(), clearAppBadge: fn });
    expect(fn).toHaveBeenCalled();
  });
});
