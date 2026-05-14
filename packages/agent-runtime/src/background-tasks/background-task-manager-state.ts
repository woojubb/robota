import { BackgroundTaskError } from './types.js';
import type {
  IBackgroundTaskHandle,
  IBackgroundTaskRequest,
  IBackgroundTaskResult,
  IBackgroundTaskRunner,
  IBackgroundTaskState,
  TBackgroundTaskRunnerEvent,
} from './types.js';
import { transitionBackgroundTaskStatus } from './state-machine.js';
import {
  applyBackgroundTaskResultMetadataToState,
  cloneBackgroundTaskState,
  createRunnerError,
  normalizeBackgroundTaskError,
  type ITrackedBackgroundTask,
} from './background-task-manager-helpers.js';

export function markBackgroundTaskStarted(
  task: ITrackedBackgroundTask,
  now: string,
): IBackgroundTaskState {
  task.state.status = transitionBackgroundTaskStatus(task.state.status, 'START');
  task.state.startedAt = now;
  task.state.updatedAt = now;
  task.state.lastActivityAt = now;
  return cloneBackgroundTaskState(task.state);
}

export function validateBackgroundTaskRequest(
  request: IBackgroundTaskRequest,
  runners: ReadonlyMap<string, IBackgroundTaskRunner>,
  maxDepth: number,
): void {
  if (request.depth > maxDepth) {
    throw new BackgroundTaskError(
      'validation',
      `Background task depth limit exceeded: depth=${request.depth} maxDepth=${maxDepth}`,
    );
  }
  if (!runners.has(request.kind)) {
    throw createRunnerError(`No background task runner registered for kind: ${request.kind}`);
  }
}

export function attachBackgroundTaskHandleMetadata(
  task: ITrackedBackgroundTask,
  handle: IBackgroundTaskHandle,
  now: () => string,
): IBackgroundTaskState | undefined {
  task.handle = handle;
  if (handle.pid) task.state.pid = handle.pid;
  if (handle.logPath) task.state.logPath = handle.logPath;
  if (handle.transcriptPath) task.state.transcriptPath = handle.transcriptPath;
  if (!handle.pid && !handle.logPath && !handle.transcriptPath) return undefined;
  const updatedAt = now();
  task.state.updatedAt = updatedAt;
  task.state.lastActivityAt = updatedAt;
  return cloneBackgroundTaskState(task.state);
}

export function markBackgroundTaskCompleted(
  task: ITrackedBackgroundTask,
  result: IBackgroundTaskResult,
  now: string,
): IBackgroundTaskState {
  task.state.status = transitionBackgroundTaskStatus(task.state.status, 'COMPLETE');
  task.state.result = result;
  applyBackgroundTaskResultMetadataToState(task.state, result);
  task.state.unread = task.state.mode === 'background';
  task.state.completedAt = now;
  task.state.updatedAt = now;
  return cloneBackgroundTaskState(task.state);
}

export function markBackgroundTaskFailed(
  task: ITrackedBackgroundTask,
  error: Error | string,
  now: string,
): IBackgroundTaskState {
  task.state.status = transitionBackgroundTaskStatus(task.state.status, 'FAIL');
  task.state.error = normalizeBackgroundTaskError(error);
  task.state.completedAt = now;
  task.state.updatedAt = now;
  return cloneBackgroundTaskState(task.state);
}

export function markBackgroundTaskCancelled(
  task: ITrackedBackgroundTask,
  reason: string | undefined,
  now: string,
): { task: IBackgroundTaskState; wasActive: boolean } {
  const wasActive = task.state.status !== 'queued';
  task.state.status = transitionBackgroundTaskStatus(task.state.status, 'CANCEL');
  task.state.error = {
    category: 'runner',
    message: reason ?? 'Background task cancelled',
    recoverable: true,
  };
  task.state.completedAt = now;
  task.state.updatedAt = now;
  return { task: cloneBackgroundTaskState(task.state), wasActive };
}

export function applyBackgroundTaskRunnerStateEvent(
  task: ITrackedBackgroundTask,
  event: TBackgroundTaskRunnerEvent,
  now: string,
): IBackgroundTaskState | undefined {
  task.state.lastActivityAt = now;
  if (event.type === 'background_task_tool_start') {
    task.state.currentAction = event.firstArg ?? event.toolName;
    task.state.updatedAt = now;
    return cloneBackgroundTaskState(task.state);
  }
  if (event.type === 'background_task_tool_end') {
    task.state.currentAction = event.success ? undefined : (event.error ?? event.toolName);
    task.state.updatedAt = now;
    return cloneBackgroundTaskState(task.state);
  }
  if (event.type === 'background_task_sleeping') {
    task.state.status = transitionBackgroundTaskStatus(task.state.status, 'SLEEP');
    task.state.nextFireAt = event.nextFireAt;
    task.state.updatedAt = now;
    return cloneBackgroundTaskState(task.state);
  }
  if (event.type === 'background_task_waking') {
    task.state.status = transitionBackgroundTaskStatus(task.state.status, 'WAKE');
    task.state.nextFireAt = undefined;
    task.state.updatedAt = now;
    return cloneBackgroundTaskState(task.state);
  }
  return undefined;
}

interface IStartBackgroundTaskRunnerOptions {
  task: ITrackedBackgroundTask;
  runner: IBackgroundTaskRunner;
  now: () => string;
  onEvent: (event: TBackgroundTaskRunnerEvent) => void;
  onStarted: () => void;
  onUpdated: (state: IBackgroundTaskState) => void;
  onCompleted: (result: IBackgroundTaskResult) => void;
  onFailed: (error: Error | string) => void;
}

export function startBackgroundTaskRunner(options: IStartBackgroundTaskRunnerOptions): void {
  try {
    const handle = options.runner.start({
      taskId: options.task.state.id,
      request: options.task.request,
      emit: options.onEvent,
    });
    const updated = attachBackgroundTaskHandleMetadata(options.task, handle, options.now);
    if (updated) options.onUpdated(updated);
    options.onStarted();
    handle.result.then(
      (result) => options.onCompleted(result),
      (error) => options.onFailed(error instanceof Error ? error : String(error)),
    );
  } catch (error) {
    options.onFailed(error instanceof Error ? error : String(error));
  }
}
