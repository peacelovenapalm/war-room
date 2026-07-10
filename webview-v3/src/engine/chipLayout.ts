/**
 * DOM chip declutter — desk labels are DOM ALWAYS (KICKOFF-v3.1 stage-2
 * decision: canvas draws only world/glow; text lives in the DOM, crisp and
 * selectable). At phone fit-to-view zoom, adjacent desks' chips collide;
 * this resolves overlaps deterministically by pushing later chips DOWN
 * into free rows (the world anchor stays visually associated — chips only
 * ever move down, never sideways).
 *
 * Pure canvas-space math: no DOM reads, no display-density anywhere.
 */

export interface ChipAnchor {
  id: number;
  /** Desired chip CENTER x, TOP y, in canvas CSS px. */
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PlacedChip extends ChipAnchor {
  /** Rows shifted down from the desired position (0 = untouched). */
  shifted: number;
}

const ROW_GAP = 2;

function overlaps(a: PlacedChip, candidate: ChipAnchor, candidateY: number): boolean {
  const xOverlap = Math.abs(a.x - candidate.x) * 2 < a.width + candidate.width;
  const yOverlap =
    candidateY < a.y + a.height + ROW_GAP && a.y < candidateY + candidate.height + ROW_GAP;
  return xOverlap && yOverlap;
}

/**
 * Greedy top-to-bottom placement: anchors are processed in (y, x, id)
 * order; each chip drops by whole rows until it clears every already-placed
 * chip. Deterministic for a given anchor set.
 */
export function declutterChips(anchors: readonly ChipAnchor[]): PlacedChip[] {
  const ordered = [...anchors].sort((a, b) => a.y - b.y || a.x - b.x || a.id - b.id);
  const placed: PlacedChip[] = [];
  for (const anchor of ordered) {
    let y = anchor.y;
    let shifted = 0;
    let collided = true;
    while (collided) {
      collided = placed.some((p) => overlaps(p, anchor, y));
      if (collided) {
        y += anchor.height + ROW_GAP;
        shifted += 1;
      }
    }
    placed.push({ ...anchor, y, shifted });
  }
  return placed;
}
