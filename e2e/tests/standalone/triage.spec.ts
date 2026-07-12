import { expect, test } from '../../fixtures/standalone';
import {
  permissionRequest,
  preToolUseBash,
  sendHookEvent,
  sessionStartStartup,
} from '../../helpers/hooks';
import { expectOverlayCount, readAgentOverlayIds } from '../../helpers/office';
import { gotoLegacyFace } from '../../helpers/standalone';
import { setSettings } from '../../helpers/webview';

/**
 * KICKOFF v1.1 item 1: crisis cards on the TRIAGE board had no click
 * handler — only the debris row's CLEAR button was interactive. Regression
 * test for TriagePanel.tsx's onOpenAgent wiring (fails on pre-fix code:
 * TriageRowView rendered a plain <div> with no onClick).
 */
test.describe('Standalone / triage board click-through', () => {
  test('clicking a crisis card opens the same agent drawer a normal click would @area:standalone', async ({
    page,
    standalone,
  }) => {
    // window.__pixelAgentsTestHooks.setCrisis and [data-testid="agent-overlay"]
    // are legacy-only — v3's TriageBoard.tsx does have a matching
    // "triage-row"/"drawer-row" testid, but there's no equivalent way to
    // force the crisis flag or read agent overlay ids (agents render on a
    // single canvas, no DOM overlay). C4-retirement-bound: a real v3 port
    // needs new instrumentation, not a selector swap.
    await gotoLegacyFace(page, standalone);
    await setSettings(page, {
      alwaysShowLabels: true,
      hooksEnabled: true,
      watchAllSessions: true,
      debugView: false,
    });

    const sessionId = 'standalone-triage-click-test-session';
    await sendHookEvent(
      standalone.hookServerConfig,
      sessionStartStartup(sessionId, standalone.workspaceDir),
    );
    await sendHookEvent(standalone.hookServerConfig, preToolUseBash(sessionId, 'npm test'));
    await expectOverlayCount(page, 1);

    // Mock a permission-denied crisis event (KICKOFF item 1's exact repro).
    await sendHookEvent(standalone.hookServerConfig, permissionRequest(sessionId));
    await expect(page.getByText('Needs approval').first()).toBeVisible();

    const [agentId] = await readAgentOverlayIds(page);
    expect(agentId).toBeDefined();

    // Force the crisis flag deterministically — see testHooks.ts setCrisis
    // doc for why (server-side crisis-escalation timing isn't this test's
    // concern; it's the same tradeoff the existing selectAgent hook makes).
    await page.evaluate((id) => {
      window.__pixelAgentsTestHooks?.setCrisis?.(id, Date.now());
    }, agentId as number);

    const triageRow = page.locator('[data-testid="triage-row"]').first();
    await expect(triageRow).toBeVisible();
    await expect(triageRow).toHaveCSS('cursor', 'pointer');

    // Before screenshot: crisis card with its hover affordance visible.
    // Full-page (not clipped) — the TRIAGE board docks top-right and its
    // width varies with row content, so a fixed clip risks missing it.
    await triageRow.hover();
    await page.screenshot({ path: 'test-results/e2e/triage-crisis-card-before.png' });
    await page.addStyleTag({ content: 'html { filter: grayscale(100%); }' });
    await page.screenshot({ path: 'test-results/e2e/triage-crisis-card-before-grayscale.png' });
    await page.addStyleTag({ content: 'html { filter: none; }' });

    // The click: same drawer a normal agent click opens (App.tsx handleClick).
    await triageRow.click();
    await expect(page.getByText(`AGENT #${agentId}`)).toBeVisible();
    await expect(page.locator('[data-testid="drawer-row"]').first()).toBeVisible();

    await page.screenshot({ path: 'test-results/e2e/triage-crisis-card-after.png' });
    await page.addStyleTag({ content: 'html { filter: grayscale(100%); }' });
    await page.screenshot({ path: 'test-results/e2e/triage-crisis-card-after-grayscale.png' });
  });
});
