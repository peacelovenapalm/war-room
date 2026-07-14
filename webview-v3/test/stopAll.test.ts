import { describe, expect, it } from 'vitest';

import {
  interpretResumeResponse,
  interpretStopAllResponse,
  isExternalStopTransition,
  reduceAutomationStopped,
  stoppedFromOrders,
} from '../src/state/stopAll';

describe('interpretStopAllResponse (hard rule 8: a failed kill switch must SAY so)', () => {
  // Regression (panel finding, StopAllControl.tsx:20): any parseable JSON
  // used to flip the UI to "stopped" — an HTTP 403 or {ok:false} left
  // automation running while the button read RESUME.
  it('rejects a non-2xx response even when the body parses', () => {
    expect(interpretStopAllResponse(false, { ok: true, haltedOrders: 2, haltedRuns: 1 })).toEqual({
      ok: false,
    });
  });

  it('rejects body.ok === false', () => {
    expect(interpretStopAllResponse(true, { ok: false, haltedOrders: 0, haltedRuns: 0 })).toEqual({
      ok: false,
    });
  });

  it('rejects a malformed body (missing ok / not an object)', () => {
    expect(interpretStopAllResponse(true, null)).toEqual({ ok: false });
    expect(interpretStopAllResponse(true, 'stopped')).toEqual({ ok: false });
    expect(interpretStopAllResponse(true, {})).toEqual({ ok: false });
  });

  it('accepts only httpOk AND body.ok, carrying the halt counts', () => {
    expect(interpretStopAllResponse(true, { ok: true, haltedOrders: 3, haltedRuns: 2 })).toEqual({
      ok: true,
      haltedOrders: 3,
      haltedRuns: 2,
    });
    // Missing counts still succeed honestly as zero.
    expect(interpretStopAllResponse(true, { ok: true })).toEqual({
      ok: true,
      haltedOrders: 0,
      haltedRuns: 0,
    });
  });
});

describe('interpretResumeResponse', () => {
  it('applies the same httpOk AND body.ok rule', () => {
    expect(interpretResumeResponse(false, { ok: true, resumedOrders: 1 })).toEqual({ ok: false });
    expect(interpretResumeResponse(true, { ok: false })).toEqual({ ok: false });
    expect(interpretResumeResponse(true, { ok: true, resumedOrders: 4 })).toEqual({
      ok: true,
      resumedOrders: 4,
    });
  });
});

describe('stoppedFromOrders (mount hydration from GET /api/standing-orders)', () => {
  it('reports stopped when ANY order is kill-switch-halted', () => {
    expect(stoppedFromOrders([{ stoppedByKillSwitch: false }, { stoppedByKillSwitch: true }])).toBe(
      true,
    );
  });

  it('reports not-stopped for an empty roster or no halted orders', () => {
    expect(stoppedFromOrders([])).toBe(false);
    expect(stoppedFromOrders([{}, { stoppedByKillSwitch: false }])).toBe(false);
  });
});

describe('reduceAutomationStopped (WS plane keeps every instance in sync)', () => {
  it('latches stopped on the automationStopped broadcast', () => {
    expect(
      reduceAutomationStopped(false, {
        type: 'automationStopped',
        haltedOrderIds: ['o1'],
        haltedRunIds: [],
      }),
    ).toBe(true);
  });

  it('ignores unrelated messages', () => {
    expect(reduceAutomationStopped(false, { type: 'agentClosed', id: 1 })).toBe(false);
    expect(reduceAutomationStopped(true, { type: 'agentClosed', id: 1 })).toBe(true);
  });
});

describe('isExternalStopTransition (M3: a local receipt must never survive an external state change)', () => {
  it('is NOT external when the actual state matches what this instance expected', () => {
    // This instance's own successful STOP-ALL call set expected=true, and
    // the prop now reads true — its own receipt is allowed to stand.
    expect(isExternalStopTransition(true, true)).toBe(false);
    expect(isExternalStopTransition(false, false)).toBe(false);
  });

  it('IS external when the state changed to something this instance never asked for', () => {
    // Another client (or the sibling HUD/AutomationPanel mount) engaged
    // STOP-ALL — this instance still expects "not stopped", so its stale
    // local receipt/confirm-arm must be cleared.
    expect(isExternalStopTransition(false, true)).toBe(true);
    expect(isExternalStopTransition(true, false)).toBe(true);
  });
});
