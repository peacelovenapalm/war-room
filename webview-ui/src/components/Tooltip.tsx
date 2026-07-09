import type { ReactNode } from 'react';

interface TooltipProps {
  title: string;
  onDismiss: () => void;
  children: ReactNode;
}

// Position is owned by whichever HudStack corner mounts this (see
// hudLayout.ts) — no absolute/corner classes here. This also retires the old
// G6-only mobile special-case (a full-width strip below the top row): the
// HudStack the caller places this in already reserves a slot below its
// siblings at every viewport, so the ad hoc case is no longer needed.
export function Tooltip({ title, onDismiss, children }: TooltipProps) {
  return (
    <div className="pixel-panel whitespace-nowrap p-0 max-sm:whitespace-normal max-w-2xs max-sm:max-w-64">
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
