/**
 * Serializes an ordered stream of text deltas onto an async sink.
 *
 * An agent's `session/update` notifications are handled synchronously, but the roundtable's
 * `ParticipantExecutionOptions.onDelta` must be awaited per chunk. `push` never blocks the
 * synchronous caller; it appends to an internal chain that delivers to `sink` strictly in push
 * order, one delta at a time. `flush` resolves once every delta pushed before it was called has
 * been delivered, so a turn awaits it before returning its outcome and the outcome never precedes
 * a delta.
 *
 * Every link of that chain gets its own failure handler in the same synchronous `push` call that
 * creates it, so no link is ever left awaiting a later `push` or `flush` to notice it rejected.
 * `sink` rejecting is recorded as the chain's first failure and skips every later delta; `flush`
 * rethrows that same first failure for as long as it stands.
 */
export interface DeltaQueue {
  push(text: string): void;
  flush(): Promise<void>;
}

export function createDeltaQueue(sink: (text: string) => Promise<void>): DeltaQueue {
  let tail: Promise<void> = Promise.resolve();
  let failure: { error: unknown } | undefined;
  return {
    push(text: string): void {
      tail = tail
        .then(() => {
          if (failure) return;
          return sink(text);
        })
        .catch((error: unknown) => {
          if (!failure) failure = { error };
        });
    },
    async flush(): Promise<void> {
      await tail;
      if (failure) throw failure.error;
    },
  };
}
