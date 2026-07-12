import { expect, test } from '../../fixtures/standalone';
import { preToolUseBash, sendHookEvent, sessionStartStartup } from '../../helpers/hooks';
import { expectOverlayCount, readAgentOverlayIds } from '../../helpers/office';
import { gotoLegacyFace } from '../../helpers/standalone';
import { setSettings } from '../../helpers/webview';

/**
 * KICKOFF v1.1 item 3: worker session kill. AgentDrawer's KILL button has
 * three visible states — enabled (known pid + live runner), ⚠ CONFIRM
 * (two-step, mirrors StopAllControl), and disabled + a shape+word reason
 * (colorblind rule) when no pid/runner is known. This drives all three,
 * plus the killed dispatch's distinct terminal state (server-verified, not
 * just a UI claim), and screenshots each (grayscale copies included per
 * Hard Rule 3).
 *
 * `openAgentDrawer` (App.tsx test hook) drives the exact function a real
 * canvas click on an agent takes — same tradeoff testHooks.ts's
 * selectAgent/setCrisis already make (avoids pixel-hunting the Pixi
 * canvas's own hit-test, which is geometry-brittle by this file's own
 * established convention).
 */
const MACHINE = 'E2EKILLTEST';

async function openDrawer(page: import('@playwright/test').Page, agentId: number): Promise<void> {
  await page.evaluate((id) => {
    window.__pixelAgentsTestHooks?.openAgentDrawer?.(id);
  }, agentId);
  await expect(page.getByText(`AGENT #${agentId}`)).toBeVisible();
}

