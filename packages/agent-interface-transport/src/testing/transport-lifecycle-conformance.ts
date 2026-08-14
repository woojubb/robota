import type {
  ITransportAdapter,
  ITransportLifecycleError,
  ITransportRunnerAdapter,
  TTransportLifecycleKind,
} from '../transport-adapter.js';

const DEFAULT_LIFECYCLE_TIMEOUT_MS = 5000;

export interface ITransportLifecycleConformanceFixture<
  TSession,
  TAdapter extends ITransportAdapter<TSession>,
> {
  readonly subjectId: string;
  readonly kind: TTransportLifecycleKind;
  createAdapter(): TAdapter;
  createSession(): TSession;
  assertReady(adapter: TAdapter): void | Promise<void>;
  assertStopped(adapter: TAdapter): void | Promise<void>;
  /** Required for runner fixtures: release one deliberately pending terminal operation. */
  completeRunner?(adapter: TAdapter): void | Promise<void>;
  readonly timeoutMs?: number;
}

function isLifecycleError(
  error: unknown,
  code: ITransportLifecycleError['code'],
): error is ITransportLifecycleError {
  return (
    error instanceof Error &&
    error.name === 'TransportLifecycleError' &&
    (error as Partial<ITransportLifecycleError>).code === code
  );
}

function isRunnerAdapter<TSession>(
  adapter: ITransportAdapter<TSession>,
): adapter is ITransportRunnerAdapter<TSession> {
  return (
    adapter.lifecycle.kind === 'runner' &&
    'waitForCompletion' in adapter &&
    typeof adapter.waitForCompletion === 'function'
  );
}

async function bounded<T>(promise: Promise<T>, label: string, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} exceeded ${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function requireLifecycleFailure(
  action: () => Promise<void>,
  code: ITransportLifecycleError['code'],
  subjectId: string,
): Promise<void> {
  try {
    await action();
  } catch (error) {
    if (isLifecycleError(error, code)) return;
    throw new Error(`${subjectId}: expected ${code}, received ${String(error)}`);
  }
  throw new Error(`${subjectId}: expected ${code}, but the action resolved`);
}

function validateLifecycleDescriptor<TSession, TAdapter extends ITransportAdapter<TSession>>(
  fixture: ITransportLifecycleConformanceFixture<TSession, TAdapter>,
  adapter: TAdapter,
): void {
  if (adapter.lifecycle.kind !== fixture.kind) {
    throw new Error(
      `${fixture.subjectId}: expected ${fixture.kind} lifecycle, received ${adapter.lifecycle.kind}`,
    );
  }
  if (!Object.isFrozen(adapter.lifecycle)) {
    throw new Error(`${fixture.subjectId}: lifecycle descriptor must be frozen`);
  }
  if (
    fixture.kind === 'runner' &&
    (!('waitForCompletion' in adapter) || typeof adapter.waitForCompletion !== 'function')
  ) {
    throw new Error(`${fixture.subjectId}: runner must expose callable waitForCompletion`);
  }
  if (
    fixture.kind === 'service' &&
    'waitForCompletion' in adapter &&
    typeof adapter.waitForCompletion === 'function'
  ) {
    throw new Error(`${fixture.subjectId}: service must not expose waitForCompletion`);
  }
}

async function verifyRunnerCompletionSeparation<
  TSession,
  TAdapter extends ITransportAdapter<TSession>,
>(
  fixture: ITransportLifecycleConformanceFixture<TSession, TAdapter>,
  adapter: TAdapter,
  timeoutMs: number,
): Promise<void> {
  if (fixture.kind !== 'runner') return;
  if (!fixture.completeRunner) {
    throw new Error(`${fixture.subjectId}: runner fixture must provide completeRunner`);
  }
  if (!isRunnerAdapter(adapter)) {
    throw new Error(`${fixture.subjectId}: runner must expose callable waitForCompletion`);
  }
  const runner = adapter;
  let settled = false;
  const completion = runner.waitForCompletion().finally(() => {
    settled = true;
  });
  await Promise.resolve();
  if (settled) throw new Error(`${fixture.subjectId}: runner completion was not held pending`);
  await fixture.completeRunner(adapter);
  await bounded(completion, `${fixture.subjectId} completion`, timeoutMs);
}

async function runNormalLifecycle<TSession, TAdapter extends ITransportAdapter<TSession>>(
  fixture: ITransportLifecycleConformanceFixture<TSession, TAdapter>,
  adapter: TAdapter,
  timeoutMs: number,
): Promise<void> {
  try {
    await requireLifecycleFailure(() => adapter.start(), 'not-attached', fixture.subjectId);
    adapter.attach(fixture.createSession());
    const starting = adapter.start();
    await requireLifecycleFailure(() => adapter.start(), 'already-started', fixture.subjectId);
    await bounded(starting, `${fixture.subjectId} start`, timeoutMs);
    await verifyRunnerCompletionSeparation(fixture, adapter, timeoutMs);
    await bounded(
      Promise.resolve(fixture.assertReady(adapter)),
      `${fixture.subjectId} ready`,
      timeoutMs,
    );
    await bounded(adapter.stop(), `${fixture.subjectId} first stop`, timeoutMs);
    await bounded(adapter.stop(), `${fixture.subjectId} repeated stop`, timeoutMs);
    adapter.attach(fixture.createSession());
    await bounded(adapter.start(), `${fixture.subjectId} restart`, timeoutMs);
    await verifyRunnerCompletionSeparation(fixture, adapter, timeoutMs);
    await bounded(
      Promise.resolve(fixture.assertReady(adapter)),
      `${fixture.subjectId} restart ready`,
      timeoutMs,
    );
    await bounded(adapter.stop(), `${fixture.subjectId} final stop`, timeoutMs);
  } finally {
    await bounded(adapter.stop(), `${fixture.subjectId} cleanup`, timeoutMs);
  }
}

async function runStopDuringStart<TSession, TAdapter extends ITransportAdapter<TSession>>(
  fixture: ITransportLifecycleConformanceFixture<TSession, TAdapter>,
  timeoutMs: number,
): Promise<void> {
  const adapter = fixture.createAdapter();
  try {
    adapter.attach(fixture.createSession());
    const starting = adapter.start();
    const stopping = adapter.stop();
    await bounded(
      Promise.allSettled([starting, stopping]),
      `${fixture.subjectId} stop-during-start`,
      timeoutMs,
    );
    await Promise.resolve();
    await bounded(
      Promise.resolve(fixture.assertStopped(adapter)),
      `${fixture.subjectId} stopped`,
      timeoutMs,
    );
  } finally {
    await bounded(adapter.stop(), `${fixture.subjectId} race cleanup`, timeoutMs);
  }
}

/**
 * Pure fixture-driven lifecycle contract. Concrete transport packages invoke this helper locally so
 * the universal contract package never imports a product transport or a test framework.
 */
export async function runTransportLifecycleConformance<
  TSession,
  TAdapter extends ITransportAdapter<TSession>,
>(fixture: ITransportLifecycleConformanceFixture<TSession, TAdapter>): Promise<void> {
  const timeoutMs = fixture.timeoutMs ?? DEFAULT_LIFECYCLE_TIMEOUT_MS;
  const adapter = fixture.createAdapter();
  validateLifecycleDescriptor(fixture, adapter);
  await runNormalLifecycle(fixture, adapter, timeoutMs);
  await runStopDuringStart(fixture, timeoutMs);
}
