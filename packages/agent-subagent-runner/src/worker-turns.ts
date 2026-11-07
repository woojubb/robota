/** Drain accepted turns unless a fatal parent change or cancellation stops the worker. */
export async function runWorkerTurns(
  session: { run(prompt: string): Promise<string> },
  firstPrompt: string,
  queue: string[],
  fatalReason: () => string | undefined,
  cancelled: () => boolean,
): Promise<string> {
  let output = '';
  let failure: { error: unknown } | undefined;
  let prompt: string | undefined = firstPrompt;
  while (prompt !== undefined) {
    try {
      output = await session.run(prompt);
    } catch (error) {
      failure ??= { error };
    }
    const fatal = fatalReason();
    if (fatal !== undefined) throw new Error(fatal);
    if (cancelled()) break;
    prompt = queue.shift();
  }
  if (failure) throw failure.error;
  return output;
}
