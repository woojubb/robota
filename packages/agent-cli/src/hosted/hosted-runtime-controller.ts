import { admitHostedRuntime } from './hosted-runtime-admission.js';
import { hostedAdmissionError } from './hosted-runtime-config.js';

import type {
  IHostedAdmission,
  IHostedAdmissionOptions,
  IHostedRuntimeExecutor,
  IHostedRuntimeUsage,
} from './hosted-runtime-types.js';

export interface IHostedRuntimeControllerOptions extends IHostedAdmissionOptions {
  /** Own partial allocations until return; rejection must release them or report unresolved cleanup. */
  readonly createExecutor: (
    admission: IHostedAdmission,
    signal: AbortSignal,
  ) => Promise<IHostedRuntimeExecutor>;
}

export type THostedRuntimeState =
  'idle' | 'admitting' | 'running' | 'stopping' | 'stopped' | 'failed';

export class HostedRuntimeController {
  private state: THostedRuntimeState = 'idle';
  private executor?: IHostedRuntimeExecutor;
  private provisioning?: Promise<IHostedRuntimeExecutor>;
  private abort?: AbortController;
  private stopping?: Promise<void>;
  private limits?: IHostedRuntimeUsage;
  private usage: IHostedRuntimeUsage = {
    sessions: 0,
    modelCalls: 0,
    modelTokens: 0,
    costMicros: 0,
  };

  constructor(private readonly options: IHostedRuntimeControllerOptions) {}

  status(): { state: THostedRuntimeState; usage: IHostedRuntimeUsage } {
    return { state: this.state, usage: { ...this.usage } };
  }

  private observe(usage: IHostedRuntimeUsage): void {
    for (const key of ['sessions', 'modelCalls', 'modelTokens', 'costMicros'] as const) {
      if (!Number.isSafeInteger(usage[key]) || usage[key] < this.usage[key]) {
        throw hostedAdmissionError('runtime usage observation is invalid or moved backward');
      }
    }
    this.usage = Object.freeze({
      sessions: usage.sessions,
      modelCalls: usage.modelCalls,
      modelTokens: usage.modelTokens,
      costMicros: usage.costMicros,
    });
    if (this.limits !== undefined &&
      Object.entries(this.limits).some(([key, limit]) => usage[key as keyof IHostedRuntimeUsage] > limit))
      throw hostedAdmissionError('runtime usage limit exhausted');
  }

