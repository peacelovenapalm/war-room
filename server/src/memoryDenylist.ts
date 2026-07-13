/**
 * V7 memory hard denylist. This module is intentionally pure: the only
 * knowledge-write entry point calls inspectMemoryText() immediately before
 * it renders or writes a note. Prompt instructions are defense in depth;
 * these code-level classes are authoritative.
 */

export const MEMORY_DENY_CLASSES = [
  'finances-accounts',
  'health-struggles',
  'named-private-person',
] as const;
export type MemoryDenyClass = (typeof MEMORY_DENY_CLASSES)[number];

export interface MemoryDenyFinding {
  class: MemoryDenyClass;
  /** Pattern label only. Never retain the matched sensitive text in a receipt. */
  pattern: string;
}

interface DenyPattern {
  class: MemoryDenyClass;
  label: string;
  expression: RegExp;
}

const DENY_PATTERNS: readonly DenyPattern[] = [
  {
    class: 'finances-accounts',
    label: 'financial-or-account-term',
    expression:
      /\b(?:bank|banking|accounts?|balance|salary|income|mortgage|rent payment|credit card|debit card|routing number|social security|ssn|tax(?:es)?|investment|brokerage|retirement fund|debt|loan)\b/i,
  },
  {
    class: 'health-struggles',
    label: 'health-or-struggle-term',
    expression:
      /\b(?:health|doctor|physician|diagnos(?:is|ed)|medication|prescription|therapy|therapist|depress(?:ion|ed)|anxiety|panic attack|hospital|surgery|chronic pain|illness|sick|struggl(?:e|es|ing))\b/i,
  },
  {
    class: 'named-private-person',
    label: 'named-relationship',
    expression:
      /\b(?:my|our)\s+(?:wife|husband|partner|friend|mother|mom|father|dad|sister|brother|son|daughter|neighbor|coworker)\s+[\p{L}][\p{L}'’-]+\b/iu,
  },
  {
    class: 'named-private-person',
    label: 'named-person-interaction',
    expression:
      /\b(?:met|called|asked|told|emailed|texted|spoke\s+(?:to|with)|talked\s+(?:to|with))\s+[\p{L}][\p{L}'’-]+(?:\s+[\p{L}][\p{L}'’-]+)?\b/iu,
  },
  {
    class: 'named-private-person',
    label: 'full-person-name',
    expression:
      /\b(?!(?:War Room|Claude Code|Visual Studio|Studio Code|Open AI)\b)\p{Lu}\p{Ll}[\p{L}'’-]*[ \t]+\p{Lu}\p{Ll}[\p{L}'’-]*\b/u,
  },
];

/** Returns at most one finding per deny class. */
export function inspectMemoryText(text: string): MemoryDenyFinding[] {
  const findings: MemoryDenyFinding[] = [];
  const seen = new Set<MemoryDenyClass>();
  for (const pattern of DENY_PATTERNS) {
    if (seen.has(pattern.class) || !pattern.expression.test(text)) continue;
    seen.add(pattern.class);
    findings.push({ class: pattern.class, pattern: pattern.label });
  }
  return findings;
}
