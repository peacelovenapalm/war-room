/**
 * Sound layer (v1) unit tests. The pure state machine (computeAmbienceStatus,
 * statusLabel, shouldPlaySfx) is tested with no AudioContext at all; the
 * AmbienceEngine tests mock a minimal fake AudioContext so WebAudio node
 * creation/teardown and rate limiting can be verified deterministically.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  AmbienceEngine,
  computeAmbienceStatus,
  shouldPlaySfx,
  statusLabel,
} from '../src/ambience.js';

// ── Fake AudioContext ────────────────────────────────────────────────────

function makeParam(initial = 0) {
  const param = {
    value: initial,
    setValueAtTime: vi.fn((v: number) => {
      param.value = v;
    }),
    linearRampToValueAtTime: vi.fn((v: number) => {
      param.value = v;
    }),
    exponentialRampToValueAtTime: vi.fn((v: number) => {
      param.value = v;
    }),
    cancelScheduledValues: vi.fn(),
  };
  return param;
}

class FakeAudioContext {
  state: 'suspended' | 'running' | 'closed' = 'suspended';
  currentTime = 0;
  sampleRate = 44100;
  destination = {};

  createBufferSource = vi.fn(() => ({
    buffer: null as unknown,
    loop: false,
    connect: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
    disconnect: vi.fn(),
  }));

  createBuffer = vi.fn((_channels: number, length: number) => ({
    getChannelData: () => new Float32Array(length),
  }));

  createBiquadFilter = vi.fn(() => ({
    type: 'lowpass',
    frequency: makeParam(),
    connect: vi.fn(),
  }));

  createGain = vi.fn(() => ({
    gain: makeParam(),
    connect: vi.fn(),
    disconnect: vi.fn(),
  }));

  createOscillator = vi.fn(() => ({
    type: 'sine',
    frequency: makeParam(),
    connect: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
    disconnect: vi.fn(),
  }));

  resume = vi.fn(async () => {
    this.state = 'running';
  });

  close = vi.fn(async () => {
    this.state = 'closed';
  });
}

let fakeCtx: FakeAudioContext;

beforeEach(() => {
  fakeCtx = new FakeAudioContext();
  vi.stubGlobal(
    'AudioContext',
    vi.fn(() => fakeCtx),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ── Pure state machine ───────────────────────────────────────────────────

describe('computeAmbienceStatus', () => {
  it('is "off" whenever the user preference is disabled, regardless of arm/duck', () => {
    expect(computeAmbienceStatus(false, false, false)).toBe('off');
    expect(computeAmbienceStatus(false, true, false)).toBe('off');
    expect(computeAmbienceStatus(false, true, true)).toBe('off');
  });

  it('is "blocked" when enabled but not yet armed (autoplay policy)', () => {
    expect(computeAmbienceStatus(true, false, false)).toBe('blocked');
    expect(computeAmbienceStatus(true, false, true)).toBe('blocked');
  });

  it('is "on" when enabled + armed + not night mode', () => {
    expect(computeAmbienceStatus(true, true, false)).toBe('on');
  });

  it('is "duck" when enabled + armed + night mode', () => {
    expect(computeAmbienceStatus(true, true, true)).toBe('duck');
  });
});

describe('statusLabel', () => {
  it('is honest about the blocked (unarmed) state — never claims playing', () => {
    expect(statusLabel('blocked')).toBe('SOUND: ON (click to start)');
  });

  it('labels every status with a plain-text SOUND: prefix (shape+label rule)', () => {
    for (const status of ['off', 'blocked', 'on', 'duck'] as const) {
      expect(statusLabel(status)).toMatch(/^SOUND:/);
    }
  });
});

describe('shouldPlaySfx', () => {
  it('allows the first play of a kind with no history', () => {
    expect(shouldPlaySfx('chirp', 1_000, {})).toBe(true);
  });

  it('rate-limits a burst — repeat within the window is rejected', () => {
    const lastPlayedAt = { chirp: 1_000 };
    expect(shouldPlaySfx('chirp', 1_050, lastPlayedAt)).toBe(false);
  });

  it('allows another play once the kind-specific window has elapsed', () => {
    const lastPlayedAt = { ding: 1_000 };
    expect(shouldPlaySfx('ding', 1_000 + 900, lastPlayedAt)).toBe(true);
  });

  it('rate-limits each kind independently', () => {
    const lastPlayedAt = { chirp: 1_000 };
    expect(shouldPlaySfx('blip', 1_010, lastPlayedAt)).toBe(true);
  });
});

// ── AmbienceEngine (mocked AudioContext) ─────────────────────────────────

describe('AmbienceEngine', () => {
  it('starts blocked (enabled, not armed) before any gesture', () => {
    const engine = new AmbienceEngine();
    expect(engine.isEnabled()).toBe(true);
    expect(engine.isArmed()).toBe(false);
    expect(engine.getStatus()).toBe('blocked');
  });

  it('never touches AudioContext before arm() — no nodes created', () => {
    const engine = new AmbienceEngine();
    engine.playAlarmChirp(1_000);
    expect(fakeCtx.createOscillator).not.toHaveBeenCalled();
  });

  it('arm() creates the context, starts the ambience loop, and status becomes "on"', () => {
    const engine = new AmbienceEngine();
    engine.arm();
    expect(engine.isArmed()).toBe(true);
    expect(engine.getStatus()).toBe('on');
    expect(fakeCtx.createBufferSource).toHaveBeenCalledTimes(1);
    expect(fakeCtx.createOscillator).toHaveBeenCalledTimes(1); // the hum
  });

  it('arm() is idempotent — a second call does not restart the loop', () => {
    const engine = new AmbienceEngine();
    engine.arm();
    engine.arm();
    expect(fakeCtx.createBufferSource).toHaveBeenCalledTimes(1);
  });

  it('setNightMode(true) ducks status without disabling sound', () => {
    const engine = new AmbienceEngine();
    engine.arm();
    engine.setNightMode(true);
    expect(engine.getStatus()).toBe('duck');
    engine.setNightMode(false);
    expect(engine.getStatus()).toBe('on');
  });

  it('setEnabled(false) stops the loop and reports "off"', () => {
    const engine = new AmbienceEngine();
    engine.arm();
    const source = fakeCtx.createBufferSource.mock.results[0]!.value as { stop: () => void };
    engine.setEnabled(false);
    expect(engine.getStatus()).toBe('off');
    expect(source.stop).toHaveBeenCalled();
  });

  it('setEnabled(true) restarts the loop once armed', () => {
    const engine = new AmbienceEngine();
    engine.arm();
    engine.setEnabled(false);
    engine.setEnabled(true);
    expect(engine.getStatus()).toBe('on');
    expect(fakeCtx.createBufferSource).toHaveBeenCalledTimes(2);
  });

  it('does not play SFX while disabled, even if armed', () => {
    const engine = new AmbienceEngine();
    engine.arm();
    engine.setEnabled(false);
    const before = fakeCtx.createOscillator.mock.calls.length;
    engine.playResolvedDing(2_000);
    expect(fakeCtx.createOscillator.mock.calls.length).toBe(before);
  });

  it('plays each SFX kind once armed+enabled, and rate-limits a burst', () => {
    const engine = new AmbienceEngine();
    engine.arm();
    const baseline = fakeCtx.createOscillator.mock.calls.length; // 1 (hum)

    engine.playAlarmChirp(10_000); // 2 tones
    engine.playAlarmChirp(10_050); // burst — rejected by shouldPlaySfx
    expect(fakeCtx.createOscillator.mock.calls.length).toBe(baseline + 2);

    engine.playResolvedDing(10_060); // 1 tone, different kind — not rate-limited by chirp
    expect(fakeCtx.createOscillator.mock.calls.length).toBe(baseline + 3);

    engine.playAllClearChime(10_070); // 3 tones (triad)
    expect(fakeCtx.createOscillator.mock.calls.length).toBe(baseline + 6);

    engine.playArrivalBlip(10_080); // 1 tone
    expect(fakeCtx.createOscillator.mock.calls.length).toBe(baseline + 7);

    // Chirp again well past its 4s window — plays.
    engine.playAlarmChirp(20_000);
    expect(fakeCtx.createOscillator.mock.calls.length).toBe(baseline + 9);
  });

  it('dispose() tears down the context and un-arms the engine', () => {
    const engine = new AmbienceEngine();
    engine.arm();
    engine.dispose();
    expect(engine.isArmed()).toBe(false);
    expect(fakeCtx.close).toHaveBeenCalled();
  });
});
