/**
 * Remote transcript-path retention (T1 remote live-tail plane, S1/S2 of
 * .planning/v2/REMOTE-TAILER-DESIGN.md). registerHookRoute (httpServer.ts)
 * strips transcript_path from remote hook events so this process never
 * watches a file on another machine, but retains it here so S2's
 * tail-instruction builder (remoteTailDemand.ts) can look it up when it
 * needs to tell the remote tailer what to read. Retained as an OPAQUE
 * string only — nothing in this process ever opens a path stored here; it
 * is remote-machine data passed through, not consumed.
 *
 * A standalone module (not folded into httpServer.ts, where S1 first wrote
 * it) so remoteTailDemand.ts can import it without a circular dependency on
 * httpServer.ts. httpServer.ts re-exports getRemoteTranscriptPath for the
 * existing S1 route/test call sites.
 *
 * Keyed by (machine, sessionId) — the same identity TailInstruction
 * carries. Bounded defensively at MAX_REMOTE_TRANSCRIPT_PATHS (oldest-first
 * eviction) so a runaway/malicious remote can't grow this unboundedly.
 * Real lifecycle cleanup rides the store's 'agentRemoved' choke point via
 * the agentId reverse index below (linked once the hook-created/-matched
 * agent is known — see registerHookRoute's linkRemoteTranscriptPathToAgent
 * call site).
 */

import { MAX_REMOTE_TRANSCRIPT_PATHS } from './constants.js';

const remoteTranscriptPaths = new Map<string, string>();
const remoteTranscriptPathAgentKeys = new Map<number, string>();

function remoteTranscriptPathKey(machine: string, sessionId: string): string {
  return `${machine} ${sessionId}`;
}

export function retainRemoteTranscriptPath(
  machine: string,
  sessionId: string,
  transcriptPath: string,
): void {
  const key = remoteTranscriptPathKey(machine, sessionId);
  remoteTranscriptPaths.set(key, transcriptPath);
  if (remoteTranscriptPaths.size > MAX_REMOTE_TRANSCRIPT_PATHS) {
    const oldest = remoteTranscriptPaths.keys().next().value;
    if (oldest !== undefined) remoteTranscriptPaths.delete(oldest);
  }
}

export function linkRemoteTranscriptPathToAgent(
  agentId: number,
  machine: string,
  sessionId: string,
): void {
  remoteTranscriptPathAgentKeys.set(agentId, remoteTranscriptPathKey(machine, sessionId));
}

/** Called from the 'agentRemoved' choke point (createHttpServer) — the
 *  transcript-path retention entry can never outlive its agent. */
export function evictRemoteTranscriptPath(agentId: number): void {
  const key = remoteTranscriptPathAgentKeys.get(agentId);
  if (key !== undefined) {
    remoteTranscriptPaths.delete(key);
    remoteTranscriptPathAgentKeys.delete(agentId);
  }
}

/** S2's tail-instruction builder (remoteTailDemand.ts) resolves this exact
 *  (machine, sessionId) → transcriptPath lookup. */
export function getRemoteTranscriptPath(machine: string, sessionId: string): string | undefined {
  return remoteTranscriptPaths.get(remoteTranscriptPathKey(machine, sessionId));
}
