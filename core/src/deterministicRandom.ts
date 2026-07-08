/**
 * Deterministic hashing + seeded PRNG shared by employeeStore.ts (quit rolls,
 * spriteIndex, name assignment) and quips.ts (quip-pool selection). Never
 * `Math.random()` for anything that must replay identically from the same
 * inputs (GAME-DESIGN §4.5).
 */

/** 32-bit FNV-1a string hash — deterministic, no external dependency. */
export function hashString(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** mulberry32 PRNG — deterministic, seeded. Returns a function yielding
 *  floats in [0, 1) on each call. */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
