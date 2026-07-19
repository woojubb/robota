import {
  cloneBackgroundTaskState,
  createDeferred,
  createQueuedBackgroundTaskState,
  createRunnerError,
  matchesBackgroundTaskFilter,
  toBackgroundTaskErrorMessage,
  type ITrackedBackgroundTask,
} from './background-task-manager-helpers.js';
import {
  applyBackgroundTaskRunnerStateEvent,
  markBackgroundTaskCancelled,
  markBackgroundTaskCompleted,
  markBackgroundTaskFailed,
  markBackgroundTaskPaused,
  markBackgroundTaskResumed,
  markBackgroundTaskStarted,
  startBackgroundTaskRunner,
  validateBackgroundTaskRequest,
} from './background-task-manager-state.js';
import { createBackgroundTaskWatchdogs } from './background-task-watchdogs.js';
import { isTerminalBackgroundTaskStatus } from './state-machine.js';
import {
  BackgroundTaskError,
  type IBackgroundTaskInput,
  type IBackgroundTaskListFilter,
  type IBackgroundTaskLogCursor,
  type IBackgroundTaskLogPage,
  type IBackgroundTaskManager,
  type IBackgroundTaskManagerOptions,
  type TBackgroundTaskRequest,
  type IBackgroundTaskResult,
  type IBackgroundTaskRunner,
  type IBackgroundTaskState,
  type IScheduleEditPatch,
  type TBackgroundTaskIdFactory,
  type TBackgroundTaskEvent,
  type TBackgroundTaskEventListener,
  type TBackgroundTaskRunnerEvent,
  type TBackgroundTaskTimeoutReason,
} from './types.js';

import type { BackgroundTaskWatchdogController } from './background-task-watchdogs.js';

const DEFAULT_MAX_CONCURRENT = 4;
const DEFAULT_MAX_DEPTH = 1;
const PREVIEW_LENGTH = 120;

export class BackgroundTaskManager implements IBackgroundTaskManager {
  private readonly runners = new Map<string, IBackgroundTaskRunner>();
  private readonly maxConcurrent: number;
  private readonly maxDepth: number;
  private readonly now: () => string;
  private readonly idFactory: TBackgroundTaskIdFactory;
  private readonly watchdogs: BackgroundTaskWatchdogController;
  private readonly listeners = new Set<TBackgroundTaskEventListener>();
  private readonly eventSink?: TBackgroundTaskEventListener;
  private readonly tasks = new Map<string, ITrackedBackgroundTask>();
  private readonly queue: string[] = [];
  /**
   * CORE-024: task ids currently holding a concurrency slot. Keyed by id (not a count) so
   * acquire/release are idempotent — a scheduled task releases on `sleeping` and re-acquires on
   * `waking` without ever double-counting, and a terminal transition from either state is safe.
   */
  private readonly slotHolders = new Set<string>();
  private sequence = 0;
  private shuttingDown = false;
  private shutdownPromise?: Promise<void>;

  constructor(options: IBackgroundTaskManagerOptions) {
    for (const runner of options.runners) this.runners.set(runner.kind, runner);
    this.maxConcurrent = options.maxConcurrent ?? DEFAULT_MAX_CONCURRENT;
    this.maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH;
    this.eventSink = options.eventSink;
    this.now = options.now ?? (() => new Date().toISOString());
    this.watchdogs = createBackgroundTaskWatchdogs(options, (task, reason, message) => {
      void this.failForTimeout(task, reason, message);
    });
    this.idFactory =
      options.idFactory ??
      (() => {
        this.sequence += 1;
        return `task_${this.sequence}`;
      });
  }

