import type {
  IBackgroundTaskManager,
  IBackgroundTaskLogCursor,
  IBackgroundTaskLogPage,
  IBackgroundTaskRunner,
  TBackgroundTaskRequest,
  TBackgroundTaskRunnerEvent,
} from '../background-tasks/index.js';
import type {
  ISubagentJobResult,
  ISubagentJobState,
  ISubagentSpawnRequest,
  TSubagentJobMode,
  TSubagentJobStatus,
} from '@robota-sdk/agent-interface-execution';

/**
 * ARCH-031: imported and re-exported here for INTRA-PACKAGE use only. The owner is
 * `agent-interface-transport`; this package's PUBLIC index does not re-export them, because a
 * pass-through re-export of another package's symbols is banned. Consumers import from the owner.
 */
export type {
  ISubagentJobResult,
  ISubagentJobState,
  ISubagentSpawnRequest,
  TSubagentJobMode,
  TSubagentJobStatus,
};

export interface ISubagentJobStart {
  taskId: string;
  request: ISubagentSpawnRequest;
  /**
   * ARCH-031: the worktree a runner PREPARED for this job, when it isolated one. Runner-produced, so
   * it lives on the envelope rather than on the request, which models what the caller asked for — the
   * worktree does not exist at the moment a request is built. The execution root is read through
   * {@link subagentExecutionRoot}, the single answer to "which directory does this run in".
   *
   * `branch` is carried deliberately even though nothing in this repository reads it yet. It is a real
   * fact about an isolated run — which branch the subagent's work is on — and this is a library:
   * contracts exist for consumers that are not in this tree. `project-structure.md` is explicit that an
   * unconsumed public surface is a PRODUCT decision to remove, never a grep-based cleanup, and that a
   * forward-provisioned surface carries the same quality bar as a consumed one. It used to sit on the
   * REQUEST, which was the wrong owner (a caller cannot know it); moving it here keeps the capability
   * and fixes the ownership.
   */
  worktree?: { readonly path: string; readonly branch?: string };
  emit?: (event: TBackgroundTaskRunnerEvent) => void;
}

export interface ISubagentJobHandle {
  readonly taskId: string;
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
  wait(taskId: string): Promise<ISubagentJobResult>;
  list(): ISubagentJobState[];
  get(taskId: string): ISubagentJobState | undefined;
  cancel(taskId: string, reason?: string): Promise<void>;
  close(taskId: string): Promise<void>;
  send(taskId: string, prompt: string): Promise<void>;
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
