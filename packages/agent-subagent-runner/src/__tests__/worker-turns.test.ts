import { describe, expect, it, vi } from 'vitest';

import { runWorkerTurns } from '../worker-turns.js';

describe('worker turn admission', () => {
  it('does not run queued input if a fatal parent update occurs during an abort-ignoring turn', async () => {
    let finish!: (text: string) => void;
    let fatal: string | undefined;
    const run = vi.fn().mockImplementationOnce(
      () =>
        new Promise<string>((resolve) => {
          finish = resolve;
        }),
    );
    const queue = ['accepted'];
    const result = runWorkerTurns(
      { run },
      'first',
      queue,
      () => fatal,
      () => false,
    );
    fatal = 'parent update failed';
    finish('provider ignored abort');
    await expect(result).rejects.toThrow('parent update failed');
    expect(run).toHaveBeenCalledTimes(1);
    expect(queue).toEqual(['accepted']);
  });
});
