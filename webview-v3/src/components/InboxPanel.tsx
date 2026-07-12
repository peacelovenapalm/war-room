import { useEffect, useState } from 'react';

import {
  formatEntryAge,
  type InboxEntry,
  type InboxListing,
  routineGlyph,
} from '../net/inboxFacts';
import { Modal } from './Modal';

export interface InboxPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

const REFRESH_INTERVAL_MS = 60_000;

function EntryRow({
  entry,
  isOpenEntry,
  onTap,
}: {
  entry: InboxEntry;
  isOpenEntry: boolean;
  onTap: () => void;
}) {
  return (
    <button
      type="button"
      className="inbox__entry"
      data-testid="inbox-entry"
      aria-expanded={isOpenEntry}
      onClick={onTap}
    >
      <span className="inbox__entry-glyph">{routineGlyph(entry.routine)}</span>
      <span className="inbox__entry-main">
        <span className="inbox__entry-routine">{entry.routine}</span>
        <span className="modal__muted"> {entry.filename}</span>
      </span>
      <span className="inbox__entry-age modal__muted">{formatEntryAge(entry.ageMs)}</span>
    </button>
  );
}

/** INBOX panel (v4 T7 slice 2): recent Brain2 vault routine outputs
 *  (vault-health, project-pulse, docs-tracker, daily-digest, todo-compiler,
 *  etc.), newest-first, capped ~20. GET /api/inbox for the list; tapping a
 *  row fetches GET /api/inbox/content and renders the markdown body inline,
 *  read-only. The server's `available: false` (mount absent on this
 *  deployment) renders as an explicit honest line, matching
 *  GraphSearchPanel.tsx's posture. */
export function InboxPanel({ isOpen, onClose }: InboxPanelProps) {
  const [listing, setListing] = useState<InboxListing | null>(null);
  const [error, setError] = useState(false);
  const [openEntry, setOpenEntry] = useState<InboxEntry | null>(null);
  const [content, setContent] = useState<string | null>(null);
  const [contentError, setContentError] = useState(false);

  const [wasOpen, setWasOpen] = useState(isOpen);
  if (isOpen !== wasOpen) {
    setWasOpen(isOpen);
    if (isOpen) {
      setOpenEntry(null);
      setContent(null);
      setContentError(false);
    }
  }

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch('/api/inbox');
        if (!res.ok) throw new Error(`HTTP ${String(res.status)}`);
        const data = (await res.json()) as InboxListing;
        if (!cancelled) {
          setListing(data);
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

  useEffect(() => {
    if (!openEntry) return;
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch(
          `/api/inbox/content?routine=${encodeURIComponent(openEntry.routine)}&file=${encodeURIComponent(openEntry.filename)}`,
        );
        if (!res.ok) throw new Error(`HTTP ${String(res.status)}`);
        const data = (await res.json()) as { content: string };
        if (!cancelled) setContent(data.content);
      } catch {
        if (!cancelled) setContentError(true);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [openEntry]);

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="INBOX" testId="inbox-panel" wide>
      {error && !listing && <div className="modal__warn">⚠ unable to reach /api/inbox</div>}

      {listing && !listing.available && (
        <div className="modal__warn" data-testid="inbox-unavailable">
          ⊘ NO INBOX SOURCE — routines mount not present on this deployment
        </div>
      )}

      {listing?.available && listing.entries.length === 0 && (
        <div className="modal__muted" data-testid="inbox-empty">
          no routine output found
        </div>
      )}

      {listing?.available && listing.entries.length > 0 && (
        <div className="inbox__list" data-testid="inbox-list">
          {listing.entries.map((entry) => (
            <EntryRow
              key={`${entry.routine}/${entry.filename}`}
              entry={entry}
              isOpenEntry={
                openEntry?.routine === entry.routine && openEntry.filename === entry.filename
              }
              onTap={() => {
                const isSame =
                  openEntry?.routine === entry.routine && openEntry.filename === entry.filename;
                setOpenEntry(isSame ? null : entry);
                setContent(null);
                setContentError(false);
              }}
            />
          ))}
        </div>
      )}

      {openEntry && (
        <div className="inbox__content" data-testid="inbox-content">
          <div className="inbox__content-head">
            {routineGlyph(openEntry.routine)} {openEntry.routine} / {openEntry.filename}
          </div>
          {contentError && <div className="modal__warn">⚠ unable to load this entry</div>}
          {!contentError && content === null && <div className="modal__muted">… loading</div>}
          {!contentError && content !== null && (
            <pre className="inbox__content-body">{content}</pre>
          )}
        </div>
      )}
    </Modal>
  );
}
