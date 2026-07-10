import { type ReactNode, useEffect } from 'react';

export interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  testId?: string;
  wide?: boolean;
}

/**
 * Generic panel chrome for every stage-3 port (HELP, Settings, Debug,
 * CALL, SHIFT, BRIEFING, Automation, Contracts) — night-office look
 * matching index.css's established palette (not a Tailwind port of
 * webview-ui's Modal.tsx). Backdrop click + ESC both close; the panel
 * itself never eats a click. Bottom-sheet on phone (matches the drawer's
 * own breakpoint), centered floating panel on desktop.
 */
export function Modal({ isOpen, onClose, title, children, testId, wide }: ModalProps) {
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="modal-backdrop" data-testid="modal-backdrop" onClick={onClose}>
      <div
        className={wide ? 'modal modal--wide' : 'modal'}
        data-testid={testId ?? 'modal'}
        role="dialog"
        aria-label={typeof title === 'string' ? title : undefined}
        onClick={(e) => {
          e.stopPropagation();
        }}
      >
        <header className="modal__head">
          <span className="modal__title">{title}</span>
          <button type="button" className="verb" data-testid="modal-close" onClick={onClose}>
            ✕ CLOSE
          </button>
        </header>
        <div className="modal__body">{children}</div>
      </div>
    </div>
  );
}
