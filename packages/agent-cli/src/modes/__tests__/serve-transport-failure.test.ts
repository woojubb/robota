import { describe, expect, it, vi } from 'vitest';

import { settleOnServeTransportFailure } from '../serve-transport-failure.js';
import { createTransportFailedOutcome } from '@robota-sdk/agent-interface-transport';

describe('serve runner failure propagation (ARCH-011)', () => {
  it('sets the real nonzero runner exit code and enters owned shutdown', async () => {
    const setExitCode = vi.fn();
    const writeError = vi.fn();
    const settle = vi.fn();

    await settleOnServeTransportFailure(
      {
        waitForFailure: async () => ({
          name: 'headless',
          outcome: createTransportFailedOutcome(2),
        }),
      },
      { setExitCode, writeError },
      settle,
    );

    expect(setExitCode).toHaveBeenCalledWith(2);
    expect(writeError).toHaveBeenCalledWith('transport failed: headless exited 2\n');
    expect(settle).toHaveBeenCalledWith('a transport failed');
  });

  it('does nothing when there are no failed runners', async () => {
    const setExitCode = vi.fn();
    const writeError = vi.fn();
    const settle = vi.fn();

    await settleOnServeTransportFailure(
      { waitForFailure: async () => undefined },
      { setExitCode, writeError },
      settle,
    );

    expect(setExitCode).not.toHaveBeenCalled();
    expect(writeError).not.toHaveBeenCalled();
    expect(settle).not.toHaveBeenCalled();
  });

  it('maps a rejected runner wait to exit 1 without exposing a cause object', async () => {
    const setExitCode = vi.fn();
    const writeError = vi.fn();
    const settle = vi.fn();

    await settleOnServeTransportFailure(
      { waitForFailure: async () => Promise.reject(new Error('runner rejected')) },
      { setExitCode, writeError },
      settle,
    );

    expect(setExitCode).toHaveBeenCalledWith(1);
    expect(writeError).toHaveBeenCalledWith('transport failed: runner rejected\n');
    expect(settle).toHaveBeenCalledWith('a transport failed');
  });
});
