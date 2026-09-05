import { isTransportRunOutcome } from '@robota-sdk/agent-interface-transport';

import type { IInteractiveSession } from '@robota-sdk/agent-interface-session';
import type {
  ITransportCompletionRecord,
  ITransportFailureRecord,
  ITransportLifecycleError,
  ITransportRunnerAdapter,
  TTransportAbandonmentReason,
} from '@robota-sdk/agent-interface-transport';

interface IDeferred<T> {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
  readonly reject: (error: unknown) => void;
}

function deferred<T>(): IDeferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function lifecycleError(transportName: string, cause: unknown): ITransportLifecycleError {
  const error = Object.assign(new Error(`Runner ${transportName} rejected.`), {
    name: 'TransportLifecycleError' as const,
    code: 'runner-rejected' as const,
    transportName,
  });
  Object.defineProperty(error, 'cause', { value: cause, enumerable: false });
  return error;
}

export class TransportRunGeneration {
  private readonly orderedNames: string[];
  private readonly records = new Map<string, ITransportCompletionRecord>();
  private readonly completion = deferred<ITransportCompletionRecord[]>();
  private readonly failure = deferred<ITransportFailureRecord | undefined>();
  private pending: number;
  private active = true;
  private sealed = false;
  private settled = false;
  private failureSettled = false;
  stopRequested = false;

  constructor(orderedNames: string[]) {
    this.orderedNames = orderedNames;
    this.pending = orderedNames.length;
    void this.completion.promise.catch(() => undefined);
    void this.failure.promise.catch(() => undefined);
  }

  waitForCompletion(): Promise<ITransportCompletionRecord[]> {
    return this.completion.promise;
  }

  waitForFailure(): Promise<ITransportFailureRecord | undefined> {
    return this.failure.promise;
  }

  track(runner: ITransportRunnerAdapter<IInteractiveSession>): void {
    void runner.waitForCompletion().then(
      (outcome) => this.acceptOutcome(runner.name, outcome),
      (cause: unknown) => this.rejectRunner(runner.name, cause),
    );
  }

  seal(): void {
    this.sealed = true;
    if (this.pending === 0) {
      this.settleCompletion();
      this.settleFailure(undefined);
    }
  }

  abandon(reason: TTransportAbandonmentReason): void {
    this.active = false;
    if (this.settled) return;
    for (const name of this.orderedNames) {
      if (!this.records.has(name)) {
        this.records.set(name, { name, outcome: { status: 'abandoned', reason } });
      }
    }
    this.pending = 0;
    this.settleCompletion();
    this.settleFailure(undefined);
  }

  private acceptOutcome(
    name: string,
    outcome: Awaited<ReturnType<ITransportRunnerAdapter['waitForCompletion']>>,
  ): void {
    if (!this.active) return;
    if (!isTransportRunOutcome(outcome)) {
      this.rejectRunner(name, new TypeError('Invalid runner outcome.'));
      return;
    }
    const record = { name, outcome } satisfies ITransportCompletionRecord;
    this.records.set(name, record);
    this.pending -= 1;
    if (outcome.status === 'failed') this.settleFailure({ name, outcome });
    if (this.sealed && this.pending === 0) {
      this.settleCompletion();
      this.settleFailure(undefined);
    }
  }

  private rejectRunner(name: string, cause: unknown): void {
    if (!this.active) return;
    const error = lifecycleError(name, cause);
    this.active = false;
    this.completion.reject(error);
    this.failure.reject(error);
    this.settled = true;
    this.failureSettled = true;
  }

  private settleCompletion(): void {
    if (this.settled) return;
    this.settled = true;
    this.completion.resolve(
      this.orderedNames.flatMap((name) => {
        const record = this.records.get(name);
        return record ? [record] : [];
      }),
    );
  }

  private settleFailure(record: ITransportFailureRecord | undefined): void {
    if (this.failureSettled) return;
    this.failureSettled = true;
    this.failure.resolve(record);
  }
}
