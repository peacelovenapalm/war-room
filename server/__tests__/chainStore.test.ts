/**
 * Unit tests for the dispatch chain store (v2 mechanic G3, GAME-DESIGN.md
 * §7.1). Covers: def validation (step cap, template forward-reference
 * rejection), run lifecycle bookkeeping, concurrent-run counting, template
 * rendering, and STOP ALL's haltAllRunning.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  CHAIN_MAX_STEPS,
  type ChainStepDef,
  ChainStore,
  chainStore,
  renderStepPrompt,
  validateStepTemplates,
} from '../src/chainStore.js';

// VITEST guard (cloned from economyStore.test.ts pattern): explicit-path
// instances below never call os.homedir(), so mocking it file-wide is safe.
let vitestGuardHome: string;
vi.mock('os', async () => {
  const actual = await vi.importActual<typeof import('os')>('os');
  return { ...actual, homedir: () => vitestGuardHome };
});

let tmpDir: string;
let defsPath: string;
let runsPath: string;
let auditPath: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chain-store-'));
  defsPath = path.join(tmpDir, 'chain-defs.json');
  runsPath = path.join(tmpDir, 'chain-runs.json');
  auditPath = path.join(tmpDir, 'chain-audit.jsonl');
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function step(id: string, prompt: string, extra: Partial<ChainStepDef> = {}): ChainStepDef {
  return { id, prompt, ...extra };
}

describe('validateStepTemplates', () => {
  it('accepts a template referencing an earlier step', () => {
    const steps = [step('s1', 'do the thing'), step('s2', 'use {{step1.result}}')];
    expect(validateStepTemplates(steps)).toEqual({ ok: true });
  });

  it('rejects a forward reference (step 1 referencing step 2)', () => {
    const steps = [step('s1', 'use {{step2.result}}'), step('s2', 'do the thing')];
    const result = validateStepTemplates(steps);
    expect(result.ok).toBe(false);
  });

  it('rejects a self-reference', () => {
    const steps = [step('s1', 'use {{step1.result}}')];
    expect(validateStepTemplates(steps).ok).toBe(false);
  });
});

describe('renderStepPrompt', () => {
  it('substitutes {{stepK.result}} and {{stepK.exitCode}} from prior steps', () => {
    const priorSteps = [
      { stepId: 's1', status: 'exited' as const, exitCode: 0, resultTail: 'hello world' },
    ];
    const rendered = renderStepPrompt(
      'echo "{{step1.result}}" (code {{step1.exitCode}})',
      priorSteps,
    );
    expect(rendered).toBe('echo "hello world" (code 0)');
  });

  it('leaves an unresolvable placeholder verbatim rather than throwing', () => {
    const rendered = renderStepPrompt('use {{step5.result}}', []);
    expect(rendered).toBe('use {{step5.result}}');
  });
});

describe('ChainStore.createDef', () => {
  it('creates a valid two-step def', () => {
    const s = new ChainStore(defsPath, runsPath, auditPath);
    const result = s.createDef({
      name: 'test chain',
      steps: [step('s1', 'first'), step('s2', 'second {{step1.result}}')],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.def.steps).toHaveLength(2);
  });

  it('rejects a def over CHAIN_MAX_STEPS', () => {
    const s = new ChainStore(defsPath, runsPath, auditPath);
    const steps = Array.from({ length: CHAIN_MAX_STEPS + 1 }, (_, i) => step(`s${i}`, `step ${i}`));
    const result = s.createDef({ name: 'too long', steps });
    expect(result.ok).toBe(false);
  });

  it('rejects a def with a forward-referencing template', () => {
    const s = new ChainStore(defsPath, runsPath, auditPath);
    const result = s.createDef({
      name: 'bad chain',
      steps: [step('s1', 'use {{step2.result}}'), step('s2', 'second')],
    });
    expect(result.ok).toBe(false);
  });

  it('rejects an empty prompt', () => {
    const s = new ChainStore(defsPath, runsPath, auditPath);
    const result = s.createDef({ name: 'x', steps: [step('s1', '')] });
    expect(result.ok).toBe(false);
  });
});

describe('ChainStore run lifecycle', () => {
  it('createRun starts all steps pending at currentStep 0', () => {
    const s = new ChainStore(defsPath, runsPath, auditPath);
    const defResult = s.createDef({ name: 'x', steps: [step('s1', 'a'), step('s2', 'b')] });
    if (!defResult.ok) throw new Error('unreachable');
    const run = s.createRun(defResult.def);
    expect(run.status).toBe('running');
    expect(run.currentStep).toBe(0);
    expect(run.steps.every((st) => st.status === 'pending')).toBe(true);
  });

  it('countRunningRuns only counts status=running', () => {
    const s = new ChainStore(defsPath, runsPath, auditPath);
    const defResult = s.createDef({ name: 'x', steps: [step('s1', 'a')] });
    if (!defResult.ok) throw new Error('unreachable');
    const run1 = s.createRun(defResult.def);
    s.createRun(defResult.def);
    expect(s.countRunningRuns()).toBe(2);
    s.completeRun(run1.id);
    expect(s.countRunningRuns()).toBe(1);
  });

  it('failRun sets status=failed and records a reason, never retried', () => {
    const s = new ChainStore(defsPath, runsPath, auditPath);
    const defResult = s.createDef({ name: 'x', steps: [step('s1', 'a')] });
    if (!defResult.ok) throw new Error('unreachable');
    const run = s.createRun(defResult.def);
    s.failRun(run.id, 'denied: path-not-allowlisted');
    const updated = s.getRun(run.id);
    expect(updated?.status).toBe('failed');
    expect(updated?.failReason).toBe('denied: path-not-allowlisted');
  });

  it('haltAllRunning (STOP ALL) halts every running run and flags provenance', () => {
    const s = new ChainStore(defsPath, runsPath, auditPath);
    const defResult = s.createDef({ name: 'x', steps: [step('s1', 'a')] });
    if (!defResult.ok) throw new Error('unreachable');
    const run1 = s.createRun(defResult.def);
    const run2 = s.createRun(defResult.def);
    s.completeRun(run2.id); // not running — should be untouched
    const halted = s.haltAllRunning();
    expect(halted).toHaveLength(1);
    expect(s.getRun(run1.id)?.status).toBe('halted');
    expect(s.getRun(run1.id)?.stoppedByKillSwitch).toBe(true);
    expect(s.getRun(run2.id)?.status).toBe('completed'); // untouched
  });

  it('haltRun (KICKOFF v1.1 item 3) halts ONLY the targeted run and records a reason — never touches other running runs', () => {
    const s = new ChainStore(defsPath, runsPath, auditPath);
    const defResult = s.createDef({ name: 'x', steps: [step('s1', 'a')] });
    if (!defResult.ok) throw new Error('unreachable');
    const run1 = s.createRun(defResult.def);
    const run2 = s.createRun(defResult.def);
    const halted = s.haltRun(run1.id, 'step-killed');
    expect(halted?.status).toBe('halted');
    expect(halted?.haltReason).toBe('step-killed');
    expect(s.getRun(run1.id)?.status).toBe('halted');
    expect(s.getRun(run2.id)?.status).toBe('running'); // the OTHER run is untouched
  });

  it('haltRun is a no-op (not an error) for an unknown or already non-running run', () => {
    const s = new ChainStore(defsPath, runsPath, auditPath);
    expect(s.haltRun('nonexistent', 'x')).toBeUndefined();

    const defResult = s.createDef({ name: 'x', steps: [step('s1', 'a')] });
    if (!defResult.ok) throw new Error('unreachable');
    const run = s.createRun(defResult.def);
    s.completeRun(run.id);
    expect(s.haltRun(run.id, 'too-late')).toBeUndefined();
    expect(s.getRun(run.id)?.status).toBe('completed'); // unchanged, not overwritten to halted
  });

  it('persists runs across a fresh instance pointed at the same files', () => {
    const s1 = new ChainStore(defsPath, runsPath, auditPath);
    const defResult = s1.createDef({ name: 'x', steps: [step('s1', 'a')] });
    if (!defResult.ok) throw new Error('unreachable');
    const run = s1.createRun(defResult.def);

    const s2 = new ChainStore(defsPath, runsPath, auditPath);
    expect(s2.getRun(run.id)?.id).toBe(run.id);
    expect(s2.getDef(defResult.def.id)?.name).toBe('x');
  });

  it('writes an audit line for every lifecycle transition', () => {
    const s = new ChainStore(defsPath, runsPath, auditPath);
    const defResult = s.createDef({ name: 'x', steps: [step('s1', 'a')] });
    if (!defResult.ok) throw new Error('unreachable');
    const run = s.createRun(defResult.def);
    s.completeRun(run.id);
    const lines = fs
      .readFileSync(auditPath, 'utf8')
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l) as { event: string });
    expect(lines.some((l) => l.event === 'run-created')).toBe(true);
    expect(lines.some((l) => l.event === 'run-completed')).toBe(true);
  });
});

describe('ChainStore VITEST guard (cloned from economyStore.test.ts pattern)', () => {
  beforeEach(() => {
    vitestGuardHome = fs.mkdtempSync(path.join(os.tmpdir(), 'chain-store-vitest-guard-'));
  });

  it('never writes the real default sidecar paths under VITEST, even via the process-wide singleton', () => {
    const defResult = chainStore.createDef({ name: 'x', steps: [step('s1', 'a')] });
    if (defResult.ok) chainStore.createRun(defResult.def);
    const expectedDefs = path.join(vitestGuardHome, '.pixel-agents', 'chain-defs.json');
    const expectedRuns = path.join(vitestGuardHome, '.pixel-agents', 'chain-runs.json');
    expect(fs.existsSync(expectedDefs)).toBe(false);
    expect(fs.existsSync(expectedRuns)).toBe(false);
  });
});
