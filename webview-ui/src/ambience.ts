/**
 * Sound layer (v1): procedural WebAudio office ambience + event SFX.
 *
 * Greg's decision (2026-07-07): FULL AMBIENCE, ON BY DEFAULT, toggleable.
 * No external audio assets, no network fetches — everything here is
 * synthesized. Every sound reinforces a signal that is ALSO visible as
 * shape+text; audio is never the only carrier of information (colorblind
 * hard rule extends to this layer).
 *
 * Autoplay policy: browsers/webviews block audio until a user gesture.
 * `enabled` (user preference, persisted) and `armed` (has a gesture
 * unlocked the AudioContext yet) are tracked separately so the UI can show
 * the true state honestly — "SOUND: ON (click to start)" — rather than
 * faking "playing" while blocked.
 *
 * State machine kept pure (computeAmbienceStatus) so it is unit-testable
 * without touching AudioContext at all; the engine class below is the only
 * piece that talks to WebAudio, and every method that produces sound routes
 * through it so tests can mock a fake AudioContext.
 */

import {
  AMBIENCE_DEFAULT_ENABLED,
  AMBIENCE_DUCK_FACTOR,
  AMBIENCE_GAIN_RAMP_SEC,
  AMBIENCE_HUM_HZ,
  AMBIENCE_HUM_VOLUME,
  AMBIENCE_NOISE_BUFFER_SEC,
  AMBIENCE_NOISE_LOWPASS_HZ,
  AMBIENCE_NOISE_VOLUME,
  AMBIENCE_STORAGE_KEY,
  BLIP_DURATION_SEC,
  BLIP_HZ,
  BLIP_VOLUME,
  CHIME_DURATION_SEC,
  CHIME_HZ,
  CHIME_NOTE_GAP_SEC,
  CHIME_VOLUME,
  CHIRP_GAP_SEC,
  CHIRP_HZ,
  CHIRP_NOTE_DURATION_SEC,
  CHIRP_VOLUME,
  DING_DURATION_SEC,
  DING_HZ,
  DING_VOLUME,
  SFX_MIN_INTERVAL_MS,
} from './constants.js';

// ── Pure state machine (no AudioContext — unit-test this directly) ───────

/** on: full volume · duck: night-shift, quiet · blocked: enabled but no
 *  gesture yet (context suspended) · off: user disabled. */
export type AmbienceStatus = 'off' | 'blocked' | 'on' | 'duck';

export function computeAmbienceStatus(
  enabled: boolean,
  armed: boolean,
  ducked: boolean,
): AmbienceStatus {
  if (!enabled) return 'off';
  if (!armed) return 'blocked';
  return ducked ? 'duck' : 'on';
}

/** Honest visible label for the toggle — never claims "playing" while blocked. */
export function statusLabel(status: AmbienceStatus): string {
  switch (status) {
    case 'off':
      return 'SOUND: OFF';
    case 'blocked':
      return 'SOUND: ON (click to start)';
    case 'duck':
      return 'SOUND: ON (night, quiet)';
    case 'on':
      return 'SOUND: ON';
  }
}

export type SfxKind = 'chirp' | 'ding' | 'chime' | 'blip';

/** Pure rate-limit check — a burst of events must not machine-gun the speakers. */
export function shouldPlaySfx(
  kind: SfxKind,
  now: number,
  lastPlayedAt: Partial<Record<SfxKind, number>>,
): boolean {
  const last = lastPlayedAt[kind];
  return last === undefined || now - last >= SFX_MIN_INTERVAL_MS[kind];
}

function loadEnabledPref(): boolean {
  try {
    if (typeof localStorage === 'undefined') return AMBIENCE_DEFAULT_ENABLED;
    const raw = localStorage.getItem(AMBIENCE_STORAGE_KEY);
    if (raw === null) return AMBIENCE_DEFAULT_ENABLED;
    return raw === '1';
  } catch {
    return AMBIENCE_DEFAULT_ENABLED;
  }
}

function saveEnabledPref(enabled: boolean): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(AMBIENCE_STORAGE_KEY, enabled ? '1' : '0');
  } catch {
    // Storage full/unavailable — preference just won't survive a refresh.
  }
}

// ── WebAudio engine ────────────────────────────────────────────────────
//
// Structural types only (never the DOM lib's ambient `AudioContext` et al.)
// — this file is imported by ambience.test.ts, which compiles under
// webview-ui/tsconfig.node.json (no "DOM" in `lib`). Naming a DOM type here
// would fail that project's type-check even though it's only used from a
// browser. Tests supply a plain object satisfying these shapes.

type WaveType = 'sine' | 'square' | 'triangle' | 'sawtooth';

