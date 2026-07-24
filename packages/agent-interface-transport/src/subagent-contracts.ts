/**
 * Subagent job data contracts (INFRA-025).
 *
 * SSOT for the subagent job state surfaced by session/workspace transport contracts.
 * Pure data only — spawn requests, results, and the runner/manager SPI stay in
 * `agent-executor`.
 */

import type {
  IBackgroundTaskState,
  TBackgroundTaskMode,
  TBackgroundTaskStatus,
} from './background-task-contracts';

/**
 * TYPE-003: derived from the background-task status SSOT ({@link TBackgroundTaskStatus}) instead of
 * a second hand-maintained union — a status added to the SSOT now flows here mechanically (the
 * prior manual copy silently missed `paused` when SELFHOST-012 added it). `paused` is excluded on
 * purpose: it is a scheduled-task-only status and a subagent is never a scheduled task
 * (`SubagentManager.toSubagentState` maps it to `sleeping`).
 */
export type TSubagentJobStatus = Exclude<TBackgroundTaskStatus, 'paused'>;

/** TYPE-003: alias of the background-task mode SSOT — the job mode is the same foreground/background pair. */
export type TSubagentJobMode = TBackgroundTaskMode;

/**
 * Subagent-job projection of {@link IBackgroundTaskState}.
 *
 * TYPE-003: every field a subagent job shares with the background-task SSOT is derived via `Pick`
 * (previously a ~20-field manual mirror that could drift silently). Only the genuinely
 * subagent-specific fields are declared here:
 * - `type` — the agent-definition type (the task-side counterpart is the optional `agentType`);
 * - `status` — the derived {@link TSubagentJobStatus} (no `paused`);
 * - `promptPreview` — required here (every subagent job is created from a prompt; optional on tasks);
 * - `currentTool` — the job-level projection of the task's free-form `currentAction`;
 * - `result`/`error` — flattened display strings (the task carries structured
 *   `IBackgroundTaskResult`/`IBackgroundTaskError` objects).
 */
export interface ISubagentJobState extends Pick<
  IBackgroundTaskState,
  | 'id'
  | 'label'
  | 'parentSessionId'
  | 'mode'
  | 'depth'
  | 'pid'
  | 'cwd'
  | 'isolation'
  | 'worktreePath'
  | 'branchName'
  | 'worktreeStatus'
  | 'worktreeNextAction'
  | 'worktreeBaseRevision'
  | 'parentWorktreeStatus'
  | 'logPath'
  | 'transcriptPath'
  | 'startedAt'
  | 'updatedAt'
  | 'completedAt'
  | 'timeoutReason'
  | 'metadata'
> {
  type: string;
  status: TSubagentJobStatus;
  promptPreview: string;
  currentTool?: string;
  result?: string;
  error?: string;
}
