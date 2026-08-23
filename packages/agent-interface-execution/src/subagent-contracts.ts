/**
 * Subagent job data contracts (INFRA-025).
 *
 * SSOT for the subagent job **data** surfaced by session/workspace transport contracts: the spawn
 * request, the job state, and the job result. Only the runner/manager **SPI** stays in
 * `agent-executor` — `ISubagentRunner`, `ISubagentManager`, `ISubagentJobStart`, `ISubagentJobHandle`
 * — because those carry methods and Promises, i.e. runtime semantics this package bans (INFRA-035).
 *
 * ARCH-031 corrected the previous version of this note, which said spawn requests and results stay in
 * `agent-executor`. They are pure data; `project-structure.md` puts the background-task/subagent data
 * contracts here and leaves the runtime SPI there. Declaring them twice is what let a field be dropped
 * at any of six hand-written projections without anything failing.
 */

import type {
  IAgentBackgroundTaskRequest,
  IBackgroundTaskResult,
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

/**
 * A subagent spawn request IS an agent background-task request (ARCH-031).
 *
 * `kind` is fixed by the seam — a subagent is never a process task — so omitting it both removes a
 * field every caller would have to set identically and structurally prevents `kind: 'process'` from
 * reaching `SubagentManager.spawn`. Everything else is carried by derivation rather than by a
 * hand-written projection remembering it, which is the whole point: `parentTaskId` and
 * `providerProfile` reach the runner because they exist on the source, not because someone recalled
 * them.
 *
 * Nothing is added here. The worktree identity a runner produces (`worktreePath`, and formerly a
 * write-only `branchName`) belongs on the runner envelope `ISubagentJobStart`, not on a request that
 * models what the CALLER asked for.
 */
export type ISubagentSpawnRequest = Omit<IAgentBackgroundTaskRequest, 'kind'>;

/**
 * A subagent job result IS a background-task result (ARCH-031).
 *
 * `exitCode`/`signalCode` are process-only — their sole producer is the shell runner
 * (`agent-executor/src/background-tasks/runners/managed-shell-process-runner.ts`) and no agent-kind
 * result sets them — so carrying them here would declare two fields that are structurally
 * unreachable, which is the defect class this derivation exists to remove.
 *
 * Deliberately an `Omit` rather than a per-kind split of `IBackgroundTaskResult`:
 * `IBackgroundTaskState.result` is an independent property alongside `state.kind`, and
 * `IBackgroundTaskState` is not itself a discriminated union, so `state.kind === 'agent'` cannot
 * narrow `state.result`. A split would hand every result consumer a bare union with no correlated
 * narrowing and buy no type safety. Revisit only if `IBackgroundTaskState` is ever discriminated.
 */
export type ISubagentJobResult = Omit<IBackgroundTaskResult, 'kind' | 'exitCode' | 'signalCode'>;