interface MinimalAudioParam {
  value: number;
  setValueAtTime(value: number, startTime: number): unknown;
  linearRampToValueAtTime(value: number, endTime: number): unknown;
  exponentialRampToValueAtTime(value: number, endTime: number): unknown;
  cancelScheduledValues(startTime: number): unknown;
}

interface MinimalAudioNode {
  connect(destination: unknown): unknown;
  disconnect(): unknown;
}

interface MinimalGainNode extends MinimalAudioNode {
  gain: MinimalAudioParam;
}

interface MinimalOscillatorNode extends MinimalAudioNode {
  type: WaveType;
  frequency: MinimalAudioParam;
  start(when?: number): unknown;
  stop(when?: number): unknown;
}

interface MinimalBufferSourceNode extends MinimalAudioNode {
  buffer: MinimalAudioBuffer | null;
  loop: boolean;
  start(when?: number): unknown;
  stop(when?: number): unknown;
}

interface MinimalBiquadFilterNode extends MinimalAudioNode {
  type: string;
  frequency: MinimalAudioParam;
}

interface MinimalAudioBuffer {
  getChannelData(channel: number): Float32Array;
}

interface MinimalAudioContext {
  currentTime: number;
  sampleRate: number;
  state: string;
  destination: unknown;
  createBufferSource(): MinimalBufferSourceNode;
  createBuffer(channels: number, length: number, sampleRate: number): MinimalAudioBuffer;
  createBiquadFilter(): MinimalBiquadFilterNode;
  createGain(): MinimalGainNode;
  createOscillator(): MinimalOscillatorNode;
  resume(): Promise<unknown>;
  close(): Promise<unknown>;
}

/** Looks up a real AudioContext constructor (or a test-stubbed one) purely
 *  via `unknown` property access — never names the DOM ambient type, so
 *  this compiles fine under a lib without "DOM". */
function getAudioContextCtor(): (new () => MinimalAudioContext) | undefined {
  const g = globalThis as unknown as Record<string, unknown>;
  const ctor = g['AudioContext'] ?? g['webkitAudioContext'];
  return typeof ctor === 'function' ? (ctor as new () => MinimalAudioContext) : undefined;
}

export class AmbienceEngine {
  private ctx: MinimalAudioContext | null = null;
  private enabled: boolean;
  private armed = false;
  private ducked = false;
  private lastPlayedAt: Partial<Record<SfxKind, number>> = {};

  // Ambience loop nodes (present only while playing).
  private noiseSource: MinimalBufferSourceNode | null = null;
  private humOsc: MinimalOscillatorNode | null = null;
  private ambienceGain: MinimalGainNode | null = null;

  constructor() {
    this.enabled = loadEnabledPref();
  }

