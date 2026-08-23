import { BackgroundTaskError, type ISubagentJobStart } from '@robota-sdk/agent-executor';

import {
  isSubagentWorkerChildMessage,
  type ISubagentWorkerResultMessage,
  type ISubagentWorkerStartPayload,
  type TSubagentWorkerWireValue,
} from './child-process-subagent-ipc.js';
import {
  cancelChildProcess,
  handleWorkerMessage,
  readChildStderrTail,
  sendWorkerMessage,
  type IChildProcessRuntime,
} from './child-process-subagent-transport.js';

import type { ISubagentJobResult } from '@robota-sdk/agent-interface-execution';

/**
 * DIST-006: how long a spawned worker may take to say anything at all. Generous — it covers process
 * start plus module load of a bundled CLI — but finite, because the alternative is a silent hang.
 */
const DEFAULT_HANDSHAKE_BUDGET_MS = 30_000;

export interface ICancellationResult {
  promise: Promise<ISubagentJobResult>;
  reject(reason?: string): void;
}

export interface IChildProcessSubagentResultOptions {
  runtime: IChildProcessRuntime;
  /** How long the worker may take to say anything. Injectable so a test can reach this branch. */
  handshakeBudgetMs?: number;
  /**
   * ARCH-033: a PROMISE, because part of the payload cannot be known synchronously — projecting the
   * parent's sandbox means asking it for a snapshot, and `snapshot()` is async. `start()` must stay
   * synchronous (it returns a handle the caller cancels), so the await happens HERE, between the
   * child saying `ready` and the parent sending `start`, which is the one point where waiting costs
   * nothing that was not already being waited for.
   */
  payload: Promise<ISubagentWorkerStartPayload>;
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
  private ready = false;
  private readonly timeoutTimer?: ReturnType<typeof setTimeout>;
  private readonly handshakeTimer: ReturnType<typeof setTimeout>;
  private readonly handshakeBudgetMs: number;
  /** The start payload, or `undefined` when building it failed and the job was already rejected. */
  private readonly payload: Promise<ISubagentWorkerStartPayload | undefined>;

  constructor(
    private readonly options: IChildProcessSubagentResultOptions,
    private readonly resolve: (result: ISubagentJobResult) => void,
    private readonly reject: (error: Error) => void,
  ) {
    // `?? DEFAULT` would turn `0` — the plausible spelling of "no deadline" — into a timer that
    // rejects every job on the next tick. A non-positive budget is not a way to opt out.
    const budget = options.handshakeBudgetMs;
    this.handshakeBudgetMs =
      budget !== undefined && budget > 0 ? budget : DEFAULT_HANDSHAKE_BUDGET_MS;
    // ARCH-033: the payload's failure handler is attached HERE, not in `startWorker`, which may be
    // several ticks away — the child has to say `ready` first. A payload that cannot be BUILT (a
    // sandbox whose `snapshot()` throws) fails the job either way, but without this the rejection
    // surfaces as an unhandled one before anything consumed it. `undefined` means "already
    // reported": there is nothing left to send, and sending a partial payload would start a child
    // that looks sandboxed while sharing none of the parent's state.
    this.payload = options.payload.catch((error) => {
      this.rejectOnce(error instanceof Error ? error : new Error(String(error)));
      return undefined;
    });
    this.timeoutTimer = createTimeoutTimer(this.options.runtime, (error) => this.rejectOnce(error));
    // DIST-006: a worker that never answers must not hang the parent forever. The old seam failed
    // LOUDLY when the entry was wrong (`Cannot find module`, then exit); this one re-executes the
    // host artifact, so a caller who wires `workerEntry` to something that is not a robota entry
    // gets a second copy of their app with an IPC channel and no `ready` — and `request.timeoutMs`
    // is optional, so without this the wait is unbounded. Occurrence #3 self-reports either way.
    this.handshakeTimer = setTimeout(() => {
      if (this.ready || this.settled) return;
      void cancelChildProcess(this.options.runtime, 'Subagent worker never signalled ready');
      this.rejectOnce(
        new BackgroundTaskError(
          'runner',
          `Subagent worker never signalled ready within ${this.handshakeBudgetMs}ms. ` +
            'Its entry must dispatch worker mode before starting the host application.',
        ),
      );
    }, this.handshakeBudgetMs);
    this.handshakeTimer.unref?.();
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
    void this.payload
      .then((payload) =>
        payload === undefined ? undefined : sendWorkerMessage(child, { type: 'start', payload }),
      )
      .catch((error) => {
        this.rejectOnce(error instanceof Error ? error : new Error(String(error)));
      });
  };

