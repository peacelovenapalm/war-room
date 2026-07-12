import { expect, test } from '../../fixtures/standalone';
import { gotoLegacyFace } from '../../helpers/standalone';

/**
 * KICKOFF v1.1 item 5: budget-pause visibility. Before this fix, a
 * budget-gated chain step and a "just between steps" pending step were
 * pixel-for-pixel identical — chainRunChipLabel() had no way to know the
 * gate had fired. This test drives a REAL 2-step chain through the real
 * dispatch lifecycle (no mocked budgetStore state): the standalone fixture
 * never posts a Claude rate-limit snapshot, so budgetStore's own fail-safe
 * default ('stale-snapshot') fires for real the instant step 1 exits and
 * step 2 is attempted — the exact same code path production hits with no
 * live Claude Code session reporting in.
 *
 * The standing-orders half is a constructed-state screenshot (network
 * response mocked) rather than a full 60s-real-tick wait — KICKOFF's own
 * scope note sanctions this when driving the real tick cadence end-to-end
 * would be awkward; standingOrderStatusLabel's mapping is covered for real
 * by webview-ui/test/standingOrders.test.ts's unit tests, this is purely
 * the rendered-DOM screenshot half of the PASS bar.
 */
const MACHINE = 'E2EBUDGETPAUSETEST';

interface ChainRunResponse {
  id: string;
  status: string;
  currentStep: number;
  pausedReason?: string;
  steps: Array<{ dispatchId?: string; status: string }>;
}

async function grayscale(page: import('@playwright/test').Page, path: string): Promise<void> {
  await page.addStyleTag({ content: 'html { filter: grayscale(100%); }' });
  await page.screenshot({ path });
  await page.addStyleTag({ content: 'html { filter: none; }' });
}

