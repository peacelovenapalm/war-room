import type { SettingsSnapshot } from '../state/settings';
import { Modal } from './Modal';

export interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  settings: SettingsSnapshot | null;
  onToggleSound: () => void;
  onToggleWatchAllSessions: () => void;
  onToggleHooksEnabled: () => void;
  onToggleAlwaysShowLabels: () => void;
}

function Toggle({
  label,
  checked,
  onChange,
  testId,
}: {
  label: string;
  checked: boolean;
  onChange: () => void;
  testId: string;
}) {
  return (
    <label className="settings-row">
      <input type="checkbox" checked={checked} onChange={onChange} data-testid={testId} />
      <span>{label}</span>
      <span className="settings-row__state">{checked ? '● ON' : '○ OFF'}</span>
    </label>
  );
}

/**
 * Settings modal (KICKOFF-v3.1 stage-3 port) — REAL toggles only, wired to
 * the actual settingsLoaded snapshot + Set* client messages (core/
 * generated). Honest "loading…" until the first settingsLoaded arrives —
 * never a guessed default toggle state. Debug View is its own dock entry
 * in v3, not a checkbox here (it opens a real panel, not an overlay flag).
 */
export function SettingsModal({
  isOpen,
  onClose,
  settings,
  onToggleSound,
  onToggleWatchAllSessions,
  onToggleHooksEnabled,
  onToggleAlwaysShowLabels,
}: SettingsModalProps) {
  return (
    <Modal isOpen={isOpen} onClose={onClose} title="SETTINGS" testId="settings-modal">
      {settings === null ? (
        <p className="modal__intro" data-testid="settings-loading">
          ◌ loading settings from the server…
        </p>
      ) : (
        <div className="settings-list">
          <Toggle
            label="Sound notifications"
            checked={settings.soundEnabled}
            onChange={onToggleSound}
            testId="settings-sound"
          />
          <Toggle
            label="Watch all sessions"
            checked={settings.watchAllSessions}
            onChange={onToggleWatchAllSessions}
            testId="settings-watch-all"
          />
          <Toggle
            label="Instant detection (hooks)"
            checked={settings.hooksEnabled}
            onChange={onToggleHooksEnabled}
            testId="settings-hooks"
          />
          <Toggle
            label="Always show labels"
            checked={settings.alwaysShowLabels}
            onChange={onToggleAlwaysShowLabels}
            testId="settings-always-labels"
          />
          {settings.externalAssetDirectories.length > 0 && (
            <div className="settings-dirs">
              <span className="settings-dirs__label">EXTERNAL ASSET DIRECTORIES</span>
              {settings.externalAssetDirectories.map((dir) => (
                <span key={dir} className="settings-dirs__item" title={dir}>
                  {dir.split(/[/\\]/).pop() ?? dir}
                </span>
              ))}
            </div>
          )}
          <p className="modal__footnote">
            v{settings.extensionVersion} · last seen {settings.lastSeenVersion || '—'}
          </p>
        </div>
      )}
    </Modal>
  );
}
