import { useEffect, useRef, useState } from 'react';

import {
  interpretResumeResponse,
  interpretStopAllResponse,
  isExternalStopTransition,
} from '../state/stopAll';
import { ControlTip } from './ControlTip';

export interface StopAllControlProps {
  /** Lifted stop state — ONE source of truth in App (hydrated from the
   *  server + latched by the WS `automationStopped` broadcast), so the HUD
   *  and AutomationPanel instances can never disagree. */
  stopped: boolean;
  onStoppedChange: (stopped: boolean) => void;
}

/**
 * STOP ALL — the global automation kill switch (KICKOFF-v3.1 hard rule 8:
 * "never weaken the unattended-run safety net"). Always visible in the HUD,
 * desktop AND phone (never hidden, never buried in a menu). Server-
 * authoritative: success is only what the server confirms (res.ok AND
 * body.ok — state/stopAll.ts); a failed call renders an explicit
 * ✗ FAILED label (shape + word, colorblind hard rule) and leaves the
 * switch armed — it never pretends automation was halted. Manual CALL
 * dispatch stays available throughout; this targets autonomy, not the
 * human. Resuming is a SEPARATE explicit action with its own confirm.
 */
export function StopAllControl({ stopped, onStoppedChange }: StopAllControlProps) {
  const [stopping, setStopping] = useState(false);
  const [confirmResume, setConfirmResume] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  // M3 (beta finding): `stopped` is WS-authoritative and can change for
  // reasons OTHER than this instance's own fetch (another client engaged
  // it, or the HUD/AutomationPanel sibling instance's call resolved first —
  // both mounts share one lifted `stopped` prop). `expectedRef` names the
  // value THIS instance just asked for; when `stopped` changes to anything
  // else, the transition was external and any local receipt/confirm-arm
  // must be cleared so it can never contradict live state (panel finding:
  // a stale "Resumed 0 order(s)." tooltip survived an external engage).
  const expectedRef = useRef<boolean>(stopped);
  useEffect(() => {
    if (!isExternalStopTransition(expectedRef.current, stopped)) return;
    expectedRef.current = stopped;
    setMessage(null);
    setFailed(false);
    setConfirmResume(false);
  }, [stopped]);

  const handleStopAll = () => {
    setStopping(true);
    setFailed(false);
    void fetch('/api/automation/stop-all', { method: 'POST' })
      .then(async (res) => interpretStopAllResponse(res.ok, (await res.json()) as unknown))
      .catch(() => ({ ok: false as const }))
      .then((result) => {
        if (result.ok) {
          expectedRef.current = true;
          onStoppedChange(true);
          setMessage(
            `Halted ${String(result.haltedOrders)} order(s), ${String(result.haltedRuns)} run(s).`,
          );
        } else {
          // Honest failure: automation may STILL be running — say so loudly
          // instead of flipping to RESUME on an unconfirmed halt.
          setFailed(true);
          setMessage('✗ STOP ALL FAILED — automation may still be running. Retry.');
        }
      })
      .finally(() => {
        setStopping(false);
      });
  };

  const handleResume = () => {
    if (!confirmResume) {
      setConfirmResume(true);
      return;
    }
    void fetch('/api/automation/resume', { method: 'POST' })
      .then(async (res) => interpretResumeResponse(res.ok, (await res.json()) as unknown))
      .catch(() => ({ ok: false as const }))
      .then((result) => {
        setConfirmResume(false);
        if (result.ok) {
          expectedRef.current = false;
          onStoppedChange(false);
          setFailed(false);
          setMessage(`Resumed ${String(result.resumedOrders)} order(s).`);
        } else {
          setFailed(true);
          setMessage('✗ RESUME FAILED — orders are still halted. Retry.');
        }
      });
  };

  return (
    <span className="stop-all" data-testid="stop-all-stack" title={message ?? undefined}>
      {/* M3 — persistent engaged banner (shape+word, colorblind hard rule):
          while stopped, the button flipping to ▶ RESUME was the ONLY
          signal (panel finding — a concurrent operator misread that as UI
          corruption). This renders unconditionally alongside the button,
          from the same WS-reduced `stopped` prop, so it can never lag or
          contradict the control itself. */}
      {stopped && (
        <span className="stop-all__engaged" data-testid="stop-all-engaged-banner" role="status">
          ■ STOP-ALL ENGAGED
        </span>
      )}
      {stopped ? (
        <ControlTip label="Resume automation — a separate explicit action, never automatic.">
          <button
            type="button"
            className={confirmResume ? 'verb verb--confirm' : 'verb'}
            onClick={handleResume}
            data-testid="resume-control"
          >
            {confirmResume ? '⚠ CONFIRM RESUME' : '▶ RESUME'}
          </button>
        </ControlTip>
      ) : (
        <ControlTip label="Halts every standing order + running chain, server-side. Manual CALL dispatch stays available.">
          <button
            type="button"
            className="verb"
            onClick={handleStopAll}
            disabled={stopping}
            data-testid="stop-all-control"
          >
            ■ STOP ALL
          </button>
        </ControlTip>
      )}
      {failed && (
        <span className="stop-all__failed" data-testid="stop-all-failed" role="alert">
          {message}
        </span>
      )}
    </span>
  );
}
