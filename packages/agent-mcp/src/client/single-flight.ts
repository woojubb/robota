/**
 * A credential obtained at most once at a time and reused until invalidated.
 *
 * An authenticator is asked for headers on every request, and obtaining them can be expensive — a
 * process to run, a token to refresh. Callers that ask while a load is running join it instead of
 * starting another. A failed load is never cached, so the next caller starts afresh.
 *
 * Invalidating drops the cached value and detaches a running load: the callers already waiting on
 * it still receive its result, but it is not stored, so a value obtained before an invalidation is
 * never handed to a caller that asks after it. A load is cancelled when every caller waiting on it
 * has given up, or when the cache is closed.
 */

interface IFlight<T> {
  readonly controller: AbortController;
  promise: Promise<T>;
  waiters: number;
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
  private cached: { readonly value: T } | undefined;
  private flight: IFlight<T> | undefined;
  private closed = false;

  constructor(private readonly load: (signal: AbortSignal) => Promise<T>) {}

  /** The cached value, the running load's, or a new load's. `signal` abandons only this caller. */
  get(signal?: AbortSignal): Promise<T> {
    if (this.closed) return Promise.reject(new MCPSingleFlightClosedError());
    if (signal?.aborted === true) return Promise.reject(cancelled());
    if (this.cached !== undefined) return Promise.resolve(this.cached.value);
    const flight = this.flight ?? this.start();
    flight.waiters += 1;
    return new Promise<T>((resolve, reject) => {
      let settled = false;
      const leave = (): void => {
        settled = true;
        flight.waiters -= 1;
        signal?.removeEventListener('abort', onAbort);
      };
      const onAbort = (): void => {
        if (settled) return;
        leave();
        if (flight.waiters === 0) {
          if (this.flight === flight) this.flight = undefined;
          flight.controller.abort();
        }
        reject(cancelled());
      };
      signal?.addEventListener('abort', onAbort, { once: true });
      flight.promise.then(
        (value) => {
          if (settled) return;
          leave();
          resolve(value);
        },
        (error: unknown) => {
          if (settled) return;
          leave();
          reject(error);
        },
      );
    });
  }

  /** Forget the cached value; the next `get` loads again. */
  invalidate(): void {
    this.cached = undefined;
    this.flight = undefined;
  }

  /** Cancel a running load and refuse every later `get`. */
  close(): void {
    this.closed = true;
    this.cached = undefined;
    const flight = this.flight;
    this.flight = undefined;
    flight?.controller.abort();
  }

  private start(): IFlight<T> {
    const flight: IFlight<T> = {
      controller: new AbortController(),
      promise: Promise.resolve() as Promise<never>,
      waiters: 0,
    };
    flight.promise = new Promise<T>((resolve) => resolve(this.load(flight.controller.signal))).then(
      (value) => {
        if (this.flight === flight) {
          this.flight = undefined;
          this.cached = { value };
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
