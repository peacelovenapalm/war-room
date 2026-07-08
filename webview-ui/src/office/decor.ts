/**
 * Decor unlocks (v1 mechanic #5 — expression pass).
 *
 * Consumes the permanent unlock flags from progressionStore.ts (see
 * `helpContent.ts`'s "progression" section — those flags were data-only
 * until this mechanic shipped). Each unlocked flag renders ONE cosmetic
 * office item at a fixed, hand-picked tile in the default layout.
 *
 * REUSE, not new art: every item below is an existing asset already in the
 * bundled furniture catalog (webview-ui/public/assets/furniture/*) — the
 * default layout already places several of the same sprites (e.g. CLOCK,
 * LARGE_PAINTING, PLANT family) as ambient decor, so these render
 * identically to furniture a human placed by hand.
 *
 * Fixed placement, not user-controlled: decor items are not inserted into
 * `OfficeLayout.furniture` (the editor-owned, persisted list) — they are a
 * separate overlay merged in at render/collision time by OfficeState. This
 * is the simpler-and-honest option over routing decor through the layout
 * editor/persistence pattern: unlocks are earned passively (streaks, XP,
 * shift grades), not curated placements, so there is nothing for the user
 * to meaningfully "place" — and keeping decor out of layout.json means an
 * unlock can never collide with the editor's undo/redo or be accidentally
 * deleted while rearranging furniture. If Greg later wants to reposition
 * unlocked decor, promoting these into real (lockable) layout.furniture
 * entries is a small follow-up, not a rewrite.
 *
 * HARD GUARDRAIL: purely cosmetic. No dashboard function reads or is gated
 * by DECOR_CATALOG or its render state — every data view stays reachable
 * regardless of what has unlocked (see helpContent.ts "decor" section).
 */

import type { PlacedFurniture } from './types.js';

export interface DecorCatalogEntry {
  /** Matches an UnlockKey from server/src/progressionStore.ts (kept as a
   *  plain string here so the webview bundle doesn't depend on server code —
   *  same convention ShiftPanel/ProgressionHUD use for their mirrored types). */
  unlockKey: string;
  /** Existing furniture catalog asset id (webview-ui/public/assets/furniture). */
  type: string;
  col: number;
  row: number;
  /** Cosmetic item name shown in the UNLOCKS panel. */
  label: string;
  /** Plain-text requirement shown in the UNLOCKS panel, e.g. "30-day streak". */
  requirement: string;
}

/**
 * Fixed tile coordinates were chosen by hand against the bundled default
 * layout (webview-ui/public/assets/default-layout-1.json, 21×22) to land on
 * open floor with no default furniture footprint. A user who has heavily
 * re-edited their layout could still place something on top of one of these
 * tiles — decor is cosmetic, so a rare visual overlap there is an accepted
 * tradeoff of the fixed-placement approach, not a functional bug.
 */
export const DECOR_CATALOG: DecorCatalogEntry[] = [
  {
    unlockKey: 'streakBronze',
    type: 'POT',
    col: 3,
    row: 20,
    label: 'Desk Pot',
    requirement: '3-day streak',
  },
  {
    unlockKey: 'streakSilver',
    type: 'CACTUS',
    col: 16,
    row: 11,
    label: 'Cactus',
    requirement: '7-day streak',
  },
  {
    unlockKey: 'streakGold',
    type: 'LARGE_PLANT',
    col: 12,
    row: 11,
    label: 'Large Plant',
    requirement: '30-day streak',
  },
  {
    unlockKey: 'leanGrade5',
    type: 'COFFEE',
    col: 8,
    row: 20,
    label: 'Coffee Machine',
    requirement: '5 LEAN-graded shift days',
  },
  {
    unlockKey: 'level5',
    type: 'CLOCK',
    col: 15,
    row: 9,
    label: 'Wall Clock',
    requirement: 'level 5',
  },
  {
    unlockKey: 'level10',
    type: 'LARGE_PAINTING',
    col: 18,
    row: 9,
    label: 'Framed Painting',
    requirement: 'level 10',
  },
];

/** Stable synthetic uid for a decor placement — never collides with editor-issued uids. */
export function decorUid(entry: DecorCatalogEntry): string {
  return `decor:${entry.unlockKey}`;
}

/** Build the PlacedFurniture[] for whichever decor items are currently unlocked. */
export function getUnlockedDecorFurniture(unlocks: Record<string, boolean>): PlacedFurniture[] {
  return DECOR_CATALOG.filter((entry) => unlocks[entry.unlockKey] === true).map((entry) => ({
    uid: decorUid(entry),
    type: entry.type,
    col: entry.col,
    row: entry.row,
  }));
}
