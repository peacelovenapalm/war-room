/**
 * v3 feature-flag tests (WS-C stage 1): default ON only when real source
 * data exists; explicit env overrides in both directions.
 */

import { afterEach, describe, expect, it } from 'vitest';

import { v3StoreEnabled } from '../src/v3Flags.js';

const VAR = 'WAR_ROOM_V3_CONTRACTS';

afterEach(() => {
  delete process.env[VAR];
});

describe('v3StoreEnabled', () => {
  it('defaults ON only when the source data exists', () => {
    expect(v3StoreEnabled('CONTRACTS', () => true)).toBe(true);
    expect(v3StoreEnabled('CONTRACTS', () => false)).toBe(false);
  });

  it('env off/0/false force-disables even with source data present', () => {
    for (const value of ['off', '0', 'false', ' OFF ']) {
      process.env[VAR] = value;
      expect(v3StoreEnabled('CONTRACTS', () => true)).toBe(false);
    }
  });

  it('env on/1/true force-enables without source data', () => {
    for (const value of ['on', '1', 'true', ' ON ']) {
      process.env[VAR] = value;
      expect(v3StoreEnabled('CONTRACTS', () => false)).toBe(true);
    }
  });

  it('unrecognized values fall back to the source-data default', () => {
    process.env[VAR] = 'banana';
    expect(v3StoreEnabled('CONTRACTS', () => false)).toBe(false);
    expect(v3StoreEnabled('CONTRACTS', () => true)).toBe(true);
  });

  it('each store name reads its own env var', () => {
    process.env[VAR] = 'off';
    expect(v3StoreEnabled('CONTRACTS', () => true)).toBe(false);
    expect(v3StoreEnabled('RIVALRIES', () => true)).toBe(true);
  });
});
