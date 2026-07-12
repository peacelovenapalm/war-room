import type { PointerEvent as ReactPointerEvent } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { ClientMessage } from '../../core/src/messages.js';
import { createBrowserLoaderDeps, createImageStore, createSpriteStore } from './assets/loader';
import { AgentDrawer } from './components/AgentDrawer';
import { AutomationPanel } from './components/AutomationPanel';
import { BriefingPanel } from './components/BriefingPanel';
import { CallModal, type CallModalPrefill } from './components/CallModal';
import { type ChipFrame, ChipLayer } from './components/ChipLayer';
import { ContractsPanel } from './components/ContractsPanel';
import { DebugView, type DiagnosticsRow } from './components/DebugView';
import { DispatchTray } from './components/DispatchTray';
import { DispatchVisitorChips } from './components/DispatchVisitorChips';
import { DistrictsView } from './components/DistrictsView';
import { FloorFeed } from './components/FloorFeed';
import { GraphSearchPanel } from './components/GraphSearchPanel';
import { HelpModal } from './components/HelpModal';
import { HudStrip, type ViewMode } from './components/HudStrip';
import { InboxPanel } from './components/InboxPanel';
import { OpsReviewPanel } from './components/OpsReviewPanel';
import { type DockPanelKind, PanelDock } from './components/PanelDock';
import { PinDock } from './components/PinDock';
import { PropHotspots } from './components/PropHotspots';
import { RealSheet } from './components/RealSheet';
import { SettingsModal } from './components/SettingsModal';
import { ShiftPanel } from './components/ShiftPanel';
import { SpeechBubbleLayer } from './components/SpeechBubbleLayer';
import { TriageBoard } from './components/TriageBoard';
import {
  type CalmTransition,
  displayedWarmth,
  INITIAL_CALM,
  updateCalmTransition,
} from './engine/calm';
import { type CameraState, clampPanToFit, fitToView, worldToCanvas } from './engine/camera';
import { easeInOut, focusCamera, mixCamera, walkProgress } from './engine/focus';
import {
  EMPTY_GESTURE,
  gesturePointerDown,
  gesturePointerMove,
  gesturePointerUp,
  type GestureState,
} from './engine/gesture';
import type { HotspotKind } from './engine/hotspots';
import { mapWorldBounds, tileToWorld } from './engine/iso';
import { type PosterPlacement, renderWorld } from './engine/renderer';
import { getCanvasResolution } from './engine/resolution';
import { createSoundscapeEngine } from './engine/soundscape';
import { computeWalkers, type WalkerAgentInput } from './engine/walkers';
import {
  buildProps,
  DEFAULT_COLS,
  DEFAULT_MAX_ELEVATION,
  DEFAULT_ROWS,
  GUEST_SLOTS,
  occupiedDeskAnchors,
  outfitForAgent,
  outfitForDispatchId,
  STATIC_PROP_SPRITE_NAMES,
  type WorldProp,
} from './engine/world';
import { type AgentMap, EMPTY_AGENTS, reduceAgents, toOccupants } from './net/agentStore';
import { type ConnectionStatus, connectToServer, type ServerConnection } from './net/connection';
import {
  clearTerminalDispatchEntries,
  detectSendFailures,
  type DispatchActionValue,
  type DispatchEntry,
  type PendingSend,
  type SendFailure,
} from './net/dispatchFacts';
import { TailManager } from './net/tailManager';
import { type AckState, EMPTY_ACKS, requestAck, undoAck } from './state/ackUndo';
import { classifyWalkerAgents } from './state/ambient';
import {
  reduceBudget,
  reduceChainRunReceivedAt,
  reduceChainRuns,
  reduceDispatchEntries,
} from './state/automationStore';
import type { BudgetSnapshotClient } from './state/budget';
import type { ChainRunClient } from './state/chain';
import {
  type CrisisState,
  EMPTY_CRISIS_STATE,
  openCrisisCount,
  reduceCrisisState,
  sweepAcks,
} from './state/crisisStore';
import { deriveDispatchVisitors, type DispatchVisitor } from './state/dispatchVisitors';
import { type EconomySnapshot, reduceEconomy } from './state/economy';
import {
  appendFloorFeedEntry,
  EMPTY_FLOOR_FEED,
  type FloorFeedEntry,
  floorFeedLabel,
} from './state/floorFeed';
import { buildRealSheet, type RealSheetKind, tallyAgents, wingCounts } from './state/hud';
import { parseLaunchTarget } from './state/launch';
import { panelFlightAnchor } from './state/panelFlight';
import { type PanelGrowOrigin, PanelGrowOriginProvider } from './state/panelGrowOrigin';
import { pinAgent, unpinAgent } from './state/pinDock';
import { reduceSettings, type SettingsSnapshot } from './state/settings';
import { readSoundscapeMuted, writeSoundscapeMuted } from './state/soundscape';
import {
  appendSpeechBubble,
  detectNewlyLoudAgents,
  detectNewlyTerminalDispatches,
  dispatchDoneBubbleText,
  dispatchStatusSnapshot,
  loudAgentIds,
  pruneSpeechBubbles,
  type SpeechBubbleEvent,
} from './state/speechBubbles';
import { reduceAutomationStopped, stoppedFromOrders } from './state/stopAll';
import {
  appendChunk,
  dropStream,
  EMPTY_TAILS,
  enforceStreamCap,
  MAX_TAIL_STREAMS,
  setPaused,
  tailKey,
  type TailMap,
} from './state/tailStore';
import { installTestHooksIfE2E } from './testHooks';

/** Board/HUD age tick — visible aging without RAF churn (v1 convention). */
const TICK_MS = 500;
/** How long the DOCK FULL rejection stays on screen. */
const DOCK_NOTICE_MS = 3_000;

/** Wall posters (KICKOFF-v3.1 WS-A "flavor, cheap, high-payoff") — 3 of the
 *  imagegen lane's 6 posters/placards, world-anchored on the back wall row
 *  (WorldProp WALL_SEGMENTS, engine/world.ts), clear of the automation (7,0)
 *  and briefing (10,0) hotspot tiles. Portraits are NOT wired this pass
 *  (dossier panel later, per the handoff). */
