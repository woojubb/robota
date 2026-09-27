/**
 * Execution-workspace contracts — the unified view of main-thread, background-task,
 * and background-group execution entries surfaced to transports.
 *
 * SSOT for the workspace projection types. The projection/spawner runtime and the
 * entry-id helpers live in agent-framework and import these declarations.
 */

import type { IBackgroundJobGroupState } from './background-group-contracts.js';
import type {
  IBackgroundTaskLogCursor,
  IBackgroundTaskState,
  TBackgroundTaskKind,
  TBackgroundTaskStatus,
} from './background-task-contracts';
import type { IHistoryEntry } from '@robota-sdk/agent-core';

export type TExecutionEntryKind = 'main_thread' | 'background_task' | 'background_group';
export type TExecutionWorkspaceStatus = 'active' | 'idle' | TBackgroundTaskStatus;
export type TExecutionAttention = 'none' | 'unread' | 'failed' | 'permission' | 'completed';
export type TExecutionWorkspaceVisibility = 'default' | 'collapsed';
/**
 * `attach` (CLI-1994) is offered on a `background_task` entry whose request carried a
 * `resumeSessionId` — a forked conversation. Selecting it is a VIEW SWITCH onto that session record,
 * not a merge: the parent and the fork stay separate records.
 */
export type TExecutionControl =
  'select' | 'cancel' | 'close' | 'send' | 'read_log' | 'wait' | 'attach';
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
/**
 * SCREEN-1992 — the five-word normalization every surface renders beside the detailed `status`:
 * `working` (queued/running/sleeping/active), `needs-input` (a parked prompt or a task waiting for
 * permission), `completed`, `failed`, `stopped` (cancelled or paused — never reported as completed).
 * Total over every `TExecutionWorkspaceStatus`; derived once by the projection, never re-derived.
 */
export type TExecutionNormalizedState =
  'working' | 'needs-input' | 'completed' | 'failed' | 'stopped';
/** SCREEN-1992 — the row's one-line text: what it is doing, the question it is asking, or its result. */
export type TExecutionHeadlineKind = 'activity' | 'question' | 'result';
export interface IExecutionHeadline {
  readonly kind: TExecutionHeadlineKind;
  readonly text: string;
}
/** SCREEN-1992 — the prompt the main thread is parked on, so a surface can say what it is waiting for. */
export interface IExecutionPendingRequest {
  readonly kind: 'permission' | 'ask';
  readonly text: string;
}

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
  /** CLI-1994: the forked session record an `attach` control switches the view onto. */
  readonly resumeSessionId?: string;
  /** SCREEN-1992: the normalized state word (see `TExecutionNormalizedState`). */
  readonly state: TExecutionNormalizedState;
  /** SCREEN-1992: the row's one-line text SSOT; `preview` stays the raw last output. */
  readonly headline?: IExecutionHeadline;
  /** SCREEN-1992: ISO time of a sleeping schedule's next fire, for a surface-side countdown. */
  readonly nextFireAt?: string;
  /**
   * #3288 §1: present on a `/loop`-managed entry (fixed cadence or self-paced) — its stable loop
   * id. A `cancel` control on this entry means "stop the loop" (`/loop stop <loopId>`), never the
   * generic `cancel-background-task`: for a self-paced loop, the background task backing the entry
   * (when there is one) is only its disposable wake timer, and cancelling THAT would leave the loop
   * itself still active. Absent on an ordinary (non-loop) task or group.
   */
  readonly loopId?: string;
  /**
   * #3288 §1: an agent task's own count of tool calls its result reports as refused, when its
   * result carries one — read defensively (the field may not exist on an older host's result), so a
   * surface can show "Needs permission" instead of a plain "Done" for a task that finished with
   * something still refused, rather than losing that fact once the task is no longer running.
   */
  readonly deniedToolCalls?: number;
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
  /** SCREEN-1992: the parked permission/ask the main thread is waiting on, when there is one. */
  readonly pendingRequest?: IExecutionPendingRequest;
}

/**
 * #3288 §1: the minimal self-paced-loop shape the projection needs to show a `pending`/`running`
 * iteration that has no background-task representation of its own (its `waiting` phase does have
 * one — see {@link IExecutionWorkspaceEntry.loopId} — so is never included here). A structural
 * subset of `ISessionLoopState`, owned by `agent-interface-session`, which depends on THIS package
 * (not the other way around) so that richer contract cannot be imported here; every real
 * `ISessionLoopState` satisfies this shape already.
 */
export interface IExecutionSelfPacedLoopSummary {
  readonly loopId: string;
  readonly instruction: string;
  readonly phase: 'waiting' | 'pending' | 'running' | 'stopped' | 'expired';
  readonly createdAt: string;
  readonly delaySeconds?: number;
  readonly reason?: string;
}

export interface ICreateExecutionWorkspaceSnapshotInput {
  readonly sessionId: string;
  readonly mainThread: ICreateMainThreadEntryInput;
  readonly tasks: readonly IBackgroundTaskState[];
  readonly groups: readonly IBackgroundJobGroupState[];
  /** #3288 §1: optional — omitted by a caller that has none (or predates this field). */
  readonly selfPacedLoops?: readonly IExecutionSelfPacedLoopSummary[];
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
  /** SCREEN-1992: a parked prompt leads the page so a peek shows the blocking question first. */
  readonly pendingRequest?: IExecutionPendingRequest;
}

export interface ICreateLineDetailPageInput {
  readonly entryId: string;
  readonly lines: readonly string[];
  readonly cursor?: IBackgroundTaskLogCursor;
  readonly nextCursor?: IBackgroundTaskLogCursor;
  readonly kind?: TExecutionDetailRecordKind;
}
