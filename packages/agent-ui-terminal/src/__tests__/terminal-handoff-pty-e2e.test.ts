/**
 * Real-terminal handoff, end-to-end through a PTY.
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
import { mkdtempSync, readFileSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import { waitForFixtureEvent } from './pty/fixture-events.js';
import { createPtyEnv } from './pty/isolated-home.js';
import { PTY_TIME_FACTOR, spawnPtyFixture } from './pty/spawn-pty.js';

import type { IPtyRunSession } from './pty/spawn-pty.js';

const FIXTURE = fileURLToPath(new URL('./fixtures/terminal-handoff-driver.tsx', import.meta.url));
const PACKAGE_DIR = fileURLToPath(new URL('../..', import.meta.url));
/** One wait per phase, as it would be on a developer machine; the harness scales it for the host. */
const PHASE_TIMEOUT_MS = 10_000;
const TEST_TIMEOUT_MS = PHASE_TIMEOUT_MS * 4 * PTY_TIME_FACTOR;

const tempDirs: string[] = [];
const sessions: IPtyRunSession[] = [];

afterEach(() => {
  for (const session of sessions.splice(0)) session.dispose();
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('terminal handoff PTY E2E', () => {
  it(
    'hands the real terminal to a child, receives its input, and resumes the TUI',
    async () => {
      const dir = realpathSync(mkdtempSync(join(tmpdir(), 'agent-test-handoff-pty-')));
      tempDirs.push(dir);
      const outputPath = join(dir, 'result.json');

      const session = spawnPtyFixture(FIXTURE, {
        argv: [outputPath],
        cwd: PACKAGE_DIR,
        // Isolated HOME — the child must not read the developer's `~`.
        env: createPtyEnv(),
      });
      sessions.push(session);

      await waitForFixtureEvent(session, outputPath, 'READY canHandoff=true');
      await waitForFixtureEvent(session, outputPath, 'HANDOFF_STARTED');
      // The child says so once it holds the terminal, where nothing redraws over it. Keys sent
      // before that wait in the console's input queue, and a fixed pause is not a guarantee.
      await session.waitFor('CHILD_GOT_READY', PHASE_TIMEOUT_MS);
      await session.sendKeys('hello-from-pty', 10);
      session.write('\r');

      // The crux: the handoff must RETURN and the TUI must resume (no hang).
      await waitForFixtureEvent(session, outputPath, 'RESUMED exit=0');
      expect(await session.expectExit(PHASE_TIMEOUT_MS)).toBe(0);

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