const POSTER_PLACEMENTS: readonly PosterPlacement[] = [
  { name: 'poster_stop_all', tileX: 2, tileY: 0, worldWidth: 26 },
  { name: 'board_logo', tileX: 6, tileY: 0, worldWidth: 34 },
  { name: 'poster_ship_it', tileX: 12, tileY: 0, worldWidth: 26 },
];

/** window.location.search, defensively (never throws outside a browser). */
function readLocationSearch(): string {
  return typeof window === 'undefined' ? '' : window.location.search;
}

/** Camera walk bookkeeping (▸ DESK / drawer close). `from` non-null means a
 *  walk is in flight; the RAF loop clears it when progress reaches 1. */
interface WalkState {
  targetAgentId: number | null;
  from: CameraState | null;
  startTs: number;
}

/** T6 item 4 — CAMERA-MOVE PANEL OPENS: a one-shot camera flight to an
 *  anchored panel's hotspot tile (state/panelFlight.ts). Unlike WalkState
 *  (which persists for as long as the drawer stays open), this always
 *  self-clears once walkProgress reaches 1 — it's an entrance flourish,
 *  not a standing focus — and is skippable: ANY input (pointer or key)
 *  clears it immediately (see the cancel effect below). */
interface PanelFlightState {
  from: CameraState;
  target: { worldX: number; worldY: number };
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
  const panelFlightRef = useRef<PanelFlightState | null>(null);
  const rafRef = useRef<number | null>(null);
  // Pinch/pan (KICKOFF-v3.1 WS-A item 4): the user's free camera, layered
  // OVER fit-to-view. null = no interaction yet, draw() uses `fit`. A desk
  // walk (▸ DESK) always wins and clears this (startWalk below) — the two
  // never fight for the same frame.
  const gestureRef = useRef<GestureState>(EMPTY_GESTURE);
  const userCameraRef = useRef<CameraState | null>(null);
  const gestureRafRef = useRef<number | null>(null);
  const managerRef = useRef<TailManager | null>(null);
  const connectionRef = useRef<ServerConnection | null>(null);
  const connectionStatusRef = useRef<ConnectionStatus>('connecting');
  const prevPinsRef = useRef<readonly number[]>([]);
  // Real-sprite asset stores (KICKOFF-v3.1 WS-A "wire real sprites in").
  // useState's lazy initializer runs exactly once per mount (StrictMode's
  // double-invoke discards the extra instance) and — unlike a ref seeded
  // with null — types as always-present, no null-check noise at every call
  // site below. createSpriteStore's documented contract is "nothing
  // fetched at construction", so building one is a pure allocation; the
  // setters are never called, these are just a stable-identity escape
  // hatch from useMemo's "may be recomputed" caveat. Manifest URLs are the
  // sync-assets.mjs mirror (webview-v3-assets/ -> public/assets/). RELATIVE
  // paths, not /assets/... — the deployed build is served under /v3/ (the
  // old face owns the root), so absolute paths would resolve against the
  // wrong static root and 404 into permanent placeholder art. Relative
  // resolves correctly in dev (/), e2e (/), and deploy (/v3/).
  const [propStore] = useState(() =>
    createSpriteStore<HTMLImageElement>('assets/props.manifest.json', createBrowserLoaderDeps()),
  );
  const [characterStore] = useState(() =>
    createSpriteStore<HTMLImageElement>(
      'assets/characters.manifest.json',
      createBrowserLoaderDeps(),
    ),
  );
  const [imageStore] = useState(() =>
    createImageStore<HTMLImageElement>('assets/imagegen/manifest.json', {
      ...createBrowserLoaderDeps(),
      // imagegen/manifest.json's `path` values are ASSET-ROOT-relative
      // (already carry the `imagegen/` prefix — assets/manifest.ts's
      // ImageAsset doc comment), not relative to the manifest's own
      // directory like the default resolver assumes; without this the
      // default would double it into .../imagegen/imagegen/....
      resolveUrl: (relativePath) => `/assets/${relativePath}`,
    }),
  );
  // T6 item 5 — SOUNDSCAPE V1: same "useState lazy-initializer, built
  // exactly once" convention as the sprite stores above. createSoundscapeEngine
  // never touches AudioContext at construction (SSR/test-safe, mirrors
  // createSpriteStore's "nothing fetched at construction" contract) —
  // real audio nodes only exist once the user actually unmutes.
  const [soundscapeEngine] = useState(() => createSoundscapeEngine());
  const [soundscapeMuted, setSoundscapeMuted] = useState(() =>
    readSoundscapeMuted(typeof window === 'undefined' ? undefined : window.localStorage),
  );
  useEffect(() => {
    soundscapeEngine.setMuted(soundscapeMuted);
  }, [soundscapeEngine, soundscapeMuted]);
  const handleToggleSoundscape = useCallback(() => {
    setSoundscapeMuted((previous) => {
      const next = !previous;
      if (typeof window !== 'undefined') writeSoundscapeMuted(window.localStorage, next);
      return next;
    });
  }, []);
  // Ambient walkers + calm-channel lighting (KICKOFF-v3.1 WS-A item 4(c)) —
  // real-telemetry-derived, recomputed on the same tick/occupancy effect
  // that already redraws (draw() itself stays a stable ref-reading
  // callback, matching every other piece of frame state here).
  const walkerInputsRef = useRef<WalkerAgentInput[]>([]);
  // T6 item 1 (dispatch visitors) — same "ref recomputed on the redraw
  // effect, read fresh inside draw()" convention as walkerInputsRef.
  const dispatchVisitorsRef = useRef<DispatchVisitor[]>([]);
  const calmRef = useRef<CalmTransition>(INITIAL_CALM);
  // Source-of-truth refs for values reduced OUTSIDE render (WS callbacks +
  // the age tick); the matching useState mirrors them for rendering.
  const agentsRef = useRef<AgentMap>(EMPTY_AGENTS);
  const crisisRef = useRef<CrisisState>(EMPTY_CRISIS_STATE);
  const acksRef = useRef<AckState>(EMPTY_ACKS);
  const dispatchEntriesRef = useRef<DispatchEntry[]>([]);
  const pendingSendsRef = useRef<PendingSend[]>([]);
  const tailsRef = useRef<TailMap>(EMPTY_TAILS);
  /** Push-landing deep link (state/launch.ts): the agent id a notification
   *  wants auto-opened, cleared once the walk fires (or never set). */
  const launchTargetRef = useRef<number | null>(parseLaunchTarget(readLocationSearch()).agentId);
  const prevFloorFeedIdsRef = useRef<readonly number[]>([]);

