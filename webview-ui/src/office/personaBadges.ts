/**
 * Employee trait badges (G1, GAME-DESIGN §4.3) — colorblind-safe glyph +
 * TEXT label per badge, same `StateChipSpec` shape as agentState.ts's
 * STATE_CHIPS (that convention lives in office/agentState.ts, NOT
 * crisis.ts — crisis.ts owns CRISIS_STAGES, a distinct concern).
 *
 * ROOKIE suppresses all other badges (below MIN_SAMPLES=5 real turns) —
 * never show a misleadingly precise trait read off 1-4 samples.
 */

export const PersonaBadge = {
  ROOKIE: 'ROOKIE',
  FAST: 'FAST',
  SLOPPY: 'SLOPPY',
  METICULOUS: 'METICULOUS',
  NIGHT_OWL: 'NIGHT_OWL',
  EFFICIENT: 'EFFICIENT',
  BURNS_TOKENS: 'BURNS_TOKENS',
} as const;
export type PersonaBadge = (typeof PersonaBadge)[keyof typeof PersonaBadge];

export interface PersonaBadgeSpec {
  /** Distinct shape per badge — the primary signal together with the label. */
  glyph: string;
  /** Human-readable label (title case, unlike the server's SCREAMING_CASE key). */
  label: string;
  /** CSS class (see index.css `.badge-chip--*`). Color is reinforcement only. */
  chipClass: string;
}

export const PERSONA_BADGES: Record<PersonaBadge, PersonaBadgeSpec> = {
  [PersonaBadge.ROOKIE]: { glyph: '◔', label: 'Rookie', chipClass: 'badge-chip--rookie' },
  [PersonaBadge.FAST]: { glyph: '⚡', label: 'Fast', chipClass: 'badge-chip--fast' },
  [PersonaBadge.SLOPPY]: { glyph: '✗', label: 'Sloppy', chipClass: 'badge-chip--sloppy' },
  [PersonaBadge.METICULOUS]: {
    glyph: '✓✓',
    label: 'Meticulous',
    chipClass: 'badge-chip--meticulous',
  },
  [PersonaBadge.NIGHT_OWL]: { glyph: '☾', label: 'Night Owl', chipClass: 'badge-chip--night-owl' },
  [PersonaBadge.EFFICIENT]: { glyph: '⬇', label: 'Efficient', chipClass: 'badge-chip--efficient' },
  [PersonaBadge.BURNS_TOKENS]: {
    glyph: '⬆',
    label: 'Burns Tokens',
    chipClass: 'badge-chip--burns-tokens',
  },
};

/** Server badge keys (employeeStore.ts's computeBadges) map 1:1 onto
 *  PersonaBadge — this guards against silent drift if either side's
 *  naming ever changes. */
export function isKnownPersonaBadge(value: string): value is PersonaBadge {
  return value in PERSONA_BADGES;
}

/** MUST mirror server/src/employeeStore.ts's MIN_SAMPLES/computeBadges
 *  thresholds exactly (GAME-DESIGN §4.3) — the raw rolling-turns ring
 *  buffer never leaves the server, so the client re-derives badges from
 *  the already-computed `scores` + `sampleCount` the wire DOES carry,
 *  rather than re-deriving scores itself. */
export const MIN_SAMPLES = 5;

export interface EmployeeScoresLike {
  speed: number;
  accuracy: number;
  nightOwl: number;
  tokenEfficiency: number;
}

export function computeBadges(scores: EmployeeScoresLike, sampleCount: number): PersonaBadge[] {
  if (sampleCount < MIN_SAMPLES) return [PersonaBadge.ROOKIE];
  const badges: PersonaBadge[] = [];
  if (scores.speed >= 70) badges.push(PersonaBadge.FAST);
  if (scores.accuracy < 50) badges.push(PersonaBadge.SLOPPY);
  if (scores.accuracy >= 85) badges.push(PersonaBadge.METICULOUS);
  if (scores.nightOwl >= 40) badges.push(PersonaBadge.NIGHT_OWL);
  if (scores.tokenEfficiency >= 70) badges.push(PersonaBadge.EFFICIENT);
  if (scores.tokenEfficiency < 30) badges.push(PersonaBadge.BURNS_TOKENS);
  return badges;
}
