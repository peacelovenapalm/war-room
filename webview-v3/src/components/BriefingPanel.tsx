import { useEffect, useState } from 'react';

import { Modal } from './Modal';

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

export interface BriefingPanelProps {
  isOpen: boolean;
  onClose: () => void;
  /** DISPATCH bridge: pre-fill the CALL modal's prompt with a todo line's
   *  text and open it. */
  onDispatchTodo: (prompt: string) => void;
}

const GATE_GLYPHS: Record<GateStatus, { glyph: string; word: string }> = {
  DONE: { glyph: '✓', word: 'DONE' },
  IN_PROGRESS: { glyph: '◷', word: 'IN PROGRESS' },
  BLOCKED: { glyph: '⚠', word: 'BLOCKED' },
  TODO: { glyph: '○', word: 'TODO' },
};

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
    <div className="modal__muted">
      {withCounts
        .map((s) => {
          const { glyph, word } = classifySection(s.title);
          return `${glyph} ${word} ${String(s.count)}`;
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
  onDispatchTodo: (prompt: string) => void;
}) {
  return (
    <div className="briefing-section">
      <h3 className="briefing-section__title">TODAY {todo ? `— START NOW (${todo.date})` : ''}</h3>
      {!todo ? (
        <div className="modal__muted">no todo source configured</div>
      ) : todo.startNow.length === 0 ? (
        <div className="modal__muted">nothing flagged for right now</div>
      ) : (
        <ol className="briefing-todo-list">
          {todo.startNow.map((item, i) => (
            <li key={i} className="briefing-todo-list__item">
              <span>{item}</span>
              <button
                type="button"
                className="verb"
                title="Dispatch this todo to a coworker"
                data-testid="briefing-dispatch"
                onClick={() => {
                  onDispatchTodo(item);
                }}
              >
                DISPATCH
              </button>
            </li>
          ))}
        </ol>
      )}
      {todo && <SectionSummary sections={todo.sections} />}
    </div>
  );
}

function GateRow({ gate }: { gate: TrackerGate }) {
  const { glyph, word } = GATE_GLYPHS[gate.status];
  return (
    <div className="briefing-gate-row">
      <span>
        {glyph} {word} {gate.label}
      </span>
      <span className="modal__muted">
        {gate.done}/{gate.total}
      </span>
    </div>
  );
}

function TrackerSection({ tracker }: { tracker: TrackerBriefing | null }) {
  return (
    <div className="briefing-section">
      <h3 className="briefing-section__title">
        HALF-BAKED {tracker?.milestone ? `— ${tracker.milestone.toUpperCase()}` : ''}
      </h3>
      {!tracker ? (
        <div className="modal__muted">no tracker source configured</div>
      ) : tracker.gates.length === 0 ? (
        <div className="modal__muted">no gates found</div>
      ) : (
        <div className="briefing-gates">
          {tracker.gates.map((gate) => (
            <GateRow key={gate.id} gate={gate} />
          ))}
        </div>
      )}
    </div>
  );
}

/** BRIEFING panel (KICKOFF-v3.1 stage-3 port): today's todo top-3 +
 *  half-baked-project tracker gates. GET /api/briefing on open + every 5
 *  minutes while open. */
export function BriefingPanel({ isOpen, onClose, onDispatchTodo }: BriefingPanelProps) {
  const [briefing, setBriefing] = useState<Briefing | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch('/api/briefing');
        if (!res.ok) throw new Error(`HTTP ${String(res.status)}`);
        const data = (await res.json()) as Briefing;
        if (!cancelled) {
          setBriefing(data);
          setError(false);
        }
      } catch {
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
    <Modal isOpen={isOpen} onClose={onClose} title="BRIEFING" testId="briefing-panel">
      {error && !briefing && <div className="modal__warn">⚠ unable to reach /api/briefing</div>}
      <TodoSection todo={briefing?.todo ?? null} onDispatchTodo={onDispatchTodo} />
      <TrackerSection tracker={briefing?.tracker ?? null} />
    </Modal>
  );
}
