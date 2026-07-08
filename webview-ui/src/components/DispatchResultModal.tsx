import { dispatchChipLabel, type DispatchEntry } from '../dispatch.js';
import { Modal } from './ui/Modal.js';

interface DispatchResultModalProps {
  entry: DispatchEntry | null;
  onClose: () => void;
}

/** Result view for an EXITED dispatch entry's resultTail (v1 mechanic #6b
 *  gap fix) — the run's output previously existed only in a log file on
 *  whichever machine ran it (~/Library/Logs/war-room-dispatch-runs/<id>.log),
 *  invisible from the dashboard. Monospace, scrollable, glyph+word header
 *  (colorblind rule) — same trust level as the tray chip it's opened from. */
export function DispatchResultModal({ entry, onClose }: DispatchResultModalProps) {
  if (!entry) return null;

  return (
    <Modal
      isOpen={entry !== null}
      onClose={onClose}
      title={dispatchChipLabel(entry)}
      className="max-w-lg w-full"
    >
      <div className="px-10 pb-10 flex flex-col gap-6">
        <div className="text-sm text-text-muted">
          {entry.machine}
          {entry.provider ? ` · ${entry.provider}` : ''}
        </div>
        {entry.resultTail ? (
          <pre
            data-testid="dispatch-result-tail"
            className="border-2 border-border bg-bg text-text py-4 px-8 text-2xs whitespace-pre-wrap break-all max-h-96 overflow-y-auto"
          >
            {entry.resultTail}
          </pre>
        ) : (
          <div className="text-sm text-warning">⚠ NO OUTPUT CAPTURED for this run.</div>
        )}
      </div>
    </Modal>
  );
}
