import type { ConnectionStatus } from '../net/connection';

/** Debug diagnostics are meaningful only for a visible panel on a live
 * socket. Including status makes an offline→live transition start a fresh
 * effect, whose first action is an immediate request. */
export function shouldPollDiagnostics(
  isOpen: boolean,
  connectionStatus: ConnectionStatus,
): boolean {
  return isOpen && connectionStatus === 'live';
}
