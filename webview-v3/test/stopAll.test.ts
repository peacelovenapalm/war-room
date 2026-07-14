import { describe, expect, it } from 'vitest';

import {
  INITIAL_AUTOMATION_LATCH,
  interpretResumeResponse,
  interpretStopAllResponse,
  isExternalStopTransition,
  latchSnapshotFromHttp,
  reconcileAutomationLatch,
  reduceAutomationLatch,
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
    expect(
      interpretStopAllResponse(true, {
        ok: true,
        haltedOrders: 3,
        haltedRuns: 2,
        revision: 7,
      }),
    ).toEqual({ ok: true, haltedOrders: 3, haltedRuns: 2, revision: 7 });
    // Missing counts still succeed honestly as zero.
    expect(interpretStopAllResponse(true, { ok: true })).toEqual({
      ok: true,
      haltedOrders: 0,
      haltedRuns: 0,
      revision: 0,
    });
  });
});

describe('interpretResumeResponse', () => {
  it('applies the same httpOk AND body.ok rule', () => {
    expect(interpretResumeResponse(false, { ok: true, resumedOrders: 1 })).toEqual({ ok: false });
    expect(interpretResumeResponse(true, { ok: false })).toEqual({ ok: false });
    expect(interpretResumeResponse(true, { ok: true, resumedOrders: 4, revision: 9 })).toEqual({
      ok: true,
      resumedOrders: 4,
      revision: 9,
    });
  });
});

describe('revisioned automation latch reconciliation', () => {
  it('applies stop and resume broadcasts in revision order', () => {
    const stopped = reduceAutomationLatch(INITIAL_AUTOMATION_LATCH, {
        type: 'automationStopped',
        haltedOrderIds: ['o1'],
        haltedRunIds: [],
        revision: 2,
      });
    expect(stopped).toEqual({ engaged: true, revision: 2 });
    expect(reduceAutomationLatch(stopped, { type: 'automationResumed', revision: 3 })).toEqual({
      engaged: false,
      revision: 3,
    });
  });

  it('rejects stale HTTP snapshots and stale broadcasts', () => {
    const current = { engaged: true, revision: 4 };
    expect(reconcileAutomationLatch(current, { engaged: false, revision: 3 })).toBe(current);
    expect(reduceAutomationLatch(current, { type: 'automationResumed', revision: 3 })).toBe(
      current,
    );
  });

  it('parses only a complete revisioned HTTP snapshot', () => {
    expect(latchSnapshotFromHttp({ engaged: false, revision: 5 })).toEqual({
      engaged: false,
      revision: 5,
    });
    expect(latchSnapshotFromHttp({ engaged: false })).toBeNull();
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
