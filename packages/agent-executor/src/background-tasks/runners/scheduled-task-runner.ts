import { spawn, type ChildProcess } from 'node:child_process';

import { endWithProcess, withChildSession } from '@robota-sdk/agent-core/node';
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
  type IPreparedBackgroundTaskHandle,
  type IScheduledBackgroundTaskRequest,
  type IScheduleEditPatch,
  type TBackgroundTaskRunnerEvent,
} from '../types.js';
import { nextScheduledFireOnOrAfter } from './scheduled-fire-time.js';
import { registerBuiltInScheduledRunner } from './scheduled-restore-trust.js';
import { resolveBackgroundTaskShellCommand } from './shell-command-resolution.js';

const DEFAULT_OUTPUT_LIMIT_BYTES = 30_000;

export interface IScheduledTaskRunnerOptions {
  timezone?: string;
  shellExecutable?: string;
}

interface IScheduledTaskState {
  taskId: string;
  request: IScheduledBackgroundTaskRequest;
  shellExecutable?: string;
  logs: string[];
  cancelled: boolean;
  /** SELFHOST-012: non-destructively paused via croner `.pause()`; a paused schedule fires nothing. */
  paused: boolean;
  /** SCREEN-1992: at least one fire ran — distinguishes a finished one-shot from a never-fired one. */
  fired: boolean;
  job: Cron;
  emit: (event: TBackgroundTaskRunnerEvent) => void;
  resolve: (result: IBackgroundTaskResult<'scheduled'>) => void;
  /** CORE-023: the in-flight fired child, tracked so cancel can kill it instead of orphaning it. */
  currentChild?: ChildProcess;
  onChildIdle?: () => void;
}

export function createScheduledTaskRunner(
  options: IScheduledTaskRunnerOptions = {},
): IBackgroundTaskRunner<'scheduled'> {
  return registerBuiltInScheduledRunner({
    kind: 'scheduled',
    nextScheduledFireOnOrAfter: (cronExpression, firstAllowedAt) =>
      nextScheduledFireOnOrAfter(cronExpression, firstAllowedAt, options),
    start(task: IBackgroundTaskStart<'scheduled'>): IBackgroundTaskHandle<'scheduled'> {
      if (task.request.kind !== 'scheduled') {
        throw new BackgroundTaskError(
          'runner',
          `Invalid scheduled task kind: ${task.request.kind}`,
        );
      }
      return startScheduledTask(task.taskId, task.request, task.emit ?? (() => undefined), options)
        .handle;
    },
    prepareRestore(task, restore) {
      if (task.request.kind !== 'scheduled') {
        throw new BackgroundTaskError(
          'runner',
          `Invalid scheduled task kind: ${task.request.kind}`,
        );
      }
      return startScheduledTask(
        task.taskId,
        task.request,
        task.emit ?? (() => undefined),
        options,
        restore,
      );
    },
  });
}

