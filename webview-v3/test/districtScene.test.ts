/**
 * districtScene tests (Phase 5 Lane C, T7/D-35 districts; v5 C1 N-project
 * build-out) — plot layout and hit-testing (pure math, no canvas needed).
 * drawDistrictScene itself is exercised via a minimal fake
 * CanvasRenderingContext2D to confirm it degrades gracefully when a
 * project has no matching plot.
 */

import { describe, expect, it } from 'vitest';

import {
  computeDistrictPlots,
  districtSceneBounds,
  drawDistrictScene,
  hitTestDistrict,
  plotWorldCenter,
} from '../src/engine/districtScene';
import type { DistrictProject } from '../src/net/districtFacts';

function project(overrides: Partial<DistrictProject> = {}): DistrictProject {
  return {
    key: 'war-room',
    label: 'WAR ROOM',
    phase: 'RUN COMPLETE',
    progress: 0.5,
    lastActivity: null,
    source: 'file:/x/STATE.md',
    ...overrides,
  };
}

function projectsOf(keys: readonly string[]): DistrictProject[] {
  return keys.map((key) => project({ key, label: key }));
}

describe('computeDistrictPlots', () => {
  it('empty project list -> empty plot list', () => {
    expect(computeDistrictPlots([])).toEqual([]);
  });

  it('one plot per project, distinct positions, same order as the input', () => {
    const projects = projectsOf(['a', 'b', 'c']);
    const plots = computeDistrictPlots(projects);
    expect(plots).toHaveLength(3);
    expect(plots.map((p) => p.key)).toEqual(['a', 'b', 'c']);
    const positions = new Set(plots.map((p) => `${String(p.tileX)},${String(p.tileY)}`));
    expect(positions.size).toBe(3); // no two plots share a tile
  });

  it('wraps into additional rows past the per-row cap rather than widening unbounded', () => {
    const projects = projectsOf(Array.from({ length: 10 }, (_, i) => `p${String(i)}`));
    const plots = computeDistrictPlots(projects);
    expect(plots).toHaveLength(10);
    // Screen-space (world) assertions — tile coords no longer map 1:1 to
    // screen width since the v5R fix advances BOTH tile axes per row.
    const centers = plots.map((p) => plotWorldCenter(p));
    const spanX =
      Math.max(...centers.map((c) => c.worldX)) - Math.min(...centers.map((c) => c.worldX));
    const spanY =
      Math.max(...centers.map((c) => c.worldY)) - Math.min(...centers.map((c) => c.worldY));
    // Width is capped at MAX_PLOTS_PER_ROW columns (2 column steps).
    expect(spanX).toBe(128);
    // 10 projects wrap into 4 rows -> the scene grows DOWN, not across.
    expect(spanY).toBe(3 * 128);
    expect(spanY).toBeGreaterThan(spanX);
  });

  it('a single project still yields exactly one positive-position plot', () => {
    const plots = computeDistrictPlots(projectsOf(['solo']));
    expect(plots).toHaveLength(1);
    expect(plots[0].key).toBe('solo');
  });

  it('odd columns stagger their plaque; even columns do not', () => {
    const plots = computeDistrictPlots(projectsOf(['a', 'b', 'c', 'd']));
    expect(plots.map((p) => p.staggerPlaque)).toEqual([false, true, false, false]);
  });

  // v5R overlap fix regression guard: at 7 projects (the live roster size
  // that exposed the bug) NO two buildings may overlap on screen. A
  // building's screen extent from its ground center: half-width 22.4
  // (footprint 0.7), from 16px below (ground diamond bottom) to
  // 56 + 11.2px above (4 floors x 14 + roof half-diamond). Two plots are
  // safe when they are separated by more than the box width horizontally
  // OR by more than one full building extent vertically.
  it.each([2, 7])('no two buildings overlap on screen at %i projects', (n) => {
    const plots = computeDistrictPlots(
      projectsOf(Array.from({ length: n }, (_, i) => `p${String(i)}`)),
    );
    const centers = plots.map((p) => plotWorldCenter(p));
    const BOX_HALF_W = (64 / 2) * 0.7; // TILE_W/2 * footprint
    const EXTENT_UP = 4 * 14 + (32 / 2) * 0.7; // floors + roof half-diamond
    const EXTENT_DOWN = 32 / 2; // ground diamond bottom vertex
    for (let i = 0; i < centers.length; i++) {
      for (let j = i + 1; j < centers.length; j++) {
        const dx = Math.abs(centers[i].worldX - centers[j].worldX);
        const dy = Math.abs(centers[i].worldY - centers[j].worldY);
        const horizontallyClear = dx >= BOX_HALF_W * 2;
        const verticallyClear = dy >= EXTENT_UP + EXTENT_DOWN;
        expect(
          horizontallyClear || verticallyClear,
          `plots ${String(i)} and ${String(j)} overlap (dx=${String(dx)}, dy=${String(dy)})`,
        ).toBe(true);
      }
    }
  });

  it('columns advance straight across the screen (zero vertical creep) and rows straight down', () => {
    const plots = computeDistrictPlots(projectsOf(['a', 'b', 'c', 'd']));
    const [a, b, , d] = plots.map((p) => plotWorldCenter(p));
    // Same row, adjacent column: +64 world x, same world y.
    expect(b.worldX - a.worldX).toBe(64);
    expect(b.worldY - a.worldY).toBe(0);
    // Same column, next row: same world x, +128 world y.
    expect(d.worldX - a.worldX).toBe(0);
    expect(d.worldY - a.worldY).toBe(128);
  });
});

