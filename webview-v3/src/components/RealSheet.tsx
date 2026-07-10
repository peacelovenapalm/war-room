import type { RealSheetContent } from '../state/hud';

export interface RealSheetProps {
  content: RealSheetContent | null;
  onClose: () => void;
}

/**
 * One-tap-real sheet (hard rule 5): the verbatim telemetry behind whichever
 * HUD chip was tapped. Monospace, selectable, labeled with its wire source.
 */
export function RealSheet({ content, onClose }: RealSheetProps) {
  if (content === null) return null;
  return (
    <div
      className="real-sheet"
      data-testid="real-sheet"
      role="dialog"
      aria-label="Verbatim telemetry"
    >
      <header className="real-sheet__head">
        <span className="real-sheet__title">VERBATIM — {content.title}</span>
        <button type="button" className="verb" data-testid="real-sheet-close" onClick={onClose}>
          ✕ CLOSE
        </button>
      </header>
      <div className="real-sheet__lines">
        {content.lines.map((line, index) => (
          // Index keys are safe: the sheet is rebuilt wholesale per open.
          <div className="real-sheet__line" key={index}>
            {line}
          </div>
        ))}
      </div>
    </div>
  );
}
