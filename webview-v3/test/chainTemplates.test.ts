/**
 * Chain starter templates — every seeded template must be SAVE-able
 * as-is (server createDef would accept it) and instantiation must stay
 * prefill-only (fresh ids, no shared references with the constant).
 */

import { describe, expect, it } from 'vitest';

import { chainMaxSteps, validateStepTemplatesClient } from '../src/state/chain';
import { CHAIN_TEMPLATES, instantiateChainTemplate } from '../src/state/chainTemplates';

describe('CHAIN_TEMPLATES', () => {
  it('every template is valid builder input (non-empty prompts, within step cap, {{stepK}} refs check out)', () => {
    for (const template of CHAIN_TEMPLATES) {
      expect(template.name.trim(), `${template.key}: name`).not.toBe('');
      expect(template.steps.length, `${template.key}: steps`).toBeGreaterThan(0);
      expect(template.steps.length, `${template.key}: un-perked step cap`).toBeLessThanOrEqual(
        chainMaxSteps(false),
      );
      const filled = instantiateChainTemplate(template);
      for (const step of filled.steps) {
        expect(step.prompt.trim(), `${template.key}: step prompt`).not.toBe('');
      }
      const check = validateStepTemplatesClient(filled.steps);
      expect(check.ok, `${template.key}: ${check.ok ? '' : check.reason}`).toBe(true);
    }
  });

  it('template keys and labels are unique, labels carry a glyph + words (colorblind rule)', () => {
    const keys = new Set(CHAIN_TEMPLATES.map((t) => t.key));
    expect(keys.size).toBe(CHAIN_TEMPLATES.length);
    for (const t of CHAIN_TEMPLATES) {
      expect(t.label, `${t.key}: label leads with a glyph`).toMatch(/^[^A-Za-z0-9\s]/);
      expect(t.label, `${t.key}: label carries words`).toMatch(/[A-Z]{2,}/);
    }
  });

  it('instantiation mints fresh step ids every call and never aliases the constant', () => {
    const template = CHAIN_TEMPLATES[0];
    const a = instantiateChainTemplate(template);
    const b = instantiateChainTemplate(template);
    const ids = new Set([...a.steps.map((s) => s.id), ...b.steps.map((s) => s.id)]);
    expect(ids.size).toBe(a.steps.length + b.steps.length);
    a.steps[0].prompt = 'mutated';
    expect(CHAIN_TEMPLATES[0].steps[0].prompt).not.toBe('mutated');
  });
});
