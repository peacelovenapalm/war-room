import { describe, expect, it } from 'vitest';

import { reduceSettings } from '../src/state/settings';

const LOADED = {
  type: 'settingsLoaded' as const,
  soundEnabled: true,
  lastSeenVersion: '1.2.3',
  extensionVersion: '1.2.4',
  watchAllSessions: false,
  alwaysShowLabels: false,
  hooksEnabled: true,
  hooksInfoShown: true,
  externalAssetDirectories: ['/a'],
};

describe('reduceSettings', () => {
  it('is null until settingsLoaded arrives (no guessed defaults)', () => {
    expect(reduceSettings(null, { type: 'agentClosed', id: 1 })).toBeNull();
  });

  it('mirrors settingsLoaded verbatim', () => {
    const settings = reduceSettings(null, LOADED);
    expect(settings).toEqual({
      soundEnabled: true,
      watchAllSessions: false,
      alwaysShowLabels: false,
      hooksEnabled: true,
      hooksInfoShown: true,
      externalAssetDirectories: ['/a'],
      lastSeenVersion: '1.2.3',
      extensionVersion: '1.2.4',
    });
  });

  it('externalAssetDirectoriesUpdated patches only that field', () => {
    const settings = reduceSettings(null, LOADED);
    const next = reduceSettings(settings, {
      type: 'externalAssetDirectoriesUpdated',
      dirs: ['/a', '/b'],
    });
    expect(next?.externalAssetDirectories).toEqual(['/a', '/b']);
    expect(next?.soundEnabled).toBe(true);
  });

  it('externalAssetDirectoriesUpdated before settingsLoaded is a no-op (still null)', () => {
    expect(
      reduceSettings(null, { type: 'externalAssetDirectoriesUpdated', dirs: ['/a'] }),
    ).toBeNull();
  });

  it('ignores unrelated messages, keeping the same reference', () => {
    const settings = reduceSettings(null, LOADED);
    expect(reduceSettings(settings, { type: 'agentClosed', id: 1 })).toBe(settings);
  });
});
