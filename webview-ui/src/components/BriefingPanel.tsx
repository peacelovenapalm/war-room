import { useEffect, useState } from 'react';

import { Button } from './ui/Button.js';
import { Modal } from './ui/Modal.js';

/** Poll cadence while the panel is open. */
const REFRESH_INTERVAL_MS = 5 * 60 * 1000;

interface TodoBriefing {
  date: string;
  startNow: string[];
  sections: Array<{ title: string; count: number }>;
}

type GateStatus = 'TODO' | 'IN_PROGRESS' | 'BLOCKED' | 'DONE';

interface TrackerGate {
  id: string;
  label: string;
  status: GateStatus;
  done: number;
  total: number;
}

interface TrackerBriefing {
  milestone: string | null;
  gates: TrackerGate[];
}

interface Briefing {
  todo: TodoBriefing | null;
  tracker: TrackerBriefing | null;
  generatedAt: string;
}

interface BriefingPanelProps {
  isOpen: boolean;
  onClose: () => void;
  /** DISPATCH bridge (mechanic #6b): pre-fill the CALL modal's prompt with a
   *  todo line's text and open it. Omitted entirely when the modal isn't
   *  wired up yet (defensive — BriefingPanel must not assume it exists). */
  onDispatchTodo?: (prompt: string) => void;
}

/** Colorblind rule: every status is GLYPH + WORD, color reinforcement only. */
const GATE_GLYPHS: Record<GateStatus, { glyph: string; word: string; color: string }> = {
  DONE: { glyph: '✓', word: 'DONE', color: 'text-status-success' },
  IN_PROGRESS: { glyph: '◷', word: 'IN PROGRESS', color: 'text-status-active' },
  BLOCKED: { glyph: '⚠', word: 'BLOCKED', color: 'text-status-permission' },
  TODO: { glyph: '○', word: 'TODO', color: 'text-text-muted' },
};

/** Classify a "Full list" section heading into a muted glyph + word for the summary line. */
function classifySection(title: string): { glyph: string; word: string } {
  const t = title.toLowerCase();
  if (t.includes('block')) return { glyph: '⚠', word: 'blocked' };
  if (t.includes('aging')) return { glyph: '◷', word: 'aging' };
  if (t.includes('quick win')) return { glyph: '✦', word: 'quick wins' };
  if (t.includes('gated') || t.includes('founder') || t.includes('owner')) {
    return { glyph: '◆', word: 'gated' };
  }
  return { glyph: '○', word: t };
}

function SectionSummary({ sections }: { sections: TodoBriefing['sections'] }) {
  const withCounts = sections.filter((s) => s.count > 0);
  if (withCounts.length === 0) return null;
  return (
    <div className="text-sm text-text-muted mt-4">
      {withCounts
        .map((s) => {
          const { glyph, word } = classifySection(s.title);
          return `${glyph} ${word} ${s.count}`;
        })
        .join(' · ')}
    </div>
  );
}

function TodoSection({
  todo,
  onDispatchTodo,
}: {
  todo: TodoBriefing | null;
  onDispatchTodo?: (prompt: string) => void;
}) {
  return (
    <div className="mb-16">
      <h3 className="text-lg font-bold mb-6">TODAY {todo ? `— START NOW (${todo.date})` : ''}</h3>
      {!todo ? (
        <div className="text-sm text-text-muted">no todo source configured</div>
      ) : todo.startNow.length === 0 ? (
        <div className="text-sm text-text-muted">nothing flagged for right now</div>
      ) : (
        <ol className="list-decimal pl-18 flex flex-col gap-4 m-0">
          {todo.startNow.map((item, i) => (
            <li key={i} className="text-sm flex items-center justify-between gap-8">
              <span>{item}</span>
              {onDispatchTodo && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="shrink-0"
                  title="Dispatch this todo to a coworker"
                  onClick={() => onDispatchTodo(item)}
                >
                  Dispatch
                </Button>
              )}
            </li>
          ))}
        </ol>
      )}
      {todo && <SectionSummary sections={todo.sections} />}
    </div>
  );
}

function GateRow({ gate }: { gate: TrackerGate }) {
  const { glyph, word, color } = GATE_GLYPHS[gate.status];
  return (
    <div className="flex items-center justify-between gap-8 py-2 text-sm">
      <span className="flex items-center gap-5 min-w-0">
        <span className={`shrink-0 leading-none ${color}`}>{glyph}</span>
        <span className={`shrink-0 ${color}`}>{word}</span>
        <span className="truncate">{gate.label}</span>
      </span>
      <span className="shrink-0 text-text-muted tabular-nums">
        {gate.done}/{gate.total}
      </span>
    </div>
  );
}

function TrackerSection({ tracker }: { tracker: TrackerBriefing | null }) {
  return (
    <div>
      <h3 className="text-lg font-bold mb-6">
        HALF-BAKED {tracker?.milestone ? `— ${tracker.milestone.toUpperCase()}` : ''}
      </h3>
      {!tracker ? (
        <div className="text-sm text-text-muted">no tracker source configured</div>
      ) : tracker.gates.length === 0 ? (
        <div className="text-sm text-text-muted">no gates found</div>
      ) : (
        <div className="flex flex-col divide-y divide-border">
          {tracker.gates.map((gate) => (
            <GateRow key={gate.id} gate={gate} />
          ))}
        </div>
      )}
    </div>
  );
}

/** HUD BRIEFING panel: today's todo top-3 + half-baked-project tracker gates.
 *  Fetches GET /api/briefing (same-origin, unauthenticated dashboard-read
 *  endpoint) on open and every 5 minutes while open. Both halves render
 *  gracefully when their env-var-wired source isn't configured on the host. */
export function BriefingPanel({ isOpen, onClose, onDispatchTodo }: BriefingPanelProps) {
  const [briefing, setBriefing] = useState<Briefing | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;

    const load = async () => {
      try {
        const res = await fetch('/api/briefing');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as Briefing;
        if (!cancelled) {
          setBriefing(data);
          setError(false);
        }
      } catch (err) {
        console.log('[BriefingPanel] failed to fetch /api/briefing:', err);
        if (!cancelled) setError(true);
      }
    };

    void load();
    const interval = setInterval(() => void load(), REFRESH_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [isOpen]);

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="BRIEFING" className="max-w-md w-full">
      <div className="px-10 pb-6 max-h-[70vh] overflow-auto">
        {error && !briefing && (
          <div className="text-sm text-status-permission mb-8">⚠ unable to reach /api/briefing</div>
        )}
        <TodoSection todo={briefing?.todo ?? null} onDispatchTodo={onDispatchTodo} />
        <TrackerSection tracker={briefing?.tracker ?? null} />
      </div>
    </Modal>
  );
}
