/**
 * Pixel frames for the crisis & triage layer (v1 mechanic #1).
 *
 * Every escalation stage is a DISTINCT SILHOUETTE (colorblind hard rule —
 * a grayscale screenshot must stay readable by shape alone):
 *   SMOKE — small round puffs drifting up from the desk
 *   FIRE  — a flickering triangular flame with a dark outline
 *   ALARM — the flame plus a white flashing beacon with radiating rays
 *            (white = the house "loudest" pattern, same as NEEDS INPUT)
 *   DEBRIS — a static rubble pile where a failed/stopped agent worked
 *   STEAM — white puffs replacing the flame when a crisis resolves
 *
 * Frames are module-level constants so getCachedSprite's per-zoom WeakMap
 * caching applies. Colors here are reinforcement only.
 */

import type { SpriteData } from '../types.js';

const CRISIS_PALETTE: Record<string, string> = {
  _: '',
  K: '#10101C', // dark outline
  W: '#FFFFFF', // beacon / steam bright
  w: '#E4E4EE', // steam light
  s: '#B4B4C0', // smoke light
  S: '#8F8F9C', // smoke mid
  d: '#62626E', // smoke dark / rubble
  O: '#FF8D14', // flame body (house --color-warning)
  R: '#D1424A', // flame edge (house --color-danger, reinforcement only)
  Y: '#FFD75E', // flame core
};

function grid(rows: string[]): SpriteData {
  return rows.map((row) => row.split('').map((c) => CRISIS_PALETTE[c] ?? ''));
}

/** SMOKE: puffs rise and disperse (3-frame cycle, round silhouettes). */
export const SMOKE_FRAMES: SpriteData[] = [
  grid([
    '________',
    '________',
    '________',
    '___ss___',
    '__sSSs__',
    '___Ss___',
    '________',
    '___dS___',
    '__dSSd__',
    '___dd___',
  ]),
  grid([
    '___ss___',
    '__sSs___',
    '___s____',
    '________',
    '___Ss___',
    '__sSSs__',
    '___ss___',
    '________',
    '___dd___',
    '__dSd___',
  ]),
  grid([
    '__ss____',
    '___s____',
    '________',
    '__sS____',
    '___Ss___',
    '________',
    '__dSs___',
    '___Sd___',
    '________',
    '___d____',
  ]),
];

/** FIRE: flickering triangular flame, dark outline (2-frame cycle). */
export const FIRE_FRAMES: SpriteData[] = [
  grid([
    '____K____',
    '___KOK___',
    '___KOK___',
    '__KROOK__',
    '__KOOOK__',
    '_KROYOOK_',
    '_KOYYYOK_',
    '_KOYYYRK_',
    '_KROYYOK_',
    '__KYYYK__',
    '___KKK___',
  ]),
  grid([
    '___K_____',
    '___KOK___',
    '__KOOK___',
    '__KOROK__',
    '_KROOOK__',
    '_KOOYOOK_',
    '_KOYYYOK_',
    '_KROYYOK_',
    '__KOYYOK_',
    '__KYYYK__',
    '___KKK___',
  ]),
];

/** ALARM beacon: white flashing dome with rays (alternate with BEACON_OFF). */
export const BEACON_ON: SpriteData = grid([
  'W____W____W',
  '_W___W___W_',
  '____KWK____',
  '___KWWWK___',
  '__KWWWWWK__',
  '__KKKKKKK__',
  'W_KKKKKKK_W',
]);

export const BEACON_OFF: SpriteData = grid([
  '___________',
  '___________',
  '____KdK____',
  '___KdddK___',
  '__KdddddK__',
  '__KKKKKKK__',
  '__KKKKKKK__',
]);

/** DEBRIS: static rubble pile (failed/stopped wreckage). */
export const DEBRIS_SPRITE: SpriteData = grid([
  '______________',
  '____K____K____',
  '___KsK__KdK___',
  '__KsdsK_KsdK__',
  '_KsddsdKsddsK_',
  '_KdsdddddddsK_',
  'KsddsdsddsdssK',
  'KdddddddddddsK',
  '_KKKKKKKKKKKK_',
]);

/** EXTINGUISH steam: white puffs (3 frames, alpha fades over lifetime). */
export const STEAM_FRAMES: SpriteData[] = [
  grid([
    '________',
    '________',
    '___ww___',
    '__wWWw__',
    '___Ww___',
    '________',
    '___wW___',
    '__wWWw__',
    '___ww___',
  ]),
  grid([
    '___ww___',
    '__wWw___',
    '___w____',
    '________',
    '__wWw___',
    '___Ww___',
    '________',
    '___ww___',
    '__wWw___',
  ]),
  grid([
    '__w_____',
    '___w____',
    '__wW____',
    '___w____',
    '________',
    '___w____',
    '__ww____',
    '________',
    '___w____',
  ]),
];