  private readonly onMessage = (message: TSubagentWorkerWireValue): void => {
    if (!isSubagentWorkerChildMessage(message)) {
      this.rejectOnce(
        new BackgroundTaskError('runner', 'Received malformed subagent worker message'),
      );
      return;
    }
    // Any well-formed child message proves the entry reached worker mode.
    this.ready = true;
    clearTimeout(this.handshakeTimer);
    const { job } = this.options.runtime;
    handleWorkerMessage(message, this.startWorker, this.resolveOnce, this.rejectOnce, job.emit);
  };

  private readonly onError = (error: Error): void => {
    this.rejectOnce(new BackgroundTaskError('crash', error.message));
  };

  private readonly onExit = (code: number | null, signal: NodeJS.Signals | null): void => {
    if (this.settled) return;
    // DIST-006: read the tail here, at `'exit'`. Review proposed deferring to `'close'` on the
    // theory that the pipe has not drained yet; measured, that is not the mechanism. When a child
    // calls `process.exit()` its pending pipe writes are TRUNCATED, so the last line is never
    // written at all — lost 10/10 at `'close'` just as at `'exit'`. When a child ends naturally the
    // tail is already complete — present 40/40 at `'exit'` across 1k–400k lines. Waiting buys
    // nothing in either case, and a wait whose stated reason is false is worse than no wait.
    this.rejectOnce(
      new BackgroundTaskError(
        'crash',
        formatEarlyExitMessage(code, signal, readChildStderrTail(this.options.runtime.child)),
      ),
    );
  };

  private readonly resolveOnce = (result: ISubagentWorkerResultMessage): void => {
    if (this.settled) return;
    this.settled = true;
    this.clearTimers();
    this.cleanup();
    const { runtime, resolveTranscriptPath } = this.options;
    this.resolve(toSubagentResult(runtime.job, result, resolveTranscriptPath));
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
    clearTimeout(this.handshakeTimer);
  }

  private cleanup(): void {
    const { child } = this.options.runtime;
    child.off('message', this.onMessage);
    child.off('error', this.onError);
    child.off('exit', this.onExit);
  }
}

export function createCancellationResult(taskId: string): ICancellationResult {
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
      rejectFn(new BackgroundTaskError('runner', reason ?? `Subagent job cancelled: ${taskId}`));
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
  result: ISubagentWorkerResultMessage,
  resolveTranscriptPath: (job: ISubagentJobStart) => string | undefined,
): ISubagentJobResult {
  const transcriptPath = resolveTranscriptPath(job);
  return {
    taskId: job.taskId,
    output: result.output,
    ...(transcriptPath ? { metadata: { transcriptPath, logPath: transcriptPath } } : {}),
    // ANALYTICS-001 (Phase 2): carry the subagent's forwarded token usage so the background-task
    // tracker can attribute it to this agent as a source in the parent log.
    ...(result.usage ? { usage: result.usage } : {}),
  };
}

function formatEarlyExitMessage(
  code: number | null,
  signal: NodeJS.Signals | null,
  stderrTail: string,
): string {
  const detail =
    signal !== null ? `signal ${signal}` : `exit code ${code === null ? 'unknown' : code}`;
  // DIST-006: the exit code alone said nothing, so the previous occurrence of this defect had to be
  // diagnosed by hand. The child's own words are what make the next one self-reporting.
  const cause = stderrTail.length > 0 ? `: ${stderrTail}` : '';
  return `Subagent worker exited before result: ${detail}${cause}`;
}
