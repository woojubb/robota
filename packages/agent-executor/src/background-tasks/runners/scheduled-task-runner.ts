import { spawn, type ChildProcess } from 'node:child_process';

import { killProcessTree } from '@robota-sdk/agent-process';
import { Cron, type CronOptions } from 'croner';

/** POSIX children are spawned detached so a process-group kill reaps grandchildren (CORE-023). */
const SPAWN_DETACHED = process.platform !== 'win32';

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
  /** CORE-023: the in-flight fired child, tracked so cancel can kill it instead of orphaning it. */
  currentChild?: ChildProcess;
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
      // CORE-023: kill an in-flight fired child instead of orphaning it (the child was
      // previously a local var with no reference held anywhere).
      if (state.currentChild) {
        await killProcessTree(state.currentChild, { processGroup: SPAWN_DETACHED });
      }
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

  // FLOW-001: carry the agent-wake instruction (if any) so an upper layer can wake the agent loop.
  state.emit(
    state.request.agentInstruction !== undefined
      ? { type: 'background_task_waking', instruction: state.request.agentInstruction }
      : { type: 'background_task_waking' },
  );

  // An agent-wake-only schedule (no shell command) just fires the wake and re-sleeps.
  const command = state.request.command;
  if (command === undefined) {
    if (!state.cancelled) emitSleeping(state);
    return;
  }

  const capture = createLimitedOutputCapture({
    limitBytes: state.request.outputLimitBytes ?? DEFAULT_OUTPUT_LIMIT_BYTES,
  });

  const shell = state.request.shell ?? 'sh';
  const child = spawn(shell, ['-c', command], {
    cwd: state.request.cwd,
    env: { ...process.env, ...(state.request.env ?? {}) },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: SPAWN_DETACHED,
  });
  state.currentChild = child;

  child.stdout?.on('data', (chunk: Buffer) => {
    const text = chunk.toString('utf8');
    capture.appendOutput(text);
    appendPrefixedLogLines(state.logs, 'stdout', text);
  });

  child.stderr?.on('data', (chunk: Buffer) => {
    const text = chunk.toString('utf8');
    capture.appendOutput(text);
    appendPrefixedLogLines(state.logs, 'stderr', text);
  });

  child.on('close', () => {
    if (state.currentChild === child) state.currentChild = undefined;
    if (!state.cancelled) {
      emitSleeping(state);
    }
  });

  child.on('error', (error) => {
    if (state.currentChild === child) state.currentChild = undefined;
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
