import { useState } from 'react';

import { HELP_CATEGORIES, HELP_SECTIONS, type HelpCategory } from '../content/helpContent';
import { Modal } from './Modal';

function slug(category: string): string {
  return category
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

export interface HelpModalProps {
  isOpen: boolean;
  onClose: () => void;
}

/**
 * Full-vocabulary HELP screen (KICKOFF-v3.1 stage-3 port) — a categorized
 * quick-menu over content/helpContent.ts, reachable via the `?` key and the
 * dock's ? HELP button. Content describes the ACTUAL v3 screen, not v1's.
 */
export function HelpModal({ isOpen, onClose }: HelpModalProps) {
  const [expanded, setExpanded] = useState<Set<HelpCategory>>(new Set());

  const toggle = (category: HelpCategory) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(category)) next.delete(category);
      else next.add(category);
      return next;
    });
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="HELP — WHAT AM I LOOKING AT?"
      testId="help-modal"
      wide
    >
      <p className="modal__intro">
        Everything on this dashboard is real: real sessions, real tokens, real gates. Press{' '}
        <strong>?</strong> anytime to reopen this screen.
      </p>
      {HELP_CATEGORIES.map((category) => {
        const sections = HELP_SECTIONS.filter((s) => s.category === category);
        const isExpanded = expanded.has(category);
        return (
          <div
            key={category}
            className="help-category"
            data-testid={`help-category-${slug(category)}`}
          >
            <button
              type="button"
              className="help-category__toggle"
              data-testid={`help-category-toggle-${slug(category)}`}
              onClick={() => {
                toggle(category);
              }}
            >
              <span>
                {isExpanded ? '▾' : '▸'} {category}
              </span>
              <span className="help-category__count">
                {sections.length} {sections.length === 1 ? 'section' : 'sections'}
              </span>
            </button>
            {isExpanded && (
              <div className="help-category__body">
                {sections.map((section) => (
                  <div
                    key={section.id}
                    className="help-section"
                    data-testid={`help-section-${section.id}`}
                  >
                    <h3 className="help-section__title">{section.title}</h3>
                    {section.intro && <p className="help-section__intro">{section.intro}</p>}
                    <div className="help-section__entries">
                      {section.entries.map((entry) => (
                        <div key={`${section.id}-${entry.word}`} className="help-entry">
                          <span className="help-entry__label">
                            {entry.glyph} {entry.word}
                          </span>
                          <span className="help-entry__text">{entry.text}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </Modal>
  );
}
