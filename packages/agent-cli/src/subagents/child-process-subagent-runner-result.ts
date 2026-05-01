import {
  BackgroundTaskError,
  type ISubagentJobResult,
  type ISubagentJobStart,
} from '@robota-sdk/agent-sdk';
import {
  isSubagentWorkerChildMessage,
  type ISubagentWorkerStartPayload,
  type TSubagentWorkerWireValue,
} from './child-process-subagent-ipc.js';
import {
  cancelChildProcess,
  handleWorkerMessage,
  sendWorkerMessage,
  type IChildProcessRuntime,
} from './child-process-subagent-transport.js';

export interface ICancellationResult {
  promise: Promise<ISubagentJobResult>;
  reject(reason?: string): void;
}

export interface IChildProcessSubagentResultOptions {
  runtime: IChildProcessRuntime;
  payload: ISubagentWorkerStartPayload;
  resolveTranscriptPath: (job: ISubagentJobStart) => string | undefined;
}

export function createChildProcessSubagentResult(
  options: IChildProcessSubagentResultOptions,
): Promise<ISubagentJobResult> {
  return new Promise<ISubagentJobResult>((resolve, reject) => {
    new ChildProcessSubagentResultController(options, resolve, reject).start();
  });
}

class ChildProcessSubagentResultController {
  private settled = false;
  private started = false;
  private readonly timeoutTimer?: ReturnType<typeof setTimeout>;

  constructor(
    private readonly options: IChildProcessSubagentResultOptions,
    private readonly resolve: (result: ISubagentJobResult) => void,
    private readonly reject: (error: Error) => void,
  ) {
    this.timeoutTimer = createTimeoutTimer(this.options.runtime, (error) => this.rejectOnce(error));
  }

  start(): void {
    const { child } = this.options.runtime;
    child.on('message', this.onMessage);
    child.on('error', this.onError);
    child.on('exit', this.onExit);
    child.once('spawn', () => {
      setImmediate(this.startWorker);
    });
  }

  private readonly startWorker = (): void => {
    if (this.started) return;
    this.started = true;
    const { child } = this.options.runtime;
    void sendWorkerMessage(child, { type: 'start', payload: this.options.payload }).catch(
      (error) => {
        this.rejectOnce(error instanceof Error ? error : new Error(String(error)));
      },
    );
  };

  private readonly onMessage = (message: TSubagentWorkerWireValue): void => {
    if (!isSubagentWorkerChildMessage(message)) {
      this.rejectOnce(
        new BackgroundTaskError('runner', 'Received malformed subagent worker message'),
      );
      return;
    }
    const { job } = this.options.runtime;
    handleWorkerMessage(message, this.startWorker, this.resolveOnce, this.rejectOnce, job.emit);
  };

  private readonly onError = (error: Error): void => {
    this.rejectOnce(new BackgroundTaskError('crash', error.message));
  };

  private readonly onExit = (code: number | null, signal: NodeJS.Signals | null): void => {
    if (this.settled) return;
    this.rejectOnce(new BackgroundTaskError('crash', formatEarlyExitMessage(code, signal)));
  };

  private readonly resolveOnce = (output: string): void => {
    if (this.settled) return;
    this.settled = true;
    this.clearTimers();
    this.cleanup();
    const { runtime, resolveTranscriptPath } = this.options;
    this.resolve(toSubagentResult(runtime.job, output, resolveTranscriptPath));
  };

  private readonly rejectOnce = (error: Error): void => {
    if (this.settled) return;
    this.settled = true;
    this.clearTimers();
    this.cleanup();
    this.reject(error);
  };

  private clearTimers(): void {
    if (this.timeoutTimer) clearTimeout(this.timeoutTimer);
    if (this.options.runtime.killTimer) clearTimeout(this.options.runtime.killTimer);
  }

  private cleanup(): void {
    const { child } = this.options.runtime;
    child.off('message', this.onMessage);
    child.off('error', this.onError);
    child.off('exit', this.onExit);
  }
}

export function createCancellationResult(jobId: string): ICancellationResult {
  let settled = false;
  let rejectFn: (error: Error) => void = () => {};
  const promise = new Promise<ISubagentJobResult>((_resolve, reject) => {
    rejectFn = reject;
  });
  return {
    promise,
    reject(reason?: string): void {
      if (settled) return;
      settled = true;
      rejectFn(new BackgroundTaskError('runner', reason ?? `Subagent job cancelled: ${jobId}`));
    },
  };
}

function createTimeoutTimer(
  runtime: IChildProcessRuntime,
  rejectOnce: (error: Error) => void,
): ReturnType<typeof setTimeout> | undefined {
  if (!runtime.job.request.timeoutMs) return undefined;
  return setTimeout(() => {
    void cancelChildProcess(runtime, 'Subagent worker timed out');
    rejectOnce(new BackgroundTaskError('timeout', 'Subagent worker timed out'));
  }, runtime.job.request.timeoutMs);
}

function toSubagentResult(
  job: ISubagentJobStart,
  output: string,
  resolveTranscriptPath: (job: ISubagentJobStart) => string | undefined,
): ISubagentJobResult {
  const transcriptPath = resolveTranscriptPath(job);
  return {
    jobId: job.jobId,
    output,
    ...(transcriptPath ? { metadata: { transcriptPath, logPath: transcriptPath } } : {}),
  };
}

function formatEarlyExitMessage(code: number | null, signal: NodeJS.Signals | null): string {
  const detail =
    signal !== null ? `signal ${signal}` : `exit code ${code === null ? 'unknown' : code}`;
  return `Subagent worker exited before result: ${detail}`;
}
