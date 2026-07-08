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
    });

    if (disposed) {
      instance.destroy(true, { children: true, texture: false });
      throw new Error('pixiApp: disposed before init resolved');
    }

    tickerFn = (ticker: Ticker) => {
      const dt = Math.min(ticker.deltaMS / 1000, MAX_DELTA_TIME_SEC);
      callbacks.update(dt);
    };
    instance.ticker.add(tickerFn);
    app = instance;
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
        app.destroy(true, { children: true, texture: false });
        app = null;
      }
    },
  };
}
