/** Bound a case setting or thread request even when the remote call does not settle. */
export async function caseRequest<T>(run: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      run(controller.signal),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => {
          reject(new Error('The case request took too long'));
          controller.abort();
        }, 15_000);
      }),
    ]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}
