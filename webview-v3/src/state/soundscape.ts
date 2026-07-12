/**
 * T6 item 5 — SOUNDSCAPE V1: pure mute-persistence + the colorblind-rule
 * toggle label, plus the pure synthesis parameters per chirp kind. The
 * actual WebAudio calls live in engine/soundscape.ts (untestable here —
 * this project's vitest config runs in a plain Node environment, no
 * AudioContext/localStorage) and import ONLY the constants below, never
 * the reverse.
 */

/** Minimal Storage-like surface (the real window.localStorage satisfies
 *  this) — injected so mute persistence is testable with a plain
 *  in-memory fake, no jsdom needed. */
export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const SOUNDSCAPE_MUTE_STORAGE_KEY = 'war-room-soundscape-muted';

/** DEFAULT MUTED (spec) — a missing key, a malformed value, or no storage
 *  at all (SSR/test) all read as muted. Only an explicit `'false'` ever
 *  unmutes — nothing here guesses a friendlier default. */
export function readSoundscapeMuted(storage: KeyValueStorage | undefined): boolean {
  if (!storage) return true;
  return storage.getItem(SOUNDSCAPE_MUTE_STORAGE_KEY) !== 'false';
}

export function writeSoundscapeMuted(storage: KeyValueStorage | undefined, muted: boolean): void {
  storage?.setItem(SOUNDSCAPE_MUTE_STORAGE_KEY, muted ? 'true' : 'false');
}

/** Shape + word (colorblind hard rule) — never color alone. */
export function soundscapeToggleLabel(muted: boolean): string {
  return muted ? '⊘ MUTED' : '♪ SOUND ON';
}

/** The only two real-telemetry triggers wired (KICKOFF-v4 T6 item 5):
 *  a dispatch reaching a terminal status, and an agent's rising edge into
 *  a loud (needs-input/failed) state — the SAME edges state/
 *  speechBubbles.ts already detects for the bubble layer. No invented
 *  event kinds. */
export type SoundscapeChirpKind = 'dispatch-done' | 'needs-input';

export interface ChirpSpec {
  frequencyHz: number;
  durationMs: number;
}

/** Pure synthesis data — distinct pitch/length per kind so the two chirps
 *  are distinguishable by ear alone, mirroring the shape+word rule in the
 *  audio channel (a duration/pitch difference, not "the same beep twice"). */
export const CHIRP_SPECS: Record<SoundscapeChirpKind, ChirpSpec> = {
  'dispatch-done': { frequencyHz: 880, durationMs: 160 },
  'needs-input': { frequencyHz: 587.33, durationMs: 220 },
};
