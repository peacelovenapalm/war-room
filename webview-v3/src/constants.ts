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
