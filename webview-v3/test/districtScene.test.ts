/**
 * districtScene tests (Phase 5 Lane C, T7/D-35 districts) — plot layout and
 * hit-testing (pure math, no canvas needed). drawDistrictScene itself is
 * exercised via a minimal fake CanvasRenderingContext2D to confirm it
 * degrades gracefully when a plot has no matching project.
 */

import { describe, expect, it } from 'vitest';

import {
  DISTRICT_PLOTS,
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

describe('DISTRICT_PLOTS', () => {
  it('has exactly 2 plots (v4 proof slice) with distinct keys and positions', () => {
    expect(DISTRICT_PLOTS).toHaveLength(2);
    const keys = DISTRICT_PLOTS.map((p) => p.key);
    expect(new Set(keys).size).toBe(2);
    const [a, b] = DISTRICT_PLOTS;
    expect(a.tileX).not.toBe(b.tileX);
  });
});

describe('districtSceneBounds', () => {
  it('returns a positive-area world bounds box', () => {
    const bounds = districtSceneBounds();
    expect(bounds.width).toBeGreaterThan(0);
    expect(bounds.height).toBeGreaterThan(0);
  });
});

describe('hitTestDistrict', () => {
  it('a point exactly on a plot center resolves to that plot key', () => {
    const [plot] = DISTRICT_PLOTS;
    const center = plotWorldCenter(plot);
    expect(hitTestDistrict(center.worldX, center.worldY)).toBe(plot.key);
  });

  it('a point far from every plot resolves to null', () => {
    expect(hitTestDistrict(100_000, 100_000)).toBeNull();
  });

  it('two plots never share a hit radius (no ambiguous overlap)', () => {
    const [a, b] = DISTRICT_PLOTS;
    const centerA = plotWorldCenter(a);
    expect(hitTestDistrict(centerA.worldX, centerA.worldY)).toBe(a.key);
    const centerB = plotWorldCenter(b);
    expect(hitTestDistrict(centerB.worldX, centerB.worldY)).toBe(b.key);
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
  it('draws without throwing when every plot has a matching project', () => {
    const projects = DISTRICT_PLOTS.map((plot) => project({ key: plot.key, label: plot.key }));
    expect(() => {
      drawDistrictScene(fakeCtx(), projects);
    }).not.toThrow();
  });

  it('draws without throwing when a plot has NO matching project (graceful degradation)', () => {
    expect(() => {
      drawDistrictScene(fakeCtx(), []);
    }).not.toThrow();
  });
});
