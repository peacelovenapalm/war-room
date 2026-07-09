import { useState } from 'react';

import { Button } from './ui/Button.js';

/** STOP ALL — the global automation kill switch (v2 mechanic G3,
 *  GAME-DESIGN.md §7.5). Always visible, desktop AND the phone check-in
 *  view (G6 re-mounts this component there). SHAPE + WORD, never an icon
 *  alone, never buried in a menu. Server-authoritative — works even if
 *  this webview disconnects mid-request. Manual CallModal dispatch
 *  remains available throughout; this targets autonomy, not the human.
 *  Resuming is a SEPARATE explicit action with its own confirm click. */
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
        setMessage(`Halted ${body.haltedOrders} order(s), ${body.haltedRuns} chain run(s).`);
      })
      .finally(() => setStopping(false));
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
        setMessage(`Resumed ${body.resumedOrders} order(s).`);
      });
  };

  return (
    <div className="flex flex-col items-center gap-3" data-testid="stop-all-stack">
      {stopped ? (
        <Button
          variant={confirmResume ? 'accent' : 'default'}
          size="sm"
          onClick={handleResume}
          data-testid="resume-control"
        >
          {confirmResume ? '⚠ CONFIRM RESUME' : '▶ RESUME'}
        </Button>
      ) : (
        <Button
          variant={stopping ? 'disabled' : 'default'}
          size="sm"
          onClick={handleStopAll}
          disabled={stopping}
          data-testid="stop-all-control"
        >
          ■ STOP ALL
        </Button>
      )}
      {/* Detail text only — the button's own label change (STOP ALL <->
          RESUME) already carries the state change. Hidden at mobile: this
          stack sits between the top-left and top-right corners with very
          little horizontal margin at the iPhone-14 width once TriagePanel
          is expanded (KICKOFF v1.1 item 4) — growing taller here is what
          pushed it into TriagePanel's row, not this text's width. */}
      {message && (
        <span
          className="text-xs text-text-muted pixel-panel py-2 px-6 max-sm:hidden"
          data-testid="stop-all-message"
        >
          {message}
        </span>
      )}
    </div>
  );
}
