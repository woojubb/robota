import type { IRuntimeWorkerLoopPort } from '@robota-sdk/dag-api';

export interface IWorkerLoopDriverLogger {
  info(msg: string): void;
  error(msg: string, err?: unknown): void;
}

const MIN_IDLE_DELAY_MS = 25;
const MAX_IDLE_DELAY_MS = 500;

/**
 * Drives the DAG worker loop in the background with exponential idle backoff.
 * Timers are unref'd to prevent process hang.
 */
export class WorkerLoopDriver {
  private state: 'idle' | 'running' | 'stopping' = 'idle';
  private loopPromise: Promise<void> | null = null;
  private abort = new AbortController();

  constructor(
    private readonly workerLoop: IRuntimeWorkerLoopPort,
    private readonly logger?: IWorkerLoopDriverLogger,
  ) {}

  async start(): Promise<void> {
    if (this.state !== 'idle') return;
    this.state = 'running';
    this.abort = new AbortController();
    this.loopPromise = this.runLoop(this.abort.signal);
  }

  async stop(): Promise<void> {
    if (this.state === 'idle') return;
    this.state = 'stopping';
    this.abort.abort();
    await this.loopPromise?.catch(() => undefined);
    this.state = 'idle';
    this.loopPromise = null;
  }

  private async runLoop(signal: AbortSignal): Promise<void> {
    let delay = MIN_IDLE_DELAY_MS;
    while (!signal.aborted) {
      const result = await this.workerLoop.processOnce();
      if (!result.ok) {
        this.logger?.error('worker-loop iteration failed', result.error);
        await this.sleep(MAX_IDLE_DELAY_MS, signal);
        continue;
      }
      if (result.value.processed) {
        delay = MIN_IDLE_DELAY_MS;
        continue;
      }
      delay = Math.min(delay * 2, MAX_IDLE_DELAY_MS);
      await this.sleep(delay, signal);
    }
  }

  private sleep(ms: number, signal: AbortSignal): Promise<void> {
    return new Promise((resolve) => {
      const t = setTimeout(resolve, ms);
      if (typeof (t as NodeJS.Timeout).unref === 'function') {
        (t as NodeJS.Timeout).unref();
      }
      signal.addEventListener(
        'abort',
        () => {
          clearTimeout(t);
          resolve();
        },
        { once: true },
      );
    });
  }
}