  const [grayscale, setGrayscale] = useState(false);
  const [view, setView] = useState<ViewMode>('floor');
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('connecting');
  const [agents, setAgents] = useState<AgentMap>(EMPTY_AGENTS);
  const [economy, setEconomy] = useState<EconomySnapshot | null>(null);
  const [crisis, setCrisis] = useState<CrisisState>(EMPTY_CRISIS_STATE);
  const [acks, setAcks] = useState<AckState>(EMPTY_ACKS);
  const [tails, setTails] = useState<TailMap>(EMPTY_TAILS);
  const [floorFeed, setFloorFeed] = useState<readonly FloorFeedEntry[]>(EMPTY_FLOOR_FEED);
  const [pins, setPins] = useState<readonly number[]>([]);
  const [dockNotice, setDockNotice] = useState<string | null>(null);
  const [drawerAgentId, setDrawerAgentId] = useState<number | null>(null);
  const [realKind, setRealKind] = useState<RealSheetKind | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [chipFrame, setChipFrame] = useState<ChipFrame | null>(null);

  // ── Stage-3 panel ports ──────────────────────────────────────────
  const [openPanel, setOpenPanel] = useState<DockPanelKind | null>(null);
  // T6 item 4 — CAMERA-MOVE PANEL OPENS: components/Modal.tsx's grow
  // origin, `null` = no anchor / cancelled (plain open, matching every
  // panel's prior appearance exactly).
  const [panelGrowOrigin, setPanelGrowOrigin] = useState<PanelGrowOrigin | null>(null);
  const [settings, setSettings] = useState<SettingsSnapshot | null>(null);
  const [dispatchEntries, setDispatchEntries] = useState<DispatchEntry[]>([]);
  const [sendFailures, setSendFailures] = useState<SendFailure[]>([]);
  const [chainRuns, setChainRuns] = useState<ChainRunClient[]>([]);
  const [chainRunReceivedAt, setChainRunReceivedAt] = useState<Record<string, number>>({});
  const [budget, setBudget] = useState<BudgetSnapshotClient | null>(null);
  /** STOP ALL — ONE lifted source of truth for both StopAllControl mounts
   *  (HUD + AutomationPanel), hydrated from the server below and latched
   *  by the WS automationStopped broadcast (state/stopAll.ts). */
  const [automationStopped, setAutomationStopped] = useState(false);
  const [diagnostics, setDiagnostics] = useState<DiagnosticsRow[]>([]);
  const [callPrefill, setCallPrefill] = useState<CallModalPrefill | null>(null);
  const [viewingResult, setViewingResult] = useState<DispatchEntry | null>(null);
  // T6 item 3 — speech bubbles: rising-edge trackers (state/speechBubbles.ts)
  // so a still-loud agent or still-terminal dispatch never re-bubbles.
  const [speechBubbles, setSpeechBubbles] = useState<readonly SpeechBubbleEvent[]>([]);
  const prevLoudAgentIdsRef = useRef<ReadonlySet<number>>(new Set());
  const prevDispatchStatusesRef = useRef<ReadonlyMap<string, DispatchEntry['status']>>(new Map());

