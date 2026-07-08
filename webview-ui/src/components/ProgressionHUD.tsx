import type { ProgressionSnapshot } from '../hooks/useExtensionMessages.js';

interface ProgressionHUDProps {
  progression: ProgressionSnapshot | null;
}

/**
 * PROGRESSION HUD (v1 mechanic #3) — a small always-visible strip: level,
 * daily-use streak, XP bar. Colorblind rule: SHAPE + WORD carry the signal
 * (glyphs + labels), the bar fill is reinforcement only and still reads in
 * grayscale via its border + numeric fraction.
 *
 * Server-side state (one user, many screens) — see progressionStore.ts.
 * XP only comes from real events (completed turns, observed crisis
 * resolutions, shift grades); this widget never shows or implies a token
 * count. Unlock flags are DATA ONLY here — no decor renders from them yet
 * (mechanic #5).
 */
export function ProgressionHUD({ progression }: ProgressionHUDProps) {
  if (!progression) return null;

  const { level, xpIntoLevel, xpForNextLevel, streakCurrent } = progression;
  const pct =
    xpForNextLevel > 0 ? Math.min(100, Math.round((xpIntoLevel / xpForNextLevel) * 100)) : 0;

  return (
    <div
      className="absolute top-8 left-8 z-10 pixel-panel py-4 px-8 flex items-center gap-8 text-sm pointer-events-none select-none"
      data-testid="progression-hud"
    >
      <span className="flex items-center gap-3 font-bold whitespace-nowrap" title="Level">
        <span aria-hidden="true">▲</span>
        <span>LVL {level}</span>
      </span>

      <span
        className="flex items-center gap-3 whitespace-nowrap"
        title="Consecutive days with real session activity"
        data-testid="progression-streak"
      >
        <span aria-hidden="true">◐</span>
        <span>
          STREAK {streakCurrent}
          {streakCurrent === 1 ? ' day' : ' days'}
        </span>
      </span>

      <span
        className="flex items-center gap-3 min-w-[7rem]"
        title={`${xpIntoLevel} / ${xpForNextLevel} XP to next level`}
        data-testid="progression-xp-bar"
      >
        <span aria-hidden="true">✦</span>
        <span
          className="relative h-8 flex-1 border-2 border-border overflow-hidden"
          style={{ minWidth: '5rem' }}
        >
          <span
            className="absolute inset-y-0 left-0 bg-accent"
            style={{ width: `${pct}%` }}
            data-testid="progression-xp-fill"
          />
        </span>
        <span className="text-2xs tabular-nums">{pct}%</span>
      </span>
    </div>
  );
}