  async spawn(request: TBackgroundTaskRequest): Promise<IBackgroundTaskState> {
    if (this.shuttingDown) {
      throw new BackgroundTaskError('validation', 'Background task manager is shutting down');
    }
    validateBackgroundTaskRequest(request, this.runners, this.maxDepth);
    const id = this.idFactory(request);
    const deferred = createDeferred();
    void deferred.promise.catch(() => undefined);
    const state = createQueuedBackgroundTaskState(id, request, this.now(), PREVIEW_LENGTH);

    this.tasks.set(id, {
      state,
      request,
      completion: deferred.promise,
      resolve: deferred.resolve,
      reject: deferred.reject,
      recentText: '',
      outputBytes: 0,
      textDeltas: 0,
      repeatedDeltaCount: 0,
    });
    this.queue.push(id);
    this.emit({ type: 'background_task_created', task: cloneBackgroundTaskState(state) });
    this.drainQueue();
    return cloneBackgroundTaskState(state);
  }

  wait(taskId: string): Promise<IBackgroundTaskResult> {
    return this.requireTask(taskId).completion;
  }

  list(filter?: IBackgroundTaskListFilter): IBackgroundTaskState[] {
    return [...this.tasks.values()]
      .map((task) => task.state)
      .filter((state) => matchesBackgroundTaskFilter(state, filter))
      .map((state) => cloneBackgroundTaskState(state));
  }

  get(taskId: string): IBackgroundTaskState | undefined {
    const task = this.tasks.get(taskId);
    return task ? cloneBackgroundTaskState(task.state) : undefined;
  }

  async cancel(taskId: string, reason?: string): Promise<void> {
    const task = this.requireTask(taskId);
    if (isTerminalBackgroundTaskStatus(task.state.status)) return;

    if (task.state.status === 'queued') {
      this.removeFromQueue(taskId);
      this.cancelTask(task, reason);
      return;
    }

    const handle = task.handle;
    this.cancelTask(task, reason);
    await handle?.cancel(reason).catch(() => undefined);
  }

  async close(taskId: string): Promise<void> {
    const task = this.requireTask(taskId);
    if (!isTerminalBackgroundTaskStatus(task.state.status)) {
      throw createRunnerError(`Cannot close active background task: ${taskId}`);
    }
    this.tasks.delete(taskId);
    this.emit({ type: 'background_task_closed', taskId });
  }

  // SELFHOST-012: non-destructive pause of a scheduled task — croner `.pause()`, not the irreversible `.stop()`
  // that `cancel` uses. A paused schedule holds no concurrency slot (like `sleeping`).
  async pauseScheduledTask(taskId: string): Promise<void> {
    const task = this.requireScheduledTask(taskId);
    if (task.state.status === 'paused') return; // idempotent
    const handle = task.handle;
    if (!handle?.pause) {
      throw createRunnerError(`Background task runner does not support pause: ${taskId}`);
    }
    const updated = markBackgroundTaskPaused(task, this.now());
    this.releaseSlot(taskId);
    this.emit({ type: 'background_task_updated', task: updated });
    await handle.pause();
    if (!this.shuttingDown) this.drainQueue();
  }

  async resumeScheduledTask(taskId: string): Promise<void> {
    const task = this.requireScheduledTask(taskId);
    if (task.state.status !== 'paused') return; // only a paused schedule resumes; otherwise no-op
    const handle = task.handle;
    if (!handle?.resume) {
      throw createRunnerError(`Background task runner does not support resume: ${taskId}`);
    }
    const updated = markBackgroundTaskResumed(task, this.now());
    this.emit({ type: 'background_task_updated', task: updated });
    // The runner re-emits `sleeping`, which refreshes nextFireAt idempotently (status is already sleeping).
    await handle.resume();
  }

  async editScheduledTask(taskId: string, patch: IScheduleEditPatch): Promise<void> {
    const task = this.requireScheduledTask(taskId);
    const handle = task.handle;
    if (!handle?.editSchedule) {
      throw createRunnerError(`Background task runner does not support edit: ${taskId}`);
    }
    await handle.editSchedule(patch);
    // Keep the reconstructable schedule (FLOW-003) + list view in sync with the in-place re-arm.
    if (task.state.schedule) {
      task.state.schedule = { ...task.state.schedule, ...patch };
    }
    task.state.updatedAt = this.now();
    this.emit({ type: 'background_task_updated', task: cloneBackgroundTaskState(task.state) });
  }

