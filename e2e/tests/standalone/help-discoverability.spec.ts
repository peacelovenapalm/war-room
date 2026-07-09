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
 * KICKOFF v1.1 item 8: help/discoverability. Covers all three pieces —
 * ControlTooltip hover+focus popups on the ~10 most-used controls,
 * RotatingTip (single data file, rotatingTips.ts), and the categorized
 * HelpModal quick-menu that replaced the old always-fully-expanded list.
 */

const DESKTOP_VIEWPORT = { width: 1280, height: 800 };
const MOBILE_VIEWPORT = { width: 390, height: 844 };
const MACHINE = 'E2EHELPTEST';

async function grayscale(page: Page, path: string): Promise<void> {
  await page.addStyleTag({ content: 'html { filter: grayscale(100%); }' });
  await page.screenshot({ path });
  await page.addStyleTag({ content: 'html { filter: none; }' });
}

/** Hovers `trigger`, asserts the popup with `expectedText` is visible, then
 *  moves away and asserts it hides again; then repeats via keyboard focus
 *  instead of the mouse — the exact gap `title` alone can't cover. */
async function assertHoverAndFocusTooltip(
  page: Page,
  trigger: import('@playwright/test').Locator,
  expectedText: string,
): Promise<void> {
  const tooltip = page.locator('[data-testid="control-tooltip"]', { hasText: expectedText });

  await trigger.hover();
  await expect(tooltip).toBeVisible();
  // Move the mouse elsewhere (not just off `trigger`) so hover genuinely ends.
  await page.mouse.move(1, 1);
  await expect(tooltip).toBeHidden();

  await trigger.focus();
  await expect(tooltip).toBeVisible();
  await trigger.blur();
  await expect(tooltip).toBeHidden();
}

