import type { IHistoryEntry } from '@robota-sdk/agent-core';
import type {
  IBackgroundTaskLogCursor,
  IBackgroundTaskState,
  TBackgroundPrimitive,
  TBackgroundTaskKind,
  TBackgroundTaskStatus,
} from '@robota-sdk/agent-runtime';
import type { IBackgroundJobGroupState } from './background-job-orchestrator.js';

export const MAIN_THREAD_ENTRY_PREFIX = 'main';
export const BACKGROUND_TASK_ENTRY_PREFIX = 'task';
export const BACKGROUND_GROUP_ENTRY_PREFIX = 'group';
export const ENTRY_ID_SEPARATOR = ':';

export const EXECUTION_ORIGIN_METADATA_KEYS = {
  kind: 'executionOriginKind',
  sessionId: 'executionOriginSessionId',
  turnId: 'executionOriginTurnId',
  commandName: 'executionOriginCommandName',
  toolCallId: 'executionOriginToolCallId',
  skillId: 'executionOriginSkillId',
  label: 'executionOriginLabel',
} as const;

export type TExecutionEntryKind = 'main_thread' | 'background_task' | 'background_group';
export type TExecutionWorkspaceStatus = 'active' | 'idle' | TBackgroundTaskStatus;
export type TExecutionAttention = 'none' | 'unread' | 'failed' | 'permission' | 'completed';
export type TExecutionWorkspaceVisibility = 'default' | 'collapsed';
export type TExecutionControl = 'select' | 'cancel' | 'close' | 'send' | 'read_log' | 'wait';
export type TExecutionOriginKind =
  | 'user_prompt'
  | 'slash_command'
  | 'model_command'
  | 'tool_call'
  | 'skill'
  | 'transport'
  | 'system';
export type TExecutionDetailRecordKind =
  | 'message'
  | 'tool_activity'
  | 'process_output'
  | 'progress'
  | 'result'
  | 'error'
  | 'group_summary';
export type TExecutionWorkspaceUpdateCause = 'main_thread' | 'background_task' | 'background_group';

export interface IExecutionOrigin {
  readonly kind: TExecutionOriginKind;
  readonly sessionId: string;
  readonly turnId?: string;
  readonly commandName?: string;
  readonly toolCallId?: string;
  readonly skillId?: string;
  readonly label?: string;
}

export interface IExecutionWorkspaceEntry {
  readonly id: string;
  readonly sourceId: string;
  readonly kind: TExecutionEntryKind;
  readonly parentId?: string;
  readonly groupId?: string;
  readonly origin: IExecutionOrigin;
  readonly taskKind?: TBackgroundTaskKind;
  readonly status: TExecutionWorkspaceStatus;
  readonly title: string;
  readonly subtitle?: string;
  readonly preview?: string;
  readonly currentAction?: string;
  readonly unread: boolean;
  readonly attention: TExecutionAttention;
  readonly visibility: TExecutionWorkspaceVisibility;
  readonly updatedAt: string;
  readonly controls: readonly TExecutionControl[];
}

export interface IExecutionWorkspaceFilter {
  readonly includeMainThread?: boolean;
  readonly kinds?: readonly TExecutionEntryKind[];
  readonly visibility?: readonly TExecutionWorkspaceVisibility[];
}

export interface IExecutionWorkspaceSnapshot {
  readonly sessionId: string;
  readonly selectedEntryId?: string;
  readonly updatedAt: string;
  readonly entries: readonly IExecutionWorkspaceEntry[];
}

export interface IExecutionWorkspaceSnapshotOptions {
  readonly selectedEntryId?: string;
  readonly filter?: IExecutionWorkspaceFilter;
}

export interface IExecutionWorkspaceEvent {
  readonly type: 'execution_workspace_updated';
  readonly cause: TExecutionWorkspaceUpdateCause;
  readonly entryId?: string;
  readonly snapshot: IExecutionWorkspaceSnapshot;
}

export interface IExecutionDetailCursor {
  readonly offset: number;
}

