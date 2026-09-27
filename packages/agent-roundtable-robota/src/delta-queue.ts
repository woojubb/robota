/**
 * Serializes an ordered stream of text deltas onto an async sink.
 *
 * A provider's `onTextDelta` callback is synchronous, but the roundtable's own
 * `ParticipantExecutionOptions.onDelta` must be awaited per chunk. `push` never blocks the
 * synchronous caller; it appends to an internal chain that delivers to `sink` strictly in push
 * order, one delta at a time. `flush` resolves once every delta pushed before it was called has
 * been delivered — callers await it before returning a turn's outcome, so a delta is never lost
 * mid-flight and the outcome never precedes it.
 *
 * Once `sink` rejects, the chain is a rejected promise: any later `.then` (a later push) is
 * skipped rather than invoked, so a delta pushed after a failure is never delivered, and every
 * `flush` after the failure rethrows that same, first error.
 */
export interface DeltaQueue {
  push(text: string): void;
  flush(): Promise<void>;
}

export function createDeltaQueue(sink: (text: string) => Promise<void>): DeltaQueue {
  let tail: Promise<void> = Promise.resolve();
  return {
    push(text: string): void {
      tail = tail.then(() => sink(text));
    },
    flush(): Promise<void> {
      return tail;
    },
  };
}
