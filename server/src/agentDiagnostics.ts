import * as fs from 'fs';

import type { AgentStateStore } from './agentStateStore.js';

export interface AgentDiagnosticRecord {
  id: number;
  projectDir: string;
  projectDirExists: boolean;
  jsonlFile: string;
  jsonlExists: boolean;
  fileSize: number;
  fileOffset: number;
  lastDataAt: number;
  linesProcessed: number;
}

/** Assemble the shared Debug View snapshot for either transport surface. */
export function buildAgentDiagnostics(store: AgentStateStore): AgentDiagnosticRecord[] {
  const diagnostics: AgentDiagnosticRecord[] = [];
  for (const [, agent] of store) {
    let jsonlExists = false;
    let fileSize = 0;
    try {
      const stat = fs.statSync(agent.jsonlFile);
      jsonlExists = true;
      fileSize = stat.size;
    } catch {
      // Missing/unreadable transcript is diagnostic state, not a request failure.
    }
    diagnostics.push({
      id: agent.id,
      projectDir: agent.projectDir,
      projectDirExists: fs.existsSync(agent.projectDir),
      jsonlFile: agent.jsonlFile,
      jsonlExists,
      fileSize,
      fileOffset: agent.fileOffset,
      lastDataAt: agent.lastDataAt,
      linesProcessed: agent.linesProcessed,
    });
  }
  return diagnostics;
}
