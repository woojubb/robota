/**
 * Bounded polling helper for asynchronous session initialization.
 *
 * Distinguishes benign "not yet initialized" errors (retried until a timeout)
 * from real failures (surfaced immediately), so the TUI can show an error
 * instead of spinning forever.
 */

export type TSessionInitFailure =
  | { kind: 'timeout'; lastError: Error | undefined }
  | { kind: 'error'; error: Error };

export interface ISessionInitPollerOptions {
  /** Throws while the session is not ready; returns normally when ready. */
  check: () => void;
  intervalMs: number;
  timeoutMs: number;
  /** Returns true when an error means "keep polling". Defaults to /not initialized/i. */
  isBenignError?: (error: Error) => boolean;
  onReady: () => void;
  onFailure: (failure: TSessionInitFailure) => void;
}

export interface ISessionInitPoller {
  start(): void;
  stop(): void;
}

function defaultIsBenignError(error: Error): boolean {
  return /not initialized/i.test(error.message);
}

export function createSessionInitPoller(options: ISessionInitPollerOptions): ISessionInitPoller {
  const isBenign = options.isBenignError ?? defaultIsBenignError;
  let timer: ReturnType<typeof setInterval> | null = null;
  let elapsedMs = 0;
  let lastBenignError: Error | undefined;

  function stop(): void {
    if (timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  }

  function tick(): void {
    elapsedMs += options.intervalMs;
    try {
      options.check();
    } catch (raw) {
      // allow-fallback: poller's purpose is to classify and route this error, never to swallow it
      const error = raw instanceof Error ? raw : new Error(String(raw));
      if (!isBenign(error)) {
        stop();
        options.onFailure({ kind: 'error', error });
        return;
      }
      lastBenignError = error;
      if (elapsedMs >= options.timeoutMs) {
        stop();
        options.onFailure({ kind: 'timeout', lastError: lastBenignError });
      }
      return;
    }
    stop();
    options.onReady();
  }

  return {
    start(): void {
      if (timer !== null) return;
      elapsedMs = 0;
      timer = setInterval(tick, options.intervalMs);
    },
    stop,
  };
}
