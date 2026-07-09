import { useEffect, useState } from 'react';

import { ROTATING_TIPS } from '../rotatingTips.js';

/** How long each tip stays on screen before advancing to the next. */
export const ROTATE_INTERVAL_MS = 8_000;

/**
 * "Skyrim-style" loading-tip strip (KICKOFF v1.1 item 8) — cycles through
 * ROTATING_TIPS on a timer. Mounted once in the bottom-right HUD stack.
 * Tips are plain text so this reads fine in grayscale by construction.
 */
export function RotatingTip() {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (ROTATING_TIPS.length < 2) return;
    const interval = setInterval(() => {
      setIndex((i) => (i + 1) % ROTATING_TIPS.length);
    }, ROTATE_INTERVAL_MS);
    return () => clearInterval(interval);
  }, []);

  if (ROTATING_TIPS.length === 0) return null;

  return (
    <div
      className="pixel-panel py-3 px-8 text-xs text-text-muted max-w-64 pointer-events-none! select-none"
      data-testid="rotating-tip"
    >
      <span className="text-accent font-bold">TIP</span> {ROTATING_TIPS[index]}
    </div>
  );
}