  const occupants = useMemo(() => toOccupants(agents, now), [agents, now]);
  const occupantsRef = useRef(occupants);
  // T6 item 1 — render-time mirror of dispatchVisitorsRef for the DOM chip
  // layer (the canvas world reads the ref inside draw(); this memo is only
  // for JSX, same split as occupants/occupantsRef above).
  const dispatchVisitors = useMemo(
    () => deriveDispatchVisitors(dispatchEntries),
    [dispatchEntries],
  );

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
    // Re-clamp on every draw (not just on the gesture that set it) so a
    // resize/rotate never leaves the free camera pointing off-bounds.
    const userCamera = userCameraRef.current
      ? clampPanToFit(userCameraRef.current, cssSize, bounds)
      : null;
    const target = desk
      ? focusCamera(cssSize, { worldX: desk.deskWorldX, worldY: desk.deskWorldY }, fit)
      : (userCamera ?? fit);
    let camera = target;
    if (walk.from !== null) {
      const t = walkProgress(walk.startTs, performance.now());
      camera = mixCamera(walk.from, target, easeInOut(t));
      if (t >= 1) walk.from = null;
    } else if (panelFlightRef.current !== null) {
      // T6 item 4 — CAMERA-MOVE PANEL OPENS: a desk walk (an explicit user
      // verb) always wins outright; the panel-open flourish only ever runs
      // when no desk walk owns the camera this frame.
      const flight = panelFlightRef.current;
      const t = walkProgress(flight.startTs, performance.now());
      const flightTarget = focusCamera(cssSize, flight.target, fit);
      camera = mixCamera(flight.from, flightTarget, easeInOut(t));
      if (t >= 1) {
        // Natural completion (not a cancel) — the CSS keyframe's own 'to'
        // state already equals the plain resting appearance (translate(0,0)
        // scale(1) opacity:1), so dropping the grow origin here is visually
        // seamless AND keeps panelFlightRef/panelGrowOrigin's null-ness in
        // lockstep, which is what lets cancelPanelFlight's early-return
        // guard stay correct for every later panel open (anchored or not).
        panelFlightRef.current = null;
        setPanelGrowOrigin(null);
      }
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    // Ambient walkers (KICKOFF-v3.1 WS-A item 4(c)): real-time positions
    // over already-classified real-telemetry inputs, converted into the
    // SAME WorldProp shape every other prop uses (one depth-sort/render
    // pass, no special-casing).
    const walkerProps: WorldProp[] = computeWalkers(
      walkerInputsRef.current,
      connectionStatusRef.current === 'live',
      Date.now(),
    ).map((pose) => ({
      kind: 'walker',
      tileX: pose.tileX,
      tileY: pose.tileY,
      rotation: pose.rotation,
      walkerPoseKind: pose.kind,
      // Janitor has no agentId (not tied to a specific agent) — fixed
      // outfit; drift/pace wear the same outfit as their desk sprite.
      walkerOutfit: pose.agentId !== undefined ? outfitForAgent(pose.agentId) : 'rust',
    }));
    // T6 item 1 — dispatch visitors: RUNNING dispatches (state/
    // dispatchVisitors.ts) rendered as a stationary guest presence, same
    // WorldProp shape as an ambient walker (walkerPoseKind:'visitor' picks
    // the 'sit' pose in renderer.ts instead of a walk cycle).
    const visitorProps: WorldProp[] = dispatchVisitorsRef.current.flatMap((visitor, index) => {
      const slot = GUEST_SLOTS[index];
      if (!slot) return [];
      return [
        {
          kind: 'walker',
          tileX: slot.tileX,
          tileY: slot.tileY,
          rotation: 'S',
          walkerPoseKind: 'visitor',
          walkerOutfit: outfitForDispatchId(visitor.id),
        } satisfies WorldProp,
      ];
    });
    renderWorld(ctx, {
      cssSize,
      resolution,
      camera,
      cols: DEFAULT_COLS,
      rows: DEFAULT_ROWS,
      props: [...buildProps(occupantsRef.current), ...walkerProps, ...visitorProps],
      warmth: displayedWarmth(calmRef.current, Date.now()),
      assets: { now: Date.now(), propStore, characterStore, imageStore },
      posters: POSTER_PLACEMENTS,
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
  }, [propStore, characterStore, imageStore]);

  /** Kick the RAF loop that advances an in-flight camera walk (▸ DESK or a
   *  T6 panel-open flight — either keeps this loop alive). */
  const ensureWalkLoop = useCallback(() => {
    if (rafRef.current !== null) return;
    const step = () => {
      draw();
      if (walkRef.current.from !== null || panelFlightRef.current !== null) {
        rafRef.current = requestAnimationFrame(step);
      } else {
        rafRef.current = null;
      }
    };
    rafRef.current = requestAnimationFrame(step);
  }, [draw]);

  const startWalk = useCallback(
    (agentId: number | null) => {
      // A desk walk (▸ DESK / drawer close) always overrides free pan/zoom —
      // the two camera sources never compose in the same frame.
      userCameraRef.current = null;
      walkRef.current = {
        targetAgentId: agentId,
        from: lastCameraRef.current,
        startTs: performance.now(),
      };
      ensureWalkLoop();
    },
    [ensureWalkLoop],
  );

  /** RAF-coalesced redraw for pointermove — a pinch/pan gesture can fire
   *  many samples per frame; only the LAST one before paint matters. */
  const scheduleGestureDraw = useCallback(() => {
    if (gestureRafRef.current !== null) return;
    gestureRafRef.current = requestAnimationFrame(() => {
      gestureRafRef.current = null;
      draw();
    });
  }, [draw]);

  /** Canvas-relative CSS-px point for a pointer event (world/camera math is
   *  CSS px throughout — never DPR). */
  const pointerPoint = useCallback((e: { clientX: number; clientY: number }) => {
    const rect = containerRef.current?.getBoundingClientRect();
    return { x: e.clientX - (rect?.left ?? 0), y: e.clientY - (rect?.top ?? 0) };
  }, []);

  const handlePointerDown = useCallback(
    (e: ReactPointerEvent<HTMLCanvasElement>) => {
      e.currentTarget.setPointerCapture(e.pointerId);
      const point = pointerPoint(e);
      gestureRef.current = gesturePointerDown(gestureRef.current, {
        id: e.pointerId,
        x: point.x,
        y: point.y,
      });
    },
    [pointerPoint],
  );

  const handlePointerMove = useCallback(
    (e: ReactPointerEvent<HTMLCanvasElement>) => {
      // A desk-walk animation (bounded theater, ≤2s) owns the camera —
      // never let a stray touch fight it mid-flight.
      if (walkRef.current.from !== null) return;
      const container = containerRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      const cssSize = { width: Math.max(1, rect.width), height: Math.max(1, rect.height) };
      const bounds = mapWorldBounds(DEFAULT_COLS, DEFAULT_ROWS, DEFAULT_MAX_ELEVATION);
      const camera = userCameraRef.current ?? lastCameraRef.current ?? fitToView(cssSize, bounds);
      const point = pointerPoint(e);
      const result = gesturePointerMove(
        gestureRef.current,
        { id: e.pointerId, x: point.x, y: point.y },
        camera,
        cssSize,
        bounds,
      );
      gestureRef.current = result.state;
      if (result.camera) {
        userCameraRef.current = result.camera;
        scheduleGestureDraw();
      }
    },
    [pointerPoint, scheduleGestureDraw],
  );

  const handlePointerUp = useCallback((e: ReactPointerEvent<HTMLCanvasElement>) => {
    gestureRef.current = gesturePointerUp(gestureRef.current, e.pointerId);
  }, []);

  // Real-sprite loading (KICKOFF-v3.1 WS-A "wire real sprites in"): the
  // office geometry (floor/walls/desk/coffee/plant) is on screen from
  // frame 1 regardless of live connection, so request those names once on
  // mount — everything else (per-outfit character sprites, posters)
  // requests lazily from inside draw() only once it's actually needed.
  // Each store's onChange fires draw() again the moment its sheet lands,
  // so real art pops in as soon as it decodes instead of waiting for the
  // next unrelated redraw (the 500ms age tick would eventually catch it,
  // but this is snappier and costs nothing extra — request()/get() are
  // idempotent no-ops once a sheet is loaded).
  useEffect(() => {
    propStore.request(STATIC_PROP_SPRITE_NAMES);
    const unsubscribers = [
      propStore.onChange(draw),
      characterStore.onChange(draw),
      imageStore.onChange(draw),
    ];
    return () => {
      for (const unsubscribe of unsubscribers) unsubscribe();
    };
  }, [draw, propStore, characterStore, imageStore]);

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

  // Redraw when occupancy/agents/crisis change, AND on the 500ms age tick
  // (`now`) so ambient walker motion + the calm-channel lerp actually
  // advance between real-state changes (draw() itself stays a stable ref-
  // reading callback for the ResizeObserver above).
  useEffect(() => {
    occupantsRef.current = occupants;
    walkerInputsRef.current = classifyWalkerAgents(occupiedDeskAnchors(occupants), agents, now);
    dispatchVisitorsRef.current = deriveDispatchVisitors(dispatchEntries);
    calmRef.current = updateCalmTransition(calmRef.current, openCrisisCount(crisis), Date.now());

    // T6 item 3 — speech bubbles: real-telemetry rising edges only (state/
    // speechBubbles.ts). Desk bubbles reuse the SAME `loud` derivation the
    // desk chip already shows (its own text, verbatim); dispatch bubbles
    // reuse dispatchChipLabel. Never invented content.
    const at = Date.now();
    const newlyLoud = detectNewlyLoudAgents(prevLoudAgentIdsRef.current, occupants);
    const newlyTerminal = detectNewlyTerminalDispatches(
      prevDispatchStatusesRef.current,
      dispatchEntries,
    );
    prevLoudAgentIdsRef.current = loudAgentIds(occupants);
    prevDispatchStatusesRef.current = dispatchStatusSnapshot(dispatchEntries);
    if (newlyLoud.length > 0 || newlyTerminal.length > 0) {
      setSpeechBubbles((prev) => {
        let next = prev;
        for (const occupant of newlyLoud) {
          next = appendSpeechBubble(next, {
            id: `agent-${String(occupant.agentId)}-${String(at)}`,
            anchor: { kind: 'agent', agentId: occupant.agentId },
            text: `${occupant.statusGlyph} ${occupant.statusWord}`,
            createdAt: at,
          });
        }
        for (const dispatchEntry of newlyTerminal) {
          next = appendSpeechBubble(next, {
            id: `dispatch-${dispatchEntry.id}-${String(at)}`,
            anchor: { kind: 'dispatch', dispatchId: dispatchEntry.id },
            text: dispatchDoneBubbleText(dispatchEntry),
            createdAt: at,
          });
        }
        return next;
      });
    }

    // T6 item 5 — SOUNDSCAPE V1: the SAME rising-edge detections that
    // trigger a speech bubble also trigger a chirp. The engine itself
    // no-ops while muted (engine/soundscape.ts), so this call is
    // unconditional — no need to thread soundscapeMuted into this effect.
    newlyLoud.forEach(() => {
      soundscapeEngine.chirp('needs-input');
    });
    newlyTerminal.forEach(() => {
      soundscapeEngine.chirp('dispatch-done');
    });

    draw();
  }, [draw, occupants, agents, crisis, now, dispatchEntries, soundscapeEngine]);

  // TTL is applied at RENDER time off the existing `now` age tick (not a
  // second effect+setState) — appendSpeechBubble already caps the
  // underlying state at MAX_CONCURRENT_BUBBLES, so there's nothing to
  // proactively garbage-collect, only what's currently worth SHOWING.
  const visibleSpeechBubbles = useMemo(
    () => pruneSpeechBubbles(speechBubbles, now),
    [speechBubbles, now],
  );

  /** Ack-state writes go through here so the tick's sweep sees them. */
  const applyAcks = useCallback((next: AckState) => {
    acksRef.current = next;
    setAcks(next);
  }, []);

  /** Crisis-state writes go through here — like agentsRef, the ref is the
   *  source of truth (reduced in WS callbacks + the age tick, outside
   *  render) and the useState mirrors it for rendering. sweepAcks needs to
   *  read the CURRENT crisis synchronously to match ack instances. */
  const applyCrisis = useCallback((next: CrisisState) => {
    if (next === crisisRef.current) return;
    crisisRef.current = next;
    setCrisis(next);
  }, []);

  /** Tail-map writes go through here — tailsRef is the ONE source of truth
   *  (the WS chunk handler reduces off it), setTails mirrors it for
   *  rendering. Every writer (chunk append, pause toggle, stream drop)
   *  must use this, or the next incoming chunk silently reverts the
   *  divergent copy. */
  const applyTails = useCallback((next: TailMap) => {
    if (next === tailsRef.current) return;
    tailsRef.current = next;
    setTails(next);
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
          applyCrisis(reduceCrisisState(crisisRef.current, nextAgents, at));
        }
        setEconomy((previous) => reduceEconomy(previous, message));
        if (message.type === 'outputChunk') {
          const appended = appendChunk(tailsRef.current, message, at);
          if (appended !== tailsRef.current) {
            // LRU backstop over the stream MAP (panel finding,
            // tailStore.ts:103) — still-subscribed streams are protected;
            // the primary eviction is TailManager's onDropped below.
            applyTails(
              enforceStreamCap(
                appended,
                MAX_TAIL_STREAMS,
                new Set(managerRef.current?.activeKeys() ?? []),
              ),
            );
            // FLOOR FEED (phone-only, GAME-DESIGN-V3 §3.2 item 4) — a merged
            // agent-labeled log, fed only on a GENUINE new chunk (the same
            // dedupe tailStore just did, via the reference check above).
            const label = floorFeedLabel(
              message.source,
              message.id,
              agentsRef.current.get(Number(message.id))?.name,
            );
            setFloorFeed((previous) => appendFloorFeedEntry(previous, message, label, at));
          }
        }
        // Stage-3 panel ports — same "verbatim mirror" reducer convention.
        setSettings((previous) => reduceSettings(previous, message));
        setBudget((previous) => reduceBudget(previous, message));
        setAutomationStopped((previous) => reduceAutomationStopped(previous, message));
        if (message.type === 'dispatchUpdate') {
          setDispatchEntries((previous) => {
            const next = reduceDispatchEntries(previous, message, at);
            dispatchEntriesRef.current = next;
            return next;
          });
        }
        if (message.type === 'chainRunUpdate') {
          setChainRuns((previous) => reduceChainRuns(previous, message));
          setChainRunReceivedAt((previous) => reduceChainRunReceivedAt(previous, message, at));
        }
        if (message.type === 'agentDiagnostics') {
          setDiagnostics(message.agents);
        }
      },
      onStatus: (status) => {
        connectionStatusRef.current = status;
        setConnectionStatus(status);
        managerRef.current?.handleStatus(status);
      },
    });
    connectionRef.current = connection;
    // Last-release eviction (panel finding, tailStore.ts:103): when no
    // surface holds a stream any more (drawer closed, unpinned, agent left
    // the floor-feed roster), its buffered chunks are dropped — a later
    // re-acquire repopulates from the server's ring replay.
    managerRef.current = new TailManager(connection, (key) => {
      applyTails(dropStream(tailsRef.current, key));
    });
    return () => {
      connectionRef.current = null;
      managerRef.current = null;
      connection.dispose();
    };
  }, [applyCrisis, applyTails]);

  /** send() for panels that write to the real server (CALL modal, Settings
   *  toggles) — queued client-side until the WS is live (connection.ts's
   *  own behavior), never a no-op when momentarily offline. */
  const send = useCallback((message: ClientMessage) => {
    connectionRef.current?.send(message);
  }, []);

  // STOP ALL hydration (panel finding, StopAllControl.tsx:12): a fresh page
  // must reflect a halt issued earlier or from another client.
  // stoppedByKillSwitch on any standing order is the server's persisted
  // record of a halt awaiting RESUME. A fetch failure (or a chain-only halt
  // — state/stopAll.ts header) hydrates not-stopped: showing STOP ALL when
  // already stopped is a harmless idempotent re-halt, the safe direction.
  useEffect(() => {
    let cancelled = false;
    void fetch('/api/standing-orders')
      .then(async (res) => (res.ok ? ((await res.json()) as unknown) : []))
      .then((orders) => {
        if (cancelled || !Array.isArray(orders)) return;
        if (stoppedFromOrders(orders as { stoppedByKillSwitch?: boolean }[])) {
          setAutomationStopped(true);
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  // Age tick — board ages, poll TTLs (fires go out when a poll expires),
  // and lapsed ACK undo windows committing for real (instance-matched:
  // sweepAcks never lets a stale ack sweep a NEW failure reusing its key,
  // and drops acks whose debris was deleted — crisisStore.ts).
  useEffect(() => {
    const timer = setInterval(() => {
      const at = Date.now();
      setNow(at);
      const reduced = reduceCrisisState(crisisRef.current, agentsRef.current, at);
      const swept = sweepAcks(reduced, acksRef.current, at);
      if (swept.acks !== acksRef.current) applyAcks(swept.acks);
      applyCrisis(swept.crisis);
      // dispatchRequest has no ack on the wire — a send with no matching
      // dispatchUpdate within DISPATCH_SEND_TIMEOUT_MS is honestly reported
      // as "not queued" rather than silently doing nothing.
      if (pendingSendsRef.current.length > 0) {
        const { stillPending, failed } = detectSendFailures(
          pendingSendsRef.current,
          dispatchEntriesRef.current,
          at,
        );
        pendingSendsRef.current = stillPending;
        if (failed.length > 0) {
          setSendFailures((previous) => [
            ...previous,
            ...failed.map((f) => ({
              id: f.id,
              machine: f.machine,
              action: f.action,
              detectedAt: at,
            })),
          ]);
        }
      }
    }, TICK_MS);
    return () => {
      clearInterval(timer);
    };
  }, [applyAcks, applyCrisis]);

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

  // FLOOR FEED subscribes to EVERY current agent's tail (not just the
  // pinned/drawer-open ones) so the merged phone strip has real content
  // regardless of what else is open — same refcounted diff pattern as the
  // pin dock above.
  useEffect(() => {
    const manager = managerRef.current;
    if (!manager) return;
    const ids = [...agents.keys()];
    const previous = prevFloorFeedIdsRef.current;
    for (const id of ids) {
      if (!previous.includes(id)) manager.acquire('agent', String(id));
    }
    for (const id of previous) {
      if (!ids.includes(id)) manager.release('agent', String(id));
    }
    prevFloorFeedIdsRef.current = ids;
  }, [agents]);

  // Push-landing deep link (state/launch.ts): once the target agent shows
  // up in the live roster, auto-open its drawer exactly once — the board
  // itself is ALREADY the unconditional cold open (App's default layout),
  // this only adds the "+ auto-opened crisis sheet" half of the decision.
  useEffect(() => {
    const target = launchTargetRef.current;
    if (target === null || !agents.has(target)) return;
    launchTargetRef.current = null;
    setDrawerAgentId(target);
    startWalk(target);
  }, [agents, startWalk]);

  useEffect(() => {
    installTestHooksIfE2E({
      getRenderCount: () => renderCountRef.current,
      getAgentCount: () => occupantsRef.current.length,
      getResolution: () => lastResolutionRef.current,
      getCameraState: () => lastCameraRef.current,
      getAssetStats: () => ({
        props: propStore.stats(),
        characters: characterStore.stats(),
        images: imageStore.stats(),
      }),
    });
  }, [propStore, characterStore, imageStore]);

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

  /** ⏸ PAUSE / ▶ RESUME — reduces off tailsRef (panel finding, App.tsx:685):
   *  updating only the React state left tailsRef stale, and the very next
   *  incoming chunk (whose handler reduces off the ref) silently reverted
   *  the pause and showed the chunk anyway. applyTails keeps both in step. */
  const handleTogglePause = useCallback(
    (key: string) => {
      const current = tailsRef.current;
      applyTails(setPaused(current, key, !(current.get(key)?.paused ?? false)));
    },
    [applyTails],
  );

  // ── Stage-3 panel handlers ───────────────────────────────────────

  /** `?` reopens HELP from anywhere, except while typing (a prompt
   *  textarea legitimately contains "?" characters). */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '?') return;
      const target = e.target;
      const typing =
        target instanceof HTMLElement &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
      if (typing) return;
      setOpenPanel('help');
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  /** T6 item 4 — clears BOTH the JS-driven camera flight and the CSS grow
   *  origin. "Any input cancels": called from the global pointerdown/keydown
   *  listener below (every click/key anywhere in the app, including inside
   *  the just-opened panel itself), and defensively before starting a
   *  fresh flight. The early return matters beyond hygiene: once a flight
   *  has already finished/been cancelled, panelGrowOrigin is already null
   *  and MUST stay untouched — a redundant setPanelGrowOrigin(null) is a
   *  same-value no-op in React terms today, but this guard is the one
   *  place that invariant is enforced on purpose, not by accident. */
  const cancelPanelFlight = useCallback(() => {
    if (panelFlightRef.current === null) return;
    panelFlightRef.current = null;
    setPanelGrowOrigin(null);
  }, []);

  const closePanel = useCallback(() => {
    setOpenPanel(null);
  }, []);

  /** T6 item 4 — CAMERA-MOVE PANEL OPENS: opens `kind` and, if it has a
   *  real in-world prop (state/panelFlight.ts — never an invented anchor),
   *  flies the camera to that tile and grows the panel from its current
   *  screen position. Panels with no physical prop, a desk-walk already in
   *  flight, or a not-yet-measured world all degrade to a plain open —
   *  honest skip, never a fabricated anchor. */
  const openPanelWithFlight = useCallback(
    (kind: DockPanelKind) => {
      setOpenPanel(kind);
      const anchor = panelFlightAnchor(kind);
      const container = containerRef.current;
      const camera = lastCameraRef.current;
      if (!anchor || !container || !camera || walkRef.current.from !== null) {
        cancelPanelFlight();
        return;
      }
      const { worldX, worldY } = tileToWorld(anchor.tileX, anchor.tileY);
      const canvasPoint = worldToCanvas(camera, worldX, worldY);
      const rect = container.getBoundingClientRect();
      const viewportX = rect.left + canvasPoint.x;
      const viewportY = rect.top + canvasPoint.y;
      panelFlightRef.current = {
        from: camera,
        target: { worldX, worldY },
        startTs: performance.now(),
      };
      setPanelGrowOrigin({
        dx: viewportX - window.innerWidth / 2,
        dy: viewportY - window.innerHeight / 2,
      });
      ensureWalkLoop();
    },
    [cancelPanelFlight, ensureWalkLoop],
  );

  const handleOpenHotspot = useCallback(
    (kind: HotspotKind) => {
      openPanelWithFlight(kind);
    },
    [openPanelWithFlight],
  );

  // T6 item 4, "skippable": ANY input while a panel-open flight/grow is in
  // progress cancels it immediately — capture phase so it fires before the
  // event reaches whatever it's aimed at, but harmless (a plain state
  // clear, no preventDefault) when nothing is flying.
  useEffect(() => {
    const cancel = () => {
      cancelPanelFlight();
    };
    window.addEventListener('pointerdown', cancel, { capture: true });
    window.addEventListener('keydown', cancel, { capture: true });
    return () => {
      window.removeEventListener('pointerdown', cancel, { capture: true });
      window.removeEventListener('keydown', cancel, { capture: true });
    };
  }, [cancelPanelFlight]);

  const handleDispatchSend = useCallback(
    (machine: string, action: DispatchActionValue, requestId: string) => {
      // The pending id IS the wire requestId (CallModal generated it) — the
      // tick's detectSendFailures matches the echoed dispatchUpdate on it.
      pendingSendsRef.current = [
        ...pendingSendsRef.current,
        { id: requestId, machine, action, sentAt: Date.now() },
      ];
    },
    [],
  );

  const handleDispatchTodo = useCallback((prompt: string) => {
    setCallPrefill({ prompt });
    setOpenPanel('call');
  }, []);

  const handleDispatchContract = useCallback((contract: { id: string; title: string }) => {
    setCallPrefill({
      prompt: `Contract ${contract.id}: ${contract.title}`,
      contractId: contract.id,
    });
    setOpenPanel('call');
  }, []);

  const handleToggleSound = useCallback(() => {
    setSettings((previous) => {
      if (previous === null) return previous;
      const enabled = !previous.soundEnabled;
      send({ type: 'setSoundEnabled', enabled });
      return { ...previous, soundEnabled: enabled };
    });
  }, [send]);

  const handleToggleWatchAllSessions = useCallback(() => {
    setSettings((previous) => {
      if (previous === null) return previous;
      const enabled = !previous.watchAllSessions;
      send({ type: 'setWatchAllSessions', enabled });
      return { ...previous, watchAllSessions: enabled };
    });
  }, [send]);

  const handleToggleHooksEnabled = useCallback(() => {
    setSettings((previous) => {
      if (previous === null) return previous;
      const enabled = !previous.hooksEnabled;
      send({ type: 'setHooksEnabled', enabled });
      return { ...previous, hooksEnabled: enabled };
    });
  }, [send]);

  const handleToggleAlwaysShowLabels = useCallback(() => {
    setSettings((previous) => {
      if (previous === null) return previous;
      const enabled = !previous.alwaysShowLabels;
      send({ type: 'setAlwaysShowLabels', enabled });
      return { ...previous, alwaysShowLabels: enabled };
    });
  }, [send]);

  const handleRequestDiagnostics = useCallback(() => {
    send({ type: 'requestDiagnostics' });
  }, [send]);

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
        soundscapeMuted={soundscapeMuted}
        onToggleSoundscape={handleToggleSoundscape}
        automationStopped={automationStopped}
        onAutomationStoppedChange={setAutomationStopped}
        onToggleGrayscale={() => {
          setGrayscale((value) => !value);
        }}
        onToggleView={() => {
          setView((value) => (value === 'floor' ? 'board' : 'floor'));
        }}
        onOpenReal={setRealKind}
        onOpenCall={() => {
          openPanelWithFlight('call');
        }}
        onOpenShift={() => {
          openPanelWithFlight('shift');
        }}
        onOpenHelp={() => {
          openPanelWithFlight('help');
        }}
      />
      <div className="surfaces" data-view={view}>
        <div className="world" ref={containerRef}>
          <canvas
            data-testid="iso-canvas"
            ref={canvasRef}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
          />
          <ChipLayer frame={chipFrame} occupants={occupants} onChipClick={handleDesk} />
          <DispatchVisitorChips frame={chipFrame} visitors={dispatchVisitors} />
          <SpeechBubbleLayer
            frame={chipFrame}
            bubbles={visibleSpeechBubbles}
            occupants={occupants}
            onTapAgent={handleDesk}
          />
          {/* Room-is-interface half of the desktop chrome model — desktop
              only (CSS-hidden on phone, matching the pin dock's own
              breakpoint: no free camera play there). */}
          <PropHotspots frame={chipFrame} onOpen={handleOpenHotspot} />
        </div>
        <TriageBoard
          agents={agents}
          crisis={crisis}
          acks={acks}
          now={now}
          onDesk={handleDesk}
          onAck={(key, since) => {
            applyAcks(requestAck(acksRef.current, key, since, Date.now()));
          }}
          onUndoAck={(key) => {
            applyAcks(undoAck(acksRef.current, key));
          }}
        />
        {/* Phone-only (CSS-gated): GAME-DESIGN-V3 §3.2 item 4, below the
            triage board, remaining-height merged tail strip. */}
        <FloorFeed entries={floorFeed} />
        {/* Inside .surfaces (the below-HUD region) so the drawer's own
            header — with ✕ CLOSE — can never render underneath the HUD
            strip (z 60): anchored at the root it started at viewport
            top: 0 and the HUD painted over the close button on desktop
            (found on real-device acceptance, 2026-07-10). */}
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
      <RealSheet
        content={realContent}
        onClose={() => {
          setRealKind(null);
        }}
      />

      <DispatchTray
        entries={dispatchEntries}
        sendFailures={sendFailures}
        onDismiss={(id) => {
          setDispatchEntries((previous) => previous.filter((e) => e.id !== id));
        }}
        onView={setViewingResult}
        onRelease={(id) => {
          // T5 fleet controls: the real override — dispatchStore.releaseHeld
          // itself re-broadcasts the record as 'ringing', so no optimistic
          // local update here; the WS dispatchUpdate is the honest source.
          void fetch(`/api/dispatch/${id}/release`, { method: 'POST' });
        }}
        onClearDone={() => {
          setDispatchEntries(clearTerminalDispatchEntries);
        }}
      />
      {/* Compact-dock half of the desktop chrome model — the cross-platform
          affordance (works on phone too, where PropHotspots doesn't apply). */}
      <PanelDock onOpen={openPanelWithFlight} />

      {/* T6 item 4 — CAMERA-MOVE PANEL OPENS: one shared grow-origin value
          for every Modal-based panel (components/Modal.tsx reads it via
          context) — only whichever panel is actually `isOpen` ever renders
          it, so this single provider is safe for all of them at once. */}
      <PanelGrowOriginProvider value={panelGrowOrigin}>
        <HelpModal isOpen={openPanel === 'help'} onClose={closePanel} />
        <SettingsModal
          isOpen={openPanel === 'settings'}
          onClose={closePanel}
          settings={settings}
          onToggleSound={handleToggleSound}
          onToggleWatchAllSessions={handleToggleWatchAllSessions}
          onToggleHooksEnabled={handleToggleHooksEnabled}
          onToggleAlwaysShowLabels={handleToggleAlwaysShowLabels}
        />
        <DebugView
          isOpen={openPanel === 'debug'}
          onClose={closePanel}
          agents={agents}
          connectionStatus={connectionStatus}
          crisis={crisis}
          economy={economy}
          diagnostics={diagnostics}
          onRequestDiagnostics={handleRequestDiagnostics}
        />
        <CallModal
          isOpen={openPanel === 'call'}
          onClose={() => {
            closePanel();
            setCallPrefill(null);
          }}
          prefill={callPrefill}
          send={send}
          onSend={handleDispatchSend}
          budget={budget}
        />
        <ShiftPanel isOpen={openPanel === 'shift'} onClose={closePanel} />
        <BriefingPanel
          isOpen={openPanel === 'briefing'}
          onClose={closePanel}
          onDispatchTodo={handleDispatchTodo}
        />
        <AutomationPanel
          isOpen={openPanel === 'automation'}
          onClose={closePanel}
          chainRuns={chainRuns}
          chainRunReceivedAt={chainRunReceivedAt}
          now={now}
          automationStopped={automationStopped}
          onAutomationStoppedChange={setAutomationStopped}
        />
        <ContractsPanel
          isOpen={openPanel === 'contracts'}
          onClose={closePanel}
          onDispatchContract={handleDispatchContract}
        />
        <OpsReviewPanel
          isOpen={openPanel === 'ops'}
          onClose={closePanel}
          send={send}
          onDispatchSend={handleDispatchSend}
          dispatchEntries={dispatchEntries}
          sendFailures={sendFailures}
        />
        <GraphSearchPanel isOpen={openPanel === 'graph-search'} onClose={closePanel} />
        <DistrictsView isOpen={openPanel === 'districts'} onClose={closePanel} />
        <InboxPanel isOpen={openPanel === 'inbox'} onClose={closePanel} />
      </PanelGrowOriginProvider>

      {viewingResult && (
        <div className="modal-backdrop" onClick={() => setViewingResult(null)}>
          <div className="modal" role="dialog" onClick={(e) => e.stopPropagation()}>
            <header className="modal__head">
              <span className="modal__title">RESULT — {viewingResult.machine}</span>
              <button
                type="button"
                className="verb"
                onClick={() => {
                  setViewingResult(null);
                }}
              >
                ✕ CLOSE
              </button>
            </header>
            <div className="modal__body">
              <pre className="dispatch-result">
                {viewingResult.resultTail ?? '(no output captured)'}
              </pre>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
