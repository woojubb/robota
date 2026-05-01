import type {
  InteractiveSession,
  ICommandResult,
  IBackgroundJobGroupState,
  IBackgroundTaskInput,
  IBackgroundTaskListFilter,
  IBackgroundTaskLogCursor,
  IBackgroundTaskLogPage,
  IBackgroundTaskState,
  IExecutionResult,
  IToolState,
  TBackgroundJobGroupEvent,
  TBackgroundTaskEvent,
} from '@robota-sdk/agent-sdk';

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
  | { type: 'get-background-tasks'; filter?: IBackgroundTaskListFilter }
  | { type: 'get-background-task'; taskId: string }
  | { type: 'get-background-job-groups' }
  | { type: 'get-background-job-group'; groupId: string }
  | { type: 'wait-background-job-group'; groupId: string }
  | { type: 'cancel-background-task'; taskId: string; reason?: string }
  | { type: 'close-background-task'; taskId: string }
  | { type: 'send-background-task'; taskId: string; input: IBackgroundTaskInput }
  | { type: 'read-background-task-log'; taskId: string; cursor?: IBackgroundTaskLogCursor };

/** Outbound message from server to client. */
export type TServerMessage =
  | { type: 'text_delta'; delta: string }
  | { type: 'tool_start'; state: IToolState }
  | { type: 'tool_end'; state: IToolState }
  | { type: 'thinking'; isThinking: boolean }
  | { type: 'complete'; result: IExecutionResult }
  | { type: 'interrupted'; result: IExecutionResult }
  | { type: 'error'; message: string }
  | {
      type: 'command_result';
      name: string;
      message: string;
      success: boolean;
      data?: ICommandResult['data'];
    }
  | { type: 'messages'; messages: ReturnType<InteractiveSession['getMessages']> }
  | { type: 'context'; state: ReturnType<InteractiveSession['getContextState']> }
  | { type: 'executing'; executing: boolean }
  | { type: 'pending'; pending: string | null }
  | { type: 'background_task_event'; event: TBackgroundTaskEvent }
  | { type: 'background_job_group_event'; event: TBackgroundJobGroupEvent }
  | { type: 'background_tasks'; tasks: IBackgroundTaskState[] }
  | { type: 'background_task'; taskId: string; task: IBackgroundTaskState | null }
  | { type: 'background_job_groups'; groups: IBackgroundJobGroupState[] }
  | { type: 'background_job_group'; groupId: string; group: IBackgroundJobGroupState | null }
  | { type: 'background_task_log'; taskId: string; page: IBackgroundTaskLogPage }
  | {
      type: 'background_task_control_result';
      action: TBackgroundControlAction;
      taskId: string;
      success: boolean;
      message?: string;
    }
  | { type: 'protocol_error'; message: string };
