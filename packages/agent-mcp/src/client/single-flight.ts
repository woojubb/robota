/**
 * A credential obtained at most once at a time and reused until it is refused.
 *
 * An authenticator is asked for headers on every request, and obtaining them can be expensive — a
 * process to run, a token to refresh. Callers that ask while a load is running join it instead of
 * starting another. A failed load is never cached, so the next caller starts afresh.
 *
 * Every value carries the generation of the load that produced it, and invalidation names the
 * generation that was refused. Only a refusal of the CURRENT value drops it; a refusal of an older
 * one — several requests sent with the same credential are all refused together — joins whatever
 * replaced it. So N concurrent refusals cost one new load, not N, which matters when a load
 * consumes something, such as a rotating refresh token.
 *
 * There is never more than one load alive. It is cancelled when every caller waiting on it has
 * given up, or when the cache is closed.
 */

interface IFlight<T> {
  readonly generation: number;
  readonly controller: AbortController;
  promise: Promise<T>;
  waiters: number;
}

/** A value and the generation of the load that produced it. */
export interface IMCPSingleFlightEntry<T> {
  readonly value: T;
  readonly generation: number;
}

function cancelled(): DOMException {
  return new DOMException('The credential request was cancelled', 'AbortError');
}

export class MCPSingleFlightClosedError extends Error {
  constructor() {
    super('The credential cache was closed');
    this.name = 'MCPSingleFlightClosedError';
  }
}

export class MCPSingleFlightCache<T> {
  private cached: IMCPSingleFlightEntry<T> | undefined;
  private flight: IFlight<T> | undefined;
  private generation = 0;
  private closed = false;

  constructor(private readonly load: (signal: AbortSignal) => Promise<T>) {}

  /** The cached value, the running load's, or a new load's. `signal` abandons only this caller. */
  async get(signal?: AbortSignal): Promise<T> {
    return (await this.getEntry(signal)).value;
  }

  /** As {@link get}, with the generation to name if the value is later refused. */
  getEntry(signal?: AbortSignal): Promise<IMCPSingleFlightEntry<T>> {
    if (this.closed) return Promise.reject(new MCPSingleFlightClosedError());
    if (signal?.aborted === true) return Promise.reject(cancelled());
    if (this.cached !== undefined) return Promise.resolve(this.cached);
    const flight = this.flight ?? this.start();
    flight.waiters += 1;
    return new Promise<IMCPSingleFlightEntry<T>>((resolve, reject) => {
      let settled = false;
      const leave = (): void => {
        settled = true;
        flight.waiters -= 1;
        signal?.removeEventListener('abort', onAbort);
      };
      const onAbort = (): void => {
        if (settled) return;
        leave();
        if (flight.waiters === 0 && this.flight === flight) {
          this.flight = undefined;
          flight.controller.abort();
        }
        reject(cancelled());
      };
      signal?.addEventListener('abort', onAbort, { once: true });
      flight.promise.then(
        (value) => {
          if (settled) return;
          leave();
          resolve({ value, generation: flight.generation });
        },
        (error: unknown) => {
          if (settled) return;
          leave();
          reject(error);
        },
      );
    });
  }

  /**
   * The value of `generation` was refused. It is dropped only while it is still the current value;
   * a newer value or a running load stays, and the next `get` returns it.
   */
  invalidate(generation: number): void {
    if (this.cached?.generation === generation) this.cached = undefined;
  }

  /** Cancel the running load and refuse every later `get`. */
  close(): void {
    this.closed = true;
    this.cached = undefined;
    const flight = this.flight;
    this.flight = undefined;
    flight?.controller.abort();
  }

  private start(): IFlight<T> {
    this.generation += 1;
    const flight: IFlight<T> = {
      generation: this.generation,
      controller: new AbortController(),
      promise: Promise.resolve() as Promise<never>,
      waiters: 0,
    };
    flight.promise = new Promise<T>((resolve) => resolve(this.load(flight.controller.signal))).then(
      (value) => {
        if (this.flight === flight) {
          this.flight = undefined;
          this.cached = { value, generation: flight.generation };
        }
        return value;
      },
      (error: unknown) => {
        if (this.flight === flight) this.flight = undefined;
        throw error;
      },
    );
    // Every waiter observes the outcome; this keeps a load nobody waits for from going unhandled.
    flight.promise.catch(() => undefined);
    this.flight = flight;
    return flight;
  }
}
