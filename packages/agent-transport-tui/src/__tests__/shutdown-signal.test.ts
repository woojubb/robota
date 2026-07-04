/**
 * CLI-075 (RUNTIME-33): interrupt-signal policy. The first Ctrl+C / signal runs the graceful
 * shutdown; a second one received while a shutdown is already in flight force-quits with 130 so a
 * user can always escape a wedged shutdown.
 */
import { describe, it, expect, vi } from 'vitest';

import { handleInterrupt, FORCE_QUIT_EXIT_CODE } from '../shutdown-signal.js';

describe('handleInterrupt (CLI-075 RUNTIME-33)', () => {
  it('runs the graceful path on the first interrupt (not shutting down yet)', () => {
    const graceful = vi.fn();
    const forceExit = vi.fn();

    handleInterrupt({ isShuttingDown: false, graceful, forceExit });

    expect(graceful).toHaveBeenCalledOnce();
    expect(forceExit).not.toHaveBeenCalled();
  });

  it('force-exits with 130 on a second interrupt during an in-flight shutdown', () => {
    const graceful = vi.fn();
    const forceExit = vi.fn();

    handleInterrupt({ isShuttingDown: true, graceful, forceExit });

    expect(forceExit).toHaveBeenCalledWith(130);
    expect(graceful).not.toHaveBeenCalled();
  });

  it('exposes 128 + SIGINT(2) as the force-quit exit code', () => {
    expect(FORCE_QUIT_EXIT_CODE).toBe(130);
  });
});