test.describe('Standalone / worker session kill (AgentDrawer)', () => {
  test('kill button: disabled+reason with no pid, then enabled -> CONFIRM -> KILLED once machine+pid telemetry and a live runner exist @area:standalone', async ({
    page,
    standalone,
  }) => {
    // window.__pixelAgentsTestHooks.openAgentDrawer and
    // [data-testid="agent-overlay"] / "kill-control" are legacy-only — v3's
    // AgentDrawer.tsx has its own drawer (testid "agent-drawer"/"drawer-kill")
    // but no equivalent open-by-id test hook or DOM agent overlay to drive
    // it from (agents render on a single canvas). C4-retirement-bound: a
    // real v3 port needs new instrumentation, not a selector swap.
    await gotoLegacyFace(page, standalone);
    await setSettings(page, {
      alwaysShowLabels: true,
      hooksEnabled: true,
      watchAllSessions: true,
      debugView: false,
    });

    // ── Register a live runner for MACHINE up front (real POST
    // /api/dispatch/poll, same route bin/dispatch-runner.mjs itself calls —
    // no browser-side route mocking, consistent with this fixture's
    // real-server philosophy). Done BEFORE either drawer ever opens:
    // AgentDrawer's own machines-list fetch effect depends only on
    // `isOpen`, not on which agent is showing, so switching agents while
    // the drawer stays open never re-fetches — registering late would race
    // a stale empty machines snapshot from the first open. ──
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

    // ── State 1: no pid telemetry at all -> KILL disabled, "NO PID" ──
    const noPidSession = 'kill-test-no-pid-session';
    await sendHookEvent(
      standalone.hookServerConfig,
      sessionStartStartup(noPidSession, standalone.workspaceDir),
    );
    await sendHookEvent(standalone.hookServerConfig, preToolUseBash(noPidSession, 'npm test'));
    await expectOverlayCount(page, 1);
    const [noPidAgentId] = await readAgentOverlayIds(page);
    expect(noPidAgentId).toBeDefined();

    await openDrawer(page, noPidAgentId as number);
    const killControl = page.locator('[data-testid="kill-control"]');
    await expect(killControl).toBeDisabled();
    await expect(page.locator('[data-testid="kill-disabled-reason"]')).toHaveText(
      '⚠ NO PID — use COPY ID',
    );

    await page.screenshot({ path: 'test-results/e2e/kill-disabled-before.png' });
    await page.addStyleTag({ content: 'html { filter: grayscale(100%); }' });
    await page.screenshot({ path: 'test-results/e2e/kill-disabled-before-grayscale.png' });
    await page.addStyleTag({ content: 'html { filter: none; }' });
    await page.keyboard.press('Escape');

    // ── State 2: a session tagged with real machine+pid telemetry (X-Machine
    // + X-Pid headers, the same headers the real hook forwarder sends) ──
    const withPidSession = 'kill-test-with-pid-session';
    const pid = 424242;
    const sessionStartRes = await page.request.post(
      `http://127.0.0.1:${standalone.hookServerConfig.port}/api/hooks/claude`,
      {
        headers: {
          authorization: `Bearer ${standalone.hookServerConfig.token}`,
          'x-machine': MACHINE,
          'x-pid': String(pid),
          'content-type': 'application/json',
        },
        data: { session_id: withPidSession, hook_event_name: 'SessionStart', source: 'startup' },
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
          session_id: withPidSession,
          hook_event_name: 'PreToolUse',
          tool_name: 'Bash',
          tool_input: { command: 'npm test' },
        },
      },
    );
    expect(preToolRes.ok()).toBe(true);

    await expectOverlayCount(page, 2);
    const overlayIds = await readAgentOverlayIds(page);
    const withPidAgentId = overlayIds.find((id) => id !== noPidAgentId);
    expect(withPidAgentId).toBeDefined();

    await openDrawer(page, withPidAgentId as number);
    await expect(page.locator('[data-testid="kill-disabled-reason"]')).toHaveCount(0);
    await expect(killControl).toBeEnabled();
    await expect(killControl).toHaveText('✕ Kill');

    await page.screenshot({ path: 'test-results/e2e/kill-enabled.png' });
    await page.addStyleTag({ content: 'html { filter: grayscale(100%); }' });
    await page.screenshot({ path: 'test-results/e2e/kill-enabled-grayscale.png' });
    await page.addStyleTag({ content: 'html { filter: none; }' });

    // First click -> two-step confirm (StopAllControl's own pattern).
    await killControl.click();
    await expect(killControl).toHaveText('⚠ CONFIRM');

    await page.screenshot({ path: 'test-results/e2e/kill-confirm.png' });
    await page.addStyleTag({ content: 'html { filter: grayscale(100%); }' });
    await page.screenshot({ path: 'test-results/e2e/kill-confirm-grayscale.png' });
    await page.addStyleTag({ content: 'html { filter: none; }' });

    // Second click -> fires the real POST /api/agents/kill.
    const killReqPromise = page.waitForResponse(
      (res) => res.url().endsWith('/api/agents/kill') && res.request().method() === 'POST',
    );
    await killControl.click();
    const killRes = await killReqPromise;
    const killBody = (await killRes.json()) as { ok: boolean; id: string };
    expect(killBody.ok).toBe(true);
    await expect(killControl).toHaveText('⏳ KILLING…');

    // Simulate the runner's real report (the same Bearer-authed POST
    // bin/dispatch-runner.mjs's processPidKillStop sends after a REAL
    // verified SIGTERM — see bin/test/dispatch-runner.test.mjs for the
    // real-process end-to-end proof of THAT side of the contract).
    const reportRes = await page.request.post(
      `http://127.0.0.1:${standalone.hookServerConfig.port}/api/pid-kills/${killBody.id}/status`,
      {
        headers: {
          authorization: `Bearer ${standalone.hookServerConfig.token}`,
          'content-type': 'application/json',
        },
        data: { event: 'killed' },
      },
    );
    expect(reportRes.ok()).toBe(true);

    await expect(killControl).toHaveText('✕ KILLED', { timeout: 5_000 });

    await page.screenshot({ path: 'test-results/e2e/kill-killed.png' });
    await page.addStyleTag({ content: 'html { filter: grayscale(100%); }' });
    await page.screenshot({ path: 'test-results/e2e/kill-killed-grayscale.png' });
  });
});
