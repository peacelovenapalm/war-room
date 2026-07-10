import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { AgentDrawer } from './components/AgentDrawer';
import { type ChipFrame, ChipLayer } from './components/ChipLayer';
import { HudStrip, type ViewMode } from './components/HudStrip';
import { PinDock } from './components/PinDock';
import { RealSheet } from './components/RealSheet';
import { TriageBoard } from './components/TriageBoard';
import { type CameraState, fitToView } from './engine/camera';
import { easeInOut, focusCamera, mixCamera, walkProgress } from './engine/focus';
import { mapWorldBounds } from './engine/iso';
import { renderWorld } from './engine/renderer';
import { getCanvasResolution } from './engine/resolution';
import {
  buildProps,
  DEFAULT_COLS,
  DEFAULT_MAX_ELEVATION,
  DEFAULT_ROWS,
  occupiedDeskAnchors,
} from './engine/world';
import { type AgentMap, EMPTY_AGENTS, reduceAgents, toOccupants } from './net/agentStore';
import { type ConnectionStatus, connectToServer } from './net/connection';
import { TailManager } from './net/tailManager';
import {
  type AckState,
  clearAcks,
  EMPTY_ACKS,
  expiredAcks,
  requestAck,
  undoAck,
} from './state/ackUndo';
import {
  acknowledgeDebris,
  type CrisisState,
  EMPTY_CRISIS_STATE,
  openCrisisCount,
  reduceCrisisState,
} from './state/crisisStore';
import { type EconomySnapshot, reduceEconomy } from './state/economy';
import { buildRealSheet, type RealSheetKind, tallyAgents, wingCounts } from './state/hud';
import { pinAgent, unpinAgent } from './state/pinDock';
import { appendChunk, EMPTY_TAILS, setPaused, tailKey, type TailMap } from './state/tailStore';
import { installTestHooksIfE2E } from './testHooks';

/** Board/HUD age tick — visible aging without RAF churn (v1 convention). */
const TICK_MS = 500;
/** How long the DOCK FULL rejection stays on screen. */
const DOCK_NOTICE_MS = 3_000;

/** Camera walk bookkeeping (▸ DESK / drawer close). `from` non-null means a
 *  walk is in flight; the RAF loop clears it when progress reaches 1. */
interface WalkState {
  targetAgentId: number | null;
  from: CameraState | null;
  startTs: number;
}

/**
 * Stage-2 face: HUD strip + triage board + tail sheets + agent drawer, all
 * DOM layers over the canvas world (text is DOM ALWAYS; the canvas draws
 * only world geometry/glow). Skeleton-first: the placeholder world paints
 * before any server or asset exists; live WS state fills it in.
 */
