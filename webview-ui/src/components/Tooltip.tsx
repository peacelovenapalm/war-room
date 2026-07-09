import type { ReactNode } from 'react';

interface TooltipProps {
  title: string;
  onDismiss: () => void;
  position?: 'top-right' | 'top-left' | 'bottom-right' | 'bottom-left';
  children: ReactNode;
}

// Position via Tailwind classes (not inline styles) so `max-sm:` can move
// 'top-right' below the crowded mobile top row — real bug found in the G6
// mobile screenshot pass: ProgressionHUD (top-8 left-8), EconomyHUD (top-8
// right-8) and StopAllControl (top-8, centered) all share that strip, and
// at a 390px viewport there's no room left for a top-right corner tooltip
// too. Desktop (`sm:` and up) keeps the original top:8/right:52 corner spot.
const positionClasses: Record<string, string> = {
  'top-right': 'max-sm:top-64 max-sm:left-8 max-sm:right-8 sm:top-8 sm:right-52',
  'top-left': 'top-8 left-8',
  'bottom-right': 'max-sm:bottom-64 max-sm:left-8 max-sm:right-8 sm:bottom-8 sm:right-52',
  'bottom-left': 'bottom-8 left-8',
};

export function Tooltip({ title, onDismiss, position = 'top-right', children }: TooltipProps) {
  return (
    <div
      className={`absolute z-20 pixel-panel whitespace-nowrap p-0 max-sm:whitespace-normal ${positionClasses[position]}`}
    >
      <div className="flex items-center justify-between py-4 px-8 border-b border-border">
        <span className="text-base text-accent font-bold">{title}</span>
        <button
          onClick={onDismiss}
          className="bg-transparent border-none text-text-muted cursor-pointer text-sm px-2 leading-none
            max-sm:min-w-44 max-sm:min-h-44 max-sm:shrink-0 max-sm:flex max-sm:items-center max-sm:justify-center"
        >
          x
        </button>
      </div>
      <div className="py-6 px-8">{children}</div>
    </div>
  );
}
