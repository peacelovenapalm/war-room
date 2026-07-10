/**
 * All color literals for webview-v3 live HERE and only here (eslint
 * pixel-agents/no-inline-colors is on everywhere else).
 *
 * Colorblind hard rule (KICKOFF-v3.1 rule 1): color is REINFORCEMENT only.
 * Every signal in the world/HUD is carried by shape + text label first and
 * must survive the GRAYSCALE toggle — so this palette is built on luminance
 * contrast, not hue contrast.
 */

export const COLOR_WORLD_BG = '#20242c';

/** Floor: two-tone checker, close values so it reads as one calm surface. */
export const COLOR_FLOOR_A = '#3d4454';
export const COLOR_FLOOR_B = '#353b4a';
export const COLOR_FLOOR_EDGE = '#272c38';

/** Placeholder desk box faces (light top, mid/dark sides = fake sun). */
export const COLOR_DESK_TOP = '#8a94a8';
export const COLOR_DESK_LEFT = '#5c657a';
export const COLOR_DESK_RIGHT = '#4a5266';
export const COLOR_BOX_OUTLINE = '#1c202a';

/** Occupied-desk occupant block (higher luminance than any desk face). */
export const COLOR_OCCUPANT_TOP = '#e0b25a';
export const COLOR_OCCUPANT_LEFT = '#b08a3e';
export const COLOR_OCCUPANT_RIGHT = '#8f6f30';

/** Generic small props (plant, coffee station, door slab). */
export const COLOR_PROP_TOP = '#6f7a8f';
export const COLOR_PROP_LEFT = '#4d5568';
export const COLOR_PROP_RIGHT = '#3f4658';

/** Monitor glow under an occupied desk (reinforcement only — the signal
 *  is the occupant block + the DOM chip's shape+text). */
export const COLOR_DESK_GLOW = 'rgba(224, 178, 90, 0.16)';

/** Ambient walker placeholder (janitor / drift / pace) — a distinctly
 *  SMALLER, rounder-footprint box than any desk/prop (shape difference,
 *  not color-only) so it reads as "a small moving figure" even in
 *  grayscale, with no text label needed (pure atmosphere, not a signal the
 *  colorblind hard rule's shape+text requirement applies to — there is no
 *  state being communicated here to read). */
export const COLOR_WALKER_TOP = '#c9a86a';
export const COLOR_WALKER_LEFT = '#9c7f4c';
export const COLOR_WALKER_RIGHT = '#7d653c';

/** Calm-channel ambient wash endpoints (engine/calm.ts) — REINFORCEMENT
 *  only; the mood chip's shape+text is the real signal (state/hud.ts
 *  officeMood). Low, fixed alpha; only the RGB is lerped by warmth. */
const AMBIENT_COOL_RGB = { r: 70, g: 96, b: 140 };
const AMBIENT_WARM_RGB = { r: 224, g: 150, b: 80 };
const AMBIENT_WASH_ALPHA = 0.08;

/** Ambient wash color for a given warmth in [0, 1] (engine/calm.ts's
 *  displayedWarmth). Lives here (not renderer.ts) because it builds an
 *  rgba() string, and only constants.ts is exempt from the no-inline-colors
 *  lint rule. */
export function ambientWashColor(warmth: number): string {
  const t = Math.min(1, Math.max(0, warmth));
  const r = Math.round(AMBIENT_COOL_RGB.r + (AMBIENT_WARM_RGB.r - AMBIENT_COOL_RGB.r) * t);
  const g = Math.round(AMBIENT_COOL_RGB.g + (AMBIENT_WARM_RGB.g - AMBIENT_COOL_RGB.g) * t);
  const b = Math.round(AMBIENT_COOL_RGB.b + (AMBIENT_WARM_RGB.b - AMBIENT_COOL_RGB.b) * t);
  return `rgba(${String(r)}, ${String(g)}, ${String(b)}, ${String(AMBIENT_WASH_ALPHA)})`;
}
