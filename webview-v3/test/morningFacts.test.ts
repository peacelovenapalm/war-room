import { describe, expect, it } from 'vitest';

import {
  formatDataAge,
  isAllCalm,
  isBoardStale,
  isMorningJsonStale,
  MORNING_BOARD_STALE_WARN_SECONDS,
  MORNING_JSON_STALE_WARN_SECONDS,
  type MorningSurface,
} from '../src/net/morningFacts';

function makeSurface(overrides: Partial<MorningSurface> = {}): MorningSurface {
  return {
    generatedAt: '2026-07-13T06:00:00.000Z',
    morningJson: {
      available: true,
      stale: false,
      dataAgeSeconds: 60,
      date: '2026-07-13',
      top3: [],
      flags: null,
      prs: { count: 0, list: [] },
    },
    board: {
      dataAgeSeconds: 0,
      needsInput: { count: 0, names: [] },
      heldBudget: { count: 0, jobs: [] },
    },
    overnight: {
      dataAgeSeconds: 0,
      windowStart: '2026-07-12T18:00:00.000Z',
      windowEnd: '2026-07-13T06:00:00.000Z',
      receiptCount: 0,
      receipts: [],
    },
    needsYouCount: 0,
    degraded: false,
    degradedReasons: [],
    streak: {
      count: 3,
      lastRecordedDate: '2026-07-13',
      lastBreachReason: null,
      lastBreachAt: null,
    },
    memory: {
      graphAnswered: 0,
      rederived: 0,
      surfacesOpenedPerMorning: 0,
      morningDate: '2026-07-13',
      persistence: 'process',
      writePathEnabled: false,
      writeMode: 'staged',
      cleanDayCount: 0,
      promotionEligible: false,
    },
    ...overrides,
  };
}

describe('isAllCalm', () => {
  it('is true when needs-you, held budget, and PRs are all zero and nothing is degraded', () => {
    expect(isAllCalm(makeSurface())).toBe(true);
  });

  it('is false when needsYouCount > 0', () => {
    expect(isAllCalm(makeSurface({ needsYouCount: 1 }))).toBe(false);
  });

  it('is false when held-budget jobs exist', () => {
    expect(
      isAllCalm(
        makeSurface({
          board: {
            dataAgeSeconds: 0,
            needsInput: { count: 0, names: [] },
            heldBudget: { count: 1, jobs: [] },
          },
        }),
      ),
    ).toBe(false);
  });

  it('is false when open routine PRs exist', () => {
    const surface = makeSurface();
    surface.morningJson.prs = { count: 1, list: [] };
    expect(isAllCalm(surface)).toBe(false);
  });

  it('is false when the surface is degraded, even if every count is zero -- never a fake calm', () => {
    expect(
      isAllCalm(makeSurface({ degraded: true, degradedReasons: ['morning.json stale'] })),
    ).toBe(false);
  });
});

describe('formatDataAge', () => {
  it('renders unknown age honestly', () => {
    expect(formatDataAge(null)).toBe('unknown age');
  });

  it('renders seconds/minutes/hours by magnitude', () => {
    expect(formatDataAge(5)).toBe('5s');
    expect(formatDataAge(90)).toBe('1m');
    expect(formatDataAge(7_200)).toBe('2h');
  });
});

describe('isBoardStale', () => {
  it('is false at/under the warn threshold', () => {
    expect(
      isBoardStale({
        dataAgeSeconds: MORNING_BOARD_STALE_WARN_SECONDS,
        needsInput: { count: 0, names: [] },
        heldBudget: { count: 0, jobs: [] },
      }),
    ).toBe(false);
  });

  it('is true past the warn threshold', () => {
    expect(
      isBoardStale({
        dataAgeSeconds: MORNING_BOARD_STALE_WARN_SECONDS + 1,
        needsInput: { count: 0, names: [] },
        heldBudget: { count: 0, jobs: [] },
      }),
    ).toBe(true);
  });
});

describe('isMorningJsonStale', () => {
  it('is false when unavailable -- that renders its own honest line, not ◷ STALE', () => {
    expect(
      isMorningJsonStale({
        available: false,
        stale: false,
        dataAgeSeconds: null,
        date: null,
        top3: [],
        flags: null,
        prs: { count: 0, list: [] },
      }),
    ).toBe(false);
  });

  it('is true when the server already flagged it stale', () => {
    expect(
      isMorningJsonStale({
        available: true,
        stale: true,
        dataAgeSeconds: 100,
        date: '2026-07-12',
        top3: [],
        flags: null,
        prs: { count: 0, list: [] },
      }),
    ).toBe(true);
  });

  it('is true past MORNING_JSON_STALE_WARN_SECONDS even if the server did not flag it', () => {
    expect(
      isMorningJsonStale({
        available: true,
        stale: false,
        dataAgeSeconds: MORNING_JSON_STALE_WARN_SECONDS + 1,
        date: '2026-07-12',
        top3: [],
        flags: null,
        prs: { count: 0, list: [] },
      }),
    ).toBe(true);
  });
});
