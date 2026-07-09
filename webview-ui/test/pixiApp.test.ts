/**
 * Unit tests for pixiApp.ts's Application init/dispose contract and its
 * pixiInitCount test hook (KICKOFF v1.1 item 2 — disappearing view).
 *
 * OfficeCanvas.tsx itself isn't unit-testable here: this repo's vitest
 * config runs webview tests under `environment: 'node'` with no jsdom or
 * React Testing Library (see webview-ui/vitest.config.ts), so a component
 * can't actually be mounted/rendered. These tests instead target the exact
 * mechanism the disappearing-view bug lived in — repeated dispose+recreate
 * of the underlying Pixi Application — by mocking `pixi.js` and driving
 * startPixiApp() directly. The companion e2e test
 * (e2e/tests/standalone/disappearing-view.spec.ts) is what proves
 * OfficeCanvas.tsx itself stays at exactly one Application instance across
 * real view-switch/zoom/edit/resize interactions in a live browser — these
 * unit tests only prove the counter it reads is trustworthy, and that the
 * G2 disposed-before-init guard (commit ef5dfa8) still holds.
 *
 * Run with: npm test
 */

import assert from 'node:assert/strict';

import { beforeEach, test, vi } from 'vitest';

// pixiApp.ts reads window.devicePixelRatio (2b) — only browsers have
// `window`, and this suite runs under vitest's node environment.
vi.stubGlobal('window', { devicePixelRatio: 1 });

const { MockApplication, resetMockApplication } = vi.hoisted(() => {
  class MockApplication {
    static instances: MockApplication[] = [];
    static deferNextInit = false;

    ticker = { add: vi.fn(), remove: vi.fn() };
    destroy = vi.fn();
    initOptions: unknown;
    private deferred = false;
    private resolveInit: (() => void) | null = null;

    constructor() {
      this.deferred = MockApplication.deferNextInit;
      MockApplication.deferNextInit = false;
      MockApplication.instances.push(this);
    }

    init(options: unknown): Promise<void> {
      this.initOptions = options;
      if (!this.deferred) return Promise.resolve();
      return new Promise((resolve) => {
        this.resolveInit = resolve;
      });
    }

    releaseInit(): void {
      this.resolveInit?.();
    }
  }

  function resetMockApplication(): void {
    MockApplication.instances = [];
    MockApplication.deferNextInit = false;
  }

  return { MockApplication, resetMockApplication };
});

vi.mock('pixi.js', () => ({ Application: MockApplication }));

const { startPixiApp, getPixiInitCount } = await import('../src/office/engine/pixiApp.js');

function fakeCanvas(): HTMLCanvasElement {
  return { parentElement: null } as unknown as HTMLCanvasElement;
}

beforeEach(() => {
  resetMockApplication();
});

test('startPixiApp: a single mount/unmount cycle inits once and disposes once', async () => {
  const before = getPixiInitCount();
  const handle = startPixiApp(fakeCanvas(), { update: () => {} });
  await handle.ready;

  assert.equal(MockApplication.instances.length, 1);
  assert.equal(getPixiInitCount(), before + 1);

  handle.dispose();
  const instance = MockApplication.instances[0]!;
  assert.equal(instance.destroy.mock.calls.length, 1);
  assert.deepEqual(instance.destroy.mock.calls[0]?.[0], { removeView: false });
});

test('startPixiApp: sequential real cycles each count once', async () => {
  // Documents the counter's behavior under exactly the pattern the pre-fix
  // OfficeCanvas.tsx mount effect produced on every isEditMode/_editorTick/
  // zoom/bayCount change: repeated real dispose+recreate. The e2e test
  // asserts this counter stays at 1 across those same interactions post-fix;
  // this proves the counter itself would have caught the pre-fix bug.
  const before = getPixiInitCount();
  for (let i = 0; i < 3; i++) {
    const handle = startPixiApp(fakeCanvas(), { update: () => {} });
    await handle.ready;
    handle.dispose();
  }

  assert.equal(MockApplication.instances.length, 3);
  assert.equal(getPixiInitCount(), before + 3);
});

test('startPixiApp: dispose before init resolves destroys the instance without counting a real init (G2 guard)', async () => {
  const before = getPixiInitCount();
  MockApplication.deferNextInit = true;
  const handle = startPixiApp(fakeCanvas(), { update: () => {} });
  const instance = MockApplication.instances[0]!;

  handle.dispose();
  instance.releaseInit();
  await handle.ready.catch(() => {});

  assert.equal(getPixiInitCount(), before);
  assert.equal(instance.destroy.mock.calls.length, 1);
  assert.deepEqual(instance.destroy.mock.calls[0]?.[0], { removeView: false });
});

test('startPixiApp: passes autoDensity + resolution (devicePixelRatio) to Application.init (2b)', async () => {
  const handle = startPixiApp(fakeCanvas(), { update: () => {} });
  await handle.ready;
  const instance = MockApplication.instances[0]!;
  const options = instance.initOptions as { autoDensity?: boolean; resolution?: number };

  assert.equal(options.autoDensity, true);
  assert.equal(options.resolution, 1);

  handle.dispose();
});
