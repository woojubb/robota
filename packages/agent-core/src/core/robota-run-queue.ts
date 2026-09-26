/**
 * The per-instance run queue (CORE-012).
 *
 * Split out of `robota.ts`, which is long past the file-size ceiling: serializing runs is a
 * self-contained responsibility with its own invariant, and it is the one part of the agent whose
 * correctness is about ordering rather than about conversation.
 *
 * The invariant: **one run at a time, per agent instance.** A second `run()` (or `runStream()`)
 * waits for the first to settle rather than interleaving with it, because both write to the same
 * conversation store — concurrent turns would produce a history that never happened.
 */

import { createAbortError, isAbortFailure } from '../utils/abort-classification';

/** Serializes runs on one agent instance and lets a caller wait for the queue to drain. */
export class RunQueue {
  private tail: Promise<void> = Promise.resolve();
  /** Slots claimed and not yet released: the run in flight plus every run waiting behind it. */
  private claimed = 0;

  /**
   * Wait for the previous run to settle, then hold the slot until the returned function is called.
   *
   * The slot is claimed BEFORE awaiting the predecessor, so callers queue in the order they
   * arrived rather than racing to claim it once the predecessor finishes.
   */
  async acquire(signal: AbortSignal | undefined): Promise<() => void> {
    const queuedBehindAnotherRun = this.claimed > 0;
    this.claimed += 1;
    const previous = this.tail;
    let settle: () => void = () => {};
    this.tail = new Promise<void>((resolve) => {
      settle = resolve;
    });
    let released = false;
    const release = (): void => {
      if (released) return;
      released = true;
      this.claimed -= 1;
      settle();
    };
    await previous;
    if (signal?.aborted) {
      // Aborting while queued must not consume the turn: release first so the queue keeps moving,
      // then report. Throwing while still holding the slot would deadlock every later run.
      release();
      throw abortedBeforeStart(signal, queuedBehindAnotherRun);
    }
    return release;
  }

  /** Run `task` in the slot, releasing it however the task settles. */
  async run<T>(signal: AbortSignal | undefined, task: () => Promise<T>): Promise<T> {
    const release = await this.acquire(signal);
    try {
      return await task();
    } finally {
      release();
    }
  }

  /**
   * Resolves once every run queued so far has settled.
   *
   * Disposal awaits this so an in-flight turn is not torn out from under itself (CORE-022).
   */
  get drained(): Promise<void> {
    return this.tail;
  }
}

/**
 * The failure for a run whose signal was already aborted when its turn came.
 *
 * It is an ABORT, recognisable by name alone: a caller that classifies failures without holding the
 * signal must not read a cancelled run as a broken one. A reason that already is an abort is thrown
 * as it is, as `signal.throwIfAborted()` would; any other reason becomes the cause of one. The
 * message says whether the run actually waited behind another, since a caller who never started a
 * second run should not be told it was queued.
 */
function abortedBeforeStart(signal: AbortSignal, queuedBehindAnotherRun: boolean): Error {
  const reason: unknown = signal.reason;
  if (isAbortFailure(reason)) return reason as Error;
  return createAbortError(
    queuedBehindAnotherRun
      ? 'Run aborted while queued behind another run on this instance'
      : 'Run aborted before it started',
    reason,
  );
}
