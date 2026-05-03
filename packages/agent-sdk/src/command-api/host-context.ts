import type { IContextWindowState, TPermissionMode } from '@robota-sdk/agent-core';
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

export interface ICommandListEntry {
  name: string;
  description: string;
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

export interface ICommandHostContext {
  clearConversationHistory?(): void;
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
  getCwd(): string;
  listCommands?(): ICommandListEntry[];
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
