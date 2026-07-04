/**
 * Subagent job data contracts (INFRA-025).
 *
 * SSOT for the subagent job state surfaced by session/workspace transport contracts.
 * Pure data only — spawn requests, results, and the runner/manager SPI stay in
 * `agent-executor`.
 */

import type {
  TBackgroundPrimitive,
  TBackgroundTaskIsolation,
  TBackgroundTaskTimeoutReason,
} from './background-task-contracts';

export type TSubagentJobStatus =
  | 'queued'
  | 'running'
  | 'waiting_permission'
  | 'sleeping'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type TSubagentJobMode = 'foreground' | 'background';

export interface ISubagentJobState {
  id: string;
  type: string;
  label: string;
  parentSessionId: string;
  status: TSubagentJobStatus;
  mode: TSubagentJobMode;
  depth: number;
  pid?: number;
  cwd: string;
  isolation?: TBackgroundTaskIsolation;
  worktreePath?: string;
  branchName?: string;
  worktreeStatus?: string;
  worktreeNextAction?: string;
  worktreeBaseRevision?: string;
  parentWorktreeStatus?: string;
  promptPreview: string;
  currentTool?: string;
  logPath?: string;
  transcriptPath?: string;
  startedAt?: string;
  updatedAt: string;
  completedAt?: string;
  timeoutReason?: TBackgroundTaskTimeoutReason;
  result?: string;
  error?: string;
  metadata?: Record<string, TBackgroundPrimitive>;
}
