/**
 * Background-task data contracts (INFRA-025).
 *
 * SSOT for the task/job data shapes shared by the execution runtime and every transport
 * surface. Pure data only — the runner/manager SPI (ports, handles, the BackgroundTaskError
 * class) stays in `agent-executor`, which imports these contracts.
 */

import type { TBackgroundPermissionPolicy, TUniversalValue } from '@robota-sdk/agent-core';

/**
 * Per-task permission policy. SSOT lives in `agent-core` (the permission-logic home; CORE-025) — re-exported
 * here so existing consumers keep importing it from `agent-interface-transport` unchanged.
 */
export type { TBackgroundPermissionPolicy } from '@robota-sdk/agent-core';

export type TBackgroundTaskKind = 'agent' | 'process' | 'scheduled';

export type TBackgroundTaskMode = 'foreground' | 'background';

export type TBackgroundTaskIsolation = 'none' | 'worktree';

export type TBackgroundTaskStatus =
  | 'queued'
  | 'running'
  | 'waiting_permission'
  | 'sleeping'
  // SELFHOST-012: a scheduled task whose recurrence is non-destructively paused (croner `.pause()`, not the
  // irreversible `.stop()` that `cancelled` uses). Non-terminal — resumes to `sleeping`.
  | 'paused'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type TBackgroundTaskTimeoutReason =
  | 'idle'
  | 'max_runtime'
  | 'output_limit'
  | 'repetition'
  | 'stale_worker';

export type TBackgroundTaskErrorCategory =
  | 'validation'
  | 'capacity'
  | 'permission'
  | 'timeout'
  | 'runner'
  | 'crash'
  | 'provider'
  | 'process';

export type TBackgroundPrimitive = string | number | boolean;

export interface IBackgroundTaskError {
  category: TBackgroundTaskErrorCategory;
  message: string;
  recoverable: boolean;
}

export interface ISerializableProviderProfile {
  profileName?: string;
  type: string;
  model: string;
  apiKey?: string;
  apiKeyEnv?: string;
  baseURL?: string;
  timeout?: number;
  options?: Record<string, TUniversalValue>;
}

export interface IBaseBackgroundTaskRequest {
  kind: TBackgroundTaskKind;
  label: string;
  mode: TBackgroundTaskMode;
  parentSessionId: string;
  parentTaskId?: string;
  depth: number;
  cwd: string;
  timeoutMs?: number;
  idleTimeoutMs?: number;
  maxRuntimeMs?: number;
  metadata?: Record<string, TBackgroundPrimitive>;
}

export interface IAgentBackgroundTaskRequest extends IBaseBackgroundTaskRequest {
  kind: 'agent';
  agentType: string;
  prompt: string;
  model?: string;
  isolation?: TBackgroundTaskIsolation;
  allowedTools?: string[];
  disallowedTools?: string[];
  permissionPolicy: TBackgroundPermissionPolicy;
  providerProfile?: ISerializableProviderProfile;
  outputLimitBytes?: number;
  maxTextDeltas?: number;
  repetitionWindow?: number;
  repetitionThreshold?: number;
}

export interface IProcessBackgroundTaskRequest extends IBaseBackgroundTaskRequest {
  kind: 'process';
  command: string;
  shell?: string;
  env?: Record<string, string>;
  stdin?: string;
  outputLimitBytes?: number;
  /**
   * FLOW-004 (monitor): a regular-expression source. Output lines matching it fire a
   * `background_task_waking` carrying `agentInstruction` + the matched line, so the agent
   * reacts to "something happened in this process's output".
   */
  matchPattern?: string;
  /** FLOW-004: the instruction injected on a monitor match (paired with `matchPattern`). */
  agentInstruction?: string;
}

export interface IScheduledBackgroundTaskRequest extends IBaseBackgroundTaskRequest {
  kind: 'scheduled';
  cronExpression: string;
  /**
   * Shell command to run on each fire. Optional when `agentInstruction` is set —
   * an agent-wake schedule may fire the agent loop instead of (or in addition to) a shell command.
   */
  command?: string;
  /**
   * FLOW-001: when set, each fire carries this instruction on the `background_task_waking`
   * event so an upper layer (FLOW-002) can wake the agent loop with a non-user turn.
   */
  agentInstruction?: string;
  shell?: string;
  env?: Record<string, string>;
  outputLimitBytes?: number;
}

