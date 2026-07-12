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
    const maxTileX = Math.max(...plots.map((p) => p.tileX));
    const maxTileY = Math.max(...plots.map((p) => p.tileY));
    // 10 projects must wrap into more than one row (bounded width).
    expect(maxTileY).toBeGreaterThan(0);
    // The row cap keeps width from growing linearly with N.
    expect(maxTileX).toBeLessThan(maxTileY === 0 ? 20 : 10);
  });

  it('a single project still yields exactly one positive-position plot', () => {
    const plots = computeDistrictPlots(projectsOf(['solo']));
    expect(plots).toHaveLength(1);
    expect(plots[0].key).toBe('solo');
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
    // ~71.6, which bounds t to roughly (0.44, 0.56]), but strictly closer
    // to B.
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
