import { describe, expect, it } from 'vitest';

import {
  CHIRP_SPECS,
  type KeyValueStorage,
  readSoundscapeMuted,
  SOUNDSCAPE_MUTE_STORAGE_KEY,
  soundscapeToggleLabel,
  writeSoundscapeMuted,
} from '../src/state/soundscape';

function fakeStorage(initial: Record<string, string> = {}): KeyValueStorage {
  const store = { ...initial };
  return {
    getItem: (key) => store[key] ?? null,
    setItem: (key, value) => {
      store[key] = value;
    },
  };
}

describe('readSoundscapeMuted (DEFAULT MUTED)', () => {
  it('reads muted with no storage at all', () => {
    expect(readSoundscapeMuted(undefined)).toBe(true);
  });

  it('reads muted when the key is absent', () => {
    expect(readSoundscapeMuted(fakeStorage())).toBe(true);
  });

  it('reads muted for any malformed value — only an explicit "false" unmutes', () => {
    expect(readSoundscapeMuted(fakeStorage({ [SOUNDSCAPE_MUTE_STORAGE_KEY]: 'nope' }))).toBe(true);
    expect(readSoundscapeMuted(fakeStorage({ [SOUNDSCAPE_MUTE_STORAGE_KEY]: '' }))).toBe(true);
  });

  it('reads unmuted only for the exact string "false"', () => {
    expect(readSoundscapeMuted(fakeStorage({ [SOUNDSCAPE_MUTE_STORAGE_KEY]: 'false' }))).toBe(
      false,
    );
  });

  it('reads muted for the exact string "true"', () => {
    expect(readSoundscapeMuted(fakeStorage({ [SOUNDSCAPE_MUTE_STORAGE_KEY]: 'true' }))).toBe(true);
  });
});

describe('writeSoundscapeMuted', () => {
  it('round-trips through readSoundscapeMuted', () => {
    const storage = fakeStorage();
    writeSoundscapeMuted(storage, false);
    expect(readSoundscapeMuted(storage)).toBe(false);
    writeSoundscapeMuted(storage, true);
    expect(readSoundscapeMuted(storage)).toBe(true);
  });

  it('is a safe no-op with no storage', () => {
    expect(() => {
      writeSoundscapeMuted(undefined, false);
    }).not.toThrow();
  });
});

describe('soundscapeToggleLabel (colorblind rule: shape + word)', () => {
  it('renders a distinct glyph + word for each state', () => {
    expect(soundscapeToggleLabel(true)).toBe('⊘ MUTED');
    expect(soundscapeToggleLabel(false)).toBe('♪ SOUND ON');
  });
});

describe('CHIRP_SPECS', () => {
  it('gives dispatch-done and needs-input distinguishable pitch/duration', () => {
    expect(CHIRP_SPECS['dispatch-done'].frequencyHz).not.toBe(
      CHIRP_SPECS['needs-input'].frequencyHz,
    );
    expect(CHIRP_SPECS['dispatch-done'].durationMs).toBeGreaterThan(0);
    expect(CHIRP_SPECS['needs-input'].durationMs).toBeGreaterThan(0);
  });
});
