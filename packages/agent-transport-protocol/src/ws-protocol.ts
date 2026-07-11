import type { IInteractiveSession, TDriverId } from '@robota-sdk/agent-interface-transport';
import type {
  IAskRequestEvent,
  IBackgroundJobGroupState,
  ICommandResult,
  IExecutionResult,
  IExecutionWorkspaceSnapshot,
  IPermissionRequestEvent,
  IPromptResolvedEvent,
  IToolState,
  TActionResponse,
  TBackgroundJobGroupEvent,
  TPermissionResultValue,
} from '@robota-sdk/agent-interface-transport';
import type {
  IBackgroundTaskInput,
  IBackgroundTaskListFilter,
  IBackgroundTaskLogCursor,
  IBackgroundTaskLogPage,
  IBackgroundTaskState,
  TBackgroundTaskEvent,
} from '@robota-sdk/agent-interface-transport';

export type TBackgroundControlAction = 'cancel' | 'close' | 'send';

/** Inbound message from client to server. */
export type TClientMessage =
  | { type: 'submit'; prompt: string }
  | { type: 'command'; name: string; args?: string }
  | { type: 'abort' }
  | { type: 'cancel-queue' }
  | { type: 'get-messages' }
  | { type: 'get-context' }
  | { type: 'get-executing' }
  | { type: 'get-pending' }
  | { type: 'get-execution-workspace' }
  | { type: 'get-background-tasks'; filter?: IBackgroundTaskListFilter }
  | { type: 'get-background-task'; taskId: string }
  | { type: 'get-background-job-groups' }
  | { type: 'get-background-job-group'; groupId: string }
  | { type: 'wait-background-job-group'; groupId: string }
  | { type: 'cancel-background-task'; taskId: string; reason?: string }
  | { type: 'close-background-task'; taskId: string }
  | { type: 'send-background-task'; taskId: string; input: IBackgroundTaskInput }
  | { type: 'read-background-task-log'; taskId: string; cursor?: IBackgroundTaskLogCursor }
  // REMOTE-007: a driving client answers a pending permission/ask prompt by id (first answer wins).
  | { type: 'permission-response'; id: string; result: TPermissionResultValue }
  | { type: 'ask-response'; id: string; response: TActionResponse }
  // REMOTE-013 E4 session-resume: `resume` asks the host to replay the tail after `lastSeq` (the last seq the
  // client applied); `ack` lets the host free its un-acked buffer up to `seq`. Only meaningful post-E3-accept.
  | { type: 'resume'; lastSeq: number }
  | { type: 'ack'; seq: number };

/** Outbound message from server to client. */
export type TServerMessage =
  // REMOTE-014 E5: turn-authored events optionally carry the ACTIVE turn's `driverId` (co-drive authorship,
  // display-only). Stamped at `subscribeSessionEvents` from `getActiveDriverId()`; background/goal/memory/
  // execution-workspace events are NEVER stamped (they are not authored by a driver turn).
  | { type: 'text_delta'; delta: string; driverId?: TDriverId }
  | { type: 'user_message'; content: string; driverId?: TDriverId }
  | { type: 'tool_start'; state: IToolState; driverId?: TDriverId }
  | { type: 'tool_end'; state: IToolState; driverId?: TDriverId }
  | { type: 'thinking'; isThinking: boolean; driverId?: TDriverId }
  | { type: 'complete'; result: IExecutionResult; driverId?: TDriverId }
  | { type: 'interrupted'; result: IExecutionResult; driverId?: TDriverId }
  | { type: 'error'; message: string; driverId?: TDriverId }
  | {
      type: 'command_result';
      name: string;
      message: string;
      success: boolean;
      data?: ICommandResult['data'];
    }
  | { type: 'messages'; messages: ReturnType<IInteractiveSession['getMessages']> }
  | { type: 'context'; state: ReturnType<IInteractiveSession['getContextState']> }
  | { type: 'executing'; executing: boolean }
  | { type: 'pending'; pending: string | null }
  | { type: 'execution_workspace_event'; snapshot: IExecutionWorkspaceSnapshot }
  | { type: 'background_task_event'; event: TBackgroundTaskEvent }
  | { type: 'background_job_group_event'; event: TBackgroundJobGroupEvent }
  | { type: 'background_tasks'; tasks: IBackgroundTaskState[] }
  | { type: 'background_task'; taskId: string; task: IBackgroundTaskState | null }
  | { type: 'background_job_groups'; groups: IBackgroundJobGroupState[] }
  | { type: 'background_job_group'; groupId: string; group: IBackgroundJobGroupState | null }
  | { type: 'background_task_log'; taskId: string; page: IBackgroundTaskLogPage }
  // REMOTE-007: forward the session's transport-neutral prompt events so a remote surface can render +
  // answer the SAME prompt (permission/ask). `prompt_resolved` dismisses it when another surface won.
  | { type: 'permission_request'; event: IPermissionRequestEvent }
  | { type: 'ask_request'; event: IAskRequestEvent }
  | { type: 'prompt_resolved'; event: IPromptResolvedEvent }
  | {
      type: 'background_task_control_result';
      action: TBackgroundControlAction;
      taskId: string;
      success: boolean;
      message?: string;
    }
  | { type: 'protocol_error'; message: string }
  // REMOTE-013 E4: sent instead of a replay when the client's `lastSeq` predates the host's retained buffer
  // (overrun) — the client must do a full `get-messages` refresh rather than accept a silent gap.
  | { type: 'resume_gap' };

/**
 * REMOTE-013 E4: a server message stamped with its monotonic session sequence number (added by the
 * {@link SessionResumeBridge} on the reconnectable WebRTC path). Intersecting over the union distributes the
 * `seq` field onto every variant. The WS localhost path never stamps it (a `type`-dispatching client ignores
 * an absent/extra `seq`).
 */
export type TSeqServerMessage = TServerMessage & { seq: number };
