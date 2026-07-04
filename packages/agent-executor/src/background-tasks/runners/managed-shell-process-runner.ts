import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';

import { DEFAULT_KILL_GRACE_MS, killProcessTree } from '@robota-sdk/agent-process';

import {
  appendPrefixedLogLines,
  createBackgroundTaskLogPage,
  createLimitedOutputCapture,
  type ILimitedOutputCapture,
} from '../log-pages.js';
import {
  BackgroundTaskError,
  type IBackgroundTaskHandle,
  type IBackgroundTaskInput,
  type IBackgroundTaskLogCursor,
  type IBackgroundTaskLogPage,
  type IBackgroundTaskResult,
  type IBackgroundTaskRunner,
  type IBackgroundTaskStart,
  type IProcessBackgroundTaskRequest,
  type TBackgroundTaskRunnerEvent,
} from '../types.js';
import { createLineWakeMatcher, type ILineWakeMatcher } from './line-wake-matcher.js';

const DEFAULT_OUTPUT_LIMIT_BYTES = 30_000;

/** POSIX children are spawned detached so a process-group kill reaps grandchildren (CORE-023). */
const SPAWN_DETACHED = process.platform !== 'win32';

export interface IManagedShellProcessRunnerOptions {
  killGraceMs?: number;
}

interface IProcessTaskRuntime {
  taskId: string;
  request: IProcessBackgroundTaskRequest;
  child: ChildProcessWithoutNullStreams;
  logs: string[];
  capture: ILimitedOutputCapture;
  killGraceMs: number;
  /** FLOW-004: present when the process is a monitor (matchPattern + agentInstruction set). */
  wakeMatcher?: ILineWakeMatcher;
}

/** FLOW-004: build a line→wake matcher when the request configures monitoring. */
function createWakeMatcher(
  request: IProcessBackgroundTaskRequest,
  emit: ((event: TBackgroundTaskRunnerEvent) => void) | undefined,
): ILineWakeMatcher | undefined {
  if (request.matchPattern === undefined || request.agentInstruction === undefined || !emit) {
    return undefined;
  }
  return createLineWakeMatcher({
    matchPattern: request.matchPattern,
    agentInstruction: request.agentInstruction,
    emit: (instruction) => emit({ type: 'background_task_waking', instruction }),
  });
}

function resolveShell(request: IProcessBackgroundTaskRequest): { command: string; args: string[] } {
  return { command: request.shell ?? 'sh', args: ['-c', request.command] };
}

function sendInput(child: ChildProcessWithoutNullStreams, input: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error): void => {
      child.stdin.off('error', onError);
      reject(error);
    };
    child.stdin.once('error', onError);
    child.stdin.end(input, () => {
      child.stdin.off('error', onError);
      resolve();
    });
  });
}

export function createManagedShellProcessRunner(
  options: IManagedShellProcessRunnerOptions = {},
): IBackgroundTaskRunner {
  const killGraceMs = options.killGraceMs ?? DEFAULT_KILL_GRACE_MS;

  return {
    kind: 'process',
    start(task: IBackgroundTaskStart): IBackgroundTaskHandle {
      if (task.request.kind !== 'process') {
        throw new BackgroundTaskError('runner', `Invalid process task kind: ${task.request.kind}`);
      }
      return startProcessTask(task.taskId, task.request, killGraceMs, task.emit);
    },
  };
}

function startProcessTask(
  taskId: string,
  request: IProcessBackgroundTaskRequest,
  killGraceMs: number,
  emit: ((event: TBackgroundTaskRunnerEvent) => void) | undefined,
): IBackgroundTaskHandle {
  const shell = resolveShell(request);
  const wakeMatcher = createWakeMatcher(request, emit);
  const runtime: IProcessTaskRuntime = {
    taskId,
    request,
    child: spawn(shell.command, shell.args, {
      cwd: request.cwd,
      env: { ...process.env, ...(request.env ?? {}) },
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: SPAWN_DETACHED,
    }),
    logs: [],
    capture: createLimitedOutputCapture({
      limitBytes: request.outputLimitBytes ?? DEFAULT_OUTPUT_LIMIT_BYTES,
    }),
    killGraceMs,
    ...(wakeMatcher ? { wakeMatcher } : {}),
  };
  const result = createProcessResult(runtime);
  return createProcessHandle(runtime, result);
}