  private requireScheduledTask(taskId: string): ITrackedBackgroundTask {
    const task = this.requireTask(taskId);
    if (task.state.kind !== 'scheduled') {
      throw createRunnerError(`Not a scheduled task: ${taskId}`);
    }
    if (isTerminalBackgroundTaskStatus(task.state.status)) {
      throw createRunnerError(`Cannot change lifecycle of a ${task.state.status} task: ${taskId}`);
    }
    // A queued schedule has no runner handle yet (all concurrency slots busy) — a clearer error than the
    // downstream "runner does not support pause" the missing handle would otherwise produce.
    if (task.state.status === 'queued') {
      throw createRunnerError(
        `Cannot change lifecycle of a not-yet-started (queued) schedule: ${taskId}`,
      );
    }
    return task;
  }

  shutdown(reason = 'Background task manager shutdown'): Promise<void> {
    if (this.shutdownPromise) return this.shutdownPromise;
    this.shuttingDown = true;
    this.shutdownPromise = Promise.all(
      [...this.tasks.values()]
        .filter((task) => !isTerminalBackgroundTaskStatus(task.state.status))
        .map((task) => this.cancel(task.state.id, reason)),
    ).then(() => undefined);
    return this.shutdownPromise;
  }

  async send(taskId: string, input: IBackgroundTaskInput): Promise<void> {
    const task = this.requireTask(taskId);
    if (!task.handle?.send) {
      throw createRunnerError(`Background task runner does not support input: ${taskId}`);
    }
    await task.handle.send(input);
  }

  async readLog(
    taskId: string,
    cursor?: IBackgroundTaskLogCursor,
  ): Promise<IBackgroundTaskLogPage> {
    const task = this.requireTask(taskId);
    if (!task.handle?.readLog) {
      throw createRunnerError(`Background task runner does not support log reads: ${taskId}`);
    }
    return task.handle.readLog(cursor);
  }

