import type { IContextWindowState, TPermissionMode } from '@robota-sdk/agent-core';
import type { ISessionReplayValidationResult } from '@robota-sdk/agent-sessions';
import type {
  IBackgroundJobGroupCreateRequest,
  IBackgroundJobGroupState,
  IBackgroundTaskListFilter,
  IBackgroundTaskLogCursor,
  IBackgroundTaskLogPage,
  IBackgroundTaskState,
  TBackgroundTaskIsolation,
} from '../background-tasks/index.js';
import type { ISubagentJobState } from '../subagents/index.js';
import type { ICommandHostAdapters } from './host-adapters.js';
import type {
  IEditCheckpointInspection,
  IEditCheckpointRestoreResult,
  IEditCheckpointSummary,
} from '../checkpoints/index.js';
import type { IMemoryEvent, IMemoryReference } from '../memory/automatic-memory-types.js';
import type { TAutoCompactThreshold } from './context/context-command-api.js';
import type { ICommandResult } from './command-result.js';
import type {
  IContextReferenceAddResult,
  IContextReferenceClearResult,
  IContextReferenceItem,
  IContextReferenceRemoveResult,
} from '../context/context-reference-inventory.js';

export interface ICommandListEntry {
  name: string;
  description: string;
}

export interface ICommandSkillListEntry {
  readonly name: string;
  readonly description: string;
  readonly source: string;
  readonly modelInvocable: boolean;
  readonly userInvocable: boolean;
  readonly argumentHint?: string;
  readonly context?: string;
  readonly agent?: string;
}

export type TCommandInvocationSource = 'user' | 'model';

export interface ICommandSkillActivationRequest {
  readonly invocationSource: TCommandInvocationSource;
  readonly displayInput?: string;
  readonly rawInput?: string;
}

export type TAutoCompactThresholdSource = 'default' | 'settings' | 'session';

export interface ICommandSessionRuntime {
  clearHistory(): void;
  compact(instructions?: string): Promise<void>;
  getContextState(): IContextWindowState;
  getPermissionMode(): TPermissionMode;
  setPermissionMode(mode: TPermissionMode): void;
  getSessionId(): string;
  getMessageCount(): number;
  getSessionAllowedTools(): readonly string[];
  getAutoCompactThreshold(): number | false;
  setAutoCompactThreshold?(threshold: TAutoCompactThreshold): void;
}

export interface ICommandSessionReplayValidationReport {
  logFile: string;
  entryCount: number;
  validation: ISessionReplayValidationResult;
}

export interface ICommandHostContext {
  clearConversationHistory?(): void;
  validateCurrentSessionReplayLog?(): ICommandSessionReplayValidationReport;
  getAgentJobCapability?(): IAgentJobHostContext | undefined;
  getSession(): ICommandSessionRuntime;
  getContextState(): IContextWindowState;
  getAutoCompactThreshold(): TAutoCompactThreshold;
  getAutoCompactThresholdSource?(): TAutoCompactThresholdSource;
  setAutoCompactThreshold?(
    threshold: TAutoCompactThreshold,
    source?: TAutoCompactThresholdSource,
  ): void;
  getCommandHostAdapters?(): ICommandHostAdapters;
  compactContext(instructions?: string): Promise<void>;
  listContextReferences?(): IContextReferenceItem[];
  addContextReference?(path: string): Promise<IContextReferenceAddResult>;
  removeContextReference?(path: string): IContextReferenceRemoveResult;
  clearContextReferences?(): IContextReferenceClearResult;
  getCwd(): string;
  getCommandInvocationSource?(): TCommandInvocationSource;
  listCommands?(): ICommandListEntry[];
  listSkills?(): ICommandSkillListEntry[];
  executeSkillCommandByName?(
    name: string,
    args: string,
    request: ICommandSkillActivationRequest,
  ): Promise<ICommandResult | null>;
  listEditCheckpoints(): IEditCheckpointSummary[];
  inspectEditCheckpoint?(checkpointId: string): IEditCheckpointInspection;
  restoreEditCheckpoint(checkpointId: string): Promise<IEditCheckpointRestoreResult>;
  rollbackEditCheckpoint(checkpointId: string): Promise<IEditCheckpointRestoreResult>;
  getUsedMemoryReferences(): IMemoryReference[];
  recordMemoryEvent(event: IMemoryEvent): void;
  listBackgroundTasks(filter?: IBackgroundTaskListFilter): IBackgroundTaskState[];
  readBackgroundTaskLog(
    taskId: string,
    cursor?: IBackgroundTaskLogCursor,
  ): Promise<IBackgroundTaskLogPage>;
  cancelBackgroundTask(taskId: string, reason?: string): Promise<void>;
  closeBackgroundTask(taskId: string): Promise<void>;
}

export interface IAgentJobHostContext {
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
  createBackgroundJobGroup(
    input: Omit<IBackgroundJobGroupCreateRequest, 'parentSessionId'>,
  ): IBackgroundJobGroupState;
  waitBackgroundJobGroup(groupId: string): Promise<IBackgroundJobGroupState>;
  readBackgroundTaskLog(
    taskId: string,
    cursor?: IBackgroundTaskLogCursor,
  ): Promise<IBackgroundTaskLogPage>;
}
