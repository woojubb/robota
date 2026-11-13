/**
 * Core transport adapter contract.
 * Declared here so the transport implementations and the assembly layer depend on this
 * contract rather than on each other.
 */

export type TTransportLifecycleKind = 'service' | 'runner';

export interface ITransportLifecycle {
  readonly kind: TTransportLifecycleKind;
}

declare const nonZeroExitCode: unique symbol;
export type TNonZeroExitCode = number & { readonly [nonZeroExitCode]: true };

export type TTransportRunOutcome =
  | { readonly status: 'succeeded'; readonly exitCode: 0 }
  | { readonly status: 'failed'; readonly exitCode: TNonZeroExitCode };

export type TTransportAbandonmentReason = 'stopped' | 'startup-rollback';
export type TTransportCompletionOutcome =
  | TTransportRunOutcome
  | { readonly status: 'abandoned'; readonly reason: TTransportAbandonmentReason };

export interface ITransportCompletionRecord {
  readonly name: string;
  readonly outcome: TTransportCompletionOutcome;
}

export interface ITransportFailureRecord {
  readonly name: string;
  readonly outcome: Extract<TTransportRunOutcome, { readonly status: 'failed' }>;
}

export type TTransportLifecycleErrorCode = 'not-attached' | 'already-started' | 'runner-rejected';

export interface ITransportLifecycleError extends Error {
  readonly name: 'TransportLifecycleError';
  readonly code: TTransportLifecycleErrorCode;
  readonly transportName: string;
}

export interface ITransportRollbackError {
  readonly transportName: string;
  readonly message: string;
}

export interface ITransportStartupError extends Error {
  readonly name: 'TransportStartupError';
  readonly transportName: string;
  readonly rollbackErrors: readonly ITransportRollbackError[];
  /** Raw rollback causes for local diagnostics only; always installed as a non-enumerable property. */
  readonly rollbackCauses?: readonly unknown[];
  readonly cause?: unknown;
}

export interface ITransportAdapter<TSession = unknown> {
  readonly name: string;
  readonly lifecycle: Readonly<ITransportLifecycle>;
  attach(session: TSession): void;

  /**
   * Begin serving or launch runner work. This resolves at the concrete transport's documented
   * readiness boundary; runner completion is observed separately through `waitForCompletion()`.
   *
   * `start(): Promise<void>` alone is ambiguous between a transport that binds a port and returns
   * and one that runs the entire prompt inside `start()` or blocks for the life of the UI.
   * `TransportRegistry.startAll` awaits each in turn, so a transport of the second kind registered
   * first would leave every transport behind it never started — no crash, no error, simply never
   * reached. The `lifecycle` discriminant is required so that a transport states which kind it is.
   */
  start(): Promise<void>;
  stop(): Promise<void>;
}

export interface ITransportRunnerAdapter<TSession = unknown> extends ITransportAdapter<TSession> {
  readonly lifecycle: Readonly<{ readonly kind: 'runner' }>;
  waitForCompletion(): Promise<TTransportRunOutcome>;
}

export interface ITransportServiceAdapter<TSession = unknown> extends ITransportAdapter<TSession> {
  readonly lifecycle: Readonly<{ readonly kind: 'service' }>;
}

export type TTransportAdapter<TSession = unknown> =
  ITransportServiceAdapter<TSession> | ITransportRunnerAdapter<TSession>;

/** A composition root has selected the exact session capability; the registry cannot reattach it. */
export interface IBoundTransportAdapter {
  readonly binding: 'bound';
  readonly name: string;
  readonly lifecycle: Readonly<ITransportLifecycle>;
  start(): Promise<void>;
  stop(): Promise<void>;
}

export interface IBoundTransportServiceAdapter extends IBoundTransportAdapter {
  readonly lifecycle: Readonly<{ readonly kind: 'service' }>;
}

export interface IBoundTransportRunnerAdapter extends IBoundTransportAdapter {
  readonly lifecycle: Readonly<{ readonly kind: 'runner' }>;
  waitForCompletion(): Promise<TTransportRunOutcome>;
}

export type TBoundTransportAdapter =
  | IBoundTransportServiceAdapter
  | IBoundTransportRunnerAdapter;

export function createTransportFailedOutcome(
  exitCode: number,
): Extract<TTransportRunOutcome, { readonly status: 'failed' }> {
  if (!Number.isInteger(exitCode) || exitCode < 1 || exitCode > 255) {
    throw new TypeError(
      `Transport failure exit code must be an integer from 1 through 255; received ${exitCode}.`,
    );
  }
  return { status: 'failed', exitCode: exitCode as TNonZeroExitCode };
}

export function isTransportRunOutcome(value: unknown): value is TTransportRunOutcome {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as { status?: unknown; exitCode?: unknown };
  if (candidate.status === 'succeeded') return candidate.exitCode === 0;
  return (
    candidate.status === 'failed' &&
    typeof candidate.exitCode === 'number' &&
    Number.isInteger(candidate.exitCode) &&
    candidate.exitCode >= 1 &&
    candidate.exitCode <= 255
  );
}
