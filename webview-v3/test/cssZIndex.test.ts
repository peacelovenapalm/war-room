/**
 * Static CSS reachability check — no DOM harness exists in this workspace
 * (vitest environment: node), so this parses index.css as text and asserts
 * stacking-order invariants that would otherwise only be caught by a human
 * eyeballing a screenshot.
 *
 * Regression target: the one-tap-real sheet (hard rule 5) must render
 * above every modal — a HUD chip stays clickable above open panels
 * (see the .hud comment in index.css), so the sheet it opens must win the
 * same stacking fight or the tap opens the sheet invisibly under the
 * modal backdrop.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(join(__dirname, '../src/index.css'), 'utf8');

/** Exact-selector z-index lookup — the trailing `\s*\{` boundary prevents
 *  `.modal` from matching `.modal-backdrop` or `.modal input[...]`. */
function zIndexOf(selector: string): number {
  const escaped = selector.replace(/[.]/g, '\\.');
  const re = new RegExp(`${escaped}\\s*\\{[^}]*?z-index:\\s*(-?\\d+)`, 's');
  const match = css.match(re);
  if (!match) throw new Error(`no z-index rule found for selector "${selector}"`);
  return Number(match[1]);
}

describe('index.css — stacking order', () => {
  it('.real-sheet renders above every modal and the HUD that can open it', () => {
    const realSheet = zIndexOf('.real-sheet');
    const backdrop = zIndexOf('.modal-backdrop');
    const modal = zIndexOf('.modal');
    const hud = zIndexOf('.hud');
    expect(realSheet).toBeGreaterThan(backdrop);
    expect(realSheet).toBeGreaterThan(modal);
    expect(realSheet).toBeGreaterThanOrEqual(hud);
  });
});
