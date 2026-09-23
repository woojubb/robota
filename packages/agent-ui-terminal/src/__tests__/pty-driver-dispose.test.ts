/**
 * INFRA-026 TC-01 — `killAndAwaitExit` (the compose behind the PTY driver's `disposeAsync`) awaits
 * ACTUAL child exit and rejects loudly on non-exit. Unit-level with a fake session (no real PTY), so
 * it runs in the default vitest project rather than the `*.ptytest` built-CLI project.
 */
import { describe, expect, it, vi } from 'vitest';

import { killAndAwaitExit } from './pty/pty-driver.js';

describe('killAndAwaitExit (INFRA-026 teardown compose)', () => {
  it('signals the child (dispose) then resolves once expectExit resolves', async () => {
    const order: string[] = [];
    const session = {
      dispose: vi.fn(() => {
        order.push('dispose');
      }),
      expectExit: vi.fn(async (): Promise<number> => {
        order.push('expectExit');
        return 0;
      }),
    };

    await expect(killAndAwaitExit(session, 1000)).resolves.toBeUndefined();

    expect(session.dispose).toHaveBeenCalledTimes(1);
    expect(session.expectExit).toHaveBeenCalledWith(1000);
    // dispose must be signalled BEFORE we await exit.
    expect(order).toEqual(['dispose', 'expectExit']);
  });

  it('rejects (does not swallow) when the child does not exit within the timeout', async () => {
    const session = {
      dispose: vi.fn(),
      expectExit: vi.fn(async (): Promise<number> => {
        throw new Error('PTY process did not exit within 1000ms');
      }),
    };

    await expect(killAndAwaitExit(session, 1000)).rejects.toThrow(/did not exit/);
    // Still signalled the child — the failure is a loud teardown defect, not a masked one.
    expect(session.dispose).toHaveBeenCalledTimes(1);
  });
});
