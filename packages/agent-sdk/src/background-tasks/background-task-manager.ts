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
} from './types.js';
import { isTerminalBackgroundTaskStatus, transitionBackgroundTaskStatus } from './state-machine.js';
import {
  cloneBackgroundTaskState,
  createDeferred,
  createQueuedBackgroundTaskState,
  createRunnerError,
  matchesBackgroundTaskFilter,
  normalizeBackgroundTaskError,
  toBackgroundTaskErrorMessage,
  type ITrackedBackgroundTask,
} from './background-task-manager-helpers.js';

const DEFAULT_MAX_CONCURRENT = 4;
const DEFAULT_MAX_DEPTH = 1;
const PREVIEW_LENGTH = 120;

export class BackgroundTaskManager implements IBackgroundTaskManager {
  private readonly runners = new Map<string, IBackgroundTaskRunner>();
  private readonly maxConcurrent: number;
  private readonly maxDepth: number;
  private readonly now: () => string;
  private readonly idFactory: TBackgroundTaskIdFactory;
  private readonly listeners = new Set<TBackgroundTaskEventListener>();
  private readonly eventSink?: TBackgroundTaskEventListener;
  private readonly tasks = new Map<string, ITrackedBackgroundTask>();
  private readonly queue: string[] = [];
  private activeCount = 0;
  private sequence = 0;

  constructor(options: IBackgroundTaskManagerOptions) {
    for (const runner of options.runners) this.runners.set(runner.kind, runner);
    this.maxConcurrent = options.maxConcurrent ?? DEFAULT_MAX_CONCURRENT;
    this.maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH;
    this.eventSink = options.eventSink;
    this.now = options.now ?? (() => new Date().toISOString());
    this.idFactory =
      options.idFactory ??
      (() => {
        this.sequence += 1;
        return `task_${this.sequence}`;
      });
  }

  async spawn(request: IBackgroundTaskRequest): Promise<IBackgroundTaskState> {
    this.validateRequest(request);
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

    try {
      await task.handle?.cancel(reason);
    } finally {
      this.cancelTask(task, reason);
    }
  }

  async close(taskId: string): Promise<void> {
    const task = this.requireTask(taskId);
    if (!isTerminalBackgroundTaskStatus(task.state.status)) {
      throw createRunnerError(`Cannot close active background task: ${taskId}`);
    }
    this.tasks.delete(taskId);
    this.emit({ type: 'background_task_closed', taskId });
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

  private validateRequest(request: IBackgroundTaskRequest): void {
    if (request.depth > this.maxDepth) {
      throw new BackgroundTaskError(
        'validation',
        `Background task depth limit exceeded: depth=${request.depth} maxDepth=${this.maxDepth}`,
      );
    }
    if (!this.runners.has(request.kind)) {
      throw createRunnerError(`No background task runner registered for kind: ${request.kind}`);
    }
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

    task.state.status = transitionBackgroundTaskStatus(task.state.status, 'START');
    task.state.startedAt = this.now();
    task.state.updatedAt = task.state.startedAt;
    this.activeCount += 1;
    this.emit({ type: 'background_task_started', task: cloneBackgroundTaskState(task.state) });

    try {
      const handle = runner.start({
        taskId: task.state.id,
        request: task.request,
        emit: (event) => this.handleRunnerEvent(task, event),
      });
      task.handle = handle;
      if (handle.pid) task.state.pid = handle.pid;
      handle.result.then(
        (result) => this.completeTask(task, result),
        (error) => this.failTask(task, error instanceof Error ? error : String(error)),
      );
    } catch (error) {
      this.failTask(task, error instanceof Error ? error : String(error));
    }
  }

  private completeTask(task: ITrackedBackgroundTask, result: IBackgroundTaskResult): void {
    if (isTerminalBackgroundTaskStatus(task.state.status)) return;
    task.state.status = transitionBackgroundTaskStatus(task.state.status, 'COMPLETE');
    task.state.result = result;
    task.state.unread = task.state.mode === 'background';
    task.state.completedAt = this.now();
    task.state.updatedAt = task.state.completedAt;
    this.activeCount -= 1;
    task.resolve(result);
    this.emit({ type: 'background_task_completed', task: cloneBackgroundTaskState(task.state) });
    this.drainQueue();
  }

  private failTask(task: ITrackedBackgroundTask, error: Error | string): void {
    if (isTerminalBackgroundTaskStatus(task.state.status)) return;
    task.state.status = transitionBackgroundTaskStatus(task.state.status, 'FAIL');
    task.state.error = normalizeBackgroundTaskError(error);
    task.state.completedAt = this.now();
    task.state.updatedAt = task.state.completedAt;
    this.activeCount -= 1;
    task.reject(createRunnerError(toBackgroundTaskErrorMessage(error)));
    this.emit({ type: 'background_task_failed', task: cloneBackgroundTaskState(task.state) });
    this.drainQueue();
  }

  private cancelTask(task: ITrackedBackgroundTask, reason?: string): void {
    if (isTerminalBackgroundTaskStatus(task.state.status)) return;
    const wasActive = task.state.status !== 'queued';
    task.state.status = transitionBackgroundTaskStatus(task.state.status, 'CANCEL');
    task.state.error = {
      category: 'runner',
      message: reason ?? 'Background task cancelled',
      recoverable: true,
    };
    task.state.completedAt = this.now();
    task.state.updatedAt = task.state.completedAt;
    if (wasActive) this.activeCount -= 1;
    task.reject(createRunnerError(task.state.error.message));
    this.emit({ type: 'background_task_cancelled', task: cloneBackgroundTaskState(task.state) });
    this.drainQueue();
  }

  private handleRunnerEvent(task: ITrackedBackgroundTask, event: TBackgroundTaskRunnerEvent): void {
    if (isTerminalBackgroundTaskStatus(task.state.status)) return;
    const emitted = this.toBackgroundTaskEvent(task, event);
    this.applyRunnerEventToState(task, event);
    this.emit(emitted);
  }

  private applyRunnerEventToState(
    task: ITrackedBackgroundTask,
    event: TBackgroundTaskRunnerEvent,
  ): void {
    if (event.type === 'background_task_tool_start') {
      task.state.currentAction = event.firstArg ?? event.toolName;
      task.state.updatedAt = this.now();
      this.emit({ type: 'background_task_updated', task: cloneBackgroundTaskState(task.state) });
      return;
    }
    if (event.type === 'background_task_tool_end') {
      task.state.currentAction = event.success ? undefined : (event.error ?? event.toolName);
      task.state.updatedAt = this.now();
      this.emit({ type: 'background_task_updated', task: cloneBackgroundTaskState(task.state) });
    }
  }

  private toBackgroundTaskEvent(
    task: ITrackedBackgroundTask,
    event: TBackgroundTaskRunnerEvent,
  ): TBackgroundTaskEvent {
    return { ...event, taskId: task.state.id };
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
