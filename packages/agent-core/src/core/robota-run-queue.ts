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

/** Serializes runs on one agent instance and lets a caller wait for the queue to drain. */
export class RunQueue {
  private tail: Promise<void> = Promise.resolve();

  /**
   * Wait for the previous run to settle, then hold the slot until the returned function is called.
   *
   * The slot is claimed BEFORE awaiting the predecessor, so callers queue in the order they
   * arrived rather than racing to claim it once the predecessor finishes.
   */
  async acquire(signal: AbortSignal | undefined): Promise<() => void> {
    const previous = this.tail;
    let release: () => void = () => {};
    this.tail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    if (signal?.aborted) {
      // Aborting while queued must not consume the turn: release first so the queue keeps moving,
      // then report. Throwing while still holding the slot would deadlock every later run.
      release();
      throw new Error('Run aborted while queued behind another run on this instance');
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
