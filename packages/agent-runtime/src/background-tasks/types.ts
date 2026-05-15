import type { TUniversalValue } from '@robota-sdk/agent-core';

export type TBackgroundTaskKind = 'agent' | 'process' | 'scheduled';

export type TBackgroundTaskMode = 'foreground' | 'background';

export type TBackgroundTaskIsolation = 'none' | 'worktree';

export type TBackgroundTaskStatus =
  | 'queued'
  | 'running'
  | 'waiting_permission'
  | 'sleeping'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type TBackgroundPermissionPolicy = 'inherit-allowlist' | 'preapproved' | 'prompt' | 'deny';

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

export class BackgroundTaskError extends Error implements IBackgroundTaskError {
  readonly category: TBackgroundTaskErrorCategory;
  readonly recoverable: boolean;

  constructor(category: TBackgroundTaskErrorCategory, message: string, recoverable = true) {
    super(message);
    this.name = 'BackgroundTaskError';
    this.category = category;
    this.recoverable = recoverable;
  }
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
}

export interface IScheduledBackgroundTaskRequest extends IBaseBackgroundTaskRequest {
  kind: 'scheduled';
  cronExpression: string;
  command: string;
  shell?: string;
  env?: Record<string, string>;
  outputLimitBytes?: number;
}

export type TBackgroundTaskRequest =
  | IAgentBackgroundTaskRequest
  | IProcessBackgroundTaskRequest
  | IScheduledBackgroundTaskRequest;

export interface IBackgroundTaskResult {
  taskId: string;
  kind: TBackgroundTaskKind;
  output: string;
  exitCode?: number;
  signalCode?: string;
  metadata?: Record<string, TBackgroundPrimitive>;
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
  metadata?: Record<string, TBackgroundPrimitive>;
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

export type TBackgroundTaskRunnerEvent =
  | { type: 'background_task_text_delta'; delta: string }
  | { type: 'background_task_tool_start'; toolName: string; firstArg?: string }
  | {
      type: 'background_task_tool_end';
      toolName: string;
      success: boolean;
      error?: string;
    }
  | {
      type: 'background_task_permission_request';
      requestId: string;
      toolName: string;
      toolArgs: Record<string, TBackgroundPrimitive>;
    }
  | { type: 'background_task_sleeping'; nextFireAt: string }
  | { type: 'background_task_waking' };

export interface IBackgroundTaskStart {
  taskId: string;
  request: TBackgroundTaskRequest;
  emit?: (event: TBackgroundTaskRunnerEvent) => void;
}

export interface IBackgroundTaskHandle {
  readonly taskId: string;
  readonly pid?: number;
  readonly logPath?: string;
  readonly transcriptPath?: string;
  result: Promise<IBackgroundTaskResult>;
  cancel(reason?: string): Promise<void>;
  send?(input: IBackgroundTaskInput): Promise<void>;
  readLog?(cursor?: IBackgroundTaskLogCursor): Promise<IBackgroundTaskLogPage>;
}

export interface IBackgroundTaskRunner {
  readonly kind: TBackgroundTaskKind;
  start(task: IBackgroundTaskStart): IBackgroundTaskHandle;
}

export type TBackgroundTaskIdFactory = (request: TBackgroundTaskRequest) => string;

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
  | { type: 'background_task_closed'; taskId: string };

export type TBackgroundTaskEventListener = (event: TBackgroundTaskEvent) => void;

export interface IBackgroundTaskManager {
  spawn(request: TBackgroundTaskRequest): Promise<IBackgroundTaskState>;
  wait(taskId: string): Promise<IBackgroundTaskResult>;
  list(filter?: IBackgroundTaskListFilter): IBackgroundTaskState[];
  get(taskId: string): IBackgroundTaskState | undefined;
  cancel(taskId: string, reason?: string): Promise<void>;
  close(taskId: string): Promise<void>;
  shutdown(reason?: string): Promise<void>;
  send(taskId: string, input: IBackgroundTaskInput): Promise<void>;
  readLog(taskId: string, cursor?: IBackgroundTaskLogCursor): Promise<IBackgroundTaskLogPage>;
  subscribe(listener: TBackgroundTaskEventListener): () => void;
}

export interface IBackgroundTaskManagerOptions {
  runners: IBackgroundTaskRunner[];
  maxConcurrent?: number;
  maxDepth?: number;
  now?: () => string;
  idFactory?: TBackgroundTaskIdFactory;
  eventSink?: TBackgroundTaskEventListener;
  agentIdleTimeoutMs?: number;
  agentMaxRuntimeMs?: number;
  agentOutputLimitBytes?: number;
  agentMaxTextDeltas?: number;
  repetitionWindow?: number;
  repetitionThreshold?: number;
}
