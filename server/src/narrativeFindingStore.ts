/**
 * Narrative spot-check findings (V6-5 "cross-model spot checks",
 * V6-DESIGN §V6-5). A sampled, non-blocking `codex exec` lane reads the
 * morning spool (morningSpotCheck.ts writes it) OFF this process and
 * answers "does the narrative match the data?" — when it finds a
 * discrepancy, it POSTs here (Bearer-authed, same tier as the other
 * runner-ingest routes: /api/agents/poll, /api/answers/:id/status).
 *
 * This store never calls codex itself and never blocks the morning push
 * on anything — it is purely the landing pad for whatever an external
 * runner (documented, not shipped as a binary here — see
 * morningSpotCheck.ts's header) chooses to file. opsAdvisor.ts folds live,
 * unexpired entries into GET /api/ops/review as kind:'narrative' findings
 * (same read-only "system proposes, Greg disposes" posture as every other
 * finding kind — a narrative finding never carries proposedActions).
 */

import { NARRATIVE_FINDING_CAP } from './constants.js';
import { V3JsonPersistence } from './v3Persistence.js';

const STATE_FILE_NAME = 'narrative-findings.json';

export interface NarrativeFinding {
  id: string;
  ts: number;
  /** The morning date (YYYY-MM-DD) this discrepancy is about. */
  date: string;
  summary: string;
  detail: string;
}

interface NarrativeFindingData {
  /** Newest last; capped at NARRATIVE_FINDING_CAP, oldest pruned. */
  findings: NarrativeFinding[];
}

function emptyData(): NarrativeFindingData {
  return { findings: [] };
}

let nextIdSuffix = 0;

export class NarrativeFindingStore {
  private data: NarrativeFindingData | null = null;
  private readonly persistence: V3JsonPersistence<NarrativeFindingData>;

  constructor(statePath?: string) {
    this.persistence = new V3JsonPersistence(STATE_FILE_NAME, statePath);
  }

  private ensureLoaded(): NarrativeFindingData {
    if (!this.data) {
      this.data = this.persistence.load((raw) => Array.isArray(raw.findings), emptyData);
    }
    return this.data;
  }

  file(
    input: { date: string; summary: string; detail: string },
    now: number = Date.now(),
  ): NarrativeFinding {
    const data = this.ensureLoaded();
    const finding: NarrativeFinding = {
      id: `narrative-${String(now)}-${String(nextIdSuffix++)}`,
      ts: now,
      date: input.date,
      summary: input.summary,
      detail: input.detail,
    };
    data.findings.push(finding);
    while (data.findings.length > NARRATIVE_FINDING_CAP) data.findings.shift();
    this.persistence.persist(data, now, true);
    return finding;
  }

  /** Newest-first, unexpired-only — `maxAgeMs` filtering happens here
   *  (not stored as an expiry) so a config bump takes effect without a
   *  migration. */
  getRecent(maxAgeMs: number, now: number = Date.now()): NarrativeFinding[] {
    return this.ensureLoaded()
      .findings.filter((f) => now - f.ts <= maxAgeMs)
      .slice()
      .reverse();
  }

  clearCacheForTests(): void {
    this.data = null;
  }
}

export const narrativeFindingStore = new NarrativeFindingStore();
