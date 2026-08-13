import { buildDispatchError } from '@robota-sdk/dag-core';

import type { IDagError, IDagRun, ITaskRun, TResult } from '@robota-sdk/dag-core';
import type { WorkerLoopService } from './worker-loop-service.js';

const MIN_IDLE_DELAY_MS = 25;
const MAX_IDLE_DELAY_MS = 500;

export interface IRunAdvancementSnapshot {
  readonly dagRun: IDagRun;
  readonly taskRuns: ITaskRun[];
}

export interface IRunAdvancementWaitOptions {
  /** Cancels only this terminal-state observation; it does not cancel the DAG run. */
  readonly signal?: AbortSignal;
  /** Absolute wall-clock deadline for this observer. */
  readonly deadlineEpochMs?: number;
}

export interface IRunAdvancementCoordinator {
  start(): Promise<void>;
  waitForTerminal(
    dagRunId: string,
    options?: IRunAdvancementWaitOptions,
  ): Promise<TResult<IRunAdvancementSnapshot, IDagError>>;
  stop(): Promise<void>;
}

export interface IRunAdvancementCoordinatorLogger {
  error(message: string, error?: unknown): void;
}

interface IRunReaderPort {
  getRun(dagRunId: string): Promise<TResult<IRunAdvancementSnapshot, IDagError>>;
}

interface IWaiter {
  readonly id: symbol;
  readonly dagRunId: string;
  readonly resolve: (result: TResult<IRunAdvancementSnapshot, IDagError>) => void;
  readonly signal?: AbortSignal;
  abortListener?: () => void;
  deadlineTimer?: ReturnType<typeof setTimeout>;
  settled: boolean;
}

export class RunAdvancementStoppedError extends Error {
  public constructor() {
    super('Run advancement has stopped and cannot be restarted.');
    this.name = 'RunAdvancementStoppedError';
  }
}

function isTerminal(status: IDagRun['status']): boolean {
  return status === 'success' || status === 'failed' || status === 'cancelled';
}

function observerError(code: string, message: string, dagRunId: string): IDagError {
  return buildDispatchError(code, message, { dagRunId });
}

/**
 * Owns the only worker-step actor for one worker/queue composition.
 * Persistent background demand and run-specific waiters wake the same actor promise.
 */
export class RunAdvancementCoordinator implements IRunAdvancementCoordinator {
  private lifecycle: 'created' | 'running' | 'stopping' | 'stopped' = 'created';
  private continuousDemand = false;
  private readonly waiters = new Map<symbol, IWaiter>();
  private actorPromise: Promise<void> | null = null;
  private stopPromise: Promise<void> | null = null;
  private wakeSleep: (() => void) | null = null;

  public constructor(
    private readonly workerStep: Pick<WorkerLoopService, 'processOnce'>,
    private readonly runReader: IRunReaderPort,
    private readonly logger: IRunAdvancementCoordinatorLogger = { error: () => undefined },
  ) {}

  public async start(): Promise<void> {
    if (this.lifecycle === 'stopping' || this.lifecycle === 'stopped') {
      throw new RunAdvancementStoppedError();
    }
    this.lifecycle = 'running';
    this.continuousDemand = true;
    this.wake();
    this.ensureActor();
  }

  public waitForTerminal(
    dagRunId: string,
    options: IRunAdvancementWaitOptions = {},
  ): Promise<TResult<IRunAdvancementSnapshot, IDagError>> {
    if (this.lifecycle === 'stopping' || this.lifecycle === 'stopped') {
      return Promise.resolve({
        ok: false,
        error: observerError(
          'DAG_RUNTIME_ADVANCEMENT_STOPPED',
          'Run advancement stopped before the observed run became terminal.',
          dagRunId,
        ),
      });
    }
    if (options.signal?.aborted) {
      return Promise.resolve({
        ok: false,
        error: observerError(
          'DAG_RUNTIME_ADVANCEMENT_WAIT_ABORTED',
          'Run terminal-state observation was aborted.',
          dagRunId,
        ),
      });
    }
    if (options.deadlineEpochMs !== undefined && options.deadlineEpochMs <= Date.now()) {
      return Promise.resolve({
        ok: false,
        error: observerError(
          'DAG_RUNTIME_ADVANCEMENT_WAIT_DEADLINE',
          'Run terminal-state observation exceeded its deadline.',
          dagRunId,
        ),
      });
    }

    const promise = new Promise<TResult<IRunAdvancementSnapshot, IDagError>>((resolve) => {
      const waiter: IWaiter = {
        id: Symbol(dagRunId),
        dagRunId,
        resolve,
        signal: options.signal,
        settled: false,
      };
      if (options.signal !== undefined) {
        waiter.abortListener = () => {
          this.settle(waiter, {
            ok: false,
            error: observerError(
              'DAG_RUNTIME_ADVANCEMENT_WAIT_ABORTED',
              'Run terminal-state observation was aborted.',
              dagRunId,
            ),
          });
        };
        options.signal.addEventListener('abort', waiter.abortListener, { once: true });
      }
      if (options.deadlineEpochMs !== undefined) {
        waiter.deadlineTimer = setTimeout(
          () => {
            this.settle(waiter, {
              ok: false,
              error: observerError(
                'DAG_RUNTIME_ADVANCEMENT_WAIT_DEADLINE',
                'Run terminal-state observation exceeded its deadline.',
                dagRunId,
              ),
            });
          },
          Math.max(0, options.deadlineEpochMs - Date.now()),
        );
        waiter.deadlineTimer.unref?.();
      }
      this.waiters.set(waiter.id, waiter);
    });

    this.wake();
    this.ensureActor();
    return promise;
  }

