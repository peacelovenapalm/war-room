import { useCallback, useEffect, useRef, useState } from 'react';

import { fitToView, worldToCanvas } from '../engine/camera';
import {
  DISTRICT_PLOTS,
  districtSceneBounds,
  drawDistrictScene,
  hitTestDistrict,
  plotWorldCenter,
} from '../engine/districtScene';
import { getCanvasResolution } from '../engine/resolution';
import {
  type DistrictProject,
  DISTRICTS_POLL_MS,
  type DistrictsSnapshot,
  districtStatusGlyph,
  fetchDistricts,
  formatDistrictActivity,
  formatDistrictPhase,
  formatDistrictProgress,
  isDistrictUnknown,
} from '../net/districtFacts';
import { Modal } from './Modal';

export interface DistrictsViewProps {
  isOpen: boolean;
  onClose: () => void;
}

/** DOM plaque position over the canvas — computed from the same
 *  fit-to-view camera the canvas drew with, so the label always sits over
 *  its own building regardless of container size. */
interface PlaquePoint {
  key: string;
  x: number;
  y: number;
}

function InfoCard({ project }: { project: DistrictProject }) {
  const unknown = isDistrictUnknown(project);
  return (
    <div className="districts__info" data-testid="districts-info-card">
      <div className="districts__info-head">
        <span>{districtStatusGlyph(project.progress)}</span>
        <strong>{project.label}</strong>
      </div>
      {unknown ? (
        <div className="modal__warn" data-testid="districts-unknown">
          ⊘ NO DATA — no STATE.md configured for this district on this deployment
        </div>
      ) : (
        <>
          <div>Phase: {formatDistrictPhase(project.phase)}</div>
          <div>Progress: {formatDistrictProgress(project.progress)}</div>
          <div className="modal__muted">
            Last activity: {formatDistrictActivity(project.lastActivity)}
          </div>
        </>
      )}
    </div>
  );
}

/**
 * DISTRICTS view (Phase 5 Lane C, T7/D-35 "districts = projects"): a
 * canvas-rendered, zoomed-out world layer showing the v4 proof slice's 2
 * seed districts (war-room, TWE) as building clusters whose floor count
 * reflects real milestone progress from GET /api/districts. Reuses the
 * office scene's own iso/camera/placeholder-box machinery rather than a
 * second rendering system. Reachable from PanelDock (own dock entry) —
 * the office scene itself is completely untouched; this is an independent
 * overlay, not a mode-swap of the main canvas.
 */
export function DistrictsView({ isOpen, onClose }: DistrictsViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [snapshot, setSnapshot] = useState<DistrictsSnapshot | null>(null);
  const [error, setError] = useState(false);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [plaques, setPlaques] = useState<PlaquePoint[]>([]);
  const cameraRef = useRef<ReturnType<typeof fitToView> | null>(null);

  const draw = useCallback(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;
    const rect = container.getBoundingClientRect();
    const cssSize = { width: Math.max(1, rect.width), height: Math.max(1, rect.height) };
    const resolution = getCanvasResolution();
    canvas.width = Math.round(cssSize.width * resolution);
    canvas.height = Math.round(cssSize.height * resolution);
    canvas.style.width = `${String(cssSize.width)}px`;
    canvas.style.height = `${String(cssSize.height)}px`;

    const bounds = districtSceneBounds();
    const camera = fitToView(cssSize, bounds);
    cameraRef.current = camera;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.save();
    ctx.scale(resolution, resolution);
    ctx.clearRect(0, 0, cssSize.width, cssSize.height);
    drawDistrictScene(ctx, snapshot?.projects ?? []);
    ctx.restore();

    setPlaques(
      DISTRICT_PLOTS.map((plot) => {
        const { worldX, worldY } = plotWorldCenter(plot);
        const point = worldToCanvas(camera, worldX, worldY);
        return { key: plot.key, x: point.x, y: point.y };
      }),
    );
  }, [snapshot]);

  // Reset per-open state (adjust-while-rendering, not an effect — mirrors
  // GraphSearchPanel's wasOpen pattern).
  const [wasOpen, setWasOpen] = useState(isOpen);
  if (isOpen !== wasOpen) {
    setWasOpen(isOpen);
    if (isOpen) {
      setSelectedKey(null);
      setError(false);
    }
  }

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    const load = () => {
      void fetchDistricts().then((data) => {
        if (cancelled) return;
        if (data) {
          setSnapshot(data);
          setError(false);
        } else {
          setError(true);
        }
      });
    };
    load();
    const interval = setInterval(load, DISTRICTS_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const container = containerRef.current;
    if (!container) return;
    const observer = new ResizeObserver(draw);
    observer.observe(container);
    draw();
    return () => {
      observer.disconnect();
    };
  }, [isOpen, draw]);

  const handleCanvasClick = useCallback((e: { clientX: number; clientY: number }) => {
    const canvas = canvasRef.current;
    const camera = cameraRef.current;
    if (!canvas || !camera) return;
    const rect = canvas.getBoundingClientRect();
    const canvasX = e.clientX - rect.left;
    const canvasY = e.clientY - rect.top;
    const worldX = (canvasX - camera.offsetX) / camera.zoom;
    const worldY = (canvasY - camera.offsetY) / camera.zoom;
    const key = hitTestDistrict(worldX, worldY);
    if (key) setSelectedKey(key);
  }, []);

  const selectedProject = snapshot?.projects.find((p) => p.key === selectedKey) ?? null;

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="DISTRICTS" testId="districts-panel" wide>
      <div className="modal__intro">
        Real milestone state renders as building height — tap a district for detail.
      </div>
      {error && <div className="modal__warn">⚠ unable to reach /api/districts</div>}
      <div className="districts__scene" ref={containerRef} data-testid="districts-scene">
        <canvas ref={canvasRef} data-testid="districts-canvas" onClick={handleCanvasClick} />
        {snapshot?.projects.map((project) => {
          const plaque = plaques.find((p) => p.key === project.key);
          if (!plaque) return null;
          return (
            <button
              type="button"
              key={project.key}
              className="districts__plaque"
              data-testid={`districts-plaque-${project.key}`}
              style={{ left: `${String(plaque.x)}px`, top: `${String(plaque.y)}px` }}
              onClick={() => {
                setSelectedKey(project.key);
              }}
            >
              <span className="districts__plaque-glyph">
                {districtStatusGlyph(project.progress)}
              </span>
              <span className="districts__plaque-label">{project.label}</span>
            </button>
          );
        })}
      </div>
      {selectedProject && <InfoCard project={selectedProject} />}
    </Modal>
  );
}