export default function App() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const renderCountRef = useRef(0);
  const lastResolutionRef = useRef(0);
  const lastCameraRef = useRef<CameraState | null>(null);
  const walkRef = useRef<WalkState>({ targetAgentId: null, from: null, startTs: 0 });
  const rafRef = useRef<number | null>(null);
  const managerRef = useRef<TailManager | null>(null);
  const prevPinsRef = useRef<readonly number[]>([]);
  // Source-of-truth refs for values reduced OUTSIDE render (WS callbacks +
  // the age tick); the matching useState mirrors them for rendering.
  const agentsRef = useRef<AgentMap>(EMPTY_AGENTS);
  const acksRef = useRef<AckState>(EMPTY_ACKS);

  const [grayscale, setGrayscale] = useState(false);
  const [view, setView] = useState<ViewMode>('floor');
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('connecting');
  const [agents, setAgents] = useState<AgentMap>(EMPTY_AGENTS);
  const [economy, setEconomy] = useState<EconomySnapshot | null>(null);
  const [crisis, setCrisis] = useState<CrisisState>(EMPTY_CRISIS_STATE);
  const [acks, setAcks] = useState<AckState>(EMPTY_ACKS);
  const [tails, setTails] = useState<TailMap>(EMPTY_TAILS);
  const [pins, setPins] = useState<readonly number[]>([]);
  const [dockNotice, setDockNotice] = useState<string | null>(null);
  const [drawerAgentId, setDrawerAgentId] = useState<number | null>(null);
  const [realKind, setRealKind] = useState<RealSheetKind | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [chipFrame, setChipFrame] = useState<ChipFrame | null>(null);

  const occupants = useMemo(() => toOccupants(agents, now), [agents, now]);
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
    // ▸ DESK walks blend fit → focus with a bounded (≤2s) ease; both
    // endpoints are CSS-size/world-size math only.
    const bounds = mapWorldBounds(DEFAULT_COLS, DEFAULT_ROWS, DEFAULT_MAX_ELEVATION);
    const fit = fitToView(cssSize, bounds);
    const walk = walkRef.current;
    const desk =
      walk.targetAgentId !== null
        ? occupiedDeskAnchors(occupantsRef.current).find((a) => a.agentId === walk.targetAgentId)
        : undefined;
    const target = desk
      ? focusCamera(cssSize, { worldX: desk.deskWorldX, worldY: desk.deskWorldY }, fit)
      : fit;
    let camera = target;
    if (walk.from !== null) {
      const t = walkProgress(walk.startTs, performance.now());
      camera = mixCamera(walk.from, target, easeInOut(t));
      if (t >= 1) walk.from = null;
    }

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
    setChipFrame((previous) =>
      previous !== null &&
      previous.camera.zoom === camera.zoom &&
      previous.camera.offsetX === camera.offsetX &&
      previous.camera.offsetY === camera.offsetY &&
      previous.cssSize.width === cssSize.width &&
      previous.cssSize.height === cssSize.height
        ? previous
        : { camera, cssSize },
    );
  }, []);

  /** Kick the RAF loop that advances an in-flight camera walk. */
  const ensureWalkLoop = useCallback(() => {
    if (rafRef.current !== null) return;
    const step = () => {
      draw();
      if (walkRef.current.from !== null) {
        rafRef.current = requestAnimationFrame(step);
      } else {
        rafRef.current = null;
      }
    };
    rafRef.current = requestAnimationFrame(step);
  }, [draw]);

  const startWalk = useCallback(
    (agentId: number | null) => {
      walkRef.current = {
        targetAgentId: agentId,
        from: lastCameraRef.current,
        startTs: performance.now(),
      };
      ensureWalkLoop();
    },
    [ensureWalkLoop],
  );

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
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
  }, [draw]);

  // Redraw when occupancy changes (ref keeps `draw` stable for the observer).
  useEffect(() => {
    occupantsRef.current = occupants;
    draw();
  }, [draw, occupants]);

  /** Ack-state writes go through here so the tick's sweep sees them. */
  const applyAcks = useCallback((next: AckState) => {
    acksRef.current = next;
    setAcks(next);
  }, []);

  // Live server plane (core/ generated message types) + tail manager. The
  // crisis state machine reduces HERE (and on the age tick below) — agents
  // are reduced outside render, so the ref is the source of truth.
  useEffect(() => {
    const connection = connectToServer({
      onMessage: (message) => {
        const at = Date.now();
        const nextAgents = reduceAgents(agentsRef.current, message, at);
        if (nextAgents !== agentsRef.current) {
          agentsRef.current = nextAgents;
          setAgents(nextAgents);
          setCrisis((previous) => reduceCrisisState(previous, nextAgents, at));
        }
        setEconomy((previous) => reduceEconomy(previous, message));
        if (message.type === 'outputChunk') {
          setTails((previous) => appendChunk(previous, message));
        }
      },
      onStatus: (status) => {
        setConnectionStatus(status);
        managerRef.current?.handleStatus(status);
      },
    });
    managerRef.current = new TailManager(connection);
    return () => {
      managerRef.current = null;
      connection.dispose();
    };
  }, []);

  // Age tick — board ages, poll TTLs (fires go out when a poll expires),
  // and lapsed ACK undo windows committing for real.
  useEffect(() => {
    const timer = setInterval(() => {
      const at = Date.now();
      setNow(at);
      setCrisis((previous) => reduceCrisisState(previous, agentsRef.current, at));
      const expired = expiredAcks(acksRef.current, at);
      if (expired.length > 0) {
        applyAcks(clearAcks(acksRef.current, expired));
        setCrisis((previous) => expired.reduce(acknowledgeDebris, previous));
      }
    }, TICK_MS);
    return () => {
      clearInterval(timer);
    };
  }, [applyAcks]);

  // DOCK FULL rejection is transient.
  useEffect(() => {
    if (dockNotice === null) return;
    const timer = setTimeout(() => {
      setDockNotice(null);
    }, DOCK_NOTICE_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [dockNotice]);

  // Drawer tail subscription follows the open drawer (refcounted).
  useEffect(() => {
    if (drawerAgentId === null) return;
    const manager = managerRef.current;
    if (!manager) return;
    const id = String(drawerAgentId);
    manager.acquire('agent', id);
    return () => {
      manager.release('agent', id);
    };
  }, [drawerAgentId]);

  // Pinned tails hold their own refs (diffed against the previous set).
  useEffect(() => {
    const manager = managerRef.current;
    if (!manager) return;
    const previous = prevPinsRef.current;
    for (const id of pins) {
      if (!previous.includes(id)) manager.acquire('agent', String(id));
    }
    for (const id of previous) {
      if (!pins.includes(id)) manager.release('agent', String(id));
    }
    prevPinsRef.current = pins;
  }, [pins]);

  useEffect(() => {
    installTestHooksIfE2E({
      getRenderCount: () => renderCountRef.current,
      getAgentCount: () => occupantsRef.current.length,
      getResolution: () => lastResolutionRef.current,
      getCameraState: () => lastCameraRef.current,
    });
  }, []);

  const handleDesk = useCallback(
    (agentId: number) => {
      setDrawerAgentId(agentId);
      startWalk(agentId);
    },
    [startWalk],
  );

  const handleCloseDrawer = useCallback(() => {
    setDrawerAgentId(null);
    startWalk(null);
  }, [startWalk]);

  const handleTogglePin = useCallback(
    (agentId: number) => {
      if (pins.includes(agentId)) {
        setPins(unpinAgent(pins, agentId));
        return;
      }
      const result = pinAgent(pins, agentId);
      if (result.ok) {
        setPins(result.pins);
      } else {
        setDockNotice(result.reason ?? null);
      }
    },
    [pins],
  );

  const handleTogglePause = useCallback((key: string) => {
    setTails((previous) => setPaused(previous, key, !(previous.get(key)?.paused ?? false)));
  }, []);

  const tally = useMemo(() => tallyAgents(agents, now), [agents, now]);
  const wings = useMemo(() => wingCounts(agents, crisis), [agents, crisis]);
  const openCrises = openCrisisCount(crisis);
  const realContent = useMemo(
    () => (realKind === null ? null : buildRealSheet(realKind, { agents, crisis, economy }, now)),
    [realKind, agents, crisis, economy, now],
  );
  const drawerTailKey = drawerAgentId !== null ? tailKey('agent', String(drawerAgentId)) : null;

  return (
    <div className={grayscale ? 'app grayscale' : 'app'}>
      <HudStrip
        connectionStatus={connectionStatus}
        tally={tally}
        wings={wings}
        openCrises={openCrises}
        economy={economy}
        grayscale={grayscale}
        view={view}
        onToggleGrayscale={() => {
          setGrayscale((value) => !value);
        }}
        onToggleView={() => {
          setView((value) => (value === 'floor' ? 'board' : 'floor'));
        }}
        onOpenReal={setRealKind}
      />
      <div className="surfaces" data-view={view}>
        <div className="world" ref={containerRef}>
          <canvas data-testid="iso-canvas" ref={canvasRef} />
          <ChipLayer frame={chipFrame} occupants={occupants} onChipClick={handleDesk} />
        </div>
        <TriageBoard
          agents={agents}
          crisis={crisis}
          acks={acks}
          now={now}
          onDesk={handleDesk}
          onAck={(key) => {
            applyAcks(requestAck(acksRef.current, key, Date.now()));
          }}
          onUndoAck={(key) => {
            applyAcks(undoAck(acksRef.current, key));
          }}
        />
      </div>
      <PinDock
        pins={pins}
        agents={agents}
        tails={tails}
        now={now}
        notice={dockNotice}
        onUnpin={handleTogglePin}
        onPromote={handleDesk}
      />
      {drawerAgentId !== null && drawerTailKey !== null && (
        <AgentDrawer
          key={drawerAgentId}
          agentId={drawerAgentId}
          agents={agents}
          crisis={crisis}
          now={now}
          tail={tails.get(drawerTailKey)}
          pinned={pins.includes(drawerAgentId)}
          onTogglePin={() => {
            handleTogglePin(drawerAgentId);
          }}
          onTogglePause={() => {
            handleTogglePause(drawerTailKey);
          }}
          onClose={handleCloseDrawer}
        />
      )}
      <RealSheet
        content={realContent}
        onClose={() => {
          setRealKind(null);
        }}
      />
    </div>
  );
}
