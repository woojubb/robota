/**
 * Core transport adapter contract.
 * Moved from agent-framework to break the circular dependency between
 * agent-transport-* implementations and the assembly layer.
 */

export interface ITransportAdapter<TSession = unknown> {
  readonly name: string;
  attach(session: TSession): void;

  /**
   * Begin serving. RESOLVES ONCE THE TRANSPORT IS SERVING, not when its work is done — unless
   * `runsToCompletion` says otherwise.
   *
   * ARCH-011: the contract used to say only `start(): Promise<void>`, and two readings coexisted.
   * Four transports bound a port and returned; `headless` ran the entire prompt inside `start()` and
   * `tui` blocked for the life of the UI. `TransportRegistry.startAll` awaited each in turn, so
   * registering either of those first meant every transport behind it never started — no crash, no
   * error, simply never reached.
   *
   * A transport whose whole job happens inside `start()` declares `runsToCompletion`, and the
   * registry starts it without waiting for it to finish.
   */
  start(): Promise<void>;
  stop(): Promise<void>;

  /**
   * True when `start()` does not return while the transport is alive — it runs the work to
   * completion, or blocks for the lifetime of a UI.
   *
   * Optional because "resolves once serving" is the ordinary case and the overwhelming majority; a
   * transport that omits this is asserting the ordinary meaning. It is the ONE axis where silence has
   * a safe reading, and the registry treats an absent value as `false` rather than guessing.
   */
  readonly runsToCompletion?: boolean;
}
