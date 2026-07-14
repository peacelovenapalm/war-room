/**
 * E2E observability hooks, installed only under the Playwright harness
 * (runtime.ts isE2E). The DPR-3 e2e (e2e/v3/dpr.spec.ts) polls these to
 * know when the world has painted instead of sleeping.
 */

import type { AssetStoreStats } from './assets/loader';
import type { CameraState } from './engine/camera';
import { isE2E } from './runtime';

export interface WarRoomV3TestHooks {
  getRenderCount: () => number;
  getAgentCount: () => number;
  getResolution: () => number;
  getBackingResizeCount: () => number;
  getCameraState: () => CameraState | null;
  /** Real-sprite asset store stats (KICKOFF-v3.1 "wire real sprites in") —
   *  chunksLoaded > 0 on a store means at least one real sheet decoded and
   *  is available to draw with, not just placeholder fallback art. */
  getAssetStats: () => {
    props: AssetStoreStats;
    characters: AssetStoreStats;
    images: AssetStoreStats;
  };
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
