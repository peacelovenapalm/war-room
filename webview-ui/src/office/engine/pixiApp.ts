import type { Ticker } from 'pixi.js';
import { Application } from 'pixi.js';

import { MAX_DELTA_TIME_SEC } from '../../constants.js';

/** @internal */
export interface PixiAppCallbacks {
  update: (dt: number) => void;
}

/** @internal */
export interface PixiAppHandle {
  /** Resolves once `Application.init()` completes (v8's init is async — the
   *  v7 synchronous constructor-options form no longer exists). Callers that
   *  need the live `Application` to build the scene graph await this. */
  ready: Promise<Application>;
  /** Stops the ticker and tears down the renderer. Safe to call before
   *  `ready` resolves — init is aborted and the instance destroyed once it
   *  lands, so a fast unmount (React StrictMode double-invoke) can't leak. */
  dispose: () => void;
}

/**
 * Boots a PixiJS Application onto an existing `<canvas>` element and drives
 * `callbacks.update(dt)` off the Pixi ticker. Replaces `gameLoop.ts`'s
 * `startGameLoop` — same dt-clamping contract (`MAX_DELTA_TIME_SEC`), but the
 * "render" half is gone: `renderFrame`'s Pixi port mutates the scene graph
 * directly, and Pixi's own render pass runs automatically each tick.
 */
let pixiInitCount = 0;

/** @internal test-only — see testHooks.ts's getPixiInitCount. Monotonic count
 *  of completed real `Application.init()` calls, i.e. actual dispose+recreate
 *  cycles (NOT one per render, NOT the disposed-before-init-resolved throw
 *  path below, which never yields a usable app). KICKOFF v1.1 item 2's e2e
 *  PASS check reads this to assert exactly one Application instance exists
 *  across view-switch/zoom/edit/resize interactions. */
export function getPixiInitCount(): number {
  return pixiInitCount;
}

export function startPixiApp(
  canvas: HTMLCanvasElement,
  callbacks: PixiAppCallbacks,
): PixiAppHandle {
  let disposed = false;
  let app: Application | null = null;
  let tickerFn: ((ticker: Ticker) => void) | null = null;

  const ready = (async () => {
    const instance = new Application();
    await instance.init({
      canvas,
      resizeTo: canvas.parentElement ?? undefined,
      antialias: false,
      roundPixels: true,
      backgroundAlpha: 0,
      // KICKOFF v1.1 item 2b — crisp DPR is Greg's stated default (the
      // office was rendering blurry 1x on retina). `autoDensity: true`
      // makes Pixi's own CanvasSource own BOTH canvas.width/height (device
      // px, `resolution`x) and canvas.style.width/height (CSS px) on every
      // resize, whether triggered by the ResizePlugin's window-resize
      // listener or by OfficeCanvas.tsx's ResizeObserver calling
      // `renderer.resize()` directly (container-only resizes the
      // ResizePlugin can't see — see OfficeCanvas.tsx's mount effect).
      // Verified against this repo's actual pixi.js@8.19.0 source
      // (CanvasSource.resizeCanvas / TextureSource.resize), not assumed.
      resolution: window.devicePixelRatio || 1,
      autoDensity: true,
    });

    if (disposed) {
      // removeView must stay false — the <canvas> DOM node belongs to
      // React (mounted/unmounted via the ref), never to Pixi. `true` here
      // physically detaches the canvas from the document; a later
      // startPixiApp() call reusing the same ref then initializes onto an
      // orphaned node React never re-inserts, leaving the office
      // permanently blank on the next dispose+recreate cycle. Historically
      // this fired on every isEditMode/_editorTick change in
      // OfficeCanvas.tsx's mount-effect deps (found via a real-browser G2
      // build-mode screenshot repro) — KICKOFF v1.1 item 2a restructured
      // that effect to run once per mount/unmount, so in normal operation
      // this guard now only protects the fast-unmount race (component
      // unmounts while `instance.init()` is still in flight), not a
      // per-interaction recreate storm. Kept regardless — a fast unmount
      // can still race init on any single mount.
      instance.destroy({ removeView: false }, { children: true, texture: false });
      throw new Error('pixiApp: disposed before init resolved');
    }

    tickerFn = (ticker: Ticker) => {
      const dt = Math.min(ticker.deltaMS / 1000, MAX_DELTA_TIME_SEC);
      callbacks.update(dt);
    };
    instance.ticker.add(tickerFn);
    app = instance;
    pixiInitCount += 1;
    return instance;
  })();
  // Callers that only care about `dispose()` (e.g. a component that
  // unmounted before init landed) never touch `ready` — swallow the
  // synthetic rejection above so it doesn't surface as unhandled.
  ready.catch(() => {});

  return {
    ready,
    dispose: () => {
      disposed = true;
      if (app) {
        if (tickerFn) app.ticker.remove(tickerFn);
        // removeView: false — see the matching comment above; React owns
        // the canvas element's DOM lifecycle, not Pixi.
        app.destroy({ removeView: false }, { children: true, texture: false });
        app = null;
      }
    },
  };
}
