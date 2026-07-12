import { PNG } from 'pngjs';

import { expect, test } from '../../fixtures/standalone';
import { preToolUseBash, sendHookEvent, sessionStartStartup } from '../../helpers/hooks';
import { expectOverlayCount } from '../../helpers/office';
import { gotoLegacyFace } from '../../helpers/standalone';
import { setSettings } from '../../helpers/webview';

/**
 * KICKOFF v1.1 item 2: "disappearing view" — changing the view, editing
 * furniture, zooming, or resizing the window made the whole office go blank
 * until a manual refresh. Root cause was OfficeCanvas.tsx's Pixi mount
 * effect re-running (dispose + recreate the Application, force-losing the
 * WebGL context) on every isEditMode/_editorTick/zoom/bayCount change (2a),
 * compounded by a dual resize-ownership bug that only self-healed by
 * accident because of how often the effect was recreating (2b). Fails on
 * pre-fix code: the old effect's dependency array included isEditMode,
 * editorState, _editorTick, zoom, panRef, and four unstable useCallback
 * results, so each trigger below would have bumped the Pixi init counter.
 */

// 2b: crisp-DPR rendering (resolution: devicePixelRatio, autoDensity: true)
// only diverges from a naive 1x canvas at dpr > 1 — force retina so the
// canvas.width === clientWidth * dpr assertion actually exercises the fix.
test.use({ deviceScaleFactor: 2 });

async function getPixiInitCount(page: import('@playwright/test').Page): Promise<number> {
  const count = await page.evaluate(() => window.__pixelAgentsTestHooks?.getPixiInitCount?.());
  expect(count).toBeDefined();
  return count as number;
}

/** Sample a dense grid across the canvas and confirm it's not all
 *  pixel-identical — a lost/blank Pixi frame renders as one uniform color
 *  (whatever's behind the transparent canvas), while real office content
 *  (floor tiles, walls, at least one character sprite) always paints more
 *  than one distinct color SOMEWHERE. A dense grid (not just center/corner
 *  points) is needed because the default camera frames the office in one
 *  corner of the canvas at this zoom — a handful of fixed sample points
 *  can miss it entirely even when rendering is working correctly. Avoids
 *  needing to read the WebGL canvas via a 2D context (which Pixi has
 *  already claimed the canvas for) — Playwright's own screenshot capture
 *  works regardless of context type. */
async function canvasShowsContent(page: import('@playwright/test').Page): Promise<boolean> {
  const buffer = await page.locator('[data-testid="office-canvas"]').screenshot();
  const png = PNG.sync.read(buffer);
  const { width, height, data } = png;
  const GRID = 12;
  const colors = new Set<string>();
  for (let gy = 0; gy < GRID; gy++) {
    for (let gx = 0; gx < GRID; gx++) {
      const x = Math.min(width - 1, Math.floor((width * (gx + 0.5)) / GRID));
      const y = Math.min(height - 1, Math.floor((height * (gy + 0.5)) / GRID));
      const idx = (width * y + x) * 4;
      colors.add(`${data[idx]},${data[idx + 1]},${data[idx + 2]}`);
      if (colors.size > 1) return true;
    }
  }
  return colors.size > 1;
}

async function grayscale(page: import('@playwright/test').Page, path: string): Promise<void> {
  await page.addStyleTag({ content: 'html { filter: grayscale(100%); }' });
  await page.screenshot({ path });
  await page.addStyleTag({ content: 'html { filter: none; }' });
}