function startScheduledTask(
  taskId: string,
  request: IScheduledBackgroundTaskRequest,
  emit: (event: TBackgroundTaskRunnerEvent) => void,
  options: IScheduledTaskRunnerOptions,
  restore?: { readonly paused: boolean },
): IPreparedBackgroundTaskHandle<'scheduled'> {
  // Fail closed synchronously before registering a schedule whose explicit executable is unsupported.
  if (request.command !== undefined) {
    resolveBackgroundTaskShellCommand(
      { ...request, command: request.command },
      { executable: options.shellExecutable },
    );
  }

  let resolveResult!: (result: IBackgroundTaskResult<'scheduled'>) => void;
  let rejectResult!: (error: unknown) => void;
  const resultPromise = new Promise<IBackgroundTaskResult<'scheduled'>>((resolve, reject) => {
    resolveResult = resolve;
    rejectResult = reject;
  });

  const logs: string[] = [];

  const cronOptions: CronOptions = {
    // During preparation no work executes, so overlapping reentrant timer callbacks must all
    // reach the gate. Restore the runner's ordinary overlap protection at activation.
    protect: restore === undefined,
    ...(restore?.paused ? { paused: true } : {}),
    ...(options.timezone !== undefined ? { timezone: options.timezone } : {}),
  };

  let active = restore === undefined;
  let pending = 0n;
  const fire = (): void => {
    // Guard on both flags: croner won't invoke a paused/stopped job, but a fire already in croner's queue
    // when pause() lands must still be suppressed.
    if (state.cancelled || state.paused) return;
    if (!active) {
      pending += 1n;
      return;
    }
    if (state.currentChild) return;
    runOneFire(state);
  };

  const state: IScheduledTaskState = {
    taskId,
    request,
    shellExecutable: options.shellExecutable,
    logs,
    cancelled: false,
    paused: restore?.paused ?? false,
    fired: false,
    emit,
    resolve: resolveResult,
    job: new Cron(request.cronExpression, cronOptions, fire),
  };

  // Signal initial sleeping state
  if (active) emitSleeping(state);

  const handle: IBackgroundTaskHandle<'scheduled'> = {
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
    // SELFHOST-012: non-destructive pause — croner `.pause()` keeps the job re-armable (unlike `.stop()`).
    pause: (): Promise<void> => {
      if (!active || state.cancelled)
        return Promise.reject(
          new BackgroundTaskError('validation', 'Prepared schedule is not active.'),
        );
      state.paused = true;
      state.job.pause();
      return Promise.resolve();
    },
    // SELFHOST-012: resume the same job and re-announce the next fire time.
    resume: (): Promise<void> => {
      if (!active || state.cancelled)
        return Promise.reject(
          new BackgroundTaskError('validation', 'Prepared schedule is not active.'),
        );
      state.paused = false;
      state.job.resume();
      emitSleeping(state);
      if (pending > 0n) void Promise.resolve().then(drain);
      return Promise.resolve();
    },
    // SELFHOST-012: re-arm in place — rebuild the Cron from the patched expression while keeping this task's
    // identity (same taskId + handle). Instruction/command changes are picked up by the fire closure.
    editSchedule: (patch: IScheduleEditPatch): Promise<void> => {
      if (!active || state.cancelled)
        return Promise.reject(
          new BackgroundTaskError('validation', 'Prepared schedule is not active.'),
        );
      state.request = { ...state.request, ...patch };
      if (patch.cronExpression !== undefined) {
        state.job.stop();
        state.job = new Cron(patch.cronExpression, { ...cronOptions, paused: state.paused }, fire);
        if (state.paused) state.job.pause();
      }
      if (!state.paused) emitSleeping(state);
      return Promise.resolve();
    },
    readLog: (cursor?: IBackgroundTaskLogCursor): Promise<IBackgroundTaskLogPage> =>
      Promise.resolve(createBackgroundTaskLogPage(taskId, logs, cursor)),
  };

  const failPreparedTask = (error: unknown): void => {
    state.cancelled = true;
    try {
      state.job.stop();
    } catch {
      // The closed gate prevents further work even if timer cleanup fails.
    }
    rejectResult(error);
  };
  const drain = (): void => {
    if (state.cancelled || state.paused || pending === 0n) return;
    if (state.currentChild) {
      state.onChildIdle = drain;
      return;
    }
    pending -= 1n;
    try {
      runOneFire(state);
    } catch (error) {
      failPreparedTask(error);
      return;
    }
    if (pending > 0n) void Promise.resolve().then(drain);
  };
  return {
    handle,
    activate: () => {
      if (state.cancelled) return 'aborted';
      if (active) return 'active';
      state.job.options.protect = true;
      active = true;
      void Promise.resolve().then(() => {
        if (state.cancelled || state.paused) return;
        try {
          emitSleeping(state);
          drain();
        } catch (error) {
          failPreparedTask(error);
        }
      });
      return 'active';
    },
    abort: () => {
      if (state.cancelled) return;
      state.cancelled = true;
      try {
        state.job.stop();
      } finally {
        resolveResult({ taskId, kind: 'scheduled', output: '' });
      }
    },
  };
}

