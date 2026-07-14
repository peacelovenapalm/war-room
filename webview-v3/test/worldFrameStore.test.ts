import { describe, expect, it, vi } from 'vitest';

import { createWorldFrameStore } from '../src/state/worldFrameStore';

describe('world frame store', () => {
  it('publishes changed camera frames without notifying for identical paints', () => {
    const store = createWorldFrameStore();
    const listener = vi.fn();
    store.subscribe(listener);
    const frame = {
      camera: { zoom: 1, offsetX: 2, offsetY: 3 },
      cssSize: { width: 800, height: 600 },
    };

    store.publish(frame);
    store.publish({ camera: { ...frame.camera }, cssSize: { ...frame.cssSize } });
    expect(listener).toHaveBeenCalledTimes(1);

    store.publish({ ...frame, camera: { ...frame.camera, offsetX: 4 } });
    expect(listener).toHaveBeenCalledTimes(2);
    expect(store.getSnapshot()?.camera.offsetX).toBe(4);
  });
});
