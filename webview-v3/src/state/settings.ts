/**
 * Settings pure reducer over the real server WS plane — a verbatim mirror
 * of the settingsLoaded/externalAssetDirectoriesUpdated broadcasts (same
 * "no synthesized state" convention as net/agentStore.ts and state/economy.ts).
 * Null until settingsLoaded arrives: the Settings modal shows an honest
 * "loading…" rather than a guessed default toggle state.
 */

import type { ServerMessage } from '../../../core/src/messages.js';

export interface SettingsSnapshot {
  soundEnabled: boolean;
  watchAllSessions: boolean;
  alwaysShowLabels: boolean;
  hooksEnabled: boolean;
  hooksInfoShown: boolean;
  externalAssetDirectories: string[];
  lastSeenVersion: string;
  extensionVersion: string;
}

export function reduceSettings(
  prev: SettingsSnapshot | null,
  message: ServerMessage,
): SettingsSnapshot | null {
  if (message.type === 'settingsLoaded') {
    return {
      soundEnabled: message.soundEnabled,
      watchAllSessions: message.watchAllSessions,
      alwaysShowLabels: message.alwaysShowLabels,
      hooksEnabled: message.hooksEnabled,
      hooksInfoShown: message.hooksInfoShown,
      externalAssetDirectories: message.externalAssetDirectories,
      lastSeenVersion: message.lastSeenVersion,
      extensionVersion: message.extensionVersion,
    };
  }
  if (message.type === 'externalAssetDirectoriesUpdated') {
    if (prev === null) return prev;
    return { ...prev, externalAssetDirectories: message.dirs };
  }
  return prev;
}
