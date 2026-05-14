import type { TUniversalMessage, IContextWindowState } from '@robota-sdk/agent-core';
import type {
  IBackgroundJobGroupCreateRequest,
  IBackgroundJobGroupState,
  IBackgroundTaskInput,
  IBackgroundTaskListFilter,
  IBackgroundTaskLogCursor,
  IBackgroundTaskLogPage,
  IBackgroundTaskState,
  IExecutionWorkspaceSnapshot,
  IExecutionWorkspaceSnapshotOptions,
  TBackgroundTaskIsolation,
} from '../background-tasks/index.js';
import type { ICommandResult, ICommandListEntry } from '../commands/index.js';
import type { ISubagentJobState } from '../subagents/index.js';
import type {
  IExecutionResult,
  TInteractiveEventName,
  IInteractiveSessionEvents,
} from './types.js';

/** Minimal session surface consumed by transport adapters and test factories. */
export interface IInteractiveSession {
  /** True once the underlying session has been initialized. */
  readonly isInitialized?: boolean;

  // Submission
  submit(input: string, displayInput?: string, rawInput?: string): Promise<void>;
  abort(): void;
  cancelQueue(): void;
  shutdown(options?: { reason?: string; message?: string }): Promise<void>;

  // State
  isExecuting(): boolean;
  getPendingPrompt(): string | null;
  getMessages(): TUniversalMessage[];
  getContextState(): IContextWindowState;
  getSession(): { getSessionId(): string };
  getCwd(): string;

  // Commands
  executeCommand(name: string, args: string): Promise<ICommandResult | null>;
  listCommands(): ICommandListEntry[];

  // Events
  on<E extends TInteractiveEventName>(event: E, handler: IInteractiveSessionEvents[E]): void;
  off<E extends TInteractiveEventName>(event: E, handler: IInteractiveSessionEvents[E]): void;

  // Background tasks
  listBackgroundTasks(filter?: IBackgroundTaskListFilter): IBackgroundTaskState[];
  getBackgroundTask(taskId: string): IBackgroundTaskState | undefined;
  cancelBackgroundTask(taskId: string, reason?: string): Promise<void>;
  closeBackgroundTask(taskId: string): Promise<void>;
  sendBackgroundTask(taskId: string, input: IBackgroundTaskInput): Promise<void>;
  readBackgroundTaskLog(
    taskId: string,
    cursor?: IBackgroundTaskLogCursor,
  ): Promise<IBackgroundTaskLogPage>;

  // Background job groups
  listBackgroundJobGroups(): IBackgroundJobGroupState[];
  getBackgroundJobGroup(groupId: string): IBackgroundJobGroupState | undefined;
  createBackgroundJobGroup(
    input: Omit<IBackgroundJobGroupCreateRequest, 'parentSessionId'>,
  ): IBackgroundJobGroupState;
  waitBackgroundJobGroup(groupId: string): Promise<IBackgroundJobGroupState>;

  // Execution workspace
  getExecutionWorkspaceSnapshot(
    options?: IExecutionWorkspaceSnapshotOptions,
  ): IExecutionWorkspaceSnapshot;

  // Agent jobs
  listAgentDefinitions(): Array<{ name: string; description: string }>;
  listAgentJobs(): ISubagentJobState[];
  spawnAgentJob(input: {
    agentType: string;
    label: string;
    mode: 'foreground' | 'background';
    prompt: string;
    model?: string;
    isolation?: TBackgroundTaskIsolation;
  }): Promise<ISubagentJobState>;
  sendAgentJob(jobId: string, prompt: string): Promise<void>;
  cancelAgentJob(jobId: string, reason?: string): Promise<void>;
  closeAgentJob(jobId: string): Promise<void>;
}

export type { IExecutionResult };