  getStatus(): AmbienceStatus {
    return computeAmbienceStatus(this.enabled, this.armed, this.ducked);
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  isArmed(): boolean {
    return this.armed;
  }

  setEnabled(enabled: boolean): void {
    if (this.enabled === enabled) return;
    this.enabled = enabled;
    saveEnabledPref(enabled);
    if (enabled) {
      if (this.armed) this.startLoop();
    } else {
      this.stopLoop();
    }
  }

  setNightMode(ducked: boolean): void {
    if (this.ducked === ducked) return;
    this.ducked = ducked;
    this.applyAmbienceGain();
  }

  /** Call from any user-gesture handler (click/keydown anywhere on the page). */
  arm(): void {
    if (this.armed) return;
    this.ensureContext();
    if (!this.ctx) return;
    this.armed = true;
    if (this.ctx.state === 'suspended') {
      void this.ctx.resume().catch(() => {});
    }
    if (this.enabled) this.startLoop();
  }

  /** Test/dev hook: full teardown so a fresh engine can be constructed. */
  dispose(): void {
    this.stopLoop();
    try {
      this.ctx?.close();
    } catch {
      // ignore
    }
    this.ctx = null;
    this.armed = false;
  }

  private ensureContext(): void {
    if (this.ctx) return;
    try {
      const Ctor = getAudioContextCtor();
      if (!Ctor) return;
      this.ctx = new Ctor();
    } catch {
      this.ctx = null;
    }
  }

  private targetAmbienceVolume(): number {
    if (!this.enabled) return 0;
    const base = AMBIENCE_NOISE_VOLUME + AMBIENCE_HUM_VOLUME;
    return this.ducked ? base * AMBIENCE_DUCK_FACTOR : base;
  }

  private applyAmbienceGain(): void {
    if (!this.ctx || !this.ambienceGain) return;
    const target = this.targetAmbienceVolume();
    const gain = this.ambienceGain.gain;
    const now = this.ctx.currentTime;
    gain.cancelScheduledValues(now);
    gain.setValueAtTime(gain.value, now);
    gain.linearRampToValueAtTime(target, now + AMBIENCE_GAIN_RAMP_SEC);
  }

  private buildNoiseBuffer(ctx: MinimalAudioContext): MinimalAudioBuffer {
    const length = Math.max(1, Math.floor(ctx.sampleRate * AMBIENCE_NOISE_BUFFER_SEC));
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    return buffer;
  }

  private startLoop(): void {
    if (!this.ctx || this.noiseSource) return;
    const ctx = this.ctx;

    const master = ctx.createGain();
    master.gain.setValueAtTime(0, ctx.currentTime);
    master.connect(ctx.destination);

    // Filtered noise → quiet "room tone".
    const noise = ctx.createBufferSource();
    noise.buffer = this.buildNoiseBuffer(ctx);
    noise.loop = true;
    const lowpass = ctx.createBiquadFilter();
    lowpass.type = 'lowpass';
    lowpass.frequency.setValueAtTime(AMBIENCE_NOISE_LOWPASS_HZ, ctx.currentTime);
    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(AMBIENCE_NOISE_VOLUME, ctx.currentTime);
    noise.connect(lowpass);
    lowpass.connect(noiseGain);
    noiseGain.connect(master);
    noise.start();

    // Very low sine "hum" underneath the noise bed.
    const hum = ctx.createOscillator();
    hum.type = 'sine';
    hum.frequency.setValueAtTime(AMBIENCE_HUM_HZ, ctx.currentTime);
    const humGain = ctx.createGain();
    humGain.gain.setValueAtTime(AMBIENCE_HUM_VOLUME, ctx.currentTime);
    hum.connect(humGain);
    humGain.connect(master);
    hum.start();

    this.noiseSource = noise;
    this.humOsc = hum;
    this.ambienceGain = master;
    this.applyAmbienceGain();
  }

  private stopLoop(): void {
    try {
      this.noiseSource?.stop();
    } catch {
      // already stopped
    }
    try {
      this.humOsc?.stop();
    } catch {
      // already stopped
    }
    this.noiseSource?.disconnect();
    this.humOsc?.disconnect();
    this.ambienceGain?.disconnect();
    this.noiseSource = null;
    this.humOsc = null;
    this.ambienceGain = null;
  }

  private playTone(
    ctx: MinimalAudioContext,
    freq: number,
    startOffset: number,
    duration: number,
    volume: number,
    type: WaveType = 'sine',
  ): void {
    const t = ctx.currentTime + startOffset;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    gain.gain.setValueAtTime(volume, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + duration);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(t);
    osc.stop(t + duration);
  }

  private playSfx(kind: SfxKind, now: number, synth: (ctx: MinimalAudioContext) => void): void {
    if (!this.enabled || !this.armed || !this.ctx) return;
    if (!shouldPlaySfx(kind, now, this.lastPlayedAt)) return;
    this.lastPlayedAt[kind] = now;
    try {
      if (this.ctx.state === 'suspended') void this.ctx.resume().catch(() => {});
      synth(this.ctx);
    } catch {
      // Audio may not be available — never let a sound failure break the app.
    }
  }

  /** Desk escalates to FIRE/ALARM — mirrors the visible stage change. */
  playAlarmChirp(now: number = Date.now()): void {
    this.playSfx('chirp', now, (ctx) => {
      this.playTone(ctx, CHIRP_HZ, 0, CHIRP_NOTE_DURATION_SEC, CHIRP_VOLUME, 'square');
      this.playTone(ctx, CHIRP_HZ, CHIRP_GAP_SEC, CHIRP_NOTE_DURATION_SEC, CHIRP_VOLUME, 'square');
    });
  }

  /** A single crisis clears — mirrors the floating "✓ RESOLVED" tag. */
  playResolvedDing(now: number = Date.now()): void {
    this.playSfx('ding', now, (ctx) => {
      this.playTone(ctx, DING_HZ, 0, DING_DURATION_SEC, DING_VOLUME);
    });
  }

  /** Last crisis clears — mirrors the "✓ ALL CLEAR" board flash. Warmer timbre. */
  playAllClearChime(now: number = Date.now()): void {
    this.playSfx('chime', now, (ctx) => {
      CHIME_HZ.forEach((hz, i) => {
        this.playTone(
          ctx,
          hz,
          i * CHIME_NOTE_GAP_SEC,
          CHIME_DURATION_SEC,
          CHIME_VOLUME,
          'triangle',
        );
      });
    });
  }

  /** A new session/coworker arrives — soft, low-key. */
  playArrivalBlip(now: number = Date.now()): void {
    this.playSfx('blip', now, (ctx) => {
      this.playTone(ctx, BLIP_HZ, 0, BLIP_DURATION_SEC, BLIP_VOLUME);
    });
  }
}

/** App-wide singleton. Tests should instantiate their own `AmbienceEngine`. */
export const ambience = new AmbienceEngine();
