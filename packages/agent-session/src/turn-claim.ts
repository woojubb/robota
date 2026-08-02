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
 * caller that took it, and only that caller can release it — so a late-finishing turn cannot free a
 * claim a newer one already holds.
 *
 * REFUSAL, not pre-emption. A session is a single conversation: two turns interleaving on it produce
 * a history neither of them wrote, and silently cancelling the first would discard work the caller
 * never asked to abandon. `claim()` throws, and the message names the three ways forward.
 */
export class TurnClaim {
  private controller: AbortController | null = null;

  /**
   * Take the claim for a new turn, or throw if one is already held.
   *
   * MUST be called before the first `await` in the turn — a check that yields first is not a claim,
   * it is a TOCTOU window, and two callers can pass it in the same tick.
   */
  claim(): AbortController {
    if (this.controller !== null) {
      throw new Error(
        'This session is already running a turn. A session is a single conversation: start the ' +
          'next turn after this one resolves, abort() it first, or use a separate session for ' +
          'concurrent work.',
      );
    }
    this.controller = new AbortController();
    return this.controller;
  }

  /**
   * Release the claim — but only if `controller` is still the one holding it.
   *
   * The ownership check is the point. `abort()` clears the claim, and a later turn may already have
   * taken a new one; a turn that released unconditionally in its `finally` would free a claim it no
   * longer holds, and `isRunning()` would then report idle while a turn was in flight.
   */
  release(controller: AbortController): void {
    if (this.controller === controller) {
      this.controller = null;
    }
  }

  /** Cancel the turn currently claimed, if any, and release its claim. */
  abort(): void {
    if (this.controller !== null) {
      this.controller.abort();
      this.controller = null;
    }
  }

  isRunning(): boolean {
    return this.controller !== null;
  }
}
