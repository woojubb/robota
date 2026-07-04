/**
 * Execution-workspace contracts — the unified view of main-thread, background-task,
 * and background-group execution entries surfaced to transports.
 *
 * SSOT for the workspace projection types. The projection/spawner runtime and the
 * entry-id helpers live in agent-framework and import these declarations.
 */

import type {
  IBackgroundTaskLogCursor,
  IBackgroundTaskState,
  TBackgroundTaskKind,
  TBackgroundTaskStatus,
} from './background-task-contracts';
import type { IBackgroundJobGroupState } from './session-contracts.js';
import type { IHistoryEntry } from '@robota-sdk/agent-core';

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