test.describe('Standalone / budget-pause visibility (KICKOFF v1.1 item 5)', () => {
  test('a real budget-paused chain step 2 renders distinctly from real step-1 running @area:standalone', async ({
    page,
    standalone,
  }) => {
    // webview-ui's ChainTray renders chain-run-chip as a persistent HUD
    // element; v3's equivalent lives inside the AutomationPanel modal
    // (gated on isOpen) — so this must run against the legacy face. See
    // FACE-MERGE-PLAN Tier 3 (df3a039): webview-v3 is the root face
    // post-cutover, so the shared `standalone` fixture boots there.
    await gotoLegacyFace(page, standalone);

    const base = `http://127.0.0.1:${standalone.hookServerConfig.port}`;
    const token = standalone.hookServerConfig.token;

    const defRes = await page.request.post(`${base}/api/chains/defs`, {
      data: {
        name: 'e2e-budget-pause',
        steps: [
          {
            id: 's1',
            prompt: 'first',
            machine: MACHINE,
            provider: 'claude',
            cwd: standalone.workspaceDir,
          },
          {
            id: 's2',
            prompt: 'second',
            machine: MACHINE,
            provider: 'claude',
            cwd: standalone.workspaceDir,
          },
        ],
      },
    });
    const defBody = (await defRes.json()) as { ok: boolean; def?: { id: string } };
    expect(defBody.ok).toBe(true);
    const defId = defBody.def!.id;

    const runRes = await page.request.post(`${base}/api/chains/defs/${defId}/run`);
    const runBody = (await runRes.json()) as { ok: boolean; run?: { id: string } };
    expect(runBody.ok).toBe(true);
    const runId = runBody.run!.id;

    // ── State 1: step 1 genuinely running (real dispatch, 'ringing') ──
    const chip = page.locator('[data-testid="chain-run-chip"]');
    await expect(chip).toContainText('RUNNING (step 1/2)', { timeout: 10_000 });
    const runningText = (await chip.textContent())!.trim();

    await page.screenshot({ path: 'test-results/e2e/chain-running.png' });
    await grayscale(page, 'test-results/e2e/chain-running-grayscale.png');

    // ── Accept + exit step 1 for real (same routes bin/dispatch-runner.mjs
    // itself calls) — this is what triggers chainOrchestrator to attempt
    // step 2's budget-gated auto-continuation. ──
    const runsRes = await page.request.get(`${base}/api/chains/runs`);
    const runs = (await runsRes.json()) as ChainRunResponse[];
    const run = runs.find((r) => r.id === runId);
    const step1DispatchId = run?.steps[0]?.dispatchId;
    expect(step1DispatchId).toBeDefined();

    const decisionRes = await page.request.post(
      `${base}/api/dispatch/${step1DispatchId}/decision`,
      {
        headers: { authorization: `Bearer ${token}` },
        data: { decision: 'accept' },
      },
    );
    expect(decisionRes.ok()).toBe(true);

    const statusRes = await page.request.post(`${base}/api/dispatch/${step1DispatchId}/status`, {
      headers: { authorization: `Bearer ${token}` },
      data: { event: 'exited', exitCode: 0, resultTail: 'ok' },
    });
    expect(statusRes.ok()).toBe(true);

    // ── State 2: step 2's budget-gated continuation, REAL pausedReason —
    // no fresh Claude snapshot was ever posted in this fixture, so
    // budgetStore's own fail-safe default ('stale-snapshot') fires. ──
    await expect(chip).toContainText('⏸ PAUSED — stale telemetry (step 2/2)', {
      timeout: 10_000,
    });
    const pausedText = (await chip.textContent())!.trim();

    // The exact bug this item fixes: a paused step and a step that's simply
    // "between steps" were indistinguishable. Assert they now differ.
    expect(pausedText).not.toBe(runningText);

    await page.screenshot({ path: 'test-results/e2e/chain-paused.png' });
    await grayscale(page, 'test-results/e2e/chain-paused-grayscale.png');

    // Server-side truth, not just a UI claim.
    const afterRes = await page.request.get(`${base}/api/chains/runs`);
    const afterRuns = (await afterRes.json()) as ChainRunResponse[];
    const afterRun = afterRuns.find((r) => r.id === runId);
    expect(afterRun?.pausedReason).toBe('stale-snapshot');
    expect(afterRun?.steps[1]?.status).toBe('pending'); // held, not enqueued
  });

  test('the 4 standing-order pause reasons render distinctly, not a generic string @area:standalone', async ({
    page,
    standalone,
  }) => {
    // See test 1's comment — the legacy face's StandingOrdersPanel is a
    // dedicated dock panel; v3's equivalent lives inside AutomationPanel.
    await gotoLegacyFace(page, standalone);

    // Component-level constructed-state screenshot (network response
    // mocked) — see file header for why this half doesn't drive the real
    // 60s tick cadence end-to-end.
    await page.route('**/api/standing-orders', async (route) => {
      if (route.request().method() !== 'GET') {
        await route.continue();
        return;
      }
      const reasons = ['stale-snapshot', '5h-threshold', '7d-threshold', 'codex-cap-reached'];
      const orders = reasons.map((reason, i) => ({
        id: `order-${String(i)}`,
        name: `order-${reason}`,
        schedule: { kind: 'interval', everyMs: 3_600_000 },
        prompt: 'go',
        enabled: true,
        needsFirstFireConfirm: false,
        lastSkipReason: reason,
        createdAt: 0,
        updatedAt: 0,
      }));
      await route.fulfill({ json: orders });
    });

    // "Standing orders" moved from a native `title` attr to a
    // ControlTooltip label (KICKOFF v1.1 item 8, bc186a3) — the button's
    // accessible name is just its visible text ("Orders") now.
    await page.getByRole('button', { name: 'Orders', exact: true }).click();
    const statuses = page.locator('[data-testid="standing-order-status"]');
    await expect(statuses).toHaveCount(4);
    const texts = await statuses.allTextContents();
    expect(texts).toEqual([
      '⏸ PAUSED — stale telemetry',
      '⏸ PAUSED — 5h budget',
      '⏸ PAUSED — 7d budget',
      '⏸ PAUSED — codex cap',
    ]);
    // All four distinct — no two reasons collapse to the same string.
    expect(new Set(texts).size).toBe(texts.length);

    await page.screenshot({ path: 'test-results/e2e/standing-orders-paused-reasons.png' });
    await grayscale(page, 'test-results/e2e/standing-orders-paused-reasons-grayscale.png');
  });
});
