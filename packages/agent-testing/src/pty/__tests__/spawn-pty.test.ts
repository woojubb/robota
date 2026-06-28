/**
 * TEST-007: self-test for the shared PTY harness (relocated to @robota-sdk/agent-testing by INFRA-016).
 *
 * Drives a trivial process (no fixture needed) through `spawnPty` to pin the harness contract:
 * `waitFor` resolves on a printed marker, `expectExit` returns the real exit code, and
 * `snapshot()`/`raw()` capture output. The terminal-handoff suites (in agent-transport-tui) are the
 * harness's real-world consumers; this guards the harness itself.
 */
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import { spawnPty } from '../spawn-pty.js';

import type { IPtyRunSession } from '../spawn-pty.js';

const PACKAGE_DIR = fileURLToPath(new URL('../../..', import.meta.url));
const sessions: IPtyRunSession[] = [];

afterEach(() => {
  for (const session of sessions.splice(0)) session.dispose();
});

describe('spawnPty harness self-test', () => {
  it('waits for a marker and reports the real exit code', async () => {
    const session = spawnPty({
      command: process.execPath,
      args: ['-e', 'process.stdout.write("MARKER_OK\\n"); setTimeout(() => process.exit(3), 50);'],
      cwd: PACKAGE_DIR,
      env: {
        PATH: process.env['PATH'] ?? '',
        HOME: process.env['HOME'] ?? '',
        TERM: 'xterm-256color',
      },
    });
    sessions.push(session);

    await session.waitFor('MARKER_OK', 5_000);
    expect(session.snapshot()).toContain('MARKER_OK');
    expect(await session.expectExit(5_000)).toBe(3);
  });

  it('paces sent keys and reads them back from the child', async () => {
    const session = spawnPty({
      command: 'sh',
      args: ['-c', 'IFS= read -r line; printf "ECHO:[%s]\\n" "$line"'],
      cwd: PACKAGE_DIR,
      env: {
        PATH: process.env['PATH'] ?? '',
        HOME: process.env['HOME'] ?? '',
        TERM: 'xterm-256color',
      },
    });
    sessions.push(session);

    await session.sendKeys('abc', 10);
    session.write('\r');
    await session.waitFor('ECHO:[abc]', 5_000);
    expect(await session.expectExit(5_000)).toBe(0);
  });
});