export interface IExecutionDetailRecord {
  readonly id: string;
  readonly kind: TExecutionDetailRecordKind;
  readonly text: string;
  readonly timestamp?: string;
  readonly sourceId?: string;
}

export interface IExecutionDetailPage {
  readonly entryId: string;
  readonly cursor?: IExecutionDetailCursor;
  readonly nextCursor?: IExecutionDetailCursor;
  readonly records: readonly IExecutionDetailRecord[];
}

export interface ICreateMainThreadEntryInput {
  readonly sessionId: string;
  readonly isExecuting: boolean;
  readonly hasPendingPrompt: boolean;
  readonly historyLength: number;
  readonly updatedAt: string;
  readonly preview?: string;
}

export interface ICreateExecutionWorkspaceSnapshotInput {
  readonly sessionId: string;
  readonly mainThread: ICreateMainThreadEntryInput;
  readonly tasks: readonly IBackgroundTaskState[];
  readonly groups: readonly IBackgroundJobGroupState[];
  readonly selectedEntryId?: string;
  readonly filter?: IExecutionWorkspaceFilter;
}

export interface IExecutionWorkspaceEntryRef {
  readonly kind: TExecutionEntryKind;
  readonly sourceId: string;
}

export interface ICreateMainThreadDetailPageInput {
  readonly entryId: string;
  readonly history: readonly IHistoryEntry[];
  readonly cursor?: IExecutionDetailCursor;
}

export interface ICreateLineDetailPageInput {
  readonly entryId: string;
  readonly lines: readonly string[];
  readonly cursor?: IBackgroundTaskLogCursor;
  readonly nextCursor?: IBackgroundTaskLogCursor;
  readonly kind?: TExecutionDetailRecordKind;
}

export function createMainThreadExecutionEntryId(sessionId: string): string {
  return [MAIN_THREAD_ENTRY_PREFIX, sessionId].join(ENTRY_ID_SEPARATOR);
}

export function createBackgroundTaskExecutionEntryId(taskId: string): string {
  return [BACKGROUND_TASK_ENTRY_PREFIX, taskId].join(ENTRY_ID_SEPARATOR);
}

export function createBackgroundGroupExecutionEntryId(groupId: string): string {
  return [BACKGROUND_GROUP_ENTRY_PREFIX, groupId].join(ENTRY_ID_SEPARATOR);
}

export function parseExecutionWorkspaceEntryId(
  entryId: string,
): IExecutionWorkspaceEntryRef | undefined {
  const [prefix, sourceId] = entryId.split(ENTRY_ID_SEPARATOR, 2);
  if (!sourceId) return undefined;
  if (prefix === MAIN_THREAD_ENTRY_PREFIX) return { kind: 'main_thread', sourceId };
  if (prefix === BACKGROUND_TASK_ENTRY_PREFIX) return { kind: 'background_task', sourceId };
  if (prefix === BACKGROUND_GROUP_ENTRY_PREFIX) return { kind: 'background_group', sourceId };
  return undefined;
}

export function createExecutionOriginMetadata(
  origin: IExecutionOrigin,
): Record<string, TBackgroundPrimitive> {
  return {
    [EXECUTION_ORIGIN_METADATA_KEYS.kind]: origin.kind,
    [EXECUTION_ORIGIN_METADATA_KEYS.sessionId]: origin.sessionId,
    ...(origin.turnId ? { [EXECUTION_ORIGIN_METADATA_KEYS.turnId]: origin.turnId } : {}),
    ...(origin.commandName
      ? { [EXECUTION_ORIGIN_METADATA_KEYS.commandName]: origin.commandName }
      : {}),
    ...(origin.toolCallId
      ? { [EXECUTION_ORIGIN_METADATA_KEYS.toolCallId]: origin.toolCallId }
      : {}),
    ...(origin.skillId ? { [EXECUTION_ORIGIN_METADATA_KEYS.skillId]: origin.skillId } : {}),
    ...(origin.label ? { [EXECUTION_ORIGIN_METADATA_KEYS.label]: origin.label } : {}),
  };
}
