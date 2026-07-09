/**
 * Digest assembler (v2 mechanic G4 — GAME-DESIGN.md §6.5) — builds the
 * "while you were out" story consumed by GET /api/economy/summary (the §2
 * check-in payoff: narrative + one decision, never a chore list).
 *
 * `renderDigest(summary, narrator = templateNarrator)` — `narrator` IS the
 * named post-v1.0 LLM seam. Templates only in v1.0: pulls flavor lines from
 * core/src/quips.ts, zero token spend, fully deterministic for fixed inputs.
 */

export interface DigestEventLine {
  glyph: string;
  summary: string;
}

export interface DigestSummary {
  cashDelta: number;
  reputationDelta: number;
  /** Top-5 flavor events (GAME-DESIGN §2's check-in digest), oldest-first or
   *  newest-first is the caller's choice — this module renders them in the
   *  order given, capped at 5. */
  topEvents: DigestEventLine[];
  /** Plain-text mood/grime warnings — no glyph prefix baked in here (the
   *  caller decides ⚠ styling at the render boundary, same posture as
   *  every other plain-text digest line). */
  warnings: string[];
}

export type DigestNarrator = (summary: DigestSummary) => string;

function signed(n: number): string {
  return n >= 0 ? `+${n}` : `${n}`;
}

/** Deterministic template narrator — the v1.0 implementation. Same inputs
 *  always produce the same string. */
export function templateNarrator(summary: DigestSummary): string {
  const lines: string[] = [
    `While you were out: ${signed(summary.cashDelta)} Cash, ${signed(summary.reputationDelta)} Rep.`,
  ];
  if (summary.topEvents.length > 0) {
    lines.push('Around the office:');
    for (const event of summary.topEvents.slice(0, 5)) {
      lines.push(`  ${event.glyph} ${event.summary}`);
    }
  }
  for (const warning of summary.warnings) {
    lines.push(`⚠ ${warning}`);
  }
  return lines.join('\n');
}

/** The named LLM seam (GAME-DESIGN §6.5, interrogation delta #9) — templates
 *  ship in v1.0; a future narrator can slot in here post-v1.0 without
 *  touching any call site. */
export function renderDigest(
  summary: DigestSummary,
  narrator: DigestNarrator = templateNarrator,
): string {
  return narrator(summary);
}
