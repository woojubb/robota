import type { TSessionEndReason } from '@robota-sdk/agent-core';

export interface ITuiChannelShutdownRequest {
  reason: TSessionEndReason;
  message: string;
}

export interface ITuiChannelLifecycleOperations {
  start(): Promise<void>;
  stop(): Promise<void>;
  beginShutdown(): void;
  shutdownSession(request: ITuiChannelShutdownRequest): Promise<void>;
}

/** Marks a startup failure whose rollback also failed, so retrying cannot duplicate live resources. */
export class TuiChannelStartRollbackError extends AggregateError {}

/** Owns channel lifecycle transitions and bounds SDK shutdown without owning presentation state. */
export class TuiChannelLifecycleCoordinator {
  private started = false;
  private startPromise: Promise<void> | undefined;
  private teardownBegun = false;
  private stopped = false;
  private shuttingDown = false;
  private shutdownPromise: Promise<void> | undefined;
  private stopPromise: Promise<void> | undefined;

  constructor(
    private readonly operations: ITuiChannelLifecycleOperations,
    private readonly defaultShutdownTimeoutMs: number,
  ) {}

  get isShuttingDown(): boolean {
    return this.shuttingDown;
  }

  async start(): Promise<void> {
    if (this.teardownBegun) {
      throw new Error('Cannot start a channel after teardown has begun.');
    }
    if (this.started) return;
    const pendingStart = (this.startPromise ??= this.operations.start());
    try {
      await pendingStart;
      this.started = true;
    } catch (error) {
      if (error instanceof TuiChannelStartRollbackError) this.teardownBegun = true;
      throw error;
    } finally {
      if (this.startPromise === pendingStart) this.startPromise = undefined;
    }
  }

  async stop(): Promise<void> {
    this.teardownBegun = true;
    if (this.stopped) return;
    this.stopPromise ??= this.performStop();
    try {
      await this.stopPromise;
    } catch (error) {
      // A failed teardown is retryable; claiming stopped here would strand owned resources.
      this.stopPromise = undefined;
      throw error;
    }
  }

  private async performStop(): Promise<void> {
    const pendingStart = this.startPromise;
    let startError: Error | undefined;
    if (pendingStart !== undefined) {
      try {
        await pendingStart;
      } catch (cause) {
        startError = cause instanceof Error ? cause : new Error(String(cause));
      }
    }
    let stopError: Error | undefined;
    try {
      await this.operations.stop();
    } catch (error) {
      stopError = error instanceof Error ? error : new Error(String(error));
    }
    this.shutdownPromise ??= this.shutdownSessionBounded(
      { reason: 'other', message: 'channel stopped' },
      this.defaultShutdownTimeoutMs,
    );
    await this.shutdownPromise;
    if (stopError !== undefined && startError !== undefined) {
      throw new AggregateError(
        [startError, stopError],
        'TUI channel start and teardown both failed.',
      );
    }
    if (stopError !== undefined) throw stopError;
    this.started = false;
    this.stopped = true;
    if (startError !== undefined) throw startError;
  }

  async shutdown(options?: { reason?: TSessionEndReason; timeoutMs?: number }): Promise<void> {
    this.teardownBegun = true;
    if (!this.shuttingDown) {
      this.shuttingDown = true;
      this.operations.beginShutdown();
    }
    const pendingStop = this.stopPromise;
    if (pendingStop !== undefined) {
      await pendingStop.catch(() => undefined); // allow-fallback: the stop caller owns teardown failure
      return;
    }
    this.shutdownPromise ??= this.performShutdown(options);
    await this.shutdownPromise;
  }

  private async performShutdown(options?: {
    reason?: TSessionEndReason;
    timeoutMs?: number;
  }): Promise<void> {
    const pendingStart = this.startPromise;
    if (pendingStart !== undefined) {
      await pendingStart.catch(() => undefined); // allow-fallback: the start caller owns startup failure
    }
    await this.shutdownSessionBounded(
      { reason: options?.reason ?? 'prompt_input_exit', message: 'CLI shutdown' },
      options?.timeoutMs ?? this.defaultShutdownTimeoutMs,
    );
  }

  private async shutdownSessionBounded(
    request: ITuiChannelShutdownRequest,
    timeoutMs: number,
  ): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, timeoutMs);
      timer.unref?.();
    });
    await Promise.race([
      this.operations.shutdownSession(request).catch(() => undefined), // allow-fallback: shutdown is best-effort during process exit and remains timeout-bounded
      timeout,
    ]);
    if (timer) clearTimeout(timer);
  }
}
