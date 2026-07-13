import { describe, expect, it } from 'vitest';

import { NO_LAUNCH_TARGET, parseLaunchTarget } from '../src/state/launch';

describe('parseLaunchTarget (push-landing deep link)', () => {
  it('no query string -> no target (plain board cold open)', () => {
    expect(parseLaunchTarget('')).toEqual(NO_LAUNCH_TARGET);
    expect(parseLaunchTarget('?')).toEqual(NO_LAUNCH_TARGET);
  });

  it('?agentId=<n> is the direct form', () => {
    expect(parseLaunchTarget('?agentId=42')).toEqual({ agentId: 42, panel: null });
  });

  it('?open=agent&id=<n> is the explicit form', () => {
    expect(parseLaunchTarget('?open=agent&id=7')).toEqual({ agentId: 7, panel: null });
  });

  it('agentId wins when both forms are present', () => {
    expect(parseLaunchTarget('?agentId=1&open=agent&id=2')).toEqual({ agentId: 1, panel: null });
  });

  it('open=agent without a valid id -> no target', () => {
    expect(parseLaunchTarget('?open=agent')).toEqual(NO_LAUNCH_TARGET);
    expect(parseLaunchTarget('?open=agent&id=nope')).toEqual(NO_LAUNCH_TARGET);
  });

  it('open=something-else (not a launchable panel kind) is ignored even with an id present', () => {
    expect(parseLaunchTarget('?open=board&id=3')).toEqual(NO_LAUNCH_TARGET);
  });

  it('rejects non-numeric, negative, and fractional ids', () => {
    expect(parseLaunchTarget('?agentId=abc')).toEqual(NO_LAUNCH_TARGET);
    expect(parseLaunchTarget('?agentId=-1')).toEqual(NO_LAUNCH_TARGET);
    expect(parseLaunchTarget('?agentId=1.5')).toEqual(NO_LAUNCH_TARGET);
    expect(parseLaunchTarget('?agentId=')).toEqual(NO_LAUNCH_TARGET);
  });

  it('accepts agent id 0 (a valid agent id, not falsy-absent)', () => {
    expect(parseLaunchTarget('?agentId=0')).toEqual({ agentId: 0, panel: null });
  });

  // V6-1 morning push deep link (morningPush.ts's morningDeepLink)
  it('?open=morning targets the MORNING panel, no agent', () => {
    expect(parseLaunchTarget('?open=morning')).toEqual({ agentId: null, panel: 'morning' });
  });

  it('agentId still wins over a panel target when both are present', () => {
    expect(parseLaunchTarget('?agentId=5&open=morning')).toEqual({ agentId: 5, panel: null });
  });
});
