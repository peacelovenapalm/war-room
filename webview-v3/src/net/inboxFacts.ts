/**
 * Pure logic for the INBOX panel (v4 T7 slice 2 — routine inbox tray).
 * Types mirror server/src/inboxProvider.ts's shapes exactly (same
 * duplication discipline as net/graphFacts.ts and state/opsReview.ts —
 * never imported across the client/server boundary).
 */

export interface InboxEntry {
  routine: string;
  filename: string;
  mtimeMs: number;
  ageMs: number;
}

export interface InboxListing {
  available: boolean;
  entries: InboxEntry[];
  generatedAt: string;
}

/** Age display spans hours-to-weeks (routine outputs range from daily to
 *  weekly), unlike crisis.ts's formatAge which is tuned for
 *  minutes-to-hours blocked episodes. Colorblind-safe: text only, no
 *  color-coded urgency. */
export function formatEntryAge(ageMs: number): string {
  const totalMin = Math.max(0, Math.floor(ageMs / 60_000));
  if (totalMin < 60) return `${String(totalMin)}m`;
  const totalHours = Math.floor(totalMin / 60);
  if (totalHours < 24) return `${String(totalHours)}h`;
  const days = Math.floor(totalHours / 24);
  return `${String(days)}d`;
}

/** Routine subdir name -> a stable display glyph, colorblind rule (shape +
 *  the routine's own name as the word — never color alone). Unknown
 *  routines fall back to a plain bullet rather than guessing. */
export function routineGlyph(routine: string): string {
  switch (routine) {
    case 'summary':
      return '☀';
    case 'todo':
      return '○';
    case 'vault-health':
      return '♥';
    case 'project-pulse':
      return '◈';
    case 'docs-tracker':
      return '▤';
    case 'refresh-mocs':
      return '▥';
    case 'proposed-plans':
      return '◆';
    case 'vault-fixer':
      return '⚙';
    default:
      return '·';
  }
}
