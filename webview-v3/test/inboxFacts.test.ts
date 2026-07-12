import { describe, expect, it } from 'vitest';

import { formatEntryAge, routineGlyph } from '../src/net/inboxFacts';

describe('formatEntryAge', () => {
  it('renders minutes under an hour', () => {
    expect(formatEntryAge(5 * 60_000)).toBe('5m');
    expect(formatEntryAge(0)).toBe('0m');
  });

  it('renders hours under a day', () => {
    expect(formatEntryAge(3 * 3_600_000)).toBe('3h');
    expect(formatEntryAge(23 * 3_600_000)).toBe('23h');
  });

  it('renders days at 24h and beyond', () => {
    expect(formatEntryAge(24 * 3_600_000)).toBe('1d');
    expect(formatEntryAge(72 * 3_600_000)).toBe('3d');
  });

  it('never goes negative on a clock skew', () => {
    expect(formatEntryAge(-1000)).toBe('0m');
  });
});

describe('routineGlyph (colorblind rule: shape + the routine name as the word)', () => {
  it('has a distinct glyph for every known routine', () => {
    const routines = [
      'summary',
      'todo',
      'vault-health',
      'project-pulse',
      'docs-tracker',
      'refresh-mocs',
      'proposed-plans',
      'vault-fixer',
    ];
    const glyphs = new Set(routines.map(routineGlyph));
    expect(glyphs.size).toBe(routines.length);
  });

  it('falls back to a plain bullet for an unknown routine rather than guessing', () => {
    expect(routineGlyph('some-future-routine')).toBe('·');
  });
});
