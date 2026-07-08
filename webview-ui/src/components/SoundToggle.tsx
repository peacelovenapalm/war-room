import { useEffect, useState } from 'react';

import { ambience, statusLabel } from '../ambience.js';
import { Button } from './ui/Button.js';

/** Poll cadence for the label — cheap, mirrors TriagePanel's tick pattern. */
const POLL_MS = 500;

/**
 * Visible SOUND ON/OFF control (v1 sound layer). TEXT LABEL is the primary
 * signal (colorblind rule: shape+label, never color/icon-only) and is
 * always honest about autoplay-block state — it never claims "ON" while the
 * AudioContext is still suspended waiting for a gesture.
 *
 * Marked `data-sound-toggle` so the page-wide first-gesture arm listener
 * (see App.tsx) skips this element — this button manages its own arm+toggle
 * sequencing so the very first click both starts audio AND doesn't
 * immediately flip it back off.
 */
export function SoundToggle() {
  const [status, setStatus] = useState(ambience.getStatus());

  useEffect(() => {
    const timer = setInterval(() => setStatus(ambience.getStatus()), POLL_MS);
    return () => clearInterval(timer);
  }, []);

  const isAudible = status === 'on' || status === 'duck';

  return (
    <Button
      data-sound-toggle
      variant={isAudible ? 'active' : 'default'}
      title="Office ambience + event sounds"
      onClick={() => {
        const wasBlocked = ambience.getStatus() === 'blocked';
        ambience.arm();
        if (!wasBlocked) {
          ambience.setEnabled(!ambience.isEnabled());
        }
        setStatus(ambience.getStatus());
      }}
    >
      {statusLabel(status)}
    </Button>
  );
}
