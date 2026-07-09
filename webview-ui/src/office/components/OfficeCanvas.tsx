import type { Application } from 'pixi.js';
import { Rectangle } from 'pixi.js';
import { useCallback, useEffect, useRef } from 'react';

import { ambience } from '../../ambience.js';
import {
  BAY_COLS_WIDTH,
  BAY_MAX_COUNT,
  bayCost,
  CAMERA_FOLLOW_LERP,
  CAMERA_FOLLOW_SNAP_THRESHOLD,
  PAN_MARGIN_FRACTION,
  ZOOM_MAX,
  ZOOM_MIN,
  ZOOM_SCROLL_THRESHOLD,
} from '../../constants.js';
import { unlockAudio } from '../../notificationSound.js';
import { transport } from '../../transport/index.js';
import { stageForAge } from '../crisis.js';
import { canPlaceFurniture, getWallPlacementRow } from '../editor/editorActions.js';
import type { EditorState } from '../editor/editorState.js';
import type { OfficeState } from '../engine/officeState.js';
import { startPixiApp } from '../engine/pixiApp.js';
import type {
  DeleteButtonBounds,
  PixiEditorState,
  PixiLayers,
  PixiSelectionState,
  PixiSpritePools,
  RotateButtonBounds,
} from '../engine/pixiRenderer.js';
import {
  createPixiLayers,
  createSpritePools,
  getSpriteTexture,
  renderFrame as renderPixiFrame,
} from '../engine/pixiRenderer.js';
import {
  computePinchPanDelta,
  computePinchZoomStep,
  computeTwoFingerGesture,
} from '../engine/touchCamera.js';
import { getCatalogEntry, isRotatable } from '../layout/furnitureCatalog.js';
import { EditTool, TILE_SIZE } from '../types.js';
import { computeNormalModeCursor } from './officeCanvasCursor.js';

interface OfficeCanvasProps {
  officeState: OfficeState;
  onClick: (agentId: number) => void;
  isEditMode: boolean;
  editorState: EditorState;
  onEditorTileAction: (col: number, row: number) => void;
  onEditorEraseAction: (col: number, row: number) => void;
  onEditorSelectionChange: () => void;
  onDeleteSelected: () => void;
  onRotateSelected: () => void;
  onDragMove: (uid: string, newCol: number, newRow: number) => void;
  zoom: number;
  onZoomChange: (zoom: number) => void;
  panRef: React.MutableRefObject<{ x: number; y: number }>;
  /** G2, GAME-DESIGN §5.7 — server-authoritative build actions. */
  onRoomTagCommit: (colStart: number, rowStart: number, colEnd: number, rowEnd: number) => void;
  onSellCommit: (uid: string) => void;
  /** G2, GAME-DESIGN §5.2 — bays already purchased, for the next-bay LOCKED
   *  ghost preview's cost label. */
  bayCount: number;
}

/** Touch pointers currently down on the canvas, keyed by Pixi pointerId —
 *  drives the two-finger pan/pinch-zoom gesture recognizer (task 9). */
interface TrackedPointer {
  x: number;
  y: number;
}

const LONG_PRESS_MS = 500;
const LONG_PRESS_MOVE_TOLERANCE_PX = 8;

