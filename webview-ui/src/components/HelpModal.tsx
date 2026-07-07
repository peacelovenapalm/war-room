import { HELP_SECTIONS } from '../helpContent.js';
import { Modal } from './ui/Modal.js';

interface HelpModalProps {
  isOpen: boolean;
  onClose: () => void;
}

/**
 * In-dashboard help screen (v1): explains every signal on screen and where
 * the data comes from. Reachable at all times via the `?` key and the HELP
 * word-button in the bottom toolbar. Content lives in helpContent.ts —
 * a mechanic isn't done until its section exists there (test-enforced).
 * Rows are GLYPH + WORD + text, so the screen itself passes the grayscale test.
 */
export function HelpModal({ isOpen, onClose }: HelpModalProps) {
  return (
    <Modal isOpen={isOpen} onClose={onClose} title="HELP — WHAT AM I LOOKING AT?" zIndex={54}>
      <div className="px-10 pb-8 max-h-[72vh] overflow-auto" style={{ maxWidth: 640 }}>
        <p className="text-sm text-text-muted mb-10">
          Everything on this dashboard is real: real sessions, real tokens, real gates. Press{' '}
          <span className="text-text font-bold">?</span> anytime to open this screen.
        </p>
        {HELP_SECTIONS.map((section) => (
          <div key={section.id} className="mb-14" data-testid={`help-section-${section.id}`}>
            <h3 className="text-lg font-bold mb-4">{section.title}</h3>
            {section.intro && <p className="text-sm text-text-muted mb-6">{section.intro}</p>}
            <div className="flex flex-col gap-5">
              {section.entries.map((entry) => (
                <div key={`${section.id}-${entry.word}`} className="flex gap-8 text-sm">
                  <span className="shrink-0 font-bold whitespace-nowrap" style={{ minWidth: 130 }}>
                    {entry.glyph} {entry.word}
                  </span>
                  <span className="min-w-0">{entry.text}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </Modal>
  );
}
