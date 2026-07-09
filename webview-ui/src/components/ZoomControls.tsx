import { useEffect, useRef, useState } from 'react';

import {
  ZOOM_LEVEL_FADE_DELAY_MS,
  ZOOM_LEVEL_FADE_DURATION_SEC,
  ZOOM_LEVEL_HIDE_DELAY_MS,
  ZOOM_MAX,
  ZOOM_MIN,
} from '../constants.js';
import { Button } from './ui/Button.js';
import { ControlTooltip } from './ui/ControlTooltip.js';

/** Shows the "Nx" level briefly whenever `zoom` changes, then fades and
 *  hides — shared by ZoomLevelBadge (rendered in the top-center HUD stack,
 *  separate from ZoomButtons' top-left slot since the two pieces occupy
 *  different corners; see hudLayout.ts). */
function useZoomLevelFlash(zoom: number): { showLevel: boolean; fadeOut: boolean } {
  const [showLevel, setShowLevel] = useState(false);
  const [fadeOut, setFadeOut] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fadeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevZoomRef = useRef(zoom);

  useEffect(() => {
    if (zoom === prevZoomRef.current) return;
    prevZoomRef.current = zoom;

    if (timerRef.current) clearTimeout(timerRef.current);
    if (fadeTimerRef.current) clearTimeout(fadeTimerRef.current);

    setShowLevel(true);
    setFadeOut(false);

    fadeTimerRef.current = setTimeout(() => {
      setFadeOut(true);
    }, ZOOM_LEVEL_FADE_DELAY_MS);

    timerRef.current = setTimeout(() => {
      setShowLevel(false);
      setFadeOut(false);
    }, ZOOM_LEVEL_HIDE_DELAY_MS);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      if (fadeTimerRef.current) clearTimeout(fadeTimerRef.current);
    };
  }, [zoom]);

  return { showLevel, fadeOut };
}

interface ZoomLevelBadgeProps {
  zoom: number;
}

/** Transient "Nx" chip — top-center HUD stack. */
export function ZoomLevelBadge({ zoom }: ZoomLevelBadgeProps) {
  const { showLevel, fadeOut } = useZoomLevelFlash(zoom);
  if (!showLevel) return null;

  return (
    <div
      className="pixel-panel pb-4 px-16 text-lg select-none pointer-events-none"
      style={{
        opacity: fadeOut ? 0 : 1,
        transition: `opacity ${ZOOM_LEVEL_FADE_DURATION_SEC}s ease-out`,
      }}
      data-testid="zoom-level-badge"
    >
      {zoom}x
    </div>
  );
}

interface ZoomControlsProps {
  zoom: number;
  onZoomChange: (zoom: number) => void;
}

/** Zoom +/- buttons — top-left HUD stack. */
export function ZoomControls({ zoom, onZoomChange }: ZoomControlsProps) {
  const minDisabled = zoom <= ZOOM_MIN;
  const maxDisabled = zoom >= ZOOM_MAX;

  return (
    <ControlTooltip label="Zoom in / out (Ctrl+Scroll)" side="bottom" display="flex">
      <div className="flex flex-col gap-4" data-testid="zoom-controls">
        <Button
          size="icon_lg"
          onClick={() => onZoomChange(zoom + 1)}
          disabled={maxDisabled}
          className="border-border! shadow-pixel disabled:hover:bg-btn-bg disabled:cursor-default disabled:opacity-(--btn-disabled-opacity)"
          title="Zoom in (Ctrl+Scroll)"
        >
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
            <line
              x1="9"
              y1="3"
              x2="9"
              y2="15"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
            <line
              x1="3"
              y1="9"
              x2="15"
              y2="9"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>
        </Button>
        <Button
          size="icon_lg"
          onClick={() => onZoomChange(zoom - 1)}
          disabled={minDisabled}
          className="border-border! shadow-pixel disabled:hover:bg-btn-bg disabled:cursor-default disabled:opacity-(--btn-disabled-opacity)"
          title="Zoom out (Ctrl+Scroll)"
        >
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
            <line
              x1="3"
              y1="9"
              x2="15"
              y2="9"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>
        </Button>
      </div>
    </ControlTooltip>
  );
}
