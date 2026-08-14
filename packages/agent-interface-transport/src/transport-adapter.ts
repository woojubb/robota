/**
 * Core transport adapter contract.
 * Moved from agent-framework to break the circular dependency between
 * agent-transport-* implementations and the assembly layer.
 */

export type TTransportLifecycleKind = 'service' | 'runner';

export interface ITransportLifecycle {
  readonly kind: TTransportLifecycleKind;
}

export type TTransportRunOutcome =
  | { readonly status: 'succeeded'; readonly exitCode: 0 }
  | { readonly status: 'failed'; readonly exitCode: number };

export interface ITransportCompletionRecord {
  readonly name: string;
  readonly outcome: TTransportRunOutcome;
}

export type TTransportLifecycleErrorCode = 'not-attached' | 'already-started' | 'runner-rejected';

export interface ITransportLifecycleError extends Error {
  readonly name: 'TransportLifecycleError';
  readonly code: TTransportLifecycleErrorCode;
  readonly transportName: string;
}

export interface ITransportAdapter<TSession = unknown> {
  readonly name: string;
  readonly lifecycle: Readonly<ITransportLifecycle>;
  attach(session: TSession): void;

  /**
   * Begin serving or launch runner work. This resolves at the concrete transport's documented
   * readiness boundary; runner completion is observed separately through `waitForCompletion()`.
   *
   * ARCH-011: the contract used to say only `start(): Promise<void>`, and two readings coexisted.
   * Four transports bound a port and returned; `headless` ran the entire prompt inside `start()` and
   * `tui` blocked for the life of the UI. `TransportRegistry.startAll` awaited each in turn, so
   * registering either of those first meant every transport behind it never started — no crash, no
   * error, simply never reached.
   *
   * The required lifecycle discriminant removes the former ambiguous `runsToCompletion` flag.
   */
  start(): Promise<void>;
  stop(): Promise<void>;
}

export interface ITransportRunnerAdapter<TSession = unknown> extends ITransportAdapter<TSession> {
  readonly lifecycle: Readonly<{ readonly kind: 'runner' }>;
  waitForCompletion(): Promise<TTransportRunOutcome>;
}
