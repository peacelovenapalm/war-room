/**
 * Unit tests for the dispatch template store (v2 mechanic G3,
 * GAME-DESIGN.md §7.3). Covers: creation validation, the 20-template cap,
 * persistence, and the VITEST-guard test cloned from economyStore.test.ts.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  DISPATCH_TEMPLATE_MAX_COUNT,
  DispatchTemplateStore,
  dispatchTemplateStore,
} from '../src/dispatchTemplateStore.js';

let vitestGuardHome: string;
vi.mock('os', async () => {
  const actual = await vi.importActual<typeof import('os')>('os');
  return { ...actual, homedir: () => vitestGuardHome };
});

let tmpDir: string;
let statePath: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dispatch-template-store-'));
  statePath = path.join(tmpDir, 'dispatch-templates.json');
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('DispatchTemplateStore.create', () => {
  it('creates a valid template', () => {
    const s = new DispatchTemplateStore(statePath);
    const result = s.create({ name: 'nightly build', prompt: 'run the build' });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.template.name).toBe('nightly build');
  });

  it('rejects a missing name or prompt', () => {
    const s = new DispatchTemplateStore(statePath);
    expect(s.create({ name: '', prompt: 'x' }).ok).toBe(false);
    expect(s.create({ name: 'x', prompt: '' }).ok).toBe(false);
  });

  it('rejects the 21st template (cap = 20)', () => {
    const s = new DispatchTemplateStore(statePath);
    for (let i = 0; i < DISPATCH_TEMPLATE_MAX_COUNT; i++) {
      expect(s.create({ name: `t${i}`, prompt: 'x' }).ok).toBe(true);
    }
    const result = s.create({ name: 'overflow', prompt: 'x' });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.reason).toBe('template-cap-exceeded');
  });

  it('persists and reloads across a fresh instance', () => {
    const s1 = new DispatchTemplateStore(statePath);
    const created = s1.create({ name: 'x', prompt: 'y' });
    if (!created.ok) throw new Error('unreachable');
    const s2 = new DispatchTemplateStore(statePath);
    expect(s2.get(created.template.id)?.name).toBe('x');
  });

  it('delete removes a template', () => {
    const s = new DispatchTemplateStore(statePath);
    const created = s.create({ name: 'x', prompt: 'y' });
    if (!created.ok) throw new Error('unreachable');
    s.delete(created.template.id);
    expect(s.get(created.template.id)).toBeUndefined();
  });
});

describe('DispatchTemplateStore VITEST guard (cloned from economyStore.test.ts pattern)', () => {
  beforeEach(() => {
    vitestGuardHome = fs.mkdtempSync(path.join(os.tmpdir(), 'dispatch-template-vitest-guard-'));
  });

  it('never writes the real default sidecar path under VITEST, even via the process-wide singleton', () => {
    dispatchTemplateStore.create({ name: 'vitest-guard-probe', prompt: 'x' });
    const expectedPath = path.join(vitestGuardHome, '.pixel-agents', 'dispatch-templates.json');
    expect(fs.existsSync(expectedPath)).toBe(false);
  });
});
