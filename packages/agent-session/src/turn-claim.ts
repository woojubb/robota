/**
 * Thrown when a turn is started on a session that is already running one. RUNTIME-003.
 *
 * A distinct type rather than a bare `Error`, because the point of giving the session a claim is to
 * let consumers STOP maintaining their own busy flags — and a consumer that has to regex-match an
 * error message to tell "busy, retry later" apart from a provider failure has not been given
 * anything it can act on. Follows `CompactionError`, this package's existing precedent.
 */
export class SessionBusyError extends Error {
  /** Always `true`: the caller can run this turn later; nothing about the session is broken. */
  readonly recoverable = true;

  constructor(message: string) {
    super(message);
    this.name = 'SessionBusyError';
  }
}

/**
 * The identity of the turn a session is currently running. RUNTIME-003.
 *
 * A session used to express "is something running?" as a bare `AbortController | null` field that
 * `run()` overwrote on entry. That field was doing three jobs at once — cancellation channel, busy
 * flag, and turn identity — and it could only do them for ONE turn, so a second concurrent `run()`
 * orphaned the first: `abort()` reached only whichever turn held the field, and the first turn to
 * finish cleared it in its `finally`, making `abort()` on the survivor a silent no-op. `isRunning()`
 * read the same field, so it answered about whichever turn happened to own it. That is why consumers
 * of this library grew their own busy flags rather than trusting it.
 *
 * The fix is to give the unit of work an OWNER. A claim is taken synchronously, it belongs to the
 * caller that took it, and ONLY that caller releases it.
 *
 * REFUSAL, not pre-emption. A session is a single conversation: two turns interleaving on it produce
 * a history neither of them wrote, and silently cancelling the first would discard work the caller
 * never asked to abandon. `claim()` throws {@link SessionBusyError}, whose message names the three
 * ways forward.
 */
export class TurnClaim {
  private controller: AbortController | null = null;

  /**
   * Take the claim for a new turn, or throw if one is already held.
   *
   * MUST be called before the first `await` in the turn — a check that yields first is not a claim,
   * it is a TOCTOU window, and two callers can pass it in the same tick.
   *
   * @throws {SessionBusyError} if a turn is already running, INCLUDING one that has been aborted but
   *   has not finished unwinding. See {@link abort} for why that case is not an exception.
   */
  claim(): AbortController {
    if (this.controller !== null) {
      throw new SessionBusyError(
        'This session is already running a turn. A session is a single conversation: await the ' +
          'turn in flight, abort() it and await it, or use a separate session for concurrent work.',
      );
    }
    this.controller = new AbortController();
    return this.controller;
  }

  /**
   * Release the claim — but only if `controller` is still the one holding it.
   *
   * The ownership check is what stops the original defect from reappearing in a new shape: a turn
   * that released unconditionally in its `finally` could free a claim a LATER turn already took, and
   * `isRunning()` would then report idle while a turn was in flight.
   */
  release(controller: AbortController): void {
    if (this.controller === controller) {
      this.controller = null;
    }
  }

  /**
   * Signal the running turn to stop. Idempotent; a no-op if nothing is running.
   *
   * This does NOT release the claim, and that is deliberate. An earlier version cleared it here, so
   * `isRunning()` answered `false` the instant `abort()` returned — while the aborted turn was still
   * unwinding, still able to write history and finish tool calls. A new `run()` could then claim the
   * session and interleave with it: exactly the two-turns-on-one-session defect RUNTIME-003 is
   * about, just moved behind the abort boundary. Review of the first draft caught it.
   *
   * A turn is not over when it is asked to stop; it is over when it has stopped. The claim is
   * therefore held until the owning turn's `finally` releases it, and until then `isRunning()` says
   * `true` and a further `run()` is refused. Cancel and restart is `abort()`, then AWAIT the turn,
   * then `run()` — which is what every caller in this repo already does.
   */
  abort(): void {
    this.controller?.abort();
  }

  isRunning(): boolean {
    return this.controller !== null;
  }
}
