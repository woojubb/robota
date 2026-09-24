/**
 * Background-task runtime SPI (runner/manager ports, handles, error class).
 *
 * The task DATA contracts (statuses, states, events, requests, results, log pages) moved
 * to `@robota-sdk/agent-interface-execution` (INFRA-025 SSOT) — imported and re-exported
 * here for intra-package use; the package's PUBLIC index does not re-export them.
 */

// ARCH-037: sourced from the `agent-core` SSOT, not from `agent-interface-transport`'s
// pass-through re-export, which is deleted. Re-exported at the end of this file for the package's
// own barrel chain — a type this file genuinely consumes, not a second name for someone else's.
import type { TObserverFailureReporter } from './observer-delivery.js';
import type { IToolResult, TBackgroundPermissionPolicy } from '@robota-sdk/agent-core';
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
  TBackgroundTaskEvent,
  TBackgroundTaskEventListener,
  TBackgroundTaskRequest,
} from '@robota-sdk/agent-interface-execution';

export type {
  TBackgroundTaskKind,
  TBackgroundTaskMode,
  TBackgroundTaskIsolation,
  TBackgroundTaskStatus,
  TBackgroundTaskTimeoutReason,
  TBackgroundTaskErrorCategory,
  TBackgroundPrimitive,
  IBackgroundTaskError,
  ISerializableProviderProfile,
  IBaseBackgroundTaskRequest,
  IAgentBackgroundTaskRequest,
  IProcessBackgroundTaskRequest,
  IScheduledBackgroundTaskRequest,
  IToolInvocationBackgroundTaskRequest,
  TBackgroundTaskRequest,
  IBackgroundTaskUsage,
  IBackgroundTaskResult,
  IBackgroundTaskState,
  IAgentBackgroundTaskState,
  IProcessBackgroundTaskState,
  IScheduledBackgroundTaskState,
  IToolInvocationBackgroundTaskState,
  TBackgroundTaskState,
  IBackgroundTaskSchedule,
  IBackgroundTaskInput,
  IBackgroundTaskLogCursor,
  IBackgroundTaskLogPage,
  IBackgroundTaskListFilter,
  TBackgroundTaskEvent,
  TBackgroundTaskEventListener,
} from '@robota-sdk/agent-interface-execution';

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

interface IBaseBackgroundTaskStart {
  taskId: string;
  emit?: (event: TBackgroundTaskRunnerEvent) => void;
}

export type IBackgroundTaskStart<K extends TBackgroundTaskKind = TBackgroundTaskKind> =
  K extends TBackgroundTaskKind
    ? IBaseBackgroundTaskStart & { request: Extract<TBackgroundTaskRequest, { kind: K }> }
    : never;

