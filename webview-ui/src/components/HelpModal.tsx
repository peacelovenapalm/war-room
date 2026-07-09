import { useState } from 'react';

import { HELP_CATEGORIES, HELP_SECTIONS, type HelpCategory } from '../helpContent.js';
import { Modal } from './ui/Modal.js';

interface HelpModalProps {
  isOpen: boolean;
  onClose: () => void;
}

function slug(category: string): string {
  return category
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

/**
 * In-dashboard help screen: a categorized quick-menu (KICKOFF v1.1 item 8)
 * replacing the old flat, always-fully-expanded list of 15 sections — each
 * category collapses to one skimmable header and expands on click to show
 * its sections exactly as before. Content still lives entirely in
 * helpContent.ts; this only reorganizes presentation. Reachable at all
 * times via the `?` key and the HELP word-button in the bottom toolbar.
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
    <Modal isOpen={isOpen} onClose={onClose} title="HELP — WHAT AM I LOOKING AT?" zIndex={54}>
      <div className="px-10 pb-8 max-h-[72vh] overflow-auto" style={{ maxWidth: 640 }}>
        <p className="text-sm text-text-muted mb-10">
          Everything on this dashboard is real: real sessions, real tokens, real gates. Press{' '}
          <span className="text-text font-bold">?</span> anytime to open this screen. Pick a
          category below to expand it.
        </p>
        {HELP_CATEGORIES.map((category) => {
          const sections = HELP_SECTIONS.filter((s) => s.category === category);
          const isExpanded = expanded.has(category);
          return (
            <div
              key={category}
              className="mb-8 border-b border-border pb-8"
              data-testid={`help-category-${slug(category)}`}
            >
              <button
                onClick={() => toggle(category)}
                className="w-full flex items-center justify-between gap-8 text-left bg-transparent border-none cursor-pointer p-0 text-lg font-bold text-text
                  max-sm:min-h-44"
                data-testid={`help-category-toggle-${slug(category)}`}
              >
                <span>
                  {isExpanded ? '▾' : '▸'} {category}
                </span>
                <span className="text-xs text-text-muted font-normal whitespace-nowrap">
                  {sections.length} {sections.length === 1 ? 'section' : 'sections'}
                </span>
              </button>
              {isExpanded && (
                <div className="mt-8">
                  {sections.map((section) => (
                    <div
                      key={section.id}
                      className="mb-14"
                      data-testid={`help-section-${section.id}`}
                    >
                      <h3 className="text-base font-bold mb-4">{section.title}</h3>
                      {section.intro && (
                        <p className="text-sm text-text-muted mb-6">{section.intro}</p>
                      )}
                      <div className="flex flex-col gap-5">
                        {section.entries.map((entry) => (
                          <div key={`${section.id}-${entry.word}`} className="flex gap-8 text-sm">
                            <span
                              className="shrink-0 font-bold whitespace-nowrap"
                              style={{ minWidth: 130 }}
                            >
                              {entry.glyph} {entry.word}
                            </span>
                            <span className="min-w-0">{entry.text}</span>
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
      </div>
    </Modal>
  );
}