export type TBackgroundTaskRequest =
  | IAgentBackgroundTaskRequest
  | IProcessBackgroundTaskRequest
  | IScheduledBackgroundTaskRequest;

/** ANALYTICS-001 (Phase 2): token usage a completed task/subagent consumed, for source attribution. */
export interface IBackgroundTaskUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface IBackgroundTaskResult {
  taskId: string;
  kind: TBackgroundTaskKind;
  output: string;
  exitCode?: number;
  signalCode?: string;
  metadata?: Record<string, TBackgroundPrimitive>;
  /** ANALYTICS-001 (Phase 2): total token usage of an agent task, attributed to it in the parent log. */
  usage?: IBackgroundTaskUsage;
}

export interface IBackgroundTaskState {
  id: string;
  kind: TBackgroundTaskKind;
  label: string;
  agentType?: string;
  status: TBackgroundTaskStatus;
  mode: TBackgroundTaskMode;
  parentSessionId: string;
  parentTaskId?: string;
  depth: number;
  cwd: string;
  pid?: number;
  startedAt?: string;
  updatedAt: string;
  lastActivityAt?: string;
  completedAt?: string;
  promptPreview?: string;
  commandPreview?: string;
  isolation?: TBackgroundTaskIsolation;
  currentAction?: string;
  unread: boolean;
  result?: IBackgroundTaskResult;
  error?: IBackgroundTaskError;
  logPath?: string;
  transcriptPath?: string;
  worktreePath?: string;
  branchName?: string;
  worktreeStatus?: string;
  worktreeNextAction?: string;
  worktreeBaseRevision?: string;
  parentWorktreeStatus?: string;
  timeoutReason?: TBackgroundTaskTimeoutReason;
  nextFireAt?: string;
  /**
   * FLOW-003: for `kind: 'scheduled'` tasks, the reconstructable schedule definition.
   * Persisted with the task so a resumed session can re-arm the croner job.
   */
  schedule?: IBackgroundTaskSchedule;
  metadata?: Record<string, TBackgroundPrimitive>;
}

/** FLOW-003: the persisted, reconstructable definition of a scheduled wake. */
export interface IBackgroundTaskSchedule {
  cronExpression: string;
  agentInstruction?: string;
  command?: string;
  shell?: string;
  env?: Record<string, string>;
}

export interface IBackgroundTaskInput {
  prompt?: string;
  stdin?: string;
}

export interface IBackgroundTaskLogCursor {
  offset: number;
}

export interface IBackgroundTaskLogPage {
  taskId: string;
  cursor?: IBackgroundTaskLogCursor;
  nextCursor?: IBackgroundTaskLogCursor;
  lines: string[];
}

export interface IBackgroundTaskListFilter {
  kind?: TBackgroundTaskKind;
  status?: TBackgroundTaskStatus;
  mode?: TBackgroundTaskMode;
  includeClosed?: boolean;
}

export type TBackgroundTaskEvent =
  | { type: 'background_task_created'; task: IBackgroundTaskState }
  | { type: 'background_task_started'; task: IBackgroundTaskState }
  | { type: 'background_task_updated'; task: IBackgroundTaskState }
  | { type: 'background_task_text_delta'; taskId: string; delta: string }
  | { type: 'background_task_tool_start'; taskId: string; toolName: string; firstArg?: string }
  | {
      type: 'background_task_tool_end';
      taskId: string;
      toolName: string;
      success: boolean;
      error?: string;
    }
  | {
      type: 'background_task_permission_request';
      taskId: string;
      requestId: string;
      toolName: string;
      toolArgs: Record<string, TBackgroundPrimitive>;
    }
  | { type: 'background_task_completed'; task: IBackgroundTaskState }
  | { type: 'background_task_failed'; task: IBackgroundTaskState }
  | { type: 'background_task_cancelled'; task: IBackgroundTaskState }
  | { type: 'background_task_closed'; taskId: string }
  // FLOW-001: a scheduled/monitor task fired. `instruction`, when present, is the agent-wake
  // instruction an upper layer (FLOW-002) injects as a non-user turn.
  | { type: 'background_task_waking'; taskId: string; instruction?: string };

export type TBackgroundTaskEventListener = (event: TBackgroundTaskEvent) => void;
