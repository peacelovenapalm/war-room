/**
 * Coworker badge sprites (v1 mechanic #6a).
 *
 * Codex / Gemini sessions render as coworkers: the badge floats above the
 * character's head as a DISTINCT SILHOUETTE per provider (square cap vs
 * diamond) alongside the `[CODEX]` / `[GEMINI]` TEXT label in the name tag.
 * Silhouette + text carry the signal; color is reinforcement only.
 */

import type { SpriteData } from '../types.js';

const PALETTE: Record<string, string> = {
  _: '',
  K: '#10101C', // outline
  W: '#FFFFFF', // fill
  d: '#62626E', // shade
};

function grid(rows: string[]): SpriteData {
  return rows.map((row) => row.split('').map((c) => PALETTE[c] ?? ''));
}

/** CODEX: flat square terminal-block badge. */
const CODEX_BADGE: SpriteData = grid([
  'KKKKKKKKK',
  'KWWWWWWWK',
  'KWKKWWWWK',
  'KWWWKKWWK',
  'KWKKWWWWK',
  'KWWWWWWWK',
  'KKKKKKKKK',
]);

/** GEMINI: diamond badge (rotated square — clearly different outline). */
const GEMINI_BADGE: SpriteData = grid([
  '____K____',
  '___KWK___',
  '__KWWWK__',
  '_KWWdWWK_',
  '__KWWWK__',
  '___KWK___',
  '____K____',
]);

/** Fallback for unknown provider ids: plain round badge. */
const GENERIC_BADGE: SpriteData = grid([
  '__KKKKK__',
  '_KWWWWWK_',
  'KWWdddWWK',
  'KWWdddWWK',
  '_KWWWWWK_',
  '__KKKKK__',
]);

export function getCoworkerBadge(provider: string): SpriteData {
  switch (provider) {
    case 'codex':
      return CODEX_BADGE;
    case 'gemini':
      return GEMINI_BADGE;
    default:
      return GENERIC_BADGE;
  }
}
