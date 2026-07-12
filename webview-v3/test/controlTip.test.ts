import { describe, expect, it } from 'vitest';

import {
  computeTipPlacement,
  HOVER_DELAY_MS,
  LONG_PRESS_MS,
  type TipRect,
} from '../src/state/controlTip';

const VIEWPORT = { width: 1280 };

function rect(partial: Partial<TipRect>): TipRect {
  return { top: 100, bottom: 120, left: 100, right: 140, width: 40, ...partial };
}

describe('T1a tooltip timing constants', () => {
  it('hover reveal is a deliberate ~500ms delay (not instant, not native-slow)', () => {
    expect(HOVER_DELAY_MS).toBe(500);
  });

  it('long-press reveal is a deliberate ~450ms delay', () => {
    expect(LONG_PRESS_MS).toBe(450);
  });
});

describe('computeTipPlacement — side (above/below flip)', () => {
  it('places the bubble above the trigger when there is room', () => {
    const placement = computeTipPlacement(rect({ top: 200, bottom: 220 }), VIEWPORT);
    expect(placement.side).toBe('above');
    expect(placement.top).toBeLessThan(200);
  });

  it('flips below when the trigger is near the top edge (HUD strip, first dock row)', () => {
    const placement = computeTipPlacement(rect({ top: 10, bottom: 30 }), VIEWPORT);
    expect(placement.side).toBe('below');
    expect(placement.top).toBeGreaterThanOrEqual(30);
  });
});

describe('computeTipPlacement — horizontal alignment (3-zone, no width measurement needed)', () => {
  it('aligns left when the trigger sits in the left third of the viewport', () => {
    const placement = computeTipPlacement(rect({ left: 20, right: 60, width: 40 }), VIEWPORT);
    expect(placement.align).toBe('left');
    expect(placement.left).toBe(20);
  });

  it('aligns right when the trigger sits in the right third of the viewport', () => {
    const placement = computeTipPlacement(
      rect({ left: 1200, right: 1240, width: 40 }),
      VIEWPORT,
    );
    expect(placement.align).toBe('right');
    expect(placement.left).toBe(1240);
  });

  it('centers when the trigger sits in the middle third', () => {
    const placement = computeTipPlacement(rect({ left: 620, right: 660, width: 40 }), VIEWPORT);
    expect(placement.align).toBe('center');
    expect(placement.left).toBe(640);
  });
});
