import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { DISTRICT_PLAQUE_STAGGER_PX } from '../constants';
import { fitToView, worldToCanvas } from '../engine/camera';
import {
  computeDistrictPlots,
  districtSceneBounds,
  drawDistrictScene,
  hitTestDistrict,
  plotWorldCenter,
} from '../engine/districtScene';
import { TILE_H } from '../engine/iso';
import { getCanvasResolution } from '../engine/resolution';
import {
  type DistrictProject,
  DISTRICTS_POLL_MS,
  type DistrictsSnapshot,
  districtStatusGlyph,
  fetchDistricts,
  formatDistrictActivity,
  formatDistrictAge,
  formatDistrictPhase,
  formatDistrictProgress,
  isDistrictStale,
  isDistrictUnknown,
} from '../net/districtFacts';
import { Modal } from './Modal';

/** Plain-text status word beside the plaque/info-card glyph (house rule:
 *  shape + WORD, never a bare symbol). Mirrors districtStatusGlyph's own
 *  branches exactly. */
function districtStatusWord(progress: number | null): string {
  if (progress === null) return 'UNKNOWN';
  if (progress <= 0) return 'NOT STARTED';
  if (progress >= 1) return 'COMPLETE';
  return 'IN PROGRESS';
}

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

function InfoCard({ project, now }: { project: DistrictProject; now: number }) {
  const unknown = isDistrictUnknown(project);
  const stale = !unknown && isDistrictStale(project.lastActivity, now);
  return (
    <div className="districts__info" data-testid="districts-info-card">
      <div className="districts__info-head">
        <span>
          {districtStatusGlyph(project.progress)} {districtStatusWord(project.progress)}
        </span>
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
          {/* Minor finding: a 2-month-old timestamp read as fresh with no
              staleness signal — shape+word+human age, raw ISO kept alongside
              (never hide the real timestamp behind the human one). */}
          {stale && (
            <div className="modal__warn" data-testid="districts-stale">
              ◷ STALE — last activity {formatDistrictAge(project.lastActivity, now)}
            </div>
          )}
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
  // Staleness check needs a "now" — refreshed at the existing district poll
  // cadence rather than by a separate ticking clock.
  const [now, setNow] = useState(() => Date.now());
  const cameraRef = useRef<ReturnType<typeof fitToView> | null>(null);

  // Plots derived from whatever project list the server returns (v5 C1:
  // N projects, not a fixed 2) — recomputed only when the project KEY list
  // changes, so a poll that just refreshes progress/phase doesn't reshuffle
  // the grid.
  const projects = snapshot?.projects ?? [];
  const projectKeysSignature = projects.map((p) => p.key).join(',');
  const plots = useMemo(
    () => computeDistrictPlots(projects),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the stable key signature, not the array identity
    [projectKeysSignature],
  );

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

    const bounds = districtSceneBounds(plots);
    const camera = fitToView(cssSize, bounds);
    cameraRef.current = camera;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.save();
    ctx.scale(resolution, resolution);
    ctx.clearRect(0, 0, cssSize.width, cssSize.height);
    // Apply the SAME camera the plaques + hit-test use (v5R overlap fix:
    // this transform was missing entirely, so the canvas drew raw world
    // coordinates at zoom 1 anchored to the top-left while the DOM
    // plaques were camera-projected — buildings and labels never lined
    // up). canvasPoint = worldPoint * zoom + offset (engine/camera.ts).
    ctx.translate(camera.offsetX, camera.offsetY);
    ctx.scale(camera.zoom, camera.zoom);
    drawDistrictScene(ctx, projects, plots);
    ctx.restore();

    setPlaques(
      plots.map((plot) => {
        const { worldX, worldY } = plotWorldCenter(plot);
        // Anchor the plaque at the ground diamond's BOTTOM vertex (v5R
        // overlap fix) — the CSS hangs it below that point, so the label
        // sits under its building instead of covering it. Odd columns
        // drop one extra plaque-height so adjacent labels can never
        // touch, regardless of zoom (see DistrictPlot.staggerPlaque).
        const point = worldToCanvas(camera, worldX, worldY + TILE_H / 2);
        const y = point.y + (plot.staggerPlaque ? DISTRICT_PLAQUE_STAGGER_PX : 0);
        return { key: plot.key, x: point.x, y };
      }),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `projects`/`plots` are derived each render from `snapshot`; depending on `snapshot` itself is equivalent and avoids an extra dep-array entry churn
  }, [snapshot, plots]);

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
        setNow(Date.now());
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

  const handleCanvasClick = useCallback(
    (e: { clientX: number; clientY: number }) => {
      const canvas = canvasRef.current;
      const camera = cameraRef.current;
      if (!canvas || !camera) return;
      const rect = canvas.getBoundingClientRect();
      const canvasX = e.clientX - rect.left;
      const canvasY = e.clientY - rect.top;
      const worldX = (canvasX - camera.offsetX) / camera.zoom;
      const worldY = (canvasY - camera.offsetY) / camera.zoom;
      const key = hitTestDistrict(worldX, worldY, plots);
      if (key) setSelectedKey(key);
    },
    [plots],
  );

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
          // Minor finding: plaques showed only a glyph + project name, no
          // state WORD. A full word beside the glyph risks re-widening the
          // plaque and regressing the v5R overlap fix (columns sit exactly
          // 64 world px apart, tuned against the CURRENT glyph+truncated-
          // label footprint) — so the word travels as an accessible label
          // (title + aria-label, always available) plus a single extra
          // glyph char for the STALE case only, which the collision fix
          // already budgets a stagger for.
          const stale = !isDistrictUnknown(project) && isDistrictStale(project.lastActivity, now);
          const word = districtStatusWord(project.progress);
          const a11yLabel = stale
            ? `${project.label} — ${word} — STALE`
            : `${project.label} — ${word}`;
          return (
            <button
              type="button"
              key={project.key}
              className="districts__plaque"
              data-testid={`districts-plaque-${project.key}`}
              style={{ left: `${String(plaque.x)}px`, top: `${String(plaque.y)}px` }}
              title={a11yLabel}
              aria-label={a11yLabel}
              onClick={() => {
                setSelectedKey(project.key);
              }}
            >
              <span className="districts__plaque-glyph">
                {districtStatusGlyph(project.progress)}
                {stale && <span data-testid={`districts-plaque-stale-${project.key}`}>◷</span>}
              </span>
              <span className="districts__plaque-label">{project.label}</span>
            </button>
          );
        })}
      </div>
      {selectedProject && <InfoCard project={selectedProject} now={now} />}
    </Modal>
  );
}
