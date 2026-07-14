import type { CameraState, Size } from '../engine/camera';

export interface ChipFrame {
  camera: CameraState;
  cssSize: Size;
}

export interface WorldFrameStore {
  getSnapshot: () => ChipFrame | null;
  publish: (frame: ChipFrame) => void;
  subscribe: (listener: () => void) => () => void;
}

export function createWorldFrameStore(): WorldFrameStore {
  let current: ChipFrame | null = null;
  const listeners = new Set<() => void>();
  return {
    getSnapshot: () => current,
    publish: (frame) => {
      if (
        current !== null &&
        current.camera.zoom === frame.camera.zoom &&
        current.camera.offsetX === frame.camera.offsetX &&
        current.camera.offsetY === frame.camera.offsetY &&
        current.cssSize.width === frame.cssSize.width &&
        current.cssSize.height === frame.cssSize.height
      ) {
        return;
      }
      current = frame;
      for (const listener of listeners) listener();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
