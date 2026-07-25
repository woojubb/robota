/**
 * TEST-007: self-test for the shared PTY harness (relocated to @robota-sdk/agent-testing by INFRA-016).
 *
 * Drives a trivial process (no fixture needed) through `spawnPty` to pin the harness contract:
 * `waitFor` resolves on a printed marker, `expectExit` returns the real exit code, and
 * `snapshot()`/`raw()` capture output. The terminal-handoff suites (in agent-transport-tui) are the
 * harness's real-world consumers; this guards the harness itself.
 *
 * HARNESS-025 adds the HOME-isolation contract: a PTY child must never receive the developer's real
 * `HOME`, or the suite silently depends on whatever is in that home directory.
 */
import { existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import { createIsolatedHome, createPtyEnv } from '../isolated-home.js';
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
      env: createPtyEnv(),
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
      env: createPtyEnv(),
    });
    sessions.push(session);

    await session.sendKeys('abc', 10);
    session.write('\r');
    await session.waitFor('ECHO:[abc]', 5_000);
    expect(await session.expectExit(5_000)).toBe(0);
  });
});

describe('PTY HOME isolation', () => {
  /** Ask the child to report the HOME it actually sees, so the assertion is on the child's view. */
  function spawnHomeReporter(env?: NodeJS.ProcessEnv): IPtyRunSession {
    const session = spawnPty({
      command: 'sh',
      args: ['-c', 'printf "CHILD_HOME:[%s]\\n" "$HOME"'],
      cwd: PACKAGE_DIR,
      ...(env ? { env } : {}),
    });
    sessions.push(session);
    return session;
  }

  function readReportedHome(snapshot: string): string {
    const match = /CHILD_HOME:\[([^\]]*)\]/.exec(snapshot);
    if (match?.[1] === undefined) throw new Error(`child never reported HOME:\n${snapshot}`);
    return match[1];
  }

  it('does not hand the real HOME to a child when no env is supplied', async () => {
    const realHome = process.env['HOME'];
    expect(
      realHome,
      'the test host must have a HOME for this assertion to mean anything',
    ).toBeTruthy();

    const session = spawnHomeReporter();
    await session.waitFor('CHILD_HOME:[', 5_000);
    await session.expectExit(5_000);

    const childHome = readReportedHome(session.snapshot());
    expect(childHome).not.toBe(realHome);
    expect(childHome.startsWith(tmpdir())).toBe(true);
  });

  it('hands the child the isolated HOME built by createPtyEnv', async () => {
    const env = createPtyEnv();
    const session = spawnHomeReporter(env);
    await session.waitFor('CHILD_HOME:[', 5_000);
    await session.expectExit(5_000);

    expect(readReportedHome(session.snapshot())).toBe(env['HOME']);
    expect(env['HOME']).not.toBe(process.env['HOME']);
  });

  it('creates an EMPTY home directory, so no user config can leak in', () => {
    const home = createIsolatedHome();
    expect(existsSync(home)).toBe(true);
    expect(readdirSync(home)).toEqual([]);
    expect(home).not.toBe(process.env['HOME']);
  });

  it('lets an override customize the env without reintroducing the real HOME', () => {
    const env = createPtyEnv({ EDITOR: 'sh /tmp/fake-editor.sh' });
    expect(env['EDITOR']).toBe('sh /tmp/fake-editor.sh');
    expect(env['TERM']).toBe('xterm-256color');
    expect(env['PATH']).toBe(process.env['PATH']);
    expect(env['HOME']).not.toBe(process.env['HOME']);
  });
});
