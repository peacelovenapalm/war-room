import { OfficeState } from './office/engine/officeState.js';
import { getPixiInitCount } from './office/engine/pixiApp.js';

declare global {
  interface Window {
    __pixelAgentsTestHooks?: {
      playedSounds?: Array<{ kind: string; at: number }>;
      getCharacters?: () => Array<{ id: number; matrixEffect: 'spawn' | 'despawn' | null }>;
      getPets?: () => Array<{
        id: string;
        name: string;
        petType: number;
        state: 'idle' | 'walk' | 'follow';
        x: number;
        y: number;
        bubbleType: 'heart' | null;
      }>;
      petClick?: (petId: string) => void;
      addAgentLog?: Array<{
        id: number;
        skipSpawnEffect: boolean | undefined;
        matrixEffectAtCreation: 'spawn' | 'despawn' | null;
      }>;
      messageLog?: Array<{
        at: number;
        type: string;
        id?: number;
        toolName?: string;
        status?: string;
        toolId?: string;
        parentToolId?: string;
      }>;
      selectAgent?: (id: number) => void;
      setCrisis?: (id: number, since: number) => void;
      getPixiInitCount?: () => number;
      /** e2e-only (KICKOFF v1.1 item 3): drives the exact path a real
       *  canvas click on an agent takes (App.tsx wires this to handleClick,
       *  not this module — see App.tsx's own useEffect for why). */
      openAgentDrawer?: (id: number) => void;
    };
  }
}

/**
 * Install e2e test observables on window.__pixelAgentsTestHooks. Mostly
 * read-only / append-only; the one action (selectAgent) only sets selection
 * state and changes no production logic. Called once at module-load from
 * App.tsx with the singleton officeStateRef.
 *
 * - getCharacters(): point-in-time snapshot of every character's matrixEffect.
 * - addAgentLog: append-only history of every OfficeState.addAgent call. The
 *   log captures matrixEffect AT addAgent time (synchronously inside the
 *   wrapper), eliminating the ~300ms matrix-effect lifetime race that would
 *   let a regression slip past a snapshot-based check.
 * - playedSounds: populated separately by notificationSound.ts (same namespace,
 *   different owner).
 * - selectAgent(id): sets officeState.selectedAgentId directly, the same state
 *   a canvas click produces. Lets e2e reveal an agent's "Close agent" (×)
 *   button deterministically instead of pixel-hunting the sprite on the canvas
 *   (see closeAgentFromOverlay in e2e/helpers/office.ts). ToolOverlay reads
 *   selectedAgentId every rAF, so the × button surfaces on the next frame.
 */
export function installTestHooks(officeStateRef: { current: OfficeState | null }): void {
  if (typeof window === 'undefined') return;
  if (!window.__pixelAgentsTestHooks) window.__pixelAgentsTestHooks = {};
  const hooks = window.__pixelAgentsTestHooks;
  if (!hooks.addAgentLog) hooks.addAgentLog = [];

  hooks.getCharacters = () => {
    const os = officeStateRef.current;
    if (!os) return [];
    return Array.from(os.characters.values()).map((ch) => ({
      id: ch.id,
      matrixEffect: ch.matrixEffect,
    }));
  };

  hooks.selectAgent = (id) => {
    const os = officeStateRef.current;
    if (os) os.selectedAgentId = id;
  };

  // Marks a character as having an active crisis (v1 crisis layer) — the
  // same `ch.crisis` field the server's crisis broadcast sets. Lets e2e
  // drive the TRIAGE board deterministically instead of reproducing the
  // full server-side crisis-escalation timing, same tradeoff selectAgent
  // makes for the canvas hit-test.
  hooks.setCrisis = (id, since) => {
    const os = officeStateRef.current;
    const ch = os?.characters.get(id);
    if (ch) ch.crisis = { since };
  };

  // KICKOFF v1.1 item 2 — monotonic count of real Pixi Application.init()
  // calls (see pixiApp.ts's getPixiInitCount doc). e2e drives view-switch/
  // zoom/edit/resize interactions and asserts this stays 1 throughout,
  // proving OfficeCanvas.tsx's mount effect no longer dispose+recreates the
  // Application on every interaction (the disappearing-view bug).
  hooks.getPixiInitCount = () => getPixiInitCount();

  // Point-in-time snapshot of every live pet. Pets render only on the canvas
  // (no DOM) and the heart bubble is never persisted, so e2e reads pet state
  // through here — the same rationale as getCharacters() above.
  hooks.getPets = () => {
    const os = officeStateRef.current;
    if (!os) return [];
    return os.pets.map((pet) => ({
      id: pet.id,
      name: pet.name,
      petType: pet.petType,
      state: pet.state,
      x: pet.x,
      y: pet.y,
      bubbleType: pet.bubbleType,
    }));
  };

  // Drive the same state a canvas click on a pet produces (toggle the heart
  // bubble). Mirrors OfficeCanvas's pet-hit branch but takes a known petId
  // instead of a hit-test result, so tests don't pixel-hunt the randomly
  // spawned sprite — the same tradeoff selectAgent makes for characters.
  hooks.petClick = (petId) => {
    const os = officeStateRef.current;
    if (!os) return;
    const pet = os.pets.find((p) => p.id === petId);
    if (!pet) return;
    if (pet.bubbleType) {
      os.dismissPetBubble(petId);
    } else {
      os.showPetBubble(petId);
    }
  };

  const origAddAgent = OfficeState.prototype.addAgent;
  OfficeState.prototype.addAgent = function (
    id,
    preferredPalette,
    preferredHueShift,
    preferredSeatId,
    skipSpawnEffect,
    folderName,
    ...rest
  ) {
    // Forward the FULL argument list (...rest — machine/provider/sessionId/
    // cwd/pid) — a fixed-arity re-declaration here previously dropped
    // everything past folderName in e2e mode only (production never called
    // this wrapper), silently leaving ch.machine/ch.pid undefined for every
    // e2e-driven agent regardless of what the real caller passed.
    origAddAgent.call(
      this,
      id,
      preferredPalette,
      preferredHueShift,
      preferredSeatId,
      skipSpawnEffect,
      folderName,
      ...rest,
    );
    const ch = this.characters.get(id);
    hooks.addAgentLog?.push({
      id,
      skipSpawnEffect,
      matrixEffectAtCreation: ch?.matrixEffect ?? null,
    });
  };
}
