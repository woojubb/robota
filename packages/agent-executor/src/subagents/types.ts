import type {
  IBackgroundTaskManager,
  IBackgroundTaskLogCursor,
  IBackgroundTaskLogPage,
  IBackgroundTaskRunner,
  TBackgroundTaskRequest,
  TBackgroundPrimitive,
  TBackgroundTaskRunnerEvent,
  TBackgroundTaskIsolation,
  TBackgroundTaskTimeoutReason,
  TBackgroundPermissionPolicy,
} from '../background-tasks/index.js';
import type {
  ISubagentJobState,
  TSubagentJobMode,
  TSubagentJobStatus,
} from '@robota-sdk/agent-interface-transport';

export type { ISubagentJobState, TSubagentJobMode, TSubagentJobStatus };

export interface ISubagentSpawnRequest {
  type: string;
  label: string;
  parentSessionId: string;
  mode: TSubagentJobMode;
  depth: number;
  cwd: string;
  worktreePath?: string;
  branchName?: string;
  prompt: string;
  model?: string;
  isolation?: TBackgroundTaskIsolation;
  allowedTools?: string[];
  disallowedTools?: string[];
  /**
   * CORE-025: the spawned subagent's permission policy. Carried from `IAgentBackgroundTaskRequest` through the
   * runner to `createSubagentSession`, where it gates tool calls BEFORE the session-mode decision. Previously
   * dropped here (the field was absent), leaving the policy unenforced.
   */
  permissionPolicy?: TBackgroundPermissionPolicy;
  timeoutMs?: number;
  idleTimeoutMs?: number;
  maxRuntimeMs?: number;
  outputLimitBytes?: number;
  maxTextDeltas?: number;
  repetitionWindow?: number;
  repetitionThreshold?: number;
  metadata?: Record<string, TBackgroundPrimitive>;
}

export interface ISubagentJobResult {
  jobId: string;
  output: string;
  metadata?: Record<string, TBackgroundPrimitive>;
  /** ANALYTICS-001 (Phase 2): total token usage of the subagent run. */
  usage?: { promptTokens: number; completionTokens: number; totalTokens: number };
}

export interface ISubagentJobStart {
  jobId: string;
  request: ISubagentSpawnRequest;
  emit?: (event: TBackgroundTaskRunnerEvent) => void;
}

export interface ISubagentJobHandle {
  readonly jobId: string;
  readonly pid?: number;
  readonly logPath?: string;
  readonly transcriptPath?: string;
  result: Promise<ISubagentJobResult>;
  cancel(reason?: string): Promise<void>;
  send?(prompt: string): Promise<void>;
  readLog?(cursor?: IBackgroundTaskLogCursor): Promise<IBackgroundTaskLogPage>;
}

export interface ISubagentRunner {
  start(job: ISubagentJobStart): ISubagentJobHandle;
}

export interface ISubagentManager {
  spawn(request: ISubagentSpawnRequest): Promise<ISubagentJobState>;
  wait(jobId: string): Promise<ISubagentJobResult>;
  list(): ISubagentJobState[];
  get(jobId: string): ISubagentJobState | undefined;
  cancel(jobId: string, reason?: string): Promise<void>;
  close(jobId: string): Promise<void>;
  send(jobId: string, prompt: string): Promise<void>;
  shutdown(reason?: string): Promise<void>;
}

export interface ISubagentManagerOptions {
  runner?: ISubagentRunner;
  backgroundTaskManager?: IBackgroundTaskManager;
  backgroundTaskRunners?: IBackgroundTaskRunner[];
  maxConcurrent?: number;
  maxDepth?: number;
  now?: () => string;
  idFactory?: (request: TBackgroundTaskRequest) => string;
  agentIdleTimeoutMs?: number;
  agentMaxRuntimeMs?: number;
  agentOutputLimitBytes?: number;
  agentMaxTextDeltas?: number;
  repetitionWindow?: number;
  repetitionThreshold?: number;
}
