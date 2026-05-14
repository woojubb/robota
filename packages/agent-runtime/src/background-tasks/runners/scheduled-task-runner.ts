import { spawn } from 'node:child_process';
import { Cron, type CronOptions } from 'croner';
import {
  appendPrefixedLogLines,
  createBackgroundTaskLogPage,
  createLimitedOutputCapture,
} from '../log-pages.js';
import {
  BackgroundTaskError,
  type IBackgroundTaskHandle,
  type IBackgroundTaskLogCursor,
  type IBackgroundTaskLogPage,
  type IBackgroundTaskResult,
  type IBackgroundTaskRunner,
  type IBackgroundTaskStart,
  type IScheduledBackgroundTaskRequest,
  type TBackgroundTaskRunnerEvent,
} from '../types.js';

const DEFAULT_OUTPUT_LIMIT_BYTES = 30_000;

export interface IScheduledTaskRunnerOptions {
  timezone?: string;
}

interface IScheduledTaskState {
  taskId: string;
  request: IScheduledBackgroundTaskRequest;
  logs: string[];
  cancelled: boolean;
  job: Cron;
  emit: (event: TBackgroundTaskRunnerEvent) => void;
  resolve: (result: IBackgroundTaskResult) => void;
}

export function createScheduledTaskRunner(
  options: IScheduledTaskRunnerOptions = {},
): IBackgroundTaskRunner {
  return {
    kind: 'scheduled',
    start(task: IBackgroundTaskStart): IBackgroundTaskHandle {
      if (task.request.kind !== 'scheduled') {
        throw new BackgroundTaskError(
          'runner',
          `Invalid scheduled task kind: ${task.request.kind}`,
        );
      }
      return startScheduledTask(task.taskId, task.request, task.emit ?? (() => undefined), options);
    },
  };
}

function startScheduledTask(
  taskId: string,
  request: IScheduledBackgroundTaskRequest,
  emit: (event: TBackgroundTaskRunnerEvent) => void,
  options: IScheduledTaskRunnerOptions,
): IBackgroundTaskHandle {
  let resolveResult!: (result: IBackgroundTaskResult) => void;
  const resultPromise = new Promise<IBackgroundTaskResult>((resolve) => {
    resolveResult = resolve;
  });

  const logs: string[] = [];

  const cronOptions: CronOptions = {
    protect: true,
    ...(options.timezone !== undefined ? { timezone: options.timezone } : {}),
  };

  const state: IScheduledTaskState = {
    taskId,
    request,
    logs,
    cancelled: false,
    emit,
    resolve: resolveResult,
    job: new Cron(request.cronExpression, cronOptions, () => {
      if (state.cancelled) return;
      runOneFire(state);
    }),
  };

  // Signal initial sleeping state
  emitSleeping(state);

  return {
    taskId,
    result: resultPromise,
    cancel: async () => {
      state.cancelled = true;
      state.job.stop();
      resolveResult({
        taskId,
        kind: 'scheduled',
        output: createLimitedOutputCapture({ limitBytes: DEFAULT_OUTPUT_LIMIT_BYTES }).getOutput(),
      });
    },
    readLog: (cursor?: IBackgroundTaskLogCursor): Promise<IBackgroundTaskLogPage> =>
      Promise.resolve(createBackgroundTaskLogPage(taskId, logs, cursor)),
  };
}

function runOneFire(state: IScheduledTaskState): void {
  if (state.cancelled) return;

  state.emit({ type: 'background_task_waking' });

  const capture = createLimitedOutputCapture({
    limitBytes: state.request.outputLimitBytes ?? DEFAULT_OUTPUT_LIMIT_BYTES,
  });

  const shell = state.request.shell ?? 'sh';
  const child = spawn(shell, ['-c', state.request.command], {
    cwd: state.request.cwd,
    env: { ...process.env, ...(state.request.env ?? {}) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  child.stdout.on('data', (chunk: Buffer) => {
    const text = chunk.toString('utf8');
    capture.appendOutput(text);
    appendPrefixedLogLines(state.logs, 'stdout', text);
  });

  child.stderr.on('data', (chunk: Buffer) => {
    const text = chunk.toString('utf8');
    capture.appendOutput(text);
    appendPrefixedLogLines(state.logs, 'stderr', text);
  });

  child.on('close', () => {
    if (!state.cancelled) {
      emitSleeping(state);
    }
  });

  child.on('error', (error) => {
    appendPrefixedLogLines(state.logs, 'system', error.message);
    if (!state.cancelled) {
      emitSleeping(state);
    }
  });
}

function emitSleeping(state: IScheduledTaskState): void {
  const nextRun = state.job.nextRun();
  if (nextRun === null) return;
  state.emit({
    type: 'background_task_sleeping',
    nextFireAt: nextRun.toISOString(),
  });
}
