import type { ProgressionSnapshot } from '../hooks/useExtensionMessages.js';
import { DECOR_CATALOG } from '../office/decor.js';
import { Modal } from './ui/Modal.js';

interface UnlocksPanelProps {
  isOpen: boolean;
  onClose: () => void;
  progression: ProgressionSnapshot | null;
}

/**
 * UNLOCKS panel (v1 mechanic #5 — expression pass). Lists every decor item
 * in DECOR_CATALOG with its plain-text requirement and an UNLOCKED/LOCKED
 * status WORD (never color alone — Greg is red-green colorblind; this reads
 * correctly in grayscale). Purely informational: nothing here is
 * interactive, and unlocking never removes access to any real dashboard
 * function or view.
 */
export function UnlocksPanel({ isOpen, onClose, progression }: UnlocksPanelProps) {
  const unlocks = progression?.unlocks ?? {};

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="OFFICE UNLOCKS" className="max-w-md w-full">
      <div className="px-10 pb-8 max-h-[70vh] overflow-auto">
        <p className="text-2xs text-text-muted mb-8">
          Cosmetic only — decor never changes what you can see or do. Requirements come from the
          same real streak/level/shift-grade progression as the HUD in the top-left corner.
        </p>
        <div className="flex flex-col divide-y divide-border">
          {DECOR_CATALOG.map((entry) => {
            const unlocked = unlocks[entry.unlockKey] === true;
            return (
              <div
                key={entry.unlockKey}
                className="flex items-center justify-between gap-8 py-4 text-sm"
                data-testid="unlock-row"
              >
                <span className="min-w-0">
                  <span className="font-bold uppercase">{entry.label}</span>
                  <span className="text-text-muted"> — {entry.requirement}</span>
                </span>
                <span
                  className="shrink-0 flex items-center gap-3 font-bold"
                  data-testid={unlocked ? 'unlock-status-unlocked' : 'unlock-status-locked'}
                >
                  <span aria-hidden="true">{unlocked ? '✓' : '✗'}</span>
                  <span>{unlocked ? 'UNLOCKED' : 'LOCKED'}</span>
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </Modal>
  );
}
