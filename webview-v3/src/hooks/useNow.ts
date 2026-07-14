import { useEffect, useState } from 'react';

/** A local one-second display clock. Only the small component that renders
 * an age subscribes; App and the canvas are not invalidated. */
export function useNow(enabled = true): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!enabled) return;
    const initial = setTimeout(() => setNow(Date.now()), 0);
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => {
      clearTimeout(initial);
      clearInterval(timer);
    };
  }, [enabled]);
  return now;
}
