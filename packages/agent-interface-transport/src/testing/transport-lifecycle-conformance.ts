import type {
  ITransportAdapter,
  ITransportLifecycleError,
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

  if (adapter.lifecycle.kind !== fixture.kind) {
    throw new Error(
      `${fixture.subjectId}: expected ${fixture.kind} lifecycle, received ${adapter.lifecycle.kind}`,
    );
  }
  if (!Object.isFrozen(adapter.lifecycle)) {
    throw new Error(`${fixture.subjectId}: lifecycle descriptor must be frozen`);
  }

  await requireLifecycleFailure(() => adapter.start(), 'not-attached', fixture.subjectId);

  adapter.attach(fixture.createSession());
  await bounded(adapter.start(), `${fixture.subjectId} start`, timeoutMs);
  await bounded(
    Promise.resolve(fixture.assertReady(adapter)),
    `${fixture.subjectId} ready`,
    timeoutMs,
  );
  await requireLifecycleFailure(() => adapter.start(), 'already-started', fixture.subjectId);

  await bounded(adapter.stop(), `${fixture.subjectId} first stop`, timeoutMs);
  await bounded(adapter.stop(), `${fixture.subjectId} repeated stop`, timeoutMs);

  adapter.attach(fixture.createSession());
  await bounded(adapter.start(), `${fixture.subjectId} restart`, timeoutMs);
  await bounded(
    Promise.resolve(fixture.assertReady(adapter)),
    `${fixture.subjectId} restart ready`,
    timeoutMs,
  );
  await bounded(adapter.stop(), `${fixture.subjectId} final stop`, timeoutMs);
}
