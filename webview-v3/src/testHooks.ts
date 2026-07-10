/**
 * E2E observability hooks, installed only under the Playwright harness
 * (runtime.ts isE2E). The DPR-3 e2e (e2e/v3/dpr.spec.ts) polls these to
 * know when the world has painted instead of sleeping.
 */

import type { CameraState } from './engine/camera';
import { isE2E } from './runtime';

export interface WarRoomV3TestHooks {
  getRenderCount: () => number;
  getAgentCount: () => number;
  getResolution: () => number;
  getCameraState: () => CameraState | null;
}

declare global {
  interface Window {
    __warRoomV3TestHooks?: WarRoomV3TestHooks;
  }
}

export function installTestHooksIfE2E(hooks: WarRoomV3TestHooks): void {
  if (!isE2E) return;
  window.__warRoomV3TestHooks = hooks;
}