test.describe('Standalone / help discoverability (KICKOFF v1.1 item 8)', () => {
  test('tooltips on the ~10 most-used controls appear on hover AND keyboard focus @area:standalone', async ({
    page,
    standalone,
  }) => {
    await page.setViewportSize(DESKTOP_VIEWPORT);
    await setSettings(page, {
      alwaysShowLabels: true,
      hooksEnabled: true,
      watchAllSessions: true,
      debugView: false,
    });

    // ── 1-6: BottomToolbar controls (Call, Chains, Orders, Layout, Help,
    // Settings) — always present, no session setup needed. ──
    await assertHoverAndFocusTooltip(
      page,
      page.getByRole('button', { name: 'Call' }),
      'Call a coworker',
    );
    await assertHoverAndFocusTooltip(
      page,
      page.getByRole('button', { name: 'Chains' }),
      'Build and dispatch multi-step chains',
    );
    await assertHoverAndFocusTooltip(
      page,
      page.getByRole('button', { name: 'Orders' }),
      'Standing orders',
    );
    await assertHoverAndFocusTooltip(
      page,
      page.getByRole('button', { name: 'Layout' }),
      'Edit office layout',
    );
    await assertHoverAndFocusTooltip(
      page,
      page.getByRole('button', { name: 'Settings' }),
      'Settings',
    );
    await assertHoverAndFocusTooltip(
      page,
      page.getByRole('button', { name: 'Help' }),
      'Help (press ?)',
    );

    // ── 7: Zoom controls (top-left HUD stack). ──
    await assertHoverAndFocusTooltip(
      page,
      page.locator('[data-testid="zoom-controls"] button').first(),
      'Zoom in / out (Ctrl+Scroll)',
    );

    // ── 8: Economy HUD chip (top-right HUD stack) — the tooltip trigger is
    // a dedicated focusable+hoverable wrapper (the display spans inside are
    // plain, non-focusable text), not the outer click-through container. ──
    await assertHoverAndFocusTooltip(
      page,
      page.locator('[data-testid="economy-hud-tooltip-trigger"]'),
      'Cash + Reputation',
    );

    await page.screenshot({
      path: 'test-results/e2e/help-discoverability-desktop-toolbar-tooltip.png',
    });
    await grayscale(
      page,
      'test-results/e2e/help-discoverability-desktop-toolbar-tooltip-grayscale.png',
    );

    // ── 9: Kill control in AgentDrawer — needs a session with known
    // machine+pid and a live runner (same setup as kill.spec.ts). ──
    const pollRes = await page.request.post(
      `http://127.0.0.1:${standalone.hookServerConfig.port}/api/dispatch/poll`,
      {
        headers: {
          authorization: `Bearer ${standalone.hookServerConfig.token}`,
          'x-machine': MACHINE,
          'content-type': 'application/json',
        },
        data: { providers: ['claude'], roots: [standalone.workspaceDir], focus: false },
      },
    );
    expect(pollRes.ok()).toBe(true);

    const pid = 555111;
    const killSession = 'help-discoverability-kill-session';
    const sessionStartRes = await page.request.post(
      `http://127.0.0.1:${standalone.hookServerConfig.port}/api/hooks/claude`,
      {
        headers: {
          authorization: `Bearer ${standalone.hookServerConfig.token}`,
          'x-machine': MACHINE,
          'x-pid': String(pid),
          'content-type': 'application/json',
        },
        data: { session_id: killSession, hook_event_name: 'SessionStart', source: 'startup' },
      },
    );
    expect(sessionStartRes.ok()).toBe(true);
    const preToolRes = await page.request.post(
      `http://127.0.0.1:${standalone.hookServerConfig.port}/api/hooks/claude`,
      {
        headers: {
          authorization: `Bearer ${standalone.hookServerConfig.token}`,
          'x-machine': MACHINE,
          'x-pid': String(pid),
          'content-type': 'application/json',
        },
        data: {
          session_id: killSession,
          hook_event_name: 'PreToolUse',
          tool_name: 'Bash',
          tool_input: { command: 'npm test' },
        },
      },
    );
    expect(preToolRes.ok()).toBe(true);

    await expectOverlayCount(page, 1);
    const [killAgentId] = await readAgentOverlayIds(page);
    expect(killAgentId).toBeDefined();

    await page.evaluate((id) => {
      window.__pixelAgentsTestHooks?.openAgentDrawer?.(id);
    }, killAgentId as number);
    await expect(page.getByText(`AGENT #${killAgentId}`)).toBeVisible();

    const killControl = page.locator('[data-testid="kill-control"]');
    await expect(killControl).toBeEnabled();
    await assertHoverAndFocusTooltip(page, killControl, "End this worker's session for real");
    // Escape only closes HelpModal (App.tsx's global keydown handler) — the
    // AgentDrawer modal closes via its own "x" button, or its backdrop stays
    // up and swallows every subsequent hover/click in the test. Several "x"
    // buttons exist on screen (VersionIndicator, first-run tooltip), so
    // scope to this modal's own header (Modal.tsx: title span + "x" button
    // are siblings).
    await page
      .getByText(`AGENT #${killAgentId}`, { exact: true })
      .locator('..')
      .getByRole('button', { name: 'x', exact: true })
      .click();
    await expect(page.getByText(`AGENT #${killAgentId}`)).toBeHidden();

    // ── 10: crisis/TRIAGE row — mock a permission-denied crisis (same
    // repro item 1's regression test uses). ──
    const crisisSession = 'help-discoverability-crisis-session';
    await sendHookEvent(
      standalone.hookServerConfig,
      sessionStartStartup(crisisSession, standalone.workspaceDir),
    );
    await sendHookEvent(standalone.hookServerConfig, preToolUseBash(crisisSession, 'npm test'));
    await expectOverlayCount(page, 2);
    await sendHookEvent(standalone.hookServerConfig, permissionRequest(crisisSession));
    const overlayIds = await readAgentOverlayIds(page);
    const crisisAgentId = overlayIds.find((id) => id !== killAgentId);
    expect(crisisAgentId).toBeDefined();
    await page.evaluate((id) => {
      window.__pixelAgentsTestHooks?.setCrisis?.(id, Date.now());
    }, crisisAgentId as number);

    const triageRow = page.locator('[data-testid="triage-row"]').first();
    await expect(triageRow).toBeVisible();
    await assertHoverAndFocusTooltip(page, triageRow, "Click to open this agent's session");

    await page.screenshot({
      path: 'test-results/e2e/help-discoverability-desktop-triage-tooltip.png',
    });
    await grayscale(
      page,
      'test-results/e2e/help-discoverability-desktop-triage-tooltip-grayscale.png',
    );

    // ── Rotating tip: loads from the single data file (rotatingTips.ts),
    // not a hardcoded string duplicated in this test. ──
    const realTips = await page.evaluate(() => window.__pixelAgentsTestHooks?.getRotatingTips?.());
    expect(realTips).toBeDefined();
    expect((realTips as string[]).length).toBeGreaterThanOrEqual(15);
    expect((realTips as string[]).length).toBeLessThanOrEqual(20);
    const tipEl = page.locator('[data-testid="rotating-tip"]');
    await expect(tipEl).toBeVisible();
    const shownText = (await tipEl.textContent())!.replace(/^TIP\s*/, '').trim();
    expect(realTips as string[]).toContain(shownText);

    await page.screenshot({
      path: 'test-results/e2e/help-discoverability-desktop-rotating-tip.png',
    });
    await grayscale(
      page,
      'test-results/e2e/help-discoverability-desktop-rotating-tip-grayscale.png',
    );

    // ── Categorized quick-menu: every category renders, and expanding one
    // reveals its (unmodified) existing help sections. ──
    await page.getByRole('button', { name: 'Help' }).click();
    const expectedSlugs = [
      'signals',
      'dispatch',
      'progress-economy',
      'office-life',
      'briefing',
      'sound',
    ];
    for (const slug of expectedSlugs) {
      await expect(page.locator(`[data-testid="help-category-${slug}"]`)).toBeVisible();
    }
    await page.locator('[data-testid="help-category-toggle-signals"]').click();
    await expect(page.locator('[data-testid="help-section-state-chips"]')).toBeVisible();

    await page.screenshot({ path: 'test-results/e2e/help-discoverability-desktop-quick-menu.png' });
    await grayscale(page, 'test-results/e2e/help-discoverability-desktop-quick-menu-grayscale.png');
  });

  test('quick-menu and rotating tip render at the iPhone-14 viewport @area:standalone', async ({
    page,
    standalone: _standalone,
  }) => {
    await page.setViewportSize(MOBILE_VIEWPORT);
    await setSettings(page, {
      alwaysShowLabels: true,
      hooksEnabled: true,
      watchAllSessions: true,
      debugView: false,
    });
    await page.waitForTimeout(300);

    const tipEl = page.locator('[data-testid="rotating-tip"]');
    await expect(tipEl).toBeVisible();
    const realTips = await page.evaluate(() => window.__pixelAgentsTestHooks?.getRotatingTips?.());
    const shownText = (await tipEl.textContent())!.replace(/^TIP\s*/, '').trim();
    expect(realTips as string[]).toContain(shownText);

    await page.screenshot({
      path: 'test-results/e2e/help-discoverability-mobile-rotating-tip.png',
    });
    await grayscale(
      page,
      'test-results/e2e/help-discoverability-mobile-rotating-tip-grayscale.png',
    );

    const helpButton = page.getByRole('button', { name: 'Help' });
    await assertHoverAndFocusTooltip(page, helpButton, 'Help (press ?)');
    await helpButton.click();

    const expectedSlugs = [
      'signals',
      'dispatch',
      'progress-economy',
      'office-life',
      'briefing',
      'sound',
    ];
    for (const slug of expectedSlugs) {
      await expect(page.locator(`[data-testid="help-category-${slug}"]`)).toBeVisible();
    }
    await page.locator('[data-testid="help-category-toggle-dispatch"]').click();
    await expect(page.locator('[data-testid="help-section-dispatch"]')).toBeVisible();

    await page.screenshot({ path: 'test-results/e2e/help-discoverability-mobile-quick-menu.png' });
    await grayscale(page, 'test-results/e2e/help-discoverability-mobile-quick-menu-grayscale.png');
  });
});
