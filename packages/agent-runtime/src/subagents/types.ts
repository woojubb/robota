import type {
  IBackgroundTaskManager,
  IBackgroundTaskLogCursor,
  IBackgroundTaskLogPage,
  IBackgroundTaskRunner,
  IBackgroundTaskRequest,
  TBackgroundPrimitive,
  TBackgroundTaskRunnerEvent,
  TBackgroundTaskIsolation,
  TBackgroundTaskTimeoutReason,
} from '../background-tasks/index.js';

export type TSubagentJobStatus =
  | 'queued'
  | 'running'
  | 'waiting_permission'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type TSubagentJobMode = 'foreground' | 'background';

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
  timeoutMs?: number;
  idleTimeoutMs?: number;
  maxRuntimeMs?: number;
  outputLimitBytes?: number;
  maxTextDeltas?: number;
  repetitionWindow?: number;
  repetitionThreshold?: number;
}

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
}

export interface ISubagentJobResult {
  jobId: string;
  output: string;
  metadata?: Record<string, TBackgroundPrimitive>;
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
  idFactory?: (request: IBackgroundTaskRequest) => string;
  agentIdleTimeoutMs?: number;
  agentMaxRuntimeMs?: number;
  agentOutputLimitBytes?: number;
  agentMaxTextDeltas?: number;
  repetitionWindow?: number;
  repetitionThreshold?: number;
}