  public stop(): Promise<void> {
    if (this.stopPromise !== null) return this.stopPromise;
    this.lifecycle = 'stopping';
    this.continuousDemand = false;
    for (const waiter of [...this.waiters.values()]) {
      this.settle(waiter, {
        ok: false,
        error: observerError(
          'DAG_RUNTIME_ADVANCEMENT_STOPPED',
          'Run advancement stopped before the observed run became terminal.',
          waiter.dagRunId,
        ),
      });
    }
    this.wake();
    this.stopPromise = (async () => {
      await this.actorPromise;
      this.lifecycle = 'stopped';
    })();
    return this.stopPromise;
  }

  private hasDemand(): boolean {
    return (
      (this.lifecycle === 'created' || this.lifecycle === 'running') &&
      (this.continuousDemand || this.waiters.size > 0)
    );
  }

  private ensureActor(): void {
    if (!this.hasDemand() || this.actorPromise !== null) return;
    const owned = this.runActor()
      .catch((error: unknown) => {
        this.logger.error('Run advancement actor failed unexpectedly.', error);
      })
      .finally(() => {
        if (this.actorPromise === owned) this.actorPromise = null;
        if (this.hasDemand()) this.ensureActor();
      });
    this.actorPromise = owned;
  }

  private async runActor(): Promise<void> {
    let idleDelayMs = MIN_IDLE_DELAY_MS;
    while (this.hasDemand()) {
      await this.queryAndSettleWaiters();
      if (!this.hasDemand()) return;

      let step: Awaited<ReturnType<WorkerLoopService['processOnce']>>;
      try {
        step = await this.workerStep.processOnce();
      } catch (error) {
        this.logger.error('Worker step threw during run advancement.', error);
        await this.sleepUntilWake(MAX_IDLE_DELAY_MS);
        continue;
      }
      if (!this.hasDemand()) return;
      if (!step.ok) {
        this.logger.error('Worker step failed during run advancement.', step.error);
        await this.sleepUntilWake(MAX_IDLE_DELAY_MS);
        continue;
      }
      if (step.value.processed) {
        idleDelayMs = MIN_IDLE_DELAY_MS;
        continue;
      }
      await this.sleepUntilWake(idleDelayMs);
      idleDelayMs = Math.min(idleDelayMs * 2, MAX_IDLE_DELAY_MS);
    }
  }

  private async queryAndSettleWaiters(): Promise<void> {
    const runIds = new Set([...this.waiters.values()].map((waiter) => waiter.dagRunId));
    for (const dagRunId of runIds) {
      let result: TResult<IRunAdvancementSnapshot, IDagError>;
      try {
        result = await this.runReader.getRun(dagRunId);
      } catch (error) {
        result = {
          ok: false,
          error: observerError(
            'DAG_RUNTIME_ADVANCEMENT_QUERY_THROW',
            error instanceof Error ? error.message : String(error),
            dagRunId,
          ),
        };
      }
      const matching = [...this.waiters.values()].filter((waiter) => waiter.dagRunId === dagRunId);
      if (!result.ok || isTerminal(result.value.dagRun.status)) {
        for (const waiter of matching) this.settle(waiter, result);
      }
    }
  }

  private settle(waiter: IWaiter, result: TResult<IRunAdvancementSnapshot, IDagError>): void {
    if (waiter.settled) return;
    waiter.settled = true;
    this.waiters.delete(waiter.id);
    if (waiter.deadlineTimer !== undefined) clearTimeout(waiter.deadlineTimer);
    if (waiter.signal !== undefined && waiter.abortListener !== undefined) {
      waiter.signal.removeEventListener('abort', waiter.abortListener);
    }
    waiter.resolve(result);
    this.wake();
  }

  private wake(): void {
    this.wakeSleep?.();
  }

  private async sleepUntilWake(delayMs: number): Promise<void> {
    if (!this.hasDemand()) return;
    await new Promise<void>((resolve) => {
      let finished = false;
      const finish = (): void => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        if (this.wakeSleep === finish) this.wakeSleep = null;
        resolve();
      };
      const timer = setTimeout(finish, delayMs);
      timer.unref?.();
      this.wakeSleep = finish;
      if (!this.hasDemand()) finish();
    });
  }
}
