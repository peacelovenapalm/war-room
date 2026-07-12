/**
 * T6 item 5 — SOUNDSCAPE V1: WebAudio-only synthesis, NO binary audio
 * assets. A quiet always-on ambience bed (two soft low sines, a fifth
 * apart, well under conversational volume) plus short chirps for real
 * events (state/soundscape.ts's CHIRP_SPECS — dispatch terminal status,
 * needs-input rising edge). Lazily constructs its AudioContext on the
 * FIRST unmute — a real user gesture (the mute toggle click itself),
 * which is what satisfies every browser's autoplay-unlock requirement
 * without a separate "click to enable audio" prompt.
 *
 * Not unit-tested directly (this project's vitest config runs in a plain
 * Node environment — no AudioContext); the pure parts worth testing
 * (mute persistence, chirp frequency/duration table) live in
 * state/soundscape.ts, imported here and nowhere the other direction.
 */

import { CHIRP_SPECS, type SoundscapeChirpKind } from '../state/soundscape';

const AMBIENCE_GAIN = 0.02;
const CHIRP_GAIN = 0.06;
/** A soft low pad, a perfect fifth apart — deliberately not a full chord,
 *  stays unobtrusive under the office's dominant channel (DOM/canvas). */
const AMBIENCE_FREQUENCIES_HZ = [110, 165] as const;

export interface SoundscapeEngine {
  setMuted(muted: boolean): void;
  /** No-ops while muted (no AudioContext exists yet, or ambience is
   *  stopped) — never a stray sound the mute toggle didn't authorize. */
  chirp(kind: SoundscapeChirpKind): void;
}

/** Every call is a safe no-op — SSR, tests, and any browser without
 *  AudioContext all get this instead of a null-check at every call site. */
const NOOP_ENGINE: SoundscapeEngine = {
  setMuted: () => undefined,
  chirp: () => undefined,
};

interface AmbienceNodes {
  oscillators: OscillatorNode[];
  gain: GainNode;
}

export function createSoundscapeEngine(): SoundscapeEngine {
  if (typeof window === 'undefined' || typeof AudioContext === 'undefined') return NOOP_ENGINE;

  let ctx: AudioContext | null = null;
  let ambience: AmbienceNodes | null = null;

  function ensureContext(): AudioContext {
    ctx ??= new AudioContext();
    return ctx;
  }

  function startAmbience(): void {
    if (ambience) return;
    const audio = ensureContext();
    const gain = audio.createGain();
    gain.gain.value = AMBIENCE_GAIN;
    gain.connect(audio.destination);
    const oscillators = AMBIENCE_FREQUENCIES_HZ.map((freq) => {
      const osc = audio.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = freq;
      osc.connect(gain);
      osc.start();
      return osc;
    });
    ambience = { oscillators, gain };
  }

  function stopAmbience(): void {
    if (!ambience) return;
    for (const osc of ambience.oscillators) {
      osc.stop();
      osc.disconnect();
    }
    ambience.gain.disconnect();
    ambience = null;
  }

  return {
    setMuted(muted) {
      if (muted) {
        stopAmbience();
        return;
      }
      startAmbience();
      void ensureContext().resume();
    },
    chirp(kind) {
      if (!ambience) return;
      const audio = ensureContext();
      const spec = CHIRP_SPECS[kind];
      const osc = audio.createOscillator();
      const gain = audio.createGain();
      osc.type = 'sine';
      osc.frequency.value = spec.frequencyHz;
      const now = audio.currentTime;
      const durationSec = spec.durationMs / 1000;
      const ATTACK_SEC = 0.02;
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(CHIRP_GAIN, now + ATTACK_SEC);
      gain.gain.linearRampToValueAtTime(0, now + durationSec);
      osc.connect(gain);
      gain.connect(audio.destination);
      osc.start(now);
      osc.stop(now + durationSec + ATTACK_SEC);
    },
  };
}
