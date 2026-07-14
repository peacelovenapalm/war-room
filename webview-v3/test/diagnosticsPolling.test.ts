import { describe, expect, it } from 'vitest';

import { shouldPollDiagnostics } from '../src/state/diagnosticsPolling';

describe('shouldPollDiagnostics', () => {
  it('polls only for an open panel on a live connection', () => {
    expect(shouldPollDiagnostics(true, 'live')).toBe(true);
    expect(shouldPollDiagnostics(false, 'live')).toBe(false);
    expect(shouldPollDiagnostics(true, 'connecting')).toBe(false);
    expect(shouldPollDiagnostics(true, 'offline')).toBe(false);
  });
});
