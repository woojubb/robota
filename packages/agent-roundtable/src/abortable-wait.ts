/** Stop waiting for host observers/control I/O; never use this to skip draining runtime effects. */
export function abortableWait<T>(pending: PromiseLike<T> | T, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason);
    if (signal.aborted) abort();
    else signal.addEventListener('abort', abort, { once: true });
    // Both handlers stay attached so a late failure is consumed after the caller stops waiting.
    Promise.resolve(pending).then(
      (value) => {
        signal.removeEventListener('abort', abort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', abort);
        reject(error);
      },
    );
  });
}