test.describe('Standalone / disappearing view (KICKOFF v1.1 item 2)', () => {
  test('view switch, furniture edit, zoom, and resize all keep exactly one Pixi Application and a non-blank canvas @area:standalone', async ({
    page,
    standalone,
  }) => {
    // This suite counts Pixi Application mounts — a legacy-face-only
    // concept (webview-v3 has no Pixi canvas). See FACE-MERGE-PLAN Tier 3
    // (df3a039): webview-v3 is the root face post-cutover, so the shared
    // `standalone` fixture boots there and this must opt into /v1/.
    await gotoLegacyFace(page, standalone);
    await setSettings(page, {
      alwaysShowLabels: true,
      hooksEnabled: true,
      watchAllSessions: true,
      debugView: false,
    });

    const sessionId = 'standalone-disappearing-view-test-session';
    await sendHookEvent(
      standalone.hookServerConfig,
      sessionStartStartup(sessionId, standalone.workspaceDir),
    );
    await sendHookEvent(standalone.hookServerConfig, preToolUseBash(sessionId, 'npm test'));
    await expectOverlayCount(page, 1);

    const initialCount = await getPixiInitCount(page);
    expect(initialCount).toBe(1);
    expect(await canvasShowsContent(page)).toBe(true);
    await page.screenshot({ path: 'test-results/e2e/disappearing-view-00-initial.png' });
    await grayscale(page, 'test-results/e2e/disappearing-view-00-initial-grayscale.png');

    // Trigger 1: view switch (isEditMode toggle — the original G2 path).
    // EditorToolbar (and its "Paint floor tiles" tool button) only renders
    // in edit mode, so its visibility is the real signal the toggle landed.
    // "Edit office layout" moved from a native `title` attr to a
    // ControlTooltip label (KICKOFF v1.1 item 8, bc186a3) — the button's
    // accessible name is just its visible text now.
    await page.getByRole('button', { name: 'Layout', exact: true }).click();
    await expect(page.locator('button[title="Paint floor tiles"]')).toBeVisible();
    await expect.poll(() => getPixiInitCount(page)).toBe(initialCount);
    expect(await canvasShowsContent(page)).toBe(true);
    await page.screenshot({ path: 'test-results/e2e/disappearing-view-01-edit-mode.png' });
    await grayscale(page, 'test-results/e2e/disappearing-view-01-edit-mode-grayscale.png');

    // Trigger 2: furniture edit (tool change bumps _editorTick via
    // handleToolChange's setEditorTick, the second real re-run trigger).
    await page.locator('button[title="Paint floor tiles"]').click();
    await expect.poll(() => getPixiInitCount(page)).toBe(initialCount);
    expect(await canvasShowsContent(page)).toBe(true);
    await page.screenshot({ path: 'test-results/e2e/disappearing-view-02-furniture-edit.png' });
    await grayscale(page, 'test-results/e2e/disappearing-view-02-furniture-edit-grayscale.png');

    // Back to view mode before the remaining triggers.
    await page.getByRole('button', { name: 'Layout', exact: true }).click();

    // Trigger 3: zoom change.
    await page.locator('button[title="Zoom in (Ctrl+Scroll)"]').click();
    await expect.poll(() => getPixiInitCount(page)).toBe(initialCount);
    expect(await canvasShowsContent(page)).toBe(true);
    await page.screenshot({ path: 'test-results/e2e/disappearing-view-03-zoom.png' });
    await grayscale(page, 'test-results/e2e/disappearing-view-03-zoom-grayscale.png');

    // Trigger 4: window resize (2b — dual resize-ownership fix).
    const before = page.viewportSize();
    expect(before).toBeTruthy();
    await page.setViewportSize({
      width: before!.width - 200 < 400 ? before!.width + 200 : before!.width - 200,
      height: before!.height,
    });
    await page.waitForTimeout(300); // Pixi's ResizePlugin queues via rAF
    await expect.poll(() => getPixiInitCount(page)).toBe(initialCount);
    expect(await canvasShowsContent(page)).toBe(true);
    await page.screenshot({ path: 'test-results/e2e/disappearing-view-04-resize.png' });
    await grayscale(page, 'test-results/e2e/disappearing-view-04-resize-grayscale.png');

    // canvas.width (device px, Pixi-owned) must track clientWidth * dpr —
    // the exact invariant 2b's dual-ownership bug violated at dpr>1.
    const dims = await page.evaluate(() => {
      const canvas = document.querySelector(
        '[data-testid="office-canvas"]',
      ) as HTMLCanvasElement | null;
      if (!canvas) return null;
      return {
        width: canvas.width,
        clientWidth: canvas.clientWidth,
        dpr: window.devicePixelRatio || 1,
      };
    });
    expect(dims).toBeTruthy();
    expect(dims!.width).toBe(Math.round(dims!.clientWidth * dims!.dpr));

    // Pan-alone investigation (KICKOFF v1.1 item 2's mandatory repro):
    // middle-mouse drag with no zoom/edit/resize in between. Pan mutates
    // panRef.current imperatively with no re-render, so neither 2a nor 2b
    // predicts a break here — this is the "third mechanism" check.
    const canvasBox = await page.locator('[data-testid="office-canvas"]').boundingBox();
    expect(canvasBox).toBeTruthy();
    const cx = canvasBox!.x + canvasBox!.width / 2;
    const cy = canvasBox!.y + canvasBox!.height / 2;
    await page.mouse.move(cx, cy);
    await page.mouse.down({ button: 'middle' });
    await page.mouse.move(cx - 150, cy - 100, { steps: 10 });
    await page.mouse.move(cx + 250, cy + 180, { steps: 10 });
    await page.mouse.up({ button: 'middle' });
    await expect.poll(() => getPixiInitCount(page)).toBe(initialCount);
    expect(await canvasShowsContent(page)).toBe(true);
    await page.screenshot({ path: 'test-results/e2e/disappearing-view-05-pan.png' });
    await grayscale(page, 'test-results/e2e/disappearing-view-05-pan-grayscale.png');

    // Exactly one real Application instance across every trigger above.
    expect(await getPixiInitCount(page)).toBe(1);
  });
});
