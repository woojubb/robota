/**
 * The OpenTelemetry SDK `IdGenerator` shape, declared structurally so this package does not depend
 * on an SDK version.
 */
export interface IOtelIdGenerator {
  generateTraceId(): string;
  generateSpanId(): string;
}

/**
 * An `IdGenerator` for a host's `TracerProvider` that can hand the next span a chosen ID. Robota
 * derives each provider call's and tool body's span ID before the operation runs and sends it in
 * `traceparent`; recording the span under that same ID is what lets a recipient's spans join the
 * trace. Every other span gets a random ID.
 */
export interface IStructuralIdGenerator extends IOtelIdGenerator {
  /** Run `start` with `spanId` as the ID of the one span it starts. */
  withSpanId<T>(spanId: string, start: () => T): T;
}

function randomHex(bytes: number): string {
  const values = new Uint8Array(bytes);
  // A valid ID is never all zeros; retry the one-in-2^64 draw that is.
  do globalThis.crypto.getRandomValues(values); while (values.every((value) => value === 0));
  return Array.from(values, (value) => value.toString(16).padStart(2, '0')).join('');
}

export function createStructuralIdGenerator(): IStructuralIdGenerator {
  let next: string | undefined;
  return {
    generateTraceId: () => randomHex(16),
    generateSpanId() {
      const chosen = next;
      next = undefined;
      return chosen ?? randomHex(8);
    },
    withSpanId(spanId, start) {
      next = spanId;
      try {
        return start();
      } finally {
        // A tracer that never asked for an ID (a no-op tracer) must not pass it to the next span.
        next = undefined;
      }
    },
  };
}