export function OfficeCanvas({
  officeState,
  onClick,
  isEditMode,
  editorState,
  onEditorTileAction,
  onEditorEraseAction,
  onEditorSelectionChange,
  onDeleteSelected,
  onRotateSelected,
  onDragMove,
  zoom,
  onZoomChange,
  panRef,
  onRoomTagCommit,
  onSellCommit,
  bayCount,
}: OfficeCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const offsetRef = useRef({ x: 0, y: 0 });
  // Middle-mouse pan state (imperative, no re-renders)
  const isPanningRef = useRef(false);
  const panStartRef = useRef({ mouseX: 0, mouseY: 0, panX: 0, panY: 0 });
  // Delete/rotate button bounds (updated each frame by renderer)
  const deleteButtonBoundsRef = useRef<DeleteButtonBounds | null>(null);
  const rotateButtonBoundsRef = useRef<RotateButtonBounds | null>(null);
  // Right-click erase dragging
  const isEraseDraggingRef = useRef(false);
  // Zoom scroll accumulator for trackpad pinch sensitivity
  const zoomAccumulatorRef = useRef(0);
  // Sound layer (v1): last-seen fire stage per agent (chirp on escalation)
  // and already-announced extinguish effects (ding on observed resolution) —
  // both mirror the exact visible signal 1:1, never carry extra information.
  const crisisStageRef = useRef<Map<number, string>>(new Map());
  const announcedExtinguishRef = useRef<WeakSet<object>>(new WeakSet());
  // Pixi engine scene (null until Application.init() resolves — G0)
  const pixiSceneRef = useRef<{
    app: Application;
    layers: PixiLayers;
    pools: PixiSpritePools;
  } | null>(null);
  // Touch gesture state (task 9 — two-finger pan/pinch-zoom, long-press)
  const touchPointersRef = useRef<Map<number, TrackedPointer>>(new Map());
  const twoFingerGestureRef = useRef<{ midX: number; midY: number; dist: number } | null>(null);
  const longPressRef = useRef<{
    timer: ReturnType<typeof setTimeout>;
    startX: number;
    startY: number;
    pointerId: number;
  } | null>(null);

  // Clamp pan so the map edge can't go past a margin inside the viewport
  const clampPan = useCallback(
    (px: number, py: number): { x: number; y: number } => {
      const canvas = canvasRef.current;
      if (!canvas) return { x: px, y: py };
      const layout = officeState.getLayout();
      const mapW = layout.cols * TILE_SIZE * zoom;
      const mapH = layout.rows * TILE_SIZE * zoom;
      const marginX = canvas.width * PAN_MARGIN_FRACTION;
      const marginY = canvas.height * PAN_MARGIN_FRACTION;
      const maxPanX = mapW / 2 + canvas.width / 2 - marginX;
      const maxPanY = mapH / 2 + canvas.height / 2 - marginY;
      return {
        x: Math.max(-maxPanX, Math.min(maxPanX, px)),
        y: Math.max(-maxPanY, Math.min(maxPanY, py)),
      };
    },
    [officeState, zoom],
  );

  // Shared per-frame sim step: office FSM tick + sound-layer bookkeeping.
  // Identical for both engines — only how the VISUAL frame gets drawn
  // afterward differs (canvas ctx draw calls vs Pixi scene-graph mutation).
  const stepSimulation = useCallback(
    (dt: number) => {
      officeState.update(dt);

      const now = Date.now();
      const seenIds = new Set<number>();
      for (const ch of officeState.characters.values()) {
        if (!ch.crisis || ch.matrixEffect === 'despawn') continue;
        seenIds.add(ch.id);
        const stage = stageForAge(now - ch.crisis.since);
        const prevStage = crisisStageRef.current.get(ch.id);
        if (stage !== prevStage) {
          if (stage === 'fire' || stage === 'alarm') {
            ambience.playAlarmChirp(now);
          }
          crisisStageRef.current.set(ch.id, stage);
        }
      }
      for (const id of crisisStageRef.current.keys()) {
        if (!seenIds.has(id)) crisisStageRef.current.delete(id);
      }

      for (const effect of officeState.crisisEffects) {
        if (announcedExtinguishRef.current.has(effect)) continue;
        announcedExtinguishRef.current.add(effect);
        ambience.playResolvedDing(now);
      }
    },
    [officeState],
  );

  // Camera follow + night-mode ambience duck — identical for both engines.
  const applyCameraFollowAndAmbience = useCallback(() => {
    if (officeState.cameraFollowId !== null) {
      const followCh = officeState.characters.get(officeState.cameraFollowId);
      if (followCh) {
        const layout = officeState.getLayout();
        const mapW = layout.cols * TILE_SIZE * zoom;
        const mapH = layout.rows * TILE_SIZE * zoom;
        const targetX = mapW / 2 - followCh.x * zoom;
        const targetY = mapH / 2 - followCh.y * zoom;
        const dx = targetX - panRef.current.x;
        const dy = targetY - panRef.current.y;
        if (
          Math.abs(dx) < CAMERA_FOLLOW_SNAP_THRESHOLD &&
          Math.abs(dy) < CAMERA_FOLLOW_SNAP_THRESHOLD
        ) {
          panRef.current = { x: targetX, y: targetY };
        } else {
          panRef.current = {
            x: panRef.current.x + dx * CAMERA_FOLLOW_LERP,
            y: panRef.current.y + dy * CAMERA_FOLLOW_LERP,
          };
        }
      }
    }
    const isNightMode = officeState.characters.size === 0;
    ambience.setNightMode(isNightMode);
    return isNightMode;
  }, [officeState, zoom, panRef]);

  // Build the editor-overlay render state consumed by pixiRenderer.ts.
  const buildEditorRenderState = useCallback((): PixiEditorState | undefined => {
    if (!isEditMode) return undefined;
    const showGhostBorder =
      editorState.activeTool === EditTool.TILE_PAINT ||
      editorState.activeTool === EditTool.WALL_PAINT ||
      editorState.activeTool === EditTool.ERASE;
    const editorRender: PixiEditorState = {
      showGrid: true,
      ghostSprite: null,
      ghostMirrored: false,
      ghostCol: editorState.ghostCol,
      ghostRow: editorState.ghostRow,
      ghostValid: editorState.ghostValid,
      selectedCol: 0,
      selectedRow: 0,
      selectedW: 0,
      selectedH: 0,
      hasSelection: false,
      isRotatable: false,
      deleteButtonBounds: null,
      rotateButtonBounds: null,
      showGhostBorder,
      ghostBorderHoverCol: showGhostBorder ? editorState.ghostCol : -999,
      ghostBorderHoverRow: showGhostBorder ? editorState.ghostRow : -999,
      roomTagRect:
        editorState.activeTool === EditTool.ROOM_TAG &&
        editorState.isRoomTagging &&
        editorState.ghostCol >= 0
          ? {
              colStart: Math.min(editorState.roomTagStartCol, editorState.ghostCol),
              rowStart: Math.min(editorState.roomTagStartRow, editorState.ghostRow),
              colEnd: Math.max(editorState.roomTagStartCol, editorState.ghostCol) + 1,
              rowEnd: Math.max(editorState.roomTagStartRow, editorState.ghostRow) + 1,
            }
          : null,
      bayGhost:
        bayCount < BAY_MAX_COUNT
          ? {
              col: officeState.getLayout().cols,
              row: 0,
              w: BAY_COLS_WIDTH,
              h: officeState.getLayout().rows,
              cost: bayCost(bayCount),
            }
          : null,
    };

    if (editorState.activeTool === EditTool.FURNITURE_PLACE && editorState.ghostCol >= 0) {
      const entry = getCatalogEntry(editorState.selectedFurnitureType);
      if (entry) {
        const placementRow = getWallPlacementRow(
          editorState.selectedFurnitureType,
          editorState.ghostRow,
        );
        editorRender.ghostSprite = entry.sprite;
        editorRender.ghostRow = placementRow;
        editorRender.ghostMirrored =
          !!entry.mirrorSide && editorState.selectedFurnitureType.endsWith(':left');
        editorRender.ghostValid = canPlaceFurniture(
          officeState.getLayout(),
          editorState.selectedFurnitureType,
          editorState.ghostCol,
          placementRow,
        );
      }
    }

    if (editorState.isDragMoving && editorState.dragUid && editorState.ghostCol >= 0) {
      const draggedItem = officeState
        .getLayout()
        .furniture.find((f) => f.uid === editorState.dragUid);
      if (draggedItem) {
        const entry = getCatalogEntry(draggedItem.type);
        if (entry) {
          const ghostCol = editorState.ghostCol - editorState.dragOffsetCol;
          const ghostRow = editorState.ghostRow - editorState.dragOffsetRow;
          editorRender.ghostSprite = entry.sprite;
          editorRender.ghostCol = ghostCol;
          editorRender.ghostRow = ghostRow;
          editorRender.ghostMirrored = !!entry.mirrorSide && draggedItem.type.endsWith(':left');
          editorRender.ghostValid = canPlaceFurniture(
            officeState.getLayout(),
            draggedItem.type,
            ghostCol,
            ghostRow,
            editorState.dragUid,
          );
        }
      }
    }

    if (editorState.selectedFurnitureUid && !editorState.isDragMoving) {
      const item = officeState
        .getLayout()
        .furniture.find((f) => f.uid === editorState.selectedFurnitureUid);
      if (item) {
        const entry = getCatalogEntry(item.type);
        if (entry) {
          editorRender.hasSelection = true;
          editorRender.selectedCol = item.col;
          editorRender.selectedRow = item.row;
          editorRender.selectedW = entry.footprintW;
          editorRender.selectedH = entry.footprintH;
          editorRender.isRotatable = isRotatable(item.type);
        }
      }
    }

    return editorRender;
  }, [isEditMode, editorState, officeState, bayCount]);

  const buildSelectionRenderState = useCallback(
    (): PixiSelectionState => ({
      selectedAgentId: officeState.selectedAgentId,
      hoveredAgentId: officeState.hoveredAgentId,
      hoveredTile: officeState.hoveredTile,
      seats: officeState.seats,
      characters: officeState.characters,
    }),
    [officeState],
  );

  // KICKOFF v1.1 item 2a — latest-value refs for the run-once Pixi ticker
  // effect below. isEditMode/editorState/_editorTick/zoom and the four
  // useCallback-wrapped functions above all change identity on ordinary
  // interaction (paint-drags, color-slider drags, zoom, edit-mode toggle).
  // The mount effect must run exactly once (mount/unmount), so the ticker
  // can't close over these directly — it would freeze on whatever was live
  // at mount. Instead it reads these refs every frame; this separate effect
  // is the only thing that keeps them current, and it's cheap to re-run as
  // often as its real deps change since it never touches Pixi or the canvas.
  const stepSimulationRef = useRef(stepSimulation);
  const buildEditorRenderStateRef = useRef(buildEditorRenderState);
  const buildSelectionRenderStateRef = useRef(buildSelectionRenderState);
  const applyCameraFollowAndAmbienceRef = useRef(applyCameraFollowAndAmbience);
  const zoomRef = useRef(zoom);

  useEffect(() => {
    stepSimulationRef.current = stepSimulation;
    buildEditorRenderStateRef.current = buildEditorRenderState;
    buildSelectionRenderStateRef.current = buildSelectionRenderState;
    applyCameraFollowAndAmbienceRef.current = applyCameraFollowAndAmbience;
    zoomRef.current = zoom;
  }, [
    stepSimulation,
    buildEditorRenderState,
    buildSelectionRenderState,
    applyCameraFollowAndAmbience,
    zoom,
  ]);

  // KICKOFF v1.1 item 2 — run once per mount/unmount (empty deps), NOT on
  // every isEditMode/_editorTick/zoom/bayCount change. The old version of
  // this effect re-ran on every one of those, disposing and recreating the
  // Pixi Application each time (force-losing the WebGL context on the
  // reused canvas, blank frames during the async re-init) — that was the
  // disappearing-view bug's primary mechanism (2a). officeState, editorState
  // and panRef are stable singleton/ref identities (never reassigned), so
  // reading them directly here (not via a ref) is safe; everything else the
  // ticker needs comes from the *Ref indirection above.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const handle = startPixiApp(canvas, {
      update: (dt) => {
        const scene = pixiSceneRef.current;
        if (!scene) return; // ready.then() below hasn't landed yet — skip this tick
        stepSimulationRef.current(dt);

        const editorRender = buildEditorRenderStateRef.current();
        applyCameraFollowAndAmbienceRef.current();
        const selectionRender = buildSelectionRenderStateRef.current();
        const isNightMode = officeState.characters.size === 0;

        const { offsetX, offsetY } = renderPixiFrame(
          scene.layers,
          scene.pools,
          canvas.width,
          canvas.height,
          officeState.tileMap,
          officeState.furniture,
          officeState.getCharacters(),
          zoomRef.current,
          panRef.current.x,
          panRef.current.y,
          getSpriteTexture,
          selectionRender,
          editorRender,
          officeState.getLayout().tileColors,
          officeState.getLayout().cols,
          officeState.getLayout().rows,
          officeState.pets,
          {
            debris: officeState.debris.values(),
            effects: officeState.crisisEffects,
            now: Date.now(),
            nightMode: isNightMode,
          },
        );
        offsetRef.current = { x: offsetX, y: offsetY };
        deleteButtonBoundsRef.current = editorRender?.deleteButtonBounds ?? null;
        rotateButtonBoundsRef.current = editorRender?.rotateButtonBounds ?? null;
      },
    });

    let observer: ResizeObserver | null = null;

    handle.ready
      .then((app) => {
        const layers = createPixiLayers(app.stage);
        const pools = createSpritePools();
        pixiSceneRef.current = { app, layers, pools };
        app.stage.eventMode = 'static';
        app.stage.hitArea = new Rectangle(0, 0, canvas.width, canvas.height);

        // KICKOFF v1.1 item 2b — Pixi's own ResizePlugin (resizeTo +
        // autoDensity + resolution, see pixiApp.ts) is now the single owner
        // of canvas.width/height (device px) and canvas.style.width/height
        // (CSS px) on every `renderer.resize()` call. But ResizePlugin only
        // listens for the window's native "resize" event (verified against
        // pixi.js@8.19.0's ResizePlugin source) — it does not observe this
        // container specifically, so a container-only resize (e.g. a side
        // panel opening/closing with the window itself unchanged) needs an
        // explicit nudge. This ResizeObserver drives that SAME
        // renderer.resize() the ResizePlugin itself calls, so there remains
        // exactly one owner of the width/height math either way; the
        // renderer's own "resize" event (fired by both trigger paths) is
        // what keeps stage.hitArea in sync afterward.
        app.renderer.on('resize', () => {
          app.stage.hitArea = new Rectangle(0, 0, canvas.width, canvas.height);
        });

        observer = new ResizeObserver(() => {
          const container = containerRef.current;
          if (!container) return;
          app.renderer.resize(container.clientWidth, container.clientHeight);
        });
        if (containerRef.current) observer.observe(containerRef.current);
      })
      .catch(() => {
        // Disposed before init resolved (fast unmount) — nothing to build.
      });

    return () => {
      handle.dispose();
      pixiSceneRef.current = null;
      observer?.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Convert CSS mouse coords to world (sprite pixel) coords
  const screenToWorld = useCallback(
    (clientX: number, clientY: number) => {
      const canvas = canvasRef.current;
      if (!canvas) return null;
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      // CSS coords relative to canvas
      const cssX = clientX - rect.left;
      const cssY = clientY - rect.top;
      // Convert to device pixels
      const deviceX = cssX * dpr;
      const deviceY = cssY * dpr;
      // Convert to world (sprite pixel) coords
      const worldX = (deviceX - offsetRef.current.x) / zoom;
      const worldY = (deviceY - offsetRef.current.y) / zoom;
      return { worldX, worldY, screenX: cssX, screenY: cssY, deviceX, deviceY };
    },
    [zoom],
  );

  const screenToTile = useCallback(
    (clientX: number, clientY: number): { col: number; row: number } | null => {
      const pos = screenToWorld(clientX, clientY);
      if (!pos) return null;
      const col = Math.floor(pos.worldX / TILE_SIZE);
      const row = Math.floor(pos.worldY / TILE_SIZE);
      const layout = officeState.getLayout();
      // In edit mode with floor/wall/erase tool, extend valid range by 1 for ghost border
      if (
        isEditMode &&
        (editorState.activeTool === EditTool.TILE_PAINT ||
          editorState.activeTool === EditTool.WALL_PAINT ||
          editorState.activeTool === EditTool.ERASE)
      ) {
        if (col < -1 || col > layout.cols || row < -1 || row > layout.rows) return null;
        return { col, row };
      }
      if (col < 0 || col >= layout.cols || row < 0 || row >= layout.rows) return null;
      return { col, row };
    },
    [screenToWorld, officeState, isEditMode, editorState],
  );

  // Check if device-pixel coords hit the delete button
  const hitTestDeleteButton = useCallback((deviceX: number, deviceY: number): boolean => {
    const bounds = deleteButtonBoundsRef.current;
    if (!bounds) return false;
    const dx = deviceX - bounds.cx;
    const dy = deviceY - bounds.cy;
    return dx * dx + dy * dy <= (bounds.radius + 2) * (bounds.radius + 2); // small padding
  }, []);

  // Check if device-pixel coords hit the rotate button
  const hitTestRotateButton = useCallback((deviceX: number, deviceY: number): boolean => {
    const bounds = rotateButtonBoundsRef.current;
    if (!bounds) return false;
    const dx = deviceX - bounds.cx;
    const dy = deviceY - bounds.cy;
    return dx * dx + dy * dy <= (bounds.radius + 2) * (bounds.radius + 2);
  }, []);

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      // Handle middle-mouse panning
      if (isPanningRef.current) {
        const dpr = window.devicePixelRatio || 1;
        const dx = (e.clientX - panStartRef.current.mouseX) * dpr;
        const dy = (e.clientY - panStartRef.current.mouseY) * dpr;
        panRef.current = clampPan(panStartRef.current.panX + dx, panStartRef.current.panY + dy);
        return;
      }

      if (isEditMode) {
        const tile = screenToTile(e.clientX, e.clientY);
        if (tile) {
          editorState.ghostCol = tile.col;
          editorState.ghostRow = tile.row;

          // Drag-to-move: check if cursor moved to different tile
          if (editorState.dragUid && !editorState.isDragMoving) {
            if (tile.col !== editorState.dragStartCol || tile.row !== editorState.dragStartRow) {
              editorState.isDragMoving = true;
            }
          }

          // Paint on drag (tile/wall/erase paint tool only, not during furniture drag)
          if (
            editorState.isDragging &&
            (editorState.activeTool === EditTool.TILE_PAINT ||
              editorState.activeTool === EditTool.WALL_PAINT ||
              editorState.activeTool === EditTool.ERASE) &&
            !editorState.dragUid
          ) {
            onEditorTileAction(tile.col, tile.row);
          }
          // Right-click erase drag
          if (
            isEraseDraggingRef.current &&
            (editorState.activeTool === EditTool.TILE_PAINT ||
              editorState.activeTool === EditTool.WALL_PAINT ||
              editorState.activeTool === EditTool.ERASE)
          ) {
            const layout = officeState.getLayout();
            if (
              tile.col >= 0 &&
              tile.col < layout.cols &&
              tile.row >= 0 &&
              tile.row < layout.rows
            ) {
              onEditorEraseAction(tile.col, tile.row);
            }
          }
        } else {
          editorState.ghostCol = -1;
          editorState.ghostRow = -1;
        }

        // Cursor: show grab during drag, pointer over delete button, crosshair otherwise
        const canvas = canvasRef.current;
        if (canvas) {
          if (editorState.isDragMoving) {
            canvas.style.cursor = 'grabbing';
          } else {
            const pos = screenToWorld(e.clientX, e.clientY);
            if (
              pos &&
              (hitTestDeleteButton(pos.deviceX, pos.deviceY) ||
                hitTestRotateButton(pos.deviceX, pos.deviceY))
            ) {
              canvas.style.cursor = 'pointer';
            } else if (editorState.activeTool === EditTool.FURNITURE_PICK && tile) {
              // Pick mode: show pointer over furniture, crosshair elsewhere
              const layout = officeState.getLayout();
              const hitFurniture = layout.furniture.find((f) => {
                const entry = getCatalogEntry(f.type);
                if (!entry) return false;
                return (
                  tile.col >= f.col &&
                  tile.col < f.col + entry.footprintW &&
                  tile.row >= f.row &&
                  tile.row < f.row + entry.footprintH
                );
              });
              canvas.style.cursor = hitFurniture ? 'pointer' : 'crosshair';
            } else if (
              (editorState.activeTool === EditTool.SELECT ||
                (editorState.activeTool === EditTool.FURNITURE_PLACE &&
                  editorState.selectedFurnitureType === '')) &&
              tile
            ) {
              // Check if hovering over furniture
              const layout = officeState.getLayout();
              const hitFurniture = layout.furniture.find((f) => {
                const entry = getCatalogEntry(f.type);
                if (!entry) return false;
                return (
                  tile.col >= f.col &&
                  tile.col < f.col + entry.footprintW &&
                  tile.row >= f.row &&
                  tile.row < f.row + entry.footprintH
                );
              });
              canvas.style.cursor = hitFurniture ? 'grab' : 'crosshair';
            } else {
              canvas.style.cursor = 'crosshair';
            }
          }
        }
        return;
      }

      const pos = screenToWorld(e.clientX, e.clientY);
      if (!pos) return;
      const hitId = officeState.getCharacterAt(pos.worldX, pos.worldY);
      // Only run pet hit-test if no character was hit (avoids redundant work).
      const petId = hitId === null ? officeState.getPetAt(pos.worldX, pos.worldY) : null;
      const tile = screenToTile(e.clientX, e.clientY);
      officeState.hoveredTile = tile;
      const canvas = canvasRef.current;
      if (canvas) {
        canvas.style.cursor = computeNormalModeCursor({
          hitId,
          petId,
          selectedAgentId: officeState.selectedAgentId,
          tile,
          getSeatAtTile: (col, row) => officeState.getSeatAtTile(col, row),
          getSeat: (seatId) => officeState.seats.get(seatId),
          getCharacter: (id) => officeState.characters.get(id),
        });
      }
      officeState.hoveredAgentId = hitId;
    },
    [
      officeState,
      screenToWorld,
      screenToTile,
      isEditMode,
      editorState,
      onEditorTileAction,
      onEditorEraseAction,
      panRef,
      hitTestDeleteButton,
      hitTestRotateButton,
      clampPan,
    ],
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      unlockAudio();
      ambience.arm();
      // Middle mouse button (button 1) starts panning
      if (e.button === 1) {
        e.preventDefault();
        // Break camera follow on manual pan
        officeState.cameraFollowId = null;
        isPanningRef.current = true;
        panStartRef.current = {
          mouseX: e.clientX,
          mouseY: e.clientY,
          panX: panRef.current.x,
          panY: panRef.current.y,
        };
        const canvas = canvasRef.current;
        if (canvas) canvas.style.cursor = 'grabbing';
        return;
      }

      // Right-click in edit mode for erasing
      if (e.button === 2 && isEditMode) {
        const tile = screenToTile(e.clientX, e.clientY);
        if (
          tile &&
          (editorState.activeTool === EditTool.TILE_PAINT ||
            editorState.activeTool === EditTool.WALL_PAINT ||
            editorState.activeTool === EditTool.ERASE)
        ) {
          const layout = officeState.getLayout();
          if (tile.col >= 0 && tile.col < layout.cols && tile.row >= 0 && tile.row < layout.rows) {
            isEraseDraggingRef.current = true;
            onEditorEraseAction(tile.col, tile.row);
          }
        }
        return;
      }

      if (!isEditMode) return;

      // Check rotate/delete button hit first
      const pos = screenToWorld(e.clientX, e.clientY);
      if (pos && hitTestRotateButton(pos.deviceX, pos.deviceY)) {
        onRotateSelected();
        return;
      }
      if (pos && hitTestDeleteButton(pos.deviceX, pos.deviceY)) {
        onDeleteSelected();
        return;
      }

      const tile = screenToTile(e.clientX, e.clientY);

      // ROOM_TAG (G2, §5.7): start a drag-rectangle at the clicked tile.
      if (editorState.activeTool === EditTool.ROOM_TAG && tile) {
        editorState.startRoomTag(tile.col, tile.row);
        return;
      }

      // SELL (G2, §5.7): click a furniture piece or room to sell it —
      // no drag, immediate server round-trip.
      if (editorState.activeTool === EditTool.SELL && tile) {
        const layout = officeState.getLayout();
        const hitFurniture = layout.furniture.find((f) => {
          const entry = getCatalogEntry(f.type);
          if (!entry) return false;
          return (
            tile.col >= f.col &&
            tile.col < f.col + entry.footprintW &&
            tile.row >= f.row &&
            tile.row < f.row + entry.footprintH
          );
        });
        if (hitFurniture) {
          onSellCommit(hitFurniture.uid);
          return;
        }
        const hitRoom = (layout.rooms ?? []).find(
          (r) =>
            tile.col >= r.colStart &&
            tile.col < r.colEnd &&
            tile.row >= r.rowStart &&
            tile.row < r.rowEnd,
        );
        if (hitRoom) {
          onSellCommit(hitRoom.uid);
        }
        return;
      }

      // SELECT tool (or furniture tool with nothing selected): check for furniture hit to start drag
      const actAsSelect =
        editorState.activeTool === EditTool.SELECT ||
        (editorState.activeTool === EditTool.FURNITURE_PLACE &&
          editorState.selectedFurnitureType === '');
      if (actAsSelect && tile) {
        const layout = officeState.getLayout();
        // Find all furniture at clicked tile, prefer surface items (on top of desks)
        let hitFurniture = null as (typeof layout.furniture)[0] | null;
        for (const f of layout.furniture) {
          const entry = getCatalogEntry(f.type);
          if (!entry) continue;
          if (
            tile.col >= f.col &&
            tile.col < f.col + entry.footprintW &&
            tile.row >= f.row &&
            tile.row < f.row + entry.footprintH
          ) {
            if (!hitFurniture || entry.canPlaceOnSurfaces) hitFurniture = f;
          }
        }
        if (hitFurniture) {
          // Start drag — record offset from furniture's top-left
          editorState.startDrag(
            hitFurniture.uid,
            tile.col,
            tile.row,
            tile.col - hitFurniture.col,
            tile.row - hitFurniture.row,
          );
          return;
        } else {
          // Clicked empty space — deselect
          editorState.clearSelection();
          onEditorSelectionChange();
        }
      }

      // Non-select tools: start paint drag
      editorState.isDragging = true;
      if (tile) {
        onEditorTileAction(tile.col, tile.row);
      }
    },
    [
      officeState,
      isEditMode,
      editorState,
      screenToTile,
      screenToWorld,
      onEditorTileAction,
      onEditorEraseAction,
      onEditorSelectionChange,
      onDeleteSelected,
      onRotateSelected,
      hitTestDeleteButton,
      hitTestRotateButton,
      panRef,
      onSellCommit,
    ],
  );

  const handleMouseUp = useCallback(
    (e: React.MouseEvent) => {
      if (e.button === 1) {
        isPanningRef.current = false;
        const canvas = canvasRef.current;
        if (canvas) canvas.style.cursor = isEditMode ? 'crosshair' : 'default';
        return;
      }
      if (e.button === 2) {
        isEraseDraggingRef.current = false;
        return;
      }

      // Handle drag-to-move completion
      if (editorState.dragUid) {
        if (editorState.isDragMoving) {
          // Compute target position
          const ghostCol = editorState.ghostCol - editorState.dragOffsetCol;
          const ghostRow = editorState.ghostRow - editorState.dragOffsetRow;
          const draggedItem = officeState
            .getLayout()
            .furniture.find((f) => f.uid === editorState.dragUid);
          if (draggedItem) {
            const valid = canPlaceFurniture(
              officeState.getLayout(),
              draggedItem.type,
              ghostCol,
              ghostRow,
              editorState.dragUid,
            );
            if (valid) {
              onDragMove(editorState.dragUid, ghostCol, ghostRow);
            }
          }
          editorState.clearSelection();
        } else {
          // Click (no movement) — toggle selection
          if (editorState.selectedFurnitureUid === editorState.dragUid) {
            editorState.clearSelection();
          } else {
            editorState.selectedFurnitureUid = editorState.dragUid;
          }
        }
        editorState.clearDrag();
        onEditorSelectionChange();
        const canvas = canvasRef.current;
        if (canvas) canvas.style.cursor = 'crosshair';
        return;
      }

      // ROOM_TAG (G2, §5.7): commit the drag rectangle on release.
      if (editorState.isRoomTagging) {
        const colStart = Math.min(editorState.roomTagStartCol, editorState.ghostCol);
        const rowStart = Math.min(editorState.roomTagStartRow, editorState.ghostRow);
        const colEnd = Math.max(editorState.roomTagStartCol, editorState.ghostCol) + 1;
        const rowEnd = Math.max(editorState.roomTagStartRow, editorState.ghostRow) + 1;
        editorState.clearRoomTag();
        onRoomTagCommit(colStart, rowStart, colEnd, rowEnd);
        return;
      }

      editorState.isDragging = false;
      editorState.wallDragAdding = null;
    },
    [editorState, isEditMode, officeState, onDragMove, onEditorSelectionChange, onRoomTagCommit],
  );

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      if (isEditMode) return; // handled by mouseDown/mouseUp
      const pos = screenToWorld(e.clientX, e.clientY);
      if (!pos) return;

      const hitId = officeState.getCharacterAt(pos.worldX, pos.worldY);
      if (hitId !== null) {
        // Dismiss any active bubble on click
        officeState.dismissBubble(hitId);
        // Toggle selection: click same agent deselects, different agent selects
        if (officeState.selectedAgentId === hitId) {
          officeState.selectedAgentId = null;
          officeState.cameraFollowId = null;
        } else {
          officeState.selectedAgentId = hitId;
          officeState.cameraFollowId = hitId;
        }
        onClick(hitId); // still focus terminal
        return;
      }

      // Pet hit: toggle the heart bubble.
      const petId = officeState.getPetAt(pos.worldX, pos.worldY);
      if (petId !== null) {
        const pet = officeState.pets.find((p) => p.id === petId);
        if (pet?.bubbleType) {
          officeState.dismissPetBubble(petId);
        } else {
          officeState.showPetBubble(petId);
        }
        return;
      }

      // No agent hit — check seat click while agent is selected
      if (officeState.selectedAgentId !== null) {
        const selectedCh = officeState.characters.get(officeState.selectedAgentId);
        // Skip seat reassignment for sub-agents
        if (selectedCh && !selectedCh.isSubagent) {
          const tile = screenToTile(e.clientX, e.clientY);
          if (tile) {
            const seatId = officeState.getSeatAtTile(tile.col, tile.row);
            if (seatId) {
              const seat = officeState.seats.get(seatId);
              if (seat && selectedCh) {
                if (selectedCh.seatId === seatId) {
                  // Clicked own seat — send agent back to it
                  officeState.sendToSeat(officeState.selectedAgentId);
                  officeState.selectedAgentId = null;
                  officeState.cameraFollowId = null;
                  return;
                } else if (!seat.assigned) {
                  // Clicked available seat — reassign
                  officeState.reassignSeat(officeState.selectedAgentId, seatId);
                  officeState.selectedAgentId = null;
                  officeState.cameraFollowId = null;
                  // Persist seat assignments (exclude sub-agents)
                  const seats: Record<
                    number,
                    { palette: number; hueShift: number; seatId: string | null }
                  > = {};
                  for (const ch of officeState.characters.values()) {
                    if (ch.isSubagent) continue;
                    seats[ch.id] = {
                      palette: ch.palette,
                      hueShift: ch.hueShift,
                      seatId: ch.seatId,
                    };
                  }
                  transport.send({ type: 'saveAgentSeats', seats });
                  return;
                }
              }
            }
          }
        }
        // Clicked empty space — deselect
        officeState.selectedAgentId = null;
        officeState.cameraFollowId = null;
      }
    },
    [officeState, onClick, screenToWorld, screenToTile, isEditMode],
  );

  const handleMouseLeave = useCallback(() => {
    isPanningRef.current = false;
    isEraseDraggingRef.current = false;
    editorState.isDragging = false;
    editorState.wallDragAdding = null;
    editorState.clearDrag();
    editorState.ghostCol = -1;
    editorState.ghostRow = -1;
    officeState.hoveredAgentId = null;
    officeState.hoveredTile = null;

    // Reset cursor in non-edit mode so pointer doesn't get stuck after hovering a pet.
    if (!isEditMode) {
      const canvas = canvasRef.current;
      if (canvas) {
        canvas.style.cursor = 'default';
      }
    }
  }, [officeState, editorState, isEditMode]);

  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      if (isEditMode) return;
      // Right-click to walk selected agent to tile
      if (officeState.selectedAgentId !== null) {
        const tile = screenToTile(e.clientX, e.clientY);
        if (tile) {
          officeState.walkToTile(officeState.selectedAgentId, tile.col, tile.row);
        }
      }
    },
    [isEditMode, officeState, screenToTile],
  );

  // Wheel: Ctrl+wheel to zoom (covers desktop trackpad pinch — browsers
  // synthesize ctrlKey+wheel for trackpad pinch gestures), plain wheel/
  // trackpad two-finger scroll to pan.
  const handleWheel = useCallback(
    (e: WheelEvent) => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        // Accumulate scroll delta, step zoom when threshold crossed
        zoomAccumulatorRef.current += e.deltaY;
        if (Math.abs(zoomAccumulatorRef.current) >= ZOOM_SCROLL_THRESHOLD) {
          const delta = zoomAccumulatorRef.current < 0 ? 1 : -1;
          zoomAccumulatorRef.current = 0;
          const newZoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, zoom + delta));
          if (newZoom !== zoom) {
            onZoomChange(newZoom);
          }
        }
      } else {
        // Pan via trackpad two-finger scroll or mouse wheel
        const dpr = window.devicePixelRatio || 1;
        officeState.cameraFollowId = null;
        panRef.current = clampPan(
          panRef.current.x - e.deltaX * dpr,
          panRef.current.y - e.deltaY * dpr,
        );
      }
    },
    [zoom, onZoomChange, officeState, panRef, clampPan],
  );

  // Attach wheel listener with { passive: false } so preventDefault() works.
  // React's onWheel is passive by default in modern browsers.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.addEventListener('wheel', handleWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', handleWheel);
  }, [handleWheel]);

  // ── Touch gestures (task 9 — phone prep) ──────────────────────
  // Native PointerEvent already unifies mouse+touch for single-pointer
  // tap/drag (the handlers above fire for touch too via React's synthetic
  // mouse events on most browsers' single-finger touch-to-mouse emulation);
  // these three gestures have no desktop-mouse equivalent and need explicit
  // multi-touch tracking: two-finger drag → pan, pinch → zoom, long-press
  // (≥500ms) → the right-click erase action.
  const clearLongPress = useCallback(() => {
    if (longPressRef.current) {
      clearTimeout(longPressRef.current.timer);
      longPressRef.current = null;
    }
  }, []);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (e.pointerType !== 'touch') return;
      touchPointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (touchPointersRef.current.size === 1 && isEditMode) {
        const { clientX, clientY, pointerId } = e;
        const timer = setTimeout(() => {
          const tracked = touchPointersRef.current.get(pointerId);
          if (!tracked) return;
          const tile = screenToTile(tracked.x, tracked.y);
          if (
            tile &&
            (editorState.activeTool === EditTool.TILE_PAINT ||
              editorState.activeTool === EditTool.WALL_PAINT ||
              editorState.activeTool === EditTool.ERASE)
          ) {
            const layout = officeState.getLayout();
            if (
              tile.col >= 0 &&
              tile.col < layout.cols &&
              tile.row >= 0 &&
              tile.row < layout.rows
            ) {
              isEraseDraggingRef.current = true;
              onEditorEraseAction(tile.col, tile.row);
            }
          }
          longPressRef.current = null;
        }, LONG_PRESS_MS);
        longPressRef.current = { timer, startX: clientX, startY: clientY, pointerId };
      }

      if (touchPointersRef.current.size === 2) {
        clearLongPress();
        officeState.cameraFollowId = null;
        const [p0, p1] = [...touchPointersRef.current.values()];
        twoFingerGestureRef.current = computeTwoFingerGesture([p0, p1]);
      }
    },
    [isEditMode, editorState, officeState, onEditorEraseAction, screenToTile, clearLongPress],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (e.pointerType !== 'touch') return;
      if (!touchPointersRef.current.has(e.pointerId)) return;

      if (longPressRef.current && longPressRef.current.pointerId === e.pointerId) {
        const moved = Math.hypot(
          e.clientX - longPressRef.current.startX,
          e.clientY - longPressRef.current.startY,
        );
        if (moved > LONG_PRESS_MOVE_TOLERANCE_PX) clearLongPress();
      }
      touchPointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (touchPointersRef.current.size === 2 && twoFingerGestureRef.current) {
        const [p0, p1] = [...touchPointersRef.current.values()];
        const next = computeTwoFingerGesture([p0, p1]);
        const dpr = window.devicePixelRatio || 1;

        // Pan: midpoint delta.
        const { dx, dy } = computePinchPanDelta(twoFingerGestureRef.current, next, dpr);
        if (dx !== 0 || dy !== 0) {
          panRef.current = clampPan(panRef.current.x + dx, panRef.current.y + dy);
        }

        // Pinch: distance ratio → discrete zoom step (same integer zoom
        // ladder the wheel handler steps through).
        const steppedZoom = computePinchZoomStep(
          twoFingerGestureRef.current.dist,
          next.dist,
          zoom,
          ZOOM_MIN,
          ZOOM_MAX,
        );
        if (steppedZoom !== zoom) onZoomChange(steppedZoom);

        twoFingerGestureRef.current = next;
      }
    },
    [zoom, onZoomChange, panRef, clampPan, clearLongPress],
  );

  const handlePointerUpOrCancel = useCallback(
    (e: React.PointerEvent) => {
      if (e.pointerType !== 'touch') return;
      touchPointersRef.current.delete(e.pointerId);
      if (longPressRef.current && longPressRef.current.pointerId === e.pointerId) clearLongPress();
      if (touchPointersRef.current.size < 2) twoFingerGestureRef.current = null;
      if (touchPointersRef.current.size === 0) isEraseDraggingRef.current = false;
    },
    [clearLongPress],
  );

  // Prevent default middle-click browser behavior (auto-scroll)
  const handleAuxClick = useCallback((e: React.MouseEvent) => {
    if (e.button === 1) e.preventDefault();
  }, []);

  return (
    <div
      ref={containerRef}
      className="w-full h-full relative overflow-hidden bg-bg"
      style={{ touchAction: 'none' }}
    >
      <canvas
        ref={canvasRef}
        data-testid="office-canvas"
        onMouseMove={handleMouseMove}
        onMouseDown={handleMouseDown}
        onMouseUp={handleMouseUp}
        onClick={handleClick}
        onAuxClick={handleAuxClick}
        onMouseLeave={handleMouseLeave}
        onContextMenu={handleContextMenu}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUpOrCancel}
        onPointerCancel={handlePointerUpOrCancel}
        className="block"
        style={{ touchAction: 'none' }}
      />
    </div>
  );
}
