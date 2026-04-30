import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
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
} from '@robota-sdk/agent-sdk';

const DEFAULT_OUTPUT_LIMIT_BYTES = 30_000;
const DEFAULT_KILL_GRACE_MS = 2_000;
const LOG_PAGE_SIZE = 200;

export interface IManagedShellProcessRunnerOptions {
  killGraceMs?: number;
}

interface IProcessCapture {
  appendOutput(text: string): void;
  getOutput(): string;
}

interface IProcessTaskRuntime {
  taskId: string;
  request: IProcessBackgroundTaskRequest;
  child: ChildProcessWithoutNullStreams;
  logs: string[];
  capture: IProcessCapture;
  killGraceMs: number;
  killTimer?: ReturnType<typeof setTimeout>;
}

function createCapture(limitBytes: number): IProcessCapture {
  const chunks: string[] = [];
  let capturedBytes = 0;
  let truncated = false;

  return {
    appendOutput(text: string): void {
      if (truncated) return;
      const remaining = limitBytes - capturedBytes;
      const buffer = Buffer.from(text, 'utf8');
      if (buffer.byteLength <= remaining) {
        chunks.push(text);
        capturedBytes += buffer.byteLength;
        return;
      }
      chunks.push(buffer.subarray(0, Math.max(remaining, 0)).toString('utf8'));
      chunks.push('\n[output truncated]\n');
      truncated = true;
    },
    getOutput(): string {
      return chunks.join('');
    },
  };
}

function appendLog(lines: string[], source: string, text: string): void {
  for (const line of text.split(/\r?\n/)) {
    if (line.length > 0) lines.push(`[${source}] ${line}`);
  }
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
      return startProcessTask(task.taskId, task.request, killGraceMs);
    },
  };
}

function startProcessTask(
  taskId: string,
  request: IProcessBackgroundTaskRequest,
  killGraceMs: number,
): IBackgroundTaskHandle {
  const shell = resolveShell(request);
  const runtime: IProcessTaskRuntime = {
    taskId,
    request,
    child: spawn(shell.command, shell.args, {
      cwd: request.cwd,
      env: { ...process.env, ...(request.env ?? {}) },
      stdio: ['pipe', 'pipe', 'pipe'],
    }),
    logs: [],
    capture: createCapture(request.outputLimitBytes ?? DEFAULT_OUTPUT_LIMIT_BYTES),
    killGraceMs,
  };
  const result = createProcessResult(runtime);
  return createProcessHandle(runtime, result);
}

function createProcessResult(runtime: IProcessTaskRuntime): Promise<IBackgroundTaskResult> {
  let settled = false;
  return new Promise<IBackgroundTaskResult>((resolve, reject) => {
    const timeoutTimer = runtime.request.timeoutMs
      ? setTimeout(() => {
          appendLog(runtime.logs, 'system', `timed out after ${runtime.request.timeoutMs}ms`);
          runtime.child.kill('SIGTERM');
          rejectOnceLocal(new BackgroundTaskError('timeout', 'Background process timed out'));
        }, runtime.request.timeoutMs)
      : undefined;

    function clearTimers(): void {
      if (timeoutTimer) clearTimeout(timeoutTimer);
      if (runtime.killTimer) clearTimeout(runtime.killTimer);
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
      appendLog(runtime.logs, 'system', error.message);
      rejectOnceLocal(new BackgroundTaskError('process', error.message));
    });
    runtime.child.on('close', (code, signal) => {
      resolveOnce(code ?? undefined, signal ?? undefined);
    });

    if (runtime.request.stdin) {
      runtime.child.stdin.write(runtime.request.stdin);
      runtime.child.stdin.end();
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
      cancelProcess(runtime, reason);
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
    appendLog(runtime.logs, 'stdout', text);
  });
  runtime.child.stderr.on('data', (chunk: Buffer) => {
    const text = chunk.toString('utf8');
    runtime.capture.appendOutput(text);
    appendLog(runtime.logs, 'stderr', text);
  });
}

function cancelProcess(runtime: IProcessTaskRuntime, reason?: string): void {
  appendLog(runtime.logs, 'system', reason ? `cancel requested: ${reason}` : 'cancel requested');
  if (!runtime.child.killed) runtime.child.kill('SIGTERM');
  runtime.killTimer = setTimeout(() => {
    if (!runtime.child.killed) runtime.child.kill('SIGKILL');
  }, runtime.killGraceMs);
}

function readProcessLog(
  runtime: IProcessTaskRuntime,
  cursor?: IBackgroundTaskLogCursor,
): IBackgroundTaskLogPage {
  const offset = cursor?.offset ?? 0;
  const nextOffset = Math.min(offset + LOG_PAGE_SIZE, runtime.logs.length);
  return {
    taskId: runtime.taskId,
    cursor,
    nextCursor: nextOffset < runtime.logs.length ? { offset: nextOffset } : undefined,
    lines: runtime.logs.slice(offset, nextOffset),
  };
}
