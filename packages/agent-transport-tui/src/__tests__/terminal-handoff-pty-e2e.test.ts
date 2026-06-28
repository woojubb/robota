/**
 * TEST-007 / TERM-002: real-terminal handoff, end-to-end through a PTY.
 *
 * Drives `fixtures/terminal-handoff-driver.tsx` (a real Ink app using the real
 * `TerminalHandoffController` + `useTerminalHandoffSuspension`) inside a pseudo-terminal. This is the
 * automated replacement for the former manual-only smoke: it proves on a real TTY that
 *
 *  1. the handoff is available (`canHandoffTerminal === true` under a PTY),
 *  2. Ink releases raw mode so the inherited child receives the driver's keystrokes, and
 *  3. `runWithTerminal` RETURNS after the child exits and the TUI resumes (regression guard for the
 *     event-loop-starvation hang fixed in the controller — without the stdin release the child's
 *     exit is never observed and the TUI hangs forever).
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import { spawnPtyFixture } from './pty/spawn-pty.js';

import type { IPtyRunSession } from './pty/spawn-pty.js';

const FIXTURE = fileURLToPath(new URL('./fixtures/terminal-handoff-driver.tsx', import.meta.url));
const PACKAGE_DIR = fileURLToPath(new URL('../..', import.meta.url));
const TEST_TIMEOUT_MS = 30_000;

const tempDirs: string[] = [];
const sessions: IPtyRunSession[] = [];

afterEach(() => {
  for (const session of sessions.splice(0)) session.dispose();
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function ptyEnv(): NodeJS.ProcessEnv {
  return {
    PATH: process.env['PATH'] ?? '',
    HOME: process.env['HOME'] ?? '',
    TERM: 'xterm-256color',
  };
}

describe('terminal handoff PTY E2E', () => {
  it(
    'hands the real terminal to a child, receives its input, and resumes the TUI',
    async () => {
      const dir = mkdtempSync(join(tmpdir(), 'robota-handoff-pty-'));
      tempDirs.push(dir);
      const outputPath = join(dir, 'result.json');

      const session = spawnPtyFixture(FIXTURE, {
        argv: [outputPath],
        cwd: PACKAGE_DIR,
        env: ptyEnv(),
      });
      sessions.push(session);

      await session.waitFor('READY canHandoff=true', 10_000);
      await session.waitFor('HANDOFF_STARTED', 10_000);
      // Let the child reach its read() before sending the line.
      await new Promise((resolve) => setTimeout(resolve, 300));
      await session.sendKeys('hello-from-pty', 10);
      session.write('\r');

      // The crux: the handoff must RETURN and the TUI must resume (no hang).
      await session.waitFor('RESUMED exit=0', 10_000);
      expect(await session.expectExit(5_000)).toBe(0);

      const snapshot = session.snapshot();
      expect(snapshot).toContain('CHILD_GOT:[hello-from-pty]');

      const result = JSON.parse(readFileSync(outputPath, 'utf8')) as {
        canHandoff: boolean;
        exitCode: number;
        returned: boolean;
      };
      expect(result).toEqual({ canHandoff: true, exitCode: 0, returned: true });
    },
    TEST_TIMEOUT_MS,
  );
});
