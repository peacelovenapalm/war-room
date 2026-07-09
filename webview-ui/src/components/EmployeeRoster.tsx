import { useState } from 'react';

import { computeLevel } from '../../../core/src/leveling.js';
import type { EmployeeSnapshotClient } from '../hooks/useExtensionMessages.js';
import { moodGlyph } from '../office/mood.js';
import { computeBadges, PERSONA_BADGES } from '../office/personaBadges.js';
import { Button } from './ui/Button.js';
import { Modal } from './ui/Modal.js';

interface EmployeeRosterProps {
  isOpen: boolean;
  onClose: () => void;
  employees: Record<string, EmployeeSnapshotClient>;
}

/** Mirrors server/src/employeeStore.ts's EMPLOYEE_LEVEL_CURVE exactly
 *  (GAME-DESIGN §4.4) — flatter than the account-wide progression curve. */
const EMPLOYEE_LEVEL_CURVE = { base: 60, step: 30 };

const SCORE_TRACKS = ['speed', 'accuracy', 'nightOwl', 'tokenEfficiency'] as const;
type ScoreTrack = (typeof SCORE_TRACKS)[number];

const ACTIVE_STATUSES = new Set(['candidate', 'active', 'on_break', 'training', 'quit', 'fired']);

const STATUS_LABEL: Record<string, string> = {
  candidate: 'CANDIDATE',
  active: 'ACTIVE',
  on_break: 'ON BREAK',
  training: 'TRAINING',
  quit: 'QUIT',
  fired: 'FIRED',
  retired: 'RETIRED',
};

async function postVerb(id: string, verb: string, body?: Record<string, unknown>): Promise<void> {
  await fetch(`/api/employees/${encodeURIComponent(id)}/${verb}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
}

/**
 * EMPLOYEE ROSTER (G1) — every distinct real work identity (machine +
 * project) as a persistent colony-sim employee. Clones AgentDrawer.tsx's
 * row/layout conventions. Mood, rank, level, and badges are all SHAPE +
 * TEXT LABEL first (colorblind hard rule) — never a bare color fill.
 * Verbs POST directly to the httpServer.ts roster routes; the next
 * employeeSnapshot broadcast is the source of truth for the result (no
 * optimistic local mutation — same "server is authoritative" posture as
 * every other real-money-adjacent surface in this app).
 */
export function EmployeeRoster({ isOpen, onClose, employees }: EmployeeRosterProps) {
  const [tab, setTab] = useState<'active' | 'retired'>('active');
  const [trainTrack, setTrainTrack] = useState<Record<string, ScoreTrack>>({});

  const all = Object.values(employees).sort((a, b) => b.lastActiveAt - a.lastActiveAt);
  const rows = all.filter((e) =>
    tab === 'active' ? ACTIVE_STATUSES.has(e.status) : e.status === 'retired',
  );

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="EMPLOYEE ROSTER" className="max-w-2xl w-full">
      <div className="px-10 pb-10">
        <div className="flex gap-4 mb-8" role="tablist">
          <Button
            variant={tab === 'active' ? 'active' : 'default'}
            size="sm"
            onClick={() => setTab('active')}
            data-testid="roster-tab-active"
          >
            ROSTER
          </Button>
          <Button
            variant={tab === 'retired' ? 'active' : 'default'}
            size="sm"
            onClick={() => setTab('retired')}
            data-testid="roster-tab-retired"
          >
            HALL OF FAME
          </Button>
        </div>

        <div className="flex flex-col divide-y divide-border max-h-[60vh] overflow-auto">
          {rows.length === 0 && (
            <div className="text-sm text-text-muted py-8">
              {tab === 'active'
                ? 'No employees yet — one real completed turn hires the first candidate.'
                : 'No one has retired yet.'}
            </div>
          )}
          {rows.map((emp) => {
            const { level } = computeLevel(emp.xp, EMPLOYEE_LEVEL_CURVE);
            const effectiveMood = Math.min(100, Math.max(0, emp.mood + emp.moodBoost));
            const badges = computeBadges(emp.scores, emp.sampleCount);
            const track = trainTrack[emp.id] ?? 'speed';

            return (
              <div key={emp.id} className="py-8" data-testid="roster-row">
                <div className="flex items-center justify-between gap-8 flex-wrap">
                  <div className="min-w-0">
                    <div className="font-bold">
                      {emp.name}{' '}
                      <span className="text-text-muted text-2xs">
                        [{emp.machine}] {emp.projectLabel}
                      </span>
                    </div>
                    <div className="text-2xs text-text-muted">
                      {emp.rank} · LVL {level} ·{' '}
                      {STATUS_LABEL[emp.status] ?? emp.status.toUpperCase()}
                    </div>
                  </div>
                  <div
                    className="flex items-center gap-3 font-bold text-sm shrink-0"
                    data-testid="roster-mood"
                    title={`mood ${Math.round(effectiveMood)}/100`}
                  >
                    <span aria-hidden="true">{moodGlyph(effectiveMood)}</span>
                    <span>{Math.round(effectiveMood)}</span>
                  </div>
                </div>

                <div className="flex flex-wrap gap-3 mt-4" data-testid="roster-badges">
                  {badges.map((badge) => {
                    const spec = PERSONA_BADGES[badge];
                    return (
                      <span key={badge} className={`badge-chip ${spec.chipClass}`}>
                        <span aria-hidden="true">{spec.glyph}</span>
                        <span>{spec.label}</span>
                      </span>
                    );
                  })}
                </div>

                {tab === 'active' && (
                  <div className="flex flex-wrap items-center gap-4 mt-6">
                    {emp.status === 'candidate' && (
                      <Button size="sm" onClick={() => void postVerb(emp.id, 'onboard')}>
                        Onboard
                      </Button>
                    )}
                    {emp.status === 'active' && (
                      <>
                        <select
                          className="bg-bg border-2 border-border text-2xs py-1 px-4 max-sm:min-h-44"
                          value={track}
                          onChange={(e) =>
                            setTrainTrack((prev) => ({
                              ...prev,
                              [emp.id]: e.target.value as ScoreTrack,
                            }))
                          }
                          aria-label="Training track"
                        >
                          {SCORE_TRACKS.map((t) => (
                            <option key={t} value={t}>
                              {t}
                            </option>
                          ))}
                        </select>
                        <Button size="sm" onClick={() => void postVerb(emp.id, 'train', { track })}>
                          Train
                        </Button>
                        <Button size="sm" onClick={() => void postVerb(emp.id, 'promote')}>
                          Promote
                        </Button>
                        <Button size="sm" onClick={() => void postVerb(emp.id, 'break')}>
                          Break
                        </Button>
                        {level >= 10 && (
                          <Button size="sm" onClick={() => void postVerb(emp.id, 'retire')}>
                            Retire
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => void postVerb(emp.id, 'fire')}
                        >
                          Fire
                        </Button>
                      </>
                    )}
                    {(emp.status === 'fired' || emp.status === 'quit') && (
                      <Button size="sm" onClick={() => void postVerb(emp.id, 'rehire')}>
                        Rehire
                      </Button>
                    )}
                  </div>
                )}

                {tab === 'retired' && (
                  <div className="text-2xs text-text-muted mt-4">
                    Tenure: {new Date(emp.createdAt).toLocaleDateString()} –{' '}
                    {new Date(emp.lastActiveAt).toLocaleDateString()}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </Modal>
  );
}
