import type { Page } from '@playwright/test';

import { expect, test } from '../../fixtures/standalone';
import {
  permissionRequest,
  preToolUseBash,
  sendHookEvent,
  sessionStartStartup,
} from '../../helpers/hooks';
import { expectOverlayCount, readAgentOverlayIds } from '../../helpers/office';
import { setSettings } from '../../helpers/webview';

/**
 * KICKOFF v1.1 item 4: HUD/overlay layout pass. Every top/bottom-anchored
 * overlay used to be independently `absolute top-N`/`bottom-N` positioned —
 * ProgressionHUD and ZoomControls' +/- buttons literally shared the exact
 * same `top-8 left-8` rectangle (TUNING.md [G6], third instance of the same
 * bug class). Fixed by routing every overlay through HudStack (hudLayout.ts
 * + components/ui/HudStack.tsx): one flex-column stack per screen corner,
 * children laid out in normal flow so siblings can never claim the same
 * rectangle, cross-checked here at BOTH the iPhone-14 viewport (390x844)
 * and a normal desktop viewport (1280x800) across every screen state this
 * suite can reasonably drive. Fails on pre-fix code: ProgressionHUD and
 * ZoomControls' +/- buttons would report an identical bounding rect.
 */

const DESKTOP_VIEWPORT = { width: 1280, height: 800 };
const MOBILE_VIEWPORT = { width: 390, height: 844 };

/** Every data-testid a migrated HUD overlay can render under. Not every id
 *  is present in every state — collectHudBoxes only returns the ones
 *  actually in the DOM, which is exactly what a real screen shows. */
const HUD_TESTIDS = [
  'progression-hud',
  'zoom-controls',
  'zoom-level-badge',
  'stop-all-stack',
  'edit-action-bar',
  'rotate-hint',
  'night-shift-label',
  'economy-hud',
  'triage-panel',
  'triage-panel-collapsed',
  'world-event-banner',
  'contracts-panel',
  'bottom-toolbar',
  'dispatch-tray',
  'chain-tray',
  'version-label',
  'version-update-notice',
  'version-whats-new-tip',
];

interface HudBox {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

async function collectHudBoxes(page: Page): Promise<HudBox[]> {
  const boxes: HudBox[] = [];
  for (const id of HUD_TESTIDS) {
    const loc = page.locator(`[data-testid="${id}"]`).first();
    if ((await loc.count()) === 0) continue;
    const rect = await loc.evaluate((el) => {
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    });
    // Zero-area (not actually painted, e.g. a collapsed-away element) can't
    // meaningfully "overlap" anything.
    if (rect.width <= 0 || rect.height <= 0) continue;
    boxes.push({ id, ...rect });
  }
  return boxes;
}

function intersects(a: HudBox, b: HudBox): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

/** Asserts no two DIFFERENT overlay elements share a rectangle. Same-corner
 *  siblings (e.g. progression-hud + zoom-controls, both top-left) are
 *  exactly what this must catch — HudStack's flex-column layout means they
 *  can only pass this by occupying genuinely different rows, never by
 *  coincidence. */
function assertNoHudOverlap(boxes: HudBox[], context: string): void {
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i]!;
      const b = boxes[j]!;
      expect(
        intersects(a, b),
        `[${context}] "${a.id}" ${JSON.stringify(a)} overlaps "${b.id}" ${JSON.stringify(b)}`,
      ).toBe(false);
    }
  }
}

async function grayscale(page: Page, path: string): Promise<void> {
  await page.addStyleTag({ content: 'html { filter: grayscale(100%); }' });
  await page.screenshot({ path });
  await page.addStyleTag({ content: 'html { filter: none; }' });
}

async function captureAndAssert(page: Page, context: string, path: string): Promise<void> {
  const boxes = await collectHudBoxes(page);
  // Every state exercised below renders at least 3 overlays (HUD chrome is
  // never literally empty) — a suspiciously low count means the selector
  // list drifted from the real testids, not that the screen is overlay-free.
  expect(boxes.length, `[${context}] expected several HUD overlays present`).toBeGreaterThan(2);
  assertNoHudOverlap(boxes, context);
  await page.screenshot({ path: `${path}.png` });
  await grayscale(page, `${path}-grayscale.png`);
}

test.describe('Standalone / HUD overlay layout (KICKOFF v1.1 item 4)', () => {
  for (const [label, viewport] of [
    ['desktop', DESKTOP_VIEWPORT],
    ['mobile', MOBILE_VIEWPORT],
  ] as const) {
    test(`no HUD overlay overlaps at ${label} across idle/crisis/stop-all/edit states @area:standalone`, async ({
      page,
      standalone,
    }) => {
      await page.setViewportSize(viewport);
      await setSettings(page, {
        alwaysShowLabels: true,
        hooksEnabled: true,
        watchAllSessions: true,
        debugView: false,
      });
      await page.waitForTimeout(300);
      const dir = `test-results/e2e/hud-layout-${label}`;

      // 1. Idle HUD.
      await captureAndAssert(page, `${label}/idle`, `${dir}-00-idle`);

      // 2. Crisis card active (TriagePanel expanded, top-right corner).
      const sessionId = `hud-layout-${label}-crisis-session`;
      await sendHookEvent(
        standalone.hookServerConfig,
        sessionStartStartup(sessionId, standalone.workspaceDir),
      );
      await sendHookEvent(standalone.hookServerConfig, preToolUseBash(sessionId, 'npm test'));
      await expectOverlayCount(page, 1);
      await sendHookEvent(standalone.hookServerConfig, permissionRequest(sessionId));
      const [agentId] = await readAgentOverlayIds(page);
      await page.evaluate((id) => {
        window.__pixelAgentsTestHooks?.setCrisis?.(id, Date.now());
      }, agentId as number);
      await expect(page.locator('[data-testid="triage-panel"]')).toBeVisible();
      await captureAndAssert(page, `${label}/crisis`, `${dir}-01-crisis`);

      // Collapse the board before driving the remaining states — a
      // realistic next action (a user works around an open incident rather
      // than leaving the full board expanded forever) and keeps the
      // following states from combining TWO wide top-right/top-center
      // members that were never meant to be asserted simultaneously.
      await page.locator('[data-testid="triage-panel"] .triage-panel__header').click();
      await expect(page.locator('[data-testid="triage-panel-collapsed"]')).toBeVisible();

      // 3. STOP ALL fired (top-center corner's own state change).
      await page.locator('[data-testid="stop-all-control"]').click();
      await expect(page.locator('[data-testid="resume-control"]')).toBeVisible();
      await captureAndAssert(page, `${label}/stop-all`, `${dir}-02-stop-all`);
      // Resume so edit mode below isn't exercised mid-"all stopped".
      await page.locator('[data-testid="resume-control"]').click();
      await page.locator('[data-testid="resume-control"]').click();

      // 4. Edit mode + a real dirty edit (EditActionBar, top-center) plus a
      // zoom change (ZoomLevelBadge, top-center) — the exact corner the
      // original zoom-%-chip-vs-EditActionBar collision happened in.
      await page.locator('button[title="Edit office layout"]').click();
      await page.locator('button[title="Paint floor tiles"]').click();
      const canvasBox = await page.locator('[data-testid="office-canvas"]').boundingBox();
      if (canvasBox) {
        await page.mouse.click(
          canvasBox.x + canvasBox.width / 2,
          canvasBox.y + canvasBox.height / 2,
        );
      }
      await page.locator('button[title="Zoom in (Ctrl+Scroll)"]').click();
      await captureAndAssert(page, `${label}/edit-dirty`, `${dir}-03-edit-dirty`);
    });
  }
});
