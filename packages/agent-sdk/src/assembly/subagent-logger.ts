/**
 * Subagent transcript logger — creates a FileSessionLogger that writes
 * subagent session logs into a subdirectory of the parent session's log folder.
 *
 * Log structure:
 *   {baseLogsDir}/{parentSessionId}/subagents/{agentId}.jsonl
 */

import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { FileSessionLogger } from '@robota-sdk/agent-sessions';

/**
 * Create a FileSessionLogger for a subagent session.
 *
 * The logger writes JSONL files into a `subagents/` subdirectory under the
 * parent session's log folder. The directory is created if it does not exist.
 *
 * @param parentSessionId - ID of the parent session (used as directory name)
 * @param agentId - Unique identifier for this subagent run
 * @param baseLogsDir - Root logs directory (e.g., `.robota/logs`)
 * @returns A FileSessionLogger writing to the subagent directory
 */
export function createSubagentLogger(
  parentSessionId: string,
  _agentId: string,
  baseLogsDir: string,
): FileSessionLogger {
  const subagentDir = join(baseLogsDir, parentSessionId, 'subagents');
  mkdirSync(subagentDir, { recursive: true });
  return new FileSessionLogger(subagentDir);
}

/**
 * Resolve the subagent log directory path without creating it.
 *
 * Useful when the caller needs the path for display or configuration
 * but does not want to create the directory immediately.
 *
 * @param parentSessionId - ID of the parent session
 * @param baseLogsDir - Root logs directory
 * @returns The resolved subagent log directory path
 */
export function resolveSubagentLogDir(parentSessionId: string, baseLogsDir: string): string {
  return join(baseLogsDir, parentSessionId, 'subagents');
}