  subscribe(listener: TBackgroundTaskEventListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** CORE-024: acquire/release a concurrency slot for a task (idempotent, set-keyed by id). */
  private acquireSlot(taskId: string): void {
    this.slotHolders.add(taskId);
  }

  private releaseSlot(taskId: string): void {
    this.slotHolders.delete(taskId);
  }

  private drainQueue(): void {
    while (this.slotHolders.size < this.maxConcurrent) {
      const taskId = this.queue.shift();
      if (!taskId) return;
      const task = this.tasks.get(taskId);
      if (!task || task.state.status !== 'queued') continue;
      this.startTask(task);
    }
  }

  private startTask(task: ITrackedBackgroundTask): void {
    const runner = this.runners.get(task.request.kind);
    if (!runner) {
      this.failTask(task, createRunnerError(`No runner for task kind: ${task.request.kind}`));
      return;
    }

    const started = markBackgroundTaskStarted(task, this.now());
    this.acquireSlot(task.state.id);
    this.emit({ type: 'background_task_started', task: started });

    startBackgroundTaskRunner({
      task,
      runner,
      now: this.now,
      onEvent: (event) => this.handleRunnerEvent(task, event),
      onStarted: () => this.watchdogs.start(task),
      onUpdated: (updated) => this.emit({ type: 'background_task_updated', task: updated }),
      onCompleted: (result) => this.completeTask(task, result),
      onFailed: (error) => this.failTask(task, error),
    });
  }

  private completeTask(task: ITrackedBackgroundTask, result: IBackgroundTaskResult): void {
    if (isTerminalBackgroundTaskStatus(task.state.status)) return;
    this.watchdogs.clear(task);
    const completed = markBackgroundTaskCompleted(task, result, this.now());
    this.releaseSlot(task.state.id);
    task.resolve(result);
    this.emit({ type: 'background_task_completed', task: completed });
    if (!this.shuttingDown) this.drainQueue();
  }

  private failTask(task: ITrackedBackgroundTask, error: Error | string): void {
    if (isTerminalBackgroundTaskStatus(task.state.status)) return;
    this.watchdogs.clear(task);
    const failed = markBackgroundTaskFailed(task, error, this.now());
    this.releaseSlot(task.state.id);
    task.reject(createRunnerError(toBackgroundTaskErrorMessage(error)));
    this.emit({ type: 'background_task_failed', task: failed });
    if (!this.shuttingDown) this.drainQueue();
  }

  private cancelTask(task: ITrackedBackgroundTask, reason?: string): void {
    if (isTerminalBackgroundTaskStatus(task.state.status)) return;
    this.watchdogs.clear(task);
    const cancelled = markBackgroundTaskCancelled(task, reason, this.now());
    // CORE-024: releaseSlot is idempotent — safe whether the task held a slot (running/waking) or
    // not (queued/sleeping), replacing the wasActive count guard.
    this.releaseSlot(task.state.id);
    task.reject(createRunnerError(task.state.error?.message ?? 'Background task cancelled'));
    this.emit({ type: 'background_task_cancelled', task: cancelled.task });
    if (!this.shuttingDown) this.drainQueue();
  }

  private handleRunnerEvent(task: ITrackedBackgroundTask, event: TBackgroundTaskRunnerEvent): void {
    if (isTerminalBackgroundTaskStatus(task.state.status)) return;
    this.applyRunnerEventToState(task, event);
    if (event.type === 'background_task_sleeping') {
      // CORE-024 (RUNTIME-17): a sleeping schedule spawns nothing — release its slot so other
      // tasks can drain. Without this, maxConcurrent sleeping schedules wedge the budget forever.
      // The status/nextFireAt change is already surfaced via background_task_updated.
      this.releaseSlot(task.state.id);
      if (!this.shuttingDown) this.drainQueue();
      return;
    }
    if (event.type === 'background_task_waking') {
      // CORE-024: re-acquire a slot for the in-flight fire (idempotent; a wake may briefly push
      // the holder count over maxConcurrent, which only pauses queue draining until it sleeps).
      this.acquireSlot(task.state.id);
      // FLOW-001: propagate a manager-level wake so an upper layer can re-enter the agent loop.
      this.emit({
        type: 'background_task_waking',
        taskId: task.state.id,
        ...(event.instruction !== undefined ? { instruction: event.instruction } : {}),
      });
      return;
    }
    this.emit({ ...event, taskId: task.state.id });
    if (event.type === 'background_task_text_delta') {
      this.watchdogs.applyTextGuards(task, event.delta);
    }
  }

  private applyRunnerEventToState(
    task: ITrackedBackgroundTask,
    event: TBackgroundTaskRunnerEvent,
  ): void {
    const now = this.now();
    this.watchdogs.recordActivity(task, now);
    const updated = applyBackgroundTaskRunnerStateEvent(task, event, now);
    if (updated) this.emit({ type: 'background_task_updated', task: updated });
  }

  private async failForTimeout(
    task: ITrackedBackgroundTask,
    reason: TBackgroundTaskTimeoutReason,
    message: string,
  ): Promise<void> {
    if (isTerminalBackgroundTaskStatus(task.state.status)) return;
    task.state.timeoutReason = reason;
    const handle = task.handle;
    this.failTask(task, new BackgroundTaskError('timeout', message));
    try {
      await handle?.cancel(message);
    } catch {
      // The timeout failure is authoritative; runner cancellation errors are secondary.
    }
  }

  private removeFromQueue(taskId: string): void {
    const index = this.queue.indexOf(taskId);
    if (index >= 0) this.queue.splice(index, 1);
  }

  private requireTask(taskId: string): ITrackedBackgroundTask {
    const task = this.tasks.get(taskId);
    if (!task) throw createRunnerError(`Unknown background task: ${taskId}`);
    return task;
  }

  private emit(event: TBackgroundTaskEvent): void {
    this.eventSink?.(event);
    for (const listener of this.listeners) listener(event);
  }
}