function createProcessResult(runtime: IProcessTaskRuntime): Promise<IBackgroundTaskResult> {
  let settled = false;
  return new Promise<IBackgroundTaskResult>((resolve, reject) => {
    const timeoutTimer = runtime.request.timeoutMs
      ? setTimeout(() => {
          appendPrefixedLogLines(
            runtime.logs,
            'system',
            `timed out after ${runtime.request.timeoutMs}ms`,
          );
          // CORE-023: escalate SIGTERM→grace→SIGKILL over the process group (reaps grandchildren)
          // instead of a bare SIGTERM. Fire-and-forget: reject the result now, escalate in background.
          void killProcessTree(runtime.child, {
            processGroup: SPAWN_DETACHED,
            graceMs: runtime.killGraceMs,
          });
          rejectOnceLocal(new BackgroundTaskError('timeout', 'Background process timed out'));
        }, runtime.request.timeoutMs)
      : undefined;

    function clearTimers(): void {
      if (timeoutTimer) clearTimeout(timeoutTimer);
    }

    function resolveOnce(exitCode: number | undefined, signalCode: string | undefined): void {
      if (settled) return;
      settled = true;
      clearTimers();
      resolve({
        taskId: runtime.taskId,
        kind: 'process',
        output: runtime.capture.getOutput(),
        exitCode,
        signalCode,
      });
    }

    function rejectOnceLocal(error: BackgroundTaskError): void {
      if (settled) return;
      settled = true;
      clearTimers();
      reject(error);
    }

    attachOutputListeners(runtime);
    runtime.child.on('error', (error) => {
      appendPrefixedLogLines(runtime.logs, 'system', error.message);
      rejectOnceLocal(new BackgroundTaskError('process', error.message));
    });
    runtime.child.on('close', (code, signal) => {
      resolveOnce(code ?? undefined, signal ?? undefined);
    });

    // RUNTIME-48: the initial write must have an error listener (an EPIPE here would otherwise
    // throw unhandled); sendInput attaches one and ends stdin. With no initial stdin we leave
    // the pipe OPEN — this runner streams interactive input via handle.send(); closing it here
    // would break processes (e.g. `cat`) that read stdin after start.
    if (runtime.request.stdin !== undefined) {
      sendInput(runtime.child, runtime.request.stdin).catch((error: Error) => {
        appendPrefixedLogLines(runtime.logs, 'system', `stdin write failed: ${error.message}`);
      });
    }
  });
}

function createProcessHandle(
  runtime: IProcessTaskRuntime,
  result: Promise<IBackgroundTaskResult>,
): IBackgroundTaskHandle {
  return {
    taskId: runtime.taskId,
    ...(runtime.child.pid !== undefined ? { pid: runtime.child.pid } : {}),
    result,
    cancel: async (reason?: string) => {
      await cancelProcess(runtime, reason);
    },
    send: async (input: IBackgroundTaskInput) => {
      if (!input.stdin) return;
      await sendInput(runtime.child, input.stdin);
    },
    readLog: (cursor?: IBackgroundTaskLogCursor) =>
      Promise.resolve(readProcessLog(runtime, cursor)),
  };
}

function attachOutputListeners(runtime: IProcessTaskRuntime): void {
  runtime.child.stdout.on('data', (chunk: Buffer) => {
    const text = chunk.toString('utf8');
    runtime.capture.appendOutput(text);
    appendPrefixedLogLines(runtime.logs, 'stdout', text);
    runtime.wakeMatcher?.push(text);
  });
  runtime.child.stderr.on('data', (chunk: Buffer) => {
    const text = chunk.toString('utf8');
    runtime.capture.appendOutput(text);
    appendPrefixedLogLines(runtime.logs, 'stderr', text);
    runtime.wakeMatcher?.push(text);
  });
}

async function cancelProcess(runtime: IProcessTaskRuntime, reason?: string): Promise<void> {
  appendPrefixedLogLines(
    runtime.logs,
    'system',
    reason ? `cancel requested: ${reason}` : 'cancel requested',
  );
  // CORE-023: SIGTERM→grace→SIGKILL over the process group, settling on the real exit event —
  // replaces the `child.killed` dead-guard (which only means "a signal was delivered", not
  // "process is dead"). Awaiting means the handle's cancel() resolves once the tree is truly gone.
  await killProcessTree(runtime.child, {
    processGroup: SPAWN_DETACHED,
    graceMs: runtime.killGraceMs,
  });
}

function readProcessLog(
  runtime: IProcessTaskRuntime,
  cursor?: IBackgroundTaskLogCursor,
): IBackgroundTaskLogPage {
  return createBackgroundTaskLogPage(runtime.taskId, runtime.logs, cursor);
}
