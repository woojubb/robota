import { describe, expect, it, vi } from 'vitest';

import { waitForRenderAndStop } from '../render.js';

describe('renderApp lifecycle ownership', () => {
  it('awaits active channel teardown after Ink exits', async () => {
    let release: (() => void) | undefined;
    const stop = vi.fn(() => new Promise<void>((resolve) => (release = resolve)));
    let settled = false;

    const outcome = waitForRenderAndStop(
      async () => {},
      () => ({ stop }),
    ).then(() => {
      settled = true;
    });
    await Promise.resolve();

    expect(stop).toHaveBeenCalledTimes(1);
    expect(settled).toBe(false);
    release?.();
    await outcome;
    expect(settled).toBe(true);
  });

  it('propagates channel teardown failure to the renderApp caller', async () => {
    const stopError = new Error('transport stop failed');

    await expect(
      waitForRenderAndStop(
        async () => {},
        () => ({ stop: vi.fn().mockRejectedValue(stopError) }),
      ),
    ).rejects.toBe(stopError);
  });
});
