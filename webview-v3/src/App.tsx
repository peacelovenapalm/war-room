import { useCallback, useEffect, useRef, useState } from 'react';

import { fitToView } from './engine/camera';
import { mapWorldBounds } from './engine/iso';
import { renderWorld } from './engine/renderer';
import { getCanvasResolution } from './engine/resolution';
import {
  buildProps,
  DEFAULT_COLS,
  DEFAULT_MAX_ELEVATION,
  DEFAULT_ROWS,
  type Occupant,
} from './engine/world';
import { installTestHooksIfE2E } from './testHooks';

/**
 * Stage-1 iso foundation face: HUD strip (DOM) over the placeholder iso
 * floor (canvas). Skeleton-first: the world paints immediately from
 * procedural placeholders — no asset or server required for first paint.
 */
export default function App() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const renderCountRef = useRef(0);
  const lastResolutionRef = useRef(0);
  const lastCameraRef = useRef<ReturnType<typeof fitToView> | null>(null);

  const [grayscale, setGrayscale] = useState(false);
  const [occupants] = useState<readonly Occupant[]>([]);
  const occupantsRef = useRef(occupants);

  const draw = useCallback(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;
    const rect = container.getBoundingClientRect();
    const cssSize = { width: Math.max(1, rect.width), height: Math.max(1, rect.height) };

    // The ONE density read (engine/resolution.ts) sizes the backing store…
    const resolution = getCanvasResolution();
    canvas.width = Math.round(cssSize.width * resolution);
    canvas.height = Math.round(cssSize.height * resolution);
    canvas.style.width = `${String(cssSize.width)}px`;
    canvas.style.height = `${String(cssSize.height)}px`;

    // …while the camera is pure fit-to-view: CSS size vs map size, no DPR.
    const bounds = mapWorldBounds(DEFAULT_COLS, DEFAULT_ROWS, DEFAULT_MAX_ELEVATION);
    const camera = fitToView(cssSize, bounds);

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    renderWorld(ctx, {
      cssSize,
      resolution,
      camera,
      cols: DEFAULT_COLS,
      rows: DEFAULT_ROWS,
      props: buildProps(occupantsRef.current),
    });
    renderCountRef.current += 1;
    lastResolutionRef.current = resolution;
    lastCameraRef.current = camera;
  }, []);

  // Redraw on container resize (covers first mount too).
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const observer = new ResizeObserver(() => {
      draw();
    });
    observer.observe(container);
    draw();
    return () => {
      observer.disconnect();
    };
  }, [draw]);

  // Redraw when occupancy changes (ref keeps `draw` stable for the observer).
  useEffect(() => {
    occupantsRef.current = occupants;
    draw();
  }, [draw, occupants]);

  useEffect(() => {
    installTestHooksIfE2E({
      getRenderCount: () => renderCountRef.current,
      getAgentCount: () => occupantsRef.current.length,
      getResolution: () => lastResolutionRef.current,
      getCameraState: () => lastCameraRef.current,
    });
  }, []);

  return (
    <div className={grayscale ? 'app grayscale' : 'app'}>
      <header className="hud">
        <span className="brand">WAR ROOM · V3</span>
        <span className="chip" data-testid="hud-agents">
          ◉ AGENTS {occupants.length}
        </span>
        <button
          type="button"
          aria-pressed={grayscale}
          onClick={() => {
            setGrayscale((value) => !value);
          }}
        >
          ◑ GRAYSCALE {grayscale ? 'ON' : 'OFF'}
        </button>
      </header>
      <div className="world" ref={containerRef}>
        <canvas data-testid="iso-canvas" ref={canvasRef} />
      </div>
    </div>
  );
}
