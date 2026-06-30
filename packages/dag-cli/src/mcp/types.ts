/** Shared types for the MCP server module. */

import type { LocalDagRunner } from '../local-runner/index.js';

export interface IRunRecord {
  dagRunId: string;
  dagId?: string;
  status: string;
  completedAt: number;
  durationMs: number;
  nodeStatuses: Array<{ nodeId: string; status: string }>;
}

export interface IMcpCommandOptions {
  /** Override for testing: skip server.connect() */
  readonly skipConnect?: boolean;
  /** Override the runner factory for testing */
  readonly createRunner?: () => LocalDagRunner;
  /** Override the catalog directory (default: .dag/workflows) */
  readonly catalogDir?: string;
  /** Working directory for resolving .dag/nodes and other relative paths */
  readonly projectDir?: string;
}
