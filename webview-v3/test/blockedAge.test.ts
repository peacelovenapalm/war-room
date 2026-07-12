/**
 * C9-3: the AgentDrawer's BLOCKED AGE anchor. The fix removed the
 * `?? poll?.since` fallback that made non-blocked agents show a stale,
 * ever-growing "blocked age" anchored to the current poll snapshot's receipt
 * time. The anchor is now the needs-input fire's onset ONLY.
 */

import { describe, expect, it } from 'vitest';

import { blockedAgeAnchor } from '../src/state/blockedAge';
import type { FireRecord } from '../src/state/crisisStore';

describe('blockedAgeAnchor (C9-3)', () => {
  it('anchors to the fire onset when the agent is blocked', () => {
    const fire: FireRecord = { since: 1_700_000_000_000 };
    expect(blockedAgeAnchor(fire)).toBe(1_700_000_000_000);
  });

  it('returns undefined (→ "—") when there is NO fire, even for a live poll agent', () => {
    // The whole bug: a non-blocked agent had a poll snapshot, and the drawer
    // used poll.since as the "blocked age" anchor. There is no poll parameter
    // here at all — a non-blocked agent has no blocked age, full stop.
    expect(blockedAgeAnchor(undefined)).toBeUndefined();
  });
});
