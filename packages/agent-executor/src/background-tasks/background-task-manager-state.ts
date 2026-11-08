import {
  applyBackgroundTaskResultMetadataToState,
  cloneBackgroundTaskState,
  createRunnerError,
  normalizeBackgroundTaskError,
  type ITrackedBackgroundTask,
} from './background-task-manager-helpers.js';
import { isTerminalBackgroundTaskStatus, transitionBackgroundTaskStatus } from './state-machine.js';
import { BackgroundTaskError } from './types.js';

import type {
  IBackgroundTaskHandle,
  TBackgroundTaskRequest,
  IBackgroundTaskResult,
  IBackgroundTaskRunner,
  IBackgroundTaskStart,
  IBackgroundTaskState,
  TBackgroundTaskRunnerEvent,
} from './types.js';

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
  request: TBackgroundTaskRequest,
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

function attachBackgroundTaskHandleMetadata(
  task: ITrackedBackgroundTask,
  handle: IBackgroundTaskHandle,
  now: () => string,
): IBackgroundTaskState | undefined {
  task.handle = handle;
  if (handle.pid) task.state.pid = handle.pid;
  if (handle.logPath) task.state.logPath = handle.logPath;
  if (handle.transcriptPath) task.state.transcriptPath = handle.transcriptPath;
  if (handle.transcriptSealed === true) task.state.transcriptSealed = true;
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
): { task: IBackgroundTaskState } {
  // `wasActive` was dropped — slot accounting is now id-keyed and idempotent
  // (releaseSlot), so the caller no longer needs a was-it-active flag to decide the decrement.
  task.state.status = transitionBackgroundTaskStatus(task.state.status, 'CANCEL');
  task.state.error = {
    category: 'runner',
    message: reason ?? 'Background task cancelled',
    recoverable: true,
  };
  task.state.completedAt = now;
  task.state.updatedAt = now;
  return { task: cloneBackgroundTaskState(task.state) };
}

/** Non-destructive pause — `paused` is non-terminal; the schedule stops firing but is kept. */
export function markBackgroundTaskPaused(
  task: ITrackedBackgroundTask,
  now: string,
): IBackgroundTaskState {
  task.state.status = transitionBackgroundTaskStatus(task.state.status, 'PAUSE');
  // `nextFireAt` is scheduled-only on the discriminated state; pause is only ever called on
  // a scheduled task (the manager's `requireScheduledTask` guard), but the kind check here is what
  // lets TypeScript narrow `task.state` to write it.
  if (task.state.kind === 'scheduled') task.state.nextFireAt = undefined; // no pending fire while paused
  task.state.updatedAt = now;
  return cloneBackgroundTaskState(task.state);
}

/** Resume a paused schedule back to `sleeping`; the runner's re-emitted sleeping sets nextFireAt. */
export function markBackgroundTaskResumed(
  task: ITrackedBackgroundTask,
  now: string,
): IBackgroundTaskState {
  task.state.status = transitionBackgroundTaskStatus(task.state.status, 'RESUME');
  task.state.updatedAt = now;
  return cloneBackgroundTaskState(task.state);
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
    // Idempotent: a resume() re-emits sleeping after the manager already transitioned paused→sleeping (RESUME).
    // Only transition when a real running→sleeping edge applies; otherwise just refresh nextFireAt.
    if (task.state.status !== 'sleeping') {
      task.state.status = transitionBackgroundTaskStatus(task.state.status, 'SLEEP');
    }
    // `nextFireAt` is scheduled-only on the discriminated state — `background_task_sleeping`
    // is only emitted by the scheduled runner, but the kind check is what lets TypeScript narrow.
    if (task.state.kind === 'scheduled') task.state.nextFireAt = event.nextFireAt;
    task.state.updatedAt = now;
    return cloneBackgroundTaskState(task.state);
  }
  if (event.type === 'background_task_waking') {
    // A scheduled task wakes from 'sleeping' → 'running'. A monitor (`process`-kind) is
    // already 'running' and fires wakes on output matches without changing status — keep it as-is.
    if (task.state.status === 'sleeping') {
      task.state.status = transitionBackgroundTaskStatus(task.state.status, 'WAKE');
    }
    // `nextFireAt` is scheduled-only; a monitor's `process`-kind state never carries it.
    if (task.state.kind === 'scheduled') task.state.nextFireAt = undefined;
    task.state.updatedAt = now;
    return cloneBackgroundTaskState(task.state);
  }
  return undefined;
}

interface IStartBackgroundTaskRunnerOptions {
  task: ITrackedBackgroundTask;
  runner: IBackgroundTaskRunner;
  startOverride?: (task: IBackgroundTaskStart) => IBackgroundTaskHandle;
  now: () => string;
  onEvent: (event: TBackgroundTaskRunnerEvent) => void;
  onStarted: () => void;
  onUpdated: (state: IBackgroundTaskState) => void;
  onCompleted: (result: IBackgroundTaskResult) => void;
  onFailed: (error: Error | string) => void;
}

export function startBackgroundTaskRunner(options: IStartBackgroundTaskRunnerOptions): void {
  try {
    if (options.runner.kind !== options.task.request.kind) {
      throw new BackgroundTaskError(
        'runner',
        `Runner kind ${options.runner.kind} does not match task kind ${options.task.request.kind}`,
      );
    }
    // The kind check establishes the correlation that TypeScript cannot recover from a
    // runtime registry of the four runner variants.
    const input = {
      taskId: options.task.state.id,
      request: options.task.request,
      emit: options.onEvent,
    };
    const handle = options.startOverride
      ? options.startOverride(input as IBackgroundTaskStart)
      : options.runner.start(input as never);
    if (isTerminalBackgroundTaskStatus(options.task.state.status)) {
      void handle.result.catch(() => undefined);
      try {
        void handle.cancel('Task ended during runner startup').catch(() => undefined);
      } catch {
        /* Best-effort cancellation. */
      }
      return;
    }
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
