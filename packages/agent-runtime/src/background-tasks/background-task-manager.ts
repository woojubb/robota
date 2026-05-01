import {
  BackgroundTaskError,
  type IBackgroundTaskInput,
  type IBackgroundTaskListFilter,
  type IBackgroundTaskLogCursor,
  type IBackgroundTaskLogPage,
  type IBackgroundTaskManager,
  type IBackgroundTaskManagerOptions,
  type IBackgroundTaskRequest,
  type IBackgroundTaskResult,
  type IBackgroundTaskRunner,
  type IBackgroundTaskState,
  type TBackgroundTaskIdFactory,
  type TBackgroundTaskEvent,
  type TBackgroundTaskEventListener,
  type TBackgroundTaskRunnerEvent,
  type TBackgroundTaskTimeoutReason,
} from './types.js';
import { isTerminalBackgroundTaskStatus } from './state-machine.js';
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
  BackgroundTaskWatchdogController,
  createBackgroundTaskWatchdogs,
} from './background-task-watchdogs.js';
import {
  applyBackgroundTaskRunnerStateEvent,
  markBackgroundTaskCancelled,
  markBackgroundTaskCompleted,
  markBackgroundTaskFailed,
  markBackgroundTaskStarted,
  startBackgroundTaskRunner,
  validateBackgroundTaskRequest,
} from './background-task-manager-state.js';

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
  private activeCount = 0;
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

  async spawn(request: IBackgroundTaskRequest): Promise<IBackgroundTaskState> {
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

  private drainQueue(): void {
    while (this.activeCount < this.maxConcurrent) {
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
    this.activeCount += 1;
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
    this.activeCount -= 1;
    task.resolve(result);
    this.emit({ type: 'background_task_completed', task: completed });
    if (!this.shuttingDown) this.drainQueue();
  }

  private failTask(task: ITrackedBackgroundTask, error: Error | string): void {
    if (isTerminalBackgroundTaskStatus(task.state.status)) return;
    this.watchdogs.clear(task);
    const failed = markBackgroundTaskFailed(task, error, this.now());
    this.activeCount -= 1;
    task.reject(createRunnerError(toBackgroundTaskErrorMessage(error)));
    this.emit({ type: 'background_task_failed', task: failed });
    if (!this.shuttingDown) this.drainQueue();
  }

  private cancelTask(task: ITrackedBackgroundTask, reason?: string): void {
    if (isTerminalBackgroundTaskStatus(task.state.status)) return;
    this.watchdogs.clear(task);
    const cancelled = markBackgroundTaskCancelled(task, reason, this.now());
    if (cancelled.wasActive) this.activeCount -= 1;
    task.reject(createRunnerError(task.state.error?.message ?? 'Background task cancelled'));
    this.emit({ type: 'background_task_cancelled', task: cancelled.task });
    if (!this.shuttingDown) this.drainQueue();
  }

  private handleRunnerEvent(task: ITrackedBackgroundTask, event: TBackgroundTaskRunnerEvent): void {
    if (isTerminalBackgroundTaskStatus(task.state.status)) return;
    this.applyRunnerEventToState(task, event);
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
