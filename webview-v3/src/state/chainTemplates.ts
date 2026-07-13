/**
 * Chain starter templates (Greg's ask 2026-07-13: "things we do often —
 * like the gpt image generation harness — should be something I can
 * select as a template to modify"). PREFILL-ONLY by design: picking a
 * template copies its name + steps into the NEW CHAIN builder where every
 * field stays editable; nothing is saved or run until the user hits SAVE
 * CHAIN, so the server's createDef validation remains the single gate.
 * Client-side constants, zero wire/server change.
 *
 * Values are grounded in the repo's real harnesses, not invented:
 *  - imagegen: tools/asset-pipeline/README.md "Stage 3 — codex $imagegen
 *    lane" (spec.json → gen.sh → pack_imagegen.py).
 *  - cross-model review: the per-phase codex-review discipline the
 *    SPRINT-STATE ledger runs on every lane.
 * Model ids referenced in prompts follow the live-verified set in
 * net/dispatchFacts.ts DISPATCH_MODEL_OPTIONS.
 */

export interface ChainTemplateStep {
  machine?: string;
  provider?: string;
  cwd?: string;
  prompt: string;
  model?: string;
}

export interface ChainTemplate {
  key: string;
  /** Picker label — glyph + words (colorblind rule). */
  label: string;
  /** Prefills the chain NAME field. */
  name: string;
  steps: ChainTemplateStep[];
}

export const CHAIN_TEMPLATES: readonly ChainTemplate[] = [
  {
    key: 'imagegen-harness',
    label: '▤ IMAGEGEN HARNESS (codex $imagegen → pack → review)',
    name: 'imagegen harness',
    steps: [
      {
        machine: 'MACBOOK',
        provider: 'codex',
        model: 'gpt-5.6-sol',
        cwd: '/Users/greg/code/war-room/tools/asset-pipeline/imagegen',
        prompt:
          'Read README.md ("Stage 3 — codex $imagegen lane") and spec.json in this directory. Generate the assets whose PNGs are missing from out/imagegen-raw/ using the gen.sh invocation pattern ($imagegen, single-quote-safe prompts), then run `python3 pack_imagegen.py` and report its budget-gate output verbatim.',
      },
      {
        machine: 'MACBOOK',
        provider: 'claude',
        model: 'sonnet',
        cwd: '/Users/greg/code/war-room',
        prompt:
          'Review the imagegen run output: {{step1.result}} — verify webview-v3-assets/imagegen/manifest.json is internally consistent (every entry has a real file, sizes match), flag any budget-gate warning, and summarize what changed.',
      },
    ],
  },
  {
    key: 'cross-model-review',
    label: '▥ CROSS-MODEL REVIEW (codex reviews → claude reconciles)',
    name: 'cross-model review + reconcile',
    steps: [
      {
        machine: 'MACBOOK',
        provider: 'codex',
        model: 'gpt-5.6-sol',
        cwd: '/Users/greg/code/war-room',
        prompt:
          'Read-only adversarial code review, no edits. Review `git diff <BASE>..<BRANCH>` (EDIT ME). Output: verdict SHIP / SHIP-WITH-NOTES / BLOCK, then numbered findings with severity (BLOCKER/MAJOR/MINOR), file:line, and a concrete failure scenario each.',
      },
      {
        machine: 'MACBOOK',
        provider: 'claude',
        model: 'sonnet',
        cwd: '/Users/greg/code/war-room',
        prompt:
          'Reconcile this code-review verdict on the branch it reviewed (EDIT ME to name the branch): {{step1.result}} — fix every MAJOR finding on-branch with tests, commit atomically (never git add -A), and report each finding as FIXED / SKIPPED with a one-line reason.',
      },
    ],
  },
] as const;

/** Instantiate a template into builder state: fresh step ids, deep-copied
 *  fields, everything editable. Pure — unit-testable without a DOM. */
export function instantiateChainTemplate(template: ChainTemplate): {
  name: string;
  steps: Array<ChainTemplateStep & { id: string }>;
} {
  return {
    name: template.name,
    steps: template.steps.map((s) => ({ ...s, id: crypto.randomUUID() })),
  };
}
