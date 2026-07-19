/**
 * Background-task runtime SPI (runner/manager ports, handles, error class).
 *
 * The task DATA contracts (statuses, states, events, requests, results, log pages) moved
 * to `@robota-sdk/agent-interface-transport` (INFRA-025 SSOT) — imported and re-exported
 * here for intra-package use; the package's PUBLIC index does not re-export them.
 */

import type {
  IBackgroundTaskError,
  IBackgroundTaskInput,
  IBackgroundTaskListFilter,
  IBackgroundTaskLogCursor,
  IBackgroundTaskLogPage,
  IBackgroundTaskResult,
  IBackgroundTaskState,
  TBackgroundPrimitive,
  TBackgroundTaskErrorCategory,
  TBackgroundTaskKind,
  TBackgroundTaskRequest,
} from '@robota-sdk/agent-interface-transport';

export type {
  TBackgroundTaskKind,
  TBackgroundTaskMode,
  TBackgroundTaskIsolation,
  TBackgroundTaskStatus,
  TBackgroundPermissionPolicy,
  TBackgroundTaskTimeoutReason,
  TBackgroundTaskErrorCategory,
  TBackgroundPrimitive,
  IBackgroundTaskError,
  ISerializableProviderProfile,
  IBaseBackgroundTaskRequest,
  IAgentBackgroundTaskRequest,
  IProcessBackgroundTaskRequest,
  IScheduledBackgroundTaskRequest,
  TBackgroundTaskRequest,
  IBackgroundTaskUsage,
  IBackgroundTaskResult,
  IBackgroundTaskState,
  IBackgroundTaskSchedule,
  IBackgroundTaskInput,
  IBackgroundTaskLogCursor,
  IBackgroundTaskLogPage,
  IBackgroundTaskListFilter,
  TBackgroundTaskEvent,
  TBackgroundTaskEventListener,
} from '@robota-sdk/agent-interface-transport';
import type { TBackgroundTaskEventListener } from '@robota-sdk/agent-interface-transport';

export class BackgroundTaskError extends Error implements IBackgroundTaskError {
  readonly category: TBackgroundTaskErrorCategory;
  readonly recoverable: boolean;

  constructor(category: TBackgroundTaskErrorCategory, message: string, recoverable = true) {
    super(message);
    this.name = 'BackgroundTaskError';
    this.category = category;
    this.recoverable = recoverable;
  }
}

export type TBackgroundTaskRunnerEvent =
  | { type: 'background_task_text_delta'; delta: string }
  | { type: 'background_task_tool_start'; toolName: string; firstArg?: string }
  | {
      type: 'background_task_tool_end';
      toolName: string;
      success: boolean;
      error?: string;
    }
  | {
      type: 'background_task_permission_request';
      requestId: string;
      toolName: string;
      toolArgs: Record<string, TBackgroundPrimitive>;
    }
  | { type: 'background_task_sleeping'; nextFireAt: string }
  | { type: 'background_task_waking'; instruction?: string };

export interface IBackgroundTaskStart {
  taskId: string;
  request: TBackgroundTaskRequest;
  emit?: (event: TBackgroundTaskRunnerEvent) => void;
}

export interface IBackgroundTaskHandle {
  readonly taskId: string;
  readonly pid?: number;
  readonly logPath?: string;
  readonly transcriptPath?: string;
  result: Promise<IBackgroundTaskResult>;
  cancel(reason?: string): Promise<void>;
  send?(input: IBackgroundTaskInput): Promise<void>;
  readLog?(cursor?: IBackgroundTaskLogCursor): Promise<IBackgroundTaskLogPage>;
  /** SELFHOST-012: non-destructive pause of a recurring schedule (croner `.pause()`, not `.stop()`). Present
   * only on runners that support it (the scheduled runner); a paused job does not fire until `resume()`. */
  pause?(): Promise<void>;
  /** SELFHOST-012: resume a paused schedule, re-arming the same job (same task id + cadence). */
  resume?(): Promise<void>;
  /** SELFHOST-012: re-arm the schedule in place from a patched cron expression / instruction (same task id). */
  editSchedule?(patch: IScheduleEditPatch): Promise<void>;
}

/** SELFHOST-012: an in-place schedule edit — any provided field replaces the current value; identity is kept. */
export interface IScheduleEditPatch {
  cronExpression?: string;
  agentInstruction?: string;
  command?: string;
}

export interface IBackgroundTaskRunner {
  readonly kind: TBackgroundTaskKind;
  start(task: IBackgroundTaskStart): IBackgroundTaskHandle;
}

export type TBackgroundTaskIdFactory = (request: TBackgroundTaskRequest) => string;

export interface IBackgroundTaskManager {
  spawn(request: TBackgroundTaskRequest): Promise<IBackgroundTaskState>;
  wait(taskId: string): Promise<IBackgroundTaskResult>;
  list(filter?: IBackgroundTaskListFilter): IBackgroundTaskState[];
  get(taskId: string): IBackgroundTaskState | undefined;
  cancel(taskId: string, reason?: string): Promise<void>;
  close(taskId: string): Promise<void>;
  shutdown(reason?: string): Promise<void>;
  send(taskId: string, input: IBackgroundTaskInput): Promise<void>;
  readLog(taskId: string, cursor?: IBackgroundTaskLogCursor): Promise<IBackgroundTaskLogPage>;
  subscribe(listener: TBackgroundTaskEventListener): () => void;
}

export interface IBackgroundTaskManagerOptions {
  runners: IBackgroundTaskRunner[];
  maxConcurrent?: number;
  maxDepth?: number;
  now?: () => string;
  idFactory?: TBackgroundTaskIdFactory;
  eventSink?: TBackgroundTaskEventListener;
  agentIdleTimeoutMs?: number;
  agentMaxRuntimeMs?: number;
  agentOutputLimitBytes?: number;
  agentMaxTextDeltas?: number;
  repetitionWindow?: number;
  repetitionThreshold?: number;
}
