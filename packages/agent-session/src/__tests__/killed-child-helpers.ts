import { expect } from 'vitest';

/** What a finished child process reports of how it ended. */
export interface IFinishedChild {
  readonly signal: NodeJS.Signals | null;
  readonly status: number | null;
  readonly stderr: unknown;
}

/**
 * The child ended itself with `process.kill(process.pid, 'SIGKILL')`, so no exit handler ran.
 * POSIX reports that as the signal. Windows has no signals: the same call stops the process at once
 * with a failure status and no signal name, so that is what is asserted there.
 */
export function expectKilled(child: IFinishedChild): void {
  if (process.platform === 'win32') {
    expect(child.signal, String(child.stderr)).toBeNull();
    expect(child.status, String(child.stderr)).not.toBe(0);
    expect(child.status, String(child.stderr)).not.toBeNull();
    return;
  }
  expect(child.signal, String(child.stderr)).toBe('SIGKILL');
}
