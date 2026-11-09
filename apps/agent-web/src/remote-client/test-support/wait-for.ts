/**
 * Polls `assertion` until it stops throwing, with the defaults Vitest's `vi.waitFor` had when these tests ran
 * there (50 ms interval, 1 s timeout). Jest has no equivalent, and Testing Library's `waitFor` needs a DOM.
 */
export async function waitFor(
  assertion: () => unknown,
  timeoutMs = 1000,
  intervalMs = 50,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      await assertion();
      return;
    } catch (error) {
      if (Date.now() >= deadline) throw error;
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  }
}
