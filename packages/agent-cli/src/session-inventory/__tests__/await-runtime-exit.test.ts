import { spawn } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { readRegisteredProcessStartTime } from '@robota-sdk/agent-local-host';
import { expect, it } from 'vitest';

import { awaitRuntimeExit } from '../supervised-session-control.js';

/**
 * A runtime that ends itself closes its control before it answers a stop request, and its
 * registration can be gone while the process is still shutting down. Waiting for the exit is what
 * a launch that failed relies on to leave nothing behind, so it must follow the process, not the
 * registration. The child here stays alive until the test lets it go, so no timing decides the result.
 */
it('does not return while the registered process is alive, even with the registration removed', async () => {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'await-exit-')));
  rmSync(directory, { recursive: true, force: true });
  const child = spawn(process.execPath, ['-e', 'process.stdin.resume()'], {
    stdio: ['pipe', 'ignore', 'ignore'],
  });
  const pid = child.pid!;
  const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
  try {
    let returned = false;
    const waiting = awaitRuntimeExit(directory, {
      pid,
      startedAt: readRegisteredProcessStartTime(pid) ?? 'unread',
    }).then(() => {
      returned = true;
    });
    // Longer than one poll of the wait: it has looked at the live process more than once.
    await new Promise<void>((resolve) => setTimeout(resolve, 150));
    expect(returned).toBe(false);

    child.stdin!.end();
    await exited;
    await waiting;
    expect(returned).toBe(true);
  } finally {
    child.kill('SIGKILL');
  }
});
