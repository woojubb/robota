const SHUTDOWN_TIMEOUT_MS = 5000;

/**
 * Shut a session down, giving up with a rejection if it has not finished in time. Either way the
 * caller is done with it, so its claim on its record ends here too.
 */
export async function shutdownSession(
  session: {
    shutdown(options?: { reason?: string; message?: string }): Promise<void>;
    releaseSessionClaim?(): void;
  },
  message: string,
  surface: string,
): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      session.shutdown({ reason: 'other', message }),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${surface} session shutdown timed out`)),
          SHUTDOWN_TIMEOUT_MS,
        );
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    session.releaseSessionClaim?.();
  }
}