describe('districtSceneBounds', () => {
  it('returns a positive-area world bounds box even with zero plots', () => {
    const bounds = districtSceneBounds([]);
    expect(bounds.width).toBeGreaterThan(0);
    expect(bounds.height).toBeGreaterThan(0);
  });

  it('grows to fit more plots (more rows -> taller bounds)', () => {
    const smallPlots = computeDistrictPlots(projectsOf(['a', 'b']));
    const bigPlots = computeDistrictPlots(
      projectsOf(Array.from({ length: 10 }, (_, i) => `p${String(i)}`)),
    );
    const small = districtSceneBounds(smallPlots);
    const big = districtSceneBounds(bigPlots);
    expect(big.height).toBeGreaterThanOrEqual(small.height);
  });
});

describe('hitTestDistrict', () => {
  it('a point exactly on a plot center resolves to that plot key', () => {
    const plots = computeDistrictPlots(projectsOf(['a', 'b']));
    const [plot] = plots;
    const center = plotWorldCenter(plot);
    expect(hitTestDistrict(center.worldX, center.worldY, plots)).toBe(plot.key);
  });

  it('a point far from every plot resolves to null', () => {
    const plots = computeDistrictPlots(projectsOf(['a', 'b']));
    expect(hitTestDistrict(100_000, 100_000, plots)).toBeNull();
  });

  it('an empty plot list always resolves to null', () => {
    expect(hitTestDistrict(0, 0, [])).toBeNull();
  });

  it('every plot center still resolves to its own key across N projects', () => {
    const plots = computeDistrictPlots(projectsOf(['a', 'b', 'c', 'd', 'e']));
    for (const plot of plots) {
      const center = plotWorldCenter(plot);
      expect(hitTestDistrict(center.worldX, center.worldY, plots)).toBe(plot.key);
    }
  });

  it('adjacent plots DO have overlapping hit circles at the default radius -- a boundary tap resolves to the NEAREST center, not the first plot in the array', () => {
    const plots = computeDistrictPlots(projectsOf(['a', 'b']));
    const [plotA, plotB] = plots;
    const centerA = plotWorldCenter(plotA);
    const centerB = plotWorldCenter(plotB);
    const centerDist = Math.sqrt(
      (centerB.worldX - centerA.worldX) ** 2 + (centerB.worldY - centerA.worldY) ** 2,
    );
    const defaultRadius = 40;
    // Confirms the overlap this test is actually about (adjacent centers
    // closer together than 2x the default radius) -- if plot spacing ever
    // widens past this, the test below stops being meaningful and should
    // be revisited rather than silently passing on a non-overlap.
    expect(centerDist).toBeLessThan(defaultRadius * 2);

    // A point 53% of the way from A to B: within radius of BOTH centers
    // (linear interpolation puts it at t*centerDist from A and
    // (1-t)*centerDist from B -- both must stay <= 40 given centerDist
    // = 64 exactly, the column step -- which bounds t to roughly
    // [0.375, 0.625]), but strictly closer to B.
    const t = 0.53;
    const boundaryX = centerA.worldX + (centerB.worldX - centerA.worldX) * t;
    const boundaryY = centerA.worldY + (centerB.worldY - centerA.worldY) * t;
    const distToA = Math.sqrt(
      (boundaryX - centerA.worldX) ** 2 + (boundaryY - centerA.worldY) ** 2,
    );
    const distToB = Math.sqrt(
      (boundaryX - centerB.worldX) ** 2 + (boundaryY - centerB.worldY) ** 2,
    );
    expect(distToA).toBeLessThanOrEqual(defaultRadius);
    expect(distToB).toBeLessThanOrEqual(defaultRadius);
    expect(distToB).toBeLessThan(distToA);

    expect(hitTestDistrict(boundaryX, boundaryY, plots, defaultRadius)).toBe(plotB.key);
    // Order independence: reversing the plot array must not change the
    // nearest-wins outcome (guards against an accidental first-match
    // regression).
    expect(hitTestDistrict(boundaryX, boundaryY, [...plots].reverse(), defaultRadius)).toBe(
      plotB.key,
    );
  });
});

/** Minimal fake 2D context — just enough surface for drawIsoBox/
 *  drawDiamondTile to run without throwing; we only assert on call counts,
 *  not pixels. */
function fakeCtx(): CanvasRenderingContext2D {
  const noop = () => undefined;
  return {
    beginPath: noop,
    moveTo: noop,
    lineTo: noop,
    closePath: noop,
    fill: noop,
    stroke: noop,
    set fillStyle(_v: string) {
      /* no-op setter */
    },
    set strokeStyle(_v: string) {
      /* no-op setter */
    },
    set lineWidth(_v: number) {
      /* no-op setter */
    },
  } as unknown as CanvasRenderingContext2D;
}

describe('drawDistrictScene', () => {
  it('draws without throwing for a full N-project roster (4-10 range)', () => {
    const projects = projectsOf(Array.from({ length: 7 }, (_, i) => `p${String(i)}`));
    const plots = computeDistrictPlots(projects);
    expect(() => {
      drawDistrictScene(fakeCtx(), projects, plots);
    }).not.toThrow();
  });

  it('draws without throwing when a project has NO matching plot (graceful degradation)', () => {
    const projects = projectsOf(['orphan']);
    expect(() => {
      drawDistrictScene(fakeCtx(), projects, []);
    }).not.toThrow();
  });

  it('draws without throwing for an empty project list', () => {
    expect(() => {
      drawDistrictScene(fakeCtx(), [], []);
    }).not.toThrow();
  });

  it('honest-unknown projects (source: "unknown") still draw without throwing', () => {
    const projects = [project({ key: 'x', source: 'unknown', progress: null })];
    const plots = computeDistrictPlots(projects);
    expect(() => {
      drawDistrictScene(fakeCtx(), projects, plots);
    }).not.toThrow();
  });
});
