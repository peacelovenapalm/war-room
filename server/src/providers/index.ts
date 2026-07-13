/**
 * Provider registry: re-exports all bundled providers.
 *
 * Adding a new CLI provider:
 *   1. Create `server/src/providers/hook/<cli>/<cli>.ts` implementing HookProvider.
 *      (File-based and stream-based provider types will land when the first such
 *       provider ships.)
 *   2. Add an export line below.
 *
 * The adapter (VS Code extension, standalone CLI, etc.) imports from here rather
 * than reaching into each provider directory directly.
 */

import type { HookProvider } from '../../../core/src/provider.js';
import { claudeProvider } from './hook/claude/claude.js';
import { codexProvider } from './hook/codex/codex.js';

export { claudeProvider };
export { copyHookScript } from './hook/claude/claudeHookInstaller.js';
export { codexProvider };

/** All native hook normalizers keyed by the authenticated ingest provider id. */
export const hookProviderRegistry: ReadonlyMap<string, HookProvider> = new Map([
  [claudeProvider.id, claudeProvider],
  [codexProvider.id, codexProvider],
]);

/** Webviews currently receive one global tool taxonomy, so expose the union of
 * bundled provider capabilities. Provider identity still travels per agent. */
export const hookProviderCapabilities = {
  readingTools: [...new Set([...claudeProvider.readingTools, ...codexProvider.readingTools])],
  subagentToolNames: [
    ...new Set([...claudeProvider.subagentToolNames, ...codexProvider.subagentToolNames]),
  ],
};
