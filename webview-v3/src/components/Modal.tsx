import { type CSSProperties, type ReactNode, useContext, useEffect } from 'react';

import { PanelGrowOriginContext } from '../state/panelGrowOrigin';

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

  const grow = useContext(PanelGrowOriginContext);

  if (!isOpen) return null;

  const className = ['modal', wide ? 'modal--wide' : null, grow ? 'modal--grow' : null]
    .filter(Boolean)
    .join(' ');
  const style: CSSProperties | undefined = grow
    ? ({
        '--panel-grow-dx': `${String(grow.dx)}px`,
        '--panel-grow-dy': `${String(grow.dy)}px`,
      } as CSSProperties)
    : undefined;

  return (
    <div className="modal-backdrop" data-testid="modal-backdrop" onClick={onClose}>
      <div
        className={className}
        data-testid={testId ?? 'modal'}
        role="dialog"
        aria-label={typeof title === 'string' ? title : undefined}
        style={style}
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
