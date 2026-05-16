export async function* streamWithAbort<T>(
  source: AsyncIterable<T>,
  signal?: AbortSignal,
): AsyncGenerator<T> {
  const iterator = source[Symbol.asyncIterator]();
  try {
    while (!signal?.aborted) {
      const item = await nextStreamItem(iterator, signal);
      if (item.done) break;
      if (signal?.aborted) break;
      yield item.value;
    }
  } finally {
    if (signal?.aborted) {
      await iterator.return?.();
    }
  }
}

async function nextStreamItem<T>(
  iterator: AsyncIterator<T>,
  signal?: AbortSignal,
): Promise<IteratorResult<T>> {
  if (!signal) return iterator.next();
  if (signal.aborted) return { done: true, value: undefined as T };

  let abortListener: (() => void) | undefined;
  const aborted = new Promise<IteratorResult<T>>((resolve) => {
    abortListener = (): void => resolve({ done: true, value: undefined as T });
    signal.addEventListener('abort', abortListener, { once: true });
  });

  try {
    return await Promise.race([iterator.next(), aborted]);
  } finally {
    if (abortListener) signal.removeEventListener('abort', abortListener);
  }
}
