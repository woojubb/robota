import type { IContextWindowState, TPermissionMode } from '@robota-sdk/agent-core';
import type { ISessionReplayValidationResult } from '@robota-sdk/agent-sessions';
import type {
  IBackgroundTaskListFilter,
  IBackgroundTaskLogCursor,
  IBackgroundTaskLogPage,
  IBackgroundTaskState,
} from '../background-tasks/index.js';
import type { ICommandHostAdapters } from './host-adapters.js';
import type {
  IEditCheckpointInspection,
  IEditCheckpointRestoreResult,
  IEditCheckpointSummary,
} from '../checkpoints/index.js';
import type { IMemoryEvent, IMemoryReference } from '../memory/automatic-memory-types.js';
import type { TAutoCompactThreshold } from './context/context-command-api.js';
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
  getAutoCompactThreshold?(): number | false;
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
  listCommands?(): ICommandListEntry[];
  listSkills?(): ICommandSkillListEntry[];
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