  async run(): Promise<void> {
    if (this.state !== 'idle')
      throw hostedAdmissionError('controller cannot reuse an admitted execution');
    this.state = 'admitting';
    const abort = new AbortController();
    this.abort = abort;
    const externalStop = (): void => {
      void this.stop('supervisor stopped the runtime').catch(() => undefined);
    };
    this.options.signal?.addEventListener('abort', externalStop, { once: true });
    let refresh: ReturnType<typeof setInterval> | undefined;
    let refreshWork: Promise<void> | undefined;
    let deadline: ReturnType<typeof setTimeout> | undefined;
    let expiry: ReturnType<typeof setTimeout> | undefined;
    let removeAbort: (() => void) | undefined;
    let admission: IHostedAdmission | undefined;
    let failure: unknown;
    let failed = false;
    try {
      if (this.options.signal?.aborted)
        abort.abort(hostedAdmissionError('supervisor stopped the runtime'));
      admission = await admitHostedRuntime({ ...this.options, signal: abort.signal });
      if (admission === undefined) throw hostedAdmissionError('controller requires hosted posture');
      this.limits = admission.config.limits;
      this.observe(admission.broker.usage!);
      abort.signal.throwIfAborted();
      const admittedConfig = JSON.stringify(admission.config);
      const now = this.options.now ?? Date.now;
      const fail = (reason: string): void => {
        void this.stop(reason).catch(() => undefined);
      };
      const armExpiry = (at: number): void => {
        if (expiry !== undefined) clearTimeout(expiry);
        const remaining = at - now();
        if (remaining <= 0) {
          fail('admission expired');
          return;
        }
        expiry = setTimeout(() => fail('admission expired'), remaining);
      };
      armExpiry(admission.expiresAt);
      deadline = setTimeout(() => fail('runtime lifetime exhausted'), admission.config.lifetimeMs);
      const stopped = new Promise<never>((_resolve, reject) => {
        const onAbort = (): void => reject(abort.signal.reason as Error);
        removeAbort = () => abort.signal.removeEventListener('abort', onAbort);
        if (abort.signal.aborted) onAbort();
        else abort.signal.addEventListener('abort', onAbort, { once: true });
      });
      const initialAdmission = admission;
      this.provisioning = Promise.resolve().then(() => {
        abort.signal.throwIfAborted();
        return this.options.createExecutor(initialAdmission, abort.signal);
      });
      this.executor = await Promise.race([this.provisioning, stopped]);
      abort.signal.throwIfAborted();
      this.state = 'running';
      refresh = setInterval(
        () => {
          if (refreshWork !== undefined || abort.signal.aborted) return;
          refreshWork = admitHostedRuntime({ ...this.options, signal: abort.signal })
            .then((next) => {
              if (abort.signal.aborted) return;
              if (next === undefined || JSON.stringify(next.config) !== admittedConfig) {
                fail('deployment identity or policy changed; a fresh admission is required');
                return;
              }
              try {
                this.observe(next.broker.usage!);
              } catch {
                fail('broker accounting moved backward or runtime usage limit exhausted');
                return;
              }
              armExpiry(next.expiresAt);
            })
            .catch(() => fail('mandatory worker or broker admission was lost'))
            .finally(() => {
              refreshWork = undefined;
            });
        },
        Math.max(10, Math.min(5000, Math.floor((admission.expiresAt - now()) / 2))),
      );
      await Promise.race([
        this.executor.run(admission, {
          signal: abort.signal,
          observe: (usage) => this.observe(usage),
        }),
        stopped,
      ]);
      // Settle a refresh before collecting the final accounting for short executions.
      if (refresh !== undefined) clearInterval(refresh);
      refresh = undefined;
      await refreshWork;
      abort.signal.throwIfAborted();
      const finalAdmission = await admitHostedRuntime({ ...this.options, signal: abort.signal });
      if (finalAdmission === undefined || JSON.stringify(finalAdmission.config) !== admittedConfig)
        throw hostedAdmissionError('deployment identity or policy changed before final accounting');
      this.observe(finalAdmission.broker.usage!);
    } catch (error) {
      this.state = 'failed';
      failure = error;
      failed = true;
    } finally {
      if (refresh !== undefined) clearInterval(refresh);
      if (deadline !== undefined) clearTimeout(deadline);
      if (expiry !== undefined) clearTimeout(expiry);
      removeAbort?.();
      this.options.signal?.removeEventListener('abort', externalStop);
      try {
        await this.stop(failed ? 'runtime failed' : 'runtime completed');
        this.state = failed ? 'failed' : 'stopped';
      } catch (error) {
        this.state = 'failed';
        failure = error;
        failed = true;
      }
    }
    if (failed) throw failure;
  }

  /** Restart constructs a fresh controller and revalidates current identity, epoch and snapshot. */
  async restart(options: IHostedRuntimeControllerOptions): Promise<HostedRuntimeController> {
    await this.stop('runtime restart');
    return new HostedRuntimeController(options);
  }

  stop(reason: string): Promise<void> {
    if (this.stopping !== undefined) return this.stopping;
    if (this.state !== 'failed') this.state = 'stopping';
    this.abort?.abort(hostedAdmissionError(reason));
    this.stopping = this.cleanup(reason);
    return this.stopping;
  }

  private async cleanup(reason: string): Promise<void> {
    let executor = this.executor;
    if (executor === undefined && this.provisioning !== undefined) {
      const pending = this.provisioning;
      // A factory retains ownership of partial allocations until it returns an executor.
      try {
        executor = await this.boundedCleanup(() => pending.catch(() => undefined));
      } catch {
        // A late result remains owned. Timeout is a failure, never evidence of provider cleanup.
        void pending.then((late) => this.cleanupExecutor(late, reason)).catch(() => undefined);
        throw hostedAdmissionError('runtime resource cleanup failed');
      }
    }
    if (executor === undefined) return;
    await this.cleanupExecutor(executor, reason);
  }

  private async cleanupExecutor(executor: IHostedRuntimeExecutor, reason: string): Promise<void> {
    const failures: unknown[] = [];
    try {
      await this.boundedCleanup(() => executor.stop(reason));
    } catch (error) {
      failures.push(error);
    }
    try {
      await this.boundedCleanup(() => executor.release());
    } catch (error) {
      failures.push(error);
    }
    if (failures.length > 0) throw hostedAdmissionError('runtime resource cleanup failed');
  }

  private async boundedCleanup<T>(operation: () => Promise<T>): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        Promise.resolve().then(operation),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(
            () => reject(hostedAdmissionError('resource teardown timed out')),
            5000,
          );
        }),
      ]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }
}
