import { normalizeProjectPath } from './normalizeProjectPath.js';

/**
 * One employee per (machine, project) pair (GAME-DESIGN §4.1). Provider is
 * an attribute, not part of identity. Shared between server (employeeStore.ts)
 * and webview (officeState.ts, for the stable-sprite FK) so both sides never
 * drift on the id algorithm.
 */
export function employeeId(machine: string | undefined, projectDir: string): string {
  const slug = normalizeProjectPath(projectDir);
  return `${machine || 'LOCAL'}:${slug}`;
}
