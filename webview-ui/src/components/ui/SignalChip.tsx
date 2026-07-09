/**
 * SignalChip (GAME-DESIGN.md §6.1) — the fiction-vs-real labeling primitive.
 * `real=true` renders a solid border, no prefix (the underlying completion
 * fact is real, even if payout numbers are invented framing). `real=false`
 * renders a dashed border + "SIM ·" prefix. Every fictional UI surface
 * (world events, Contract manual-claim rows) must render through this — no
 * hand-rolled chip markup for anything fictional.
 *
 * Glyph/word are shape+text, colorblind-safe by construction; color is
 * reinforcement only (border style + the SIM prefix carry the real/sim
 * signal, not a hue).
 */

interface SignalChipProps {
  glyph: string;
  word: string;
  real: boolean;
  className?: string;
}

export function SignalChip({ glyph, word, real, className = '' }: SignalChipProps) {
  return (
    <span
      className={`inline-flex items-center gap-2 py-2 px-4 text-xs border-2 rounded-none ${
        real ? 'border-border border-solid' : 'border-border border-dashed'
      } ${className}`}
      data-testid="signal-chip"
      data-real={real}
    >
      {!real && <span aria-hidden="true">SIM ·</span>}
      <span aria-hidden="true">{glyph}</span>
      <span>{word}</span>
    </span>
  );
}
