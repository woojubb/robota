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
  prompt: string;
  timeoutMs?: number;
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
  worktreePath?: string;
  branchName?: string;
  promptPreview: string;
  currentTool?: string;
  startedAt?: string;
  updatedAt: string;
  completedAt?: string;
  result?: string;
  error?: string;
}

export interface ISubagentJobResult {
  jobId: string;
  output: string;
}

export interface ISubagentJobStart {
  jobId: string;
  request: ISubagentSpawnRequest;
}

export interface ISubagentJobHandle {
  readonly jobId: string;
  readonly pid?: number;
  result: Promise<ISubagentJobResult>;
  cancel(reason?: string): Promise<void>;
  send?(prompt: string): Promise<void>;
}

export interface ISubagentRunner {
  start(job: ISubagentJobStart): ISubagentJobHandle;
}

export interface ISubagentManagerOptions {
  runner: ISubagentRunner;
  maxConcurrent?: number;
  maxDepth?: number;
  now?: () => string;
  idFactory?: () => string;
}