function runOneFire(state: IScheduledTaskState): void {
  if (state.cancelled || state.paused) return;
  state.fired = true;

  // FLOW-001: carry the agent-wake instruction (if any) so an upper layer can wake the agent loop.
  state.emit(
    state.request.agentInstruction !== undefined
      ? { type: 'background_task_waking', instruction: state.request.agentInstruction }
      : { type: 'background_task_waking' },
  );
  if (state.cancelled || state.paused) return;

  // An agent-wake-only schedule (no shell command) just fires the wake and re-sleeps.
  const command = state.request.command;
  if (command === undefined) {
    if (!state.cancelled) emitSleeping(state);
    return;
  }

  const capture = createLimitedOutputCapture({
    limitBytes: state.request.outputLimitBytes ?? DEFAULT_OUTPUT_LIMIT_BYTES,
  });

  const shell = resolveBackgroundTaskShellCommand(
    { ...state.request, command },
    { executable: state.shellExecutable },
  );
  // As a background process task: its own session on POSIX, and in secure mode it ends with this
  // process.
  const child = endWithProcess(
    spawn(
      shell.executable,
      shell.args,
      withChildSession({
        cwd: state.request.cwd,
        env: { ...process.env, ...(state.request.env ?? {}) },
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: SPAWN_DETACHED,
      }),
    ),
  );
  state.currentChild = child;

  // CORE-024 (RUNTIME-18): croner `protect: true` skips a fire while the previous one still runs,
  // so a hung fire starves EVERY future fire. A per-fire timeout kills the hung child (process
  // group) so `close` fires, the schedule re-sleeps, and the next cron tick runs.
  const fireTimeout =
    state.request.timeoutMs !== undefined
      ? setTimeout(() => {
          appendPrefixedLogLines(
            state.logs,
            'system',
            `fire timed out after ${state.request.timeoutMs}ms — killing`,
          );
          void killProcessTree(child, { processGroup: SPAWN_DETACHED });
        }, state.request.timeoutMs)
      : undefined;
  const clearFireTimeout = (): void => {
    if (fireTimeout) clearTimeout(fireTimeout);
  };

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
    clearFireTimeout();
    const tracked = state.currentChild === child;
    if (tracked) state.currentChild = undefined;
    // SELFHOST-012: a fire in flight when pause() lands still completes; don't re-announce sleeping for a
    // now-paused schedule (it would drive an illegal paused→sleeping transition upstream).
    if (!state.cancelled && !state.paused) {
      emitSleeping(state);
    }
    if (tracked) resumeHeldWakes(state);
  });

  child.on('error', (error) => {
    clearFireTimeout();
    const tracked = state.currentChild === child;
    if (tracked) state.currentChild = undefined;
    appendPrefixedLogLines(state.logs, 'system', error.message);
    if (!state.cancelled && !state.paused) {
      emitSleeping(state);
    }
    if (tracked) resumeHeldWakes(state);
  });
}

function resumeHeldWakes(state: IScheduledTaskState): void {
  const resume = state.onChildIdle;
  state.onChildIdle = undefined;
  if (resume && !state.cancelled) void Promise.resolve().then(resume);
}

/**
 * Re-arm after a fire (or on start). SCREEN-1992: when the cron has no next run — a one-shot
 * `in <N>` / ISO schedule that has just fired — the schedule is finished, so the handle resolves
 * and the manager moves the task to `completed`. Before this, such a task stayed `running` with
 * no `nextFireAt` forever, because only `cancel` ever resolved the handle.
 */
function emitSleeping(state: IScheduledTaskState): void {
  const nextRun = state.job.nextRun();
  if (nextRun === null) {
    if (!state.cancelled && !state.paused && state.fired) finishOneShot(state);
    return;
  }
  state.emit({
    type: 'background_task_sleeping',
    nextFireAt: nextRun.toISOString(),
  });
}

function finishOneShot(state: IScheduledTaskState): void {
  state.job.stop();
  state.resolve({
    taskId: state.taskId,
    kind: 'scheduled',
    output: state.logs.join('\n'),
  });
}
