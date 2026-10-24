/** A void port must acknowledge synchronously. Observe rejected async work without accepting it. */
export function assertSynchronousCheckpoint(result: unknown): void {
  if (
    ((typeof result === 'object' && result !== null) || typeof result === 'function') &&
    'then' in result &&
    typeof result.then === 'function'
  ) {
    void Promise.resolve(result).catch(() => undefined);
    throw new Error(
      'Session checkpoint must acknowledge synchronously; asynchronous persistence is unsupported',
    );
  }
}