interface IBaseBackgroundTaskHandle {
  readonly taskId: string;
  readonly pid?: number;
  readonly logPath?: string;
  readonly transcriptPath?: string;
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

/**
 * #2079: parameterized like {@link IBackgroundTaskStart} — a runner that declares kind `K` resolves
 * its handle's `result` to the `K`-specific member of `IBackgroundTaskResult`, so a caller that
 * starts a known-kind runner gets a correctly-narrowed result without a cast, and accessing a
 * cross-kind field on it is a compile error. The manager's dynamic dispatch (a heterogeneous
 * registry of runners looked up by kind at runtime) uses the default `K` and keeps the handle typed
 * to the full result union, exactly as before.
 */
export type IBackgroundTaskHandle<K extends TBackgroundTaskKind = TBackgroundTaskKind> =
  K extends TBackgroundTaskKind
    ? IBaseBackgroundTaskHandle & { result: Promise<IBackgroundTaskResult<K>> }
    : never;

/** SELFHOST-012: an in-place schedule edit — any provided field replaces the current value; identity is kept. */
export interface IScheduleEditPatch {
  cronExpression?: string;
  agentInstruction?: string;
  command?: string;
  /** CMD-009: the list-view label summarizes the instruction, so an edit may refresh it too. */
  label?: string;
}

interface IKindedBackgroundTaskRunner<K extends TBackgroundTaskKind> {
  readonly kind: K;
  /** Optional scheduler calculation using the runner's own timezone and cron semantics. */
  nextScheduledFireOnOrAfter?(cronExpression: string, firstAllowedAt: Date): Date | null;
  /**
   * MCP-004 §S1: how the manager admits a spawned task of this runner's kind. `'queued'` (the
   * default when absent) enqueues and waits for a concurrency slot, as every runner did before this
   * unit. `'already-running'` declares that `start()` adopts work that is ALREADY running outside
   * the manager (nothing to queue, no manager-provisioned resource to bound) — `spawn` starts it
   * directly, without a queue or a slot, so `cancel()` always reaches the handle
   * (`background-task-manager.ts`).
   */
  readonly admission?: 'queued' | 'already-running';
  start(task: IBackgroundTaskStart<K>): IBackgroundTaskHandle<K>;
}

/** A runner is paired with the request of its declared kind; the default is all supported kinds. */
export type IBackgroundTaskRunner<K extends TBackgroundTaskKind = TBackgroundTaskKind> =
  K extends TBackgroundTaskKind ? IKindedBackgroundTaskRunner<K> : never;

/**
 * MCP-004 §S1: the port a `tool-invocation` runner exposes so the wrapper (`agent-framework`, S3)
 * can hand it an already-running tool call BEFORE `manager.spawn()` is called — the runner's
 * `start()` looks the token up in the registry `adopt()` populates. The runner owns this registry as
 * an INSTANCE, never a module singleton, so multiple manager instances (tests, multiple sessions in
 * one process) never share adoption state.
 */
export interface IToolInvocationAdopter {
  /**
   * Registers `work` under `token`. Returns a release function that withdraws the token — called by
   * the wrapper when `manager.spawn()` refuses the handoff (§ Fallback), so a refused token is never
   * left adopted forever.
   */
  adopt(
    token: string,
    work: { settled: Promise<IToolResult>; abort(reason: string): void },
  ): () => void;
}

export type TBackgroundTaskIdFactory = (request: TBackgroundTaskRequest) => string;

export interface IBackgroundTaskManager {
  spawn(request: TBackgroundTaskRequest): Promise<IBackgroundTaskState>;
  wait(taskId: string): Promise<IBackgroundTaskResult>;
  list(filter?: IBackgroundTaskListFilter): IBackgroundTaskState[];
  get(taskId: string): IBackgroundTaskState | undefined;
  /** Available on the built-in manager; custom manager ports may omit it. */
  nextScheduledFireOnOrAfter?(cronExpression: string, firstAllowedAt: Date): Date | null;
  cancel(taskId: string, reason?: string): Promise<void>;
  close(taskId: string): Promise<void>;
  // SELFHOST-012: non-destructive schedule lifecycle (scheduled tasks only).
  pauseScheduledTask(taskId: string): Promise<void>;
  resumeScheduledTask(taskId: string): Promise<void>;
  editScheduledTask(taskId: string, patch: IScheduleEditPatch): Promise<void>;
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
  /**
   * ARCH-053: receives every observer (eventSink/listener) failure. Defaults to a process warning;
   * never invoked from inside the failing observer's own delivery, never allowed to be silent.
   */
  onObserverFailure?: TObserverFailureReporter<TBackgroundTaskEvent>;
  /** Host-selected process-warning identity used when no custom reporter is supplied. */
  observerFailureWarningCode?: string;
  agentIdleTimeoutMs?: number;
  agentMaxRuntimeMs?: number;
  agentOutputLimitBytes?: number;
  agentMaxTextDeltas?: number;
  repetitionWindow?: number;
  repetitionThreshold?: number;
}

export type { TBackgroundPermissionPolicy };
