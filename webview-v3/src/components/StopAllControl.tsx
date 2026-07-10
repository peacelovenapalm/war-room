import { useState } from 'react';

/**
 * STOP ALL — the global automation kill switch (KICKOFF-v3.1 hard rule 8:
 * "never weaken the unattended-run safety net"). Always visible in the HUD,
 * desktop AND phone (never hidden, never buried in a menu). Server-
 * authoritative — works even if this webview disconnects mid-request.
 * Manual CALL dispatch stays available throughout; this targets autonomy,
 * not the human. Resuming is a SEPARATE explicit action with its own
 * confirm click. Display only — the server owns the real behavior.
 */
export function StopAllControl() {
  const [stopping, setStopping] = useState(false);
  const [stopped, setStopped] = useState(false);
  const [confirmResume, setConfirmResume] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const handleStopAll = () => {
    setStopping(true);
    void fetch('/api/automation/stop-all', { method: 'POST' })
      .then((res) => res.json())
      .then((body: { ok: boolean; haltedOrders: number; haltedRuns: number }) => {
        setStopped(true);
        setMessage(
          `Halted ${String(body.haltedOrders)} order(s), ${String(body.haltedRuns)} run(s).`,
        );
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
      .then((res) => res.json())
      .then((body: { ok: boolean; resumedOrders: number }) => {
        setStopped(false);
        setConfirmResume(false);
        setMessage(`Resumed ${String(body.resumedOrders)} order(s).`);
      });
  };

  return (
    <span className="stop-all" data-testid="stop-all-stack" title={message ?? undefined}>
      {stopped ? (
        <button
          type="button"
          className={confirmResume ? 'verb verb--confirm' : 'verb'}
          onClick={handleResume}
          data-testid="resume-control"
        >
          {confirmResume ? '⚠ CONFIRM RESUME' : '▶ RESUME'}
        </button>
      ) : (
        <button
          type="button"
          className="verb"
          onClick={handleStopAll}
          disabled={stopping}
          data-testid="stop-all-control"
        >
          ■ STOP ALL
        </button>
      )}
    </span>
  );
}
