/**
 * `/shell` and `/editor` through a real terminal handoff, end-to-end
 * in a PTY. Drives `fixtures/command-handoff-driver.tsx` (real executors + real
 * `TerminalHandoffController`). Proves on a real TTY that the child (subshell / `$EDITOR`) receives
 * the driver's keystrokes and the command returns cleanly — the behavior only a PTY can validate
 * (the session command-pipeline path is covered by the framework functional tests with a fake
 * handoff).
 */
import { mkdtempSync, readFileSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import { createPtyEnv } from './pty/isolated-home.js';
import { spawnPtyFixture } from './pty/spawn-pty.js';

import type { IPtyRunSession } from './pty/spawn-pty.js';

const FIXTURE = fileURLToPath(new URL('./fixtures/command-handoff-driver.tsx', import.meta.url));
const FAKE_EDITOR = fileURLToPath(new URL('./fixtures/fake-editor.cjs', import.meta.url));
const PACKAGE_DIR = fileURLToPath(new URL('../..', import.meta.url));
/**
 * One wait per phase. Each phase starts a cold node process (the TSX fixture, then the child that
 * takes the terminal), and on a loaded Windows runner a cold start takes several times as long as on
 * a developer machine, so the Windows bound is three times the POSIX one.
 */
const PHASE_TIMEOUT_MS = process.platform === 'win32' ? 30_000 : 10_000;
const TEST_TIMEOUT_MS = PHASE_TIMEOUT_MS * 3;

const tempDirs: string[] = [];
const sessions: IPtyRunSession[] = [];

afterEach(() => {
  for (const session of sessions.splice(0)) session.dispose();
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

interface IResult {
  success: boolean;
  message: string;
  exitCode?: number;
}

function readResult(outputPath: string): IResult {
  return JSON.parse(readFileSync(outputPath, 'utf8')) as IResult;
}

/**
 * Types `text` into the handed-off child and gives the terminal back, waiting for each side to say
 * it owns the terminal before sending keys to it. Neither wait can be a sleep: keys sent before the
 * child holds the terminal reach the TUI's own input hook and are consumed there, and a key sent
 * before that hook has mounted again is dropped, so the command would wait for input forever.
 */
async function typeIntoChildAndResume(
  session: IPtyRunSession,
  childReady: string,
  text: string,
): Promise<void> {
  await session.waitFor('READY canHandoff=true', PHASE_TIMEOUT_MS);
  await session.waitFor(childReady, PHASE_TIMEOUT_MS);
  await session.sendKeys(text, 10);
  session.write('\r');
  await session.waitFor('CMD_DONE', PHASE_TIMEOUT_MS);
  await session.waitFor('INPUT_READY 2', PHASE_TIMEOUT_MS);
  session.write('r');
  await session.waitFor('INPUT_AFTER_HANDOFF r', PHASE_TIMEOUT_MS);
}

describe('command handoff PTY E2E', () => {
  it(
    '/shell runs a one-shot command on the real terminal and returns its exit code',
    async () => {
      const dir = realpathSync(mkdtempSync(join(tmpdir(), 'agent-test-shell-pty-')));
      tempDirs.push(dir);
      const outputPath = join(dir, 'result.json');
      const session = spawnPtyFixture(FIXTURE, {
        argv: ['shell', outputPath],
        cwd: PACKAGE_DIR,
        // Isolated HOME — the subshell must not read the developer's `~` (a real
        // shell rc there would otherwise change what the handoff child does).
        env: createPtyEnv(),
      });
      sessions.push(session);

      await typeIntoChildAndResume(session, 'SHELL_GOT_READY', 'shell-input');
      expect(await session.expectExit(PHASE_TIMEOUT_MS)).toBe(0);

      expect(session.snapshot()).toContain('SHELL_GOT:[shell-input]');
      const result = readResult(outputPath);
      expect(result.success).toBe(true);
      expect(result.exitCode).toBe(0);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    '/editor opens $EDITOR on the real terminal and round-trips the composed text',
    async () => {
      const dir = realpathSync(mkdtempSync(join(tmpdir(), 'agent-test-editor-pty-')));
      tempDirs.push(dir);
      const outputPath = join(dir, 'result.json');
      const session = spawnPtyFixture(FIXTURE, {
        argv: ['editor', outputPath],
        cwd: PACKAGE_DIR,
        // Isolated HOME — only the EDITOR override comes from the test, so a real
        // `~/.selected_editor` (or similar) on the host cannot influence the assertion.
        env: createPtyEnv({ EDITOR: `node ${FAKE_EDITOR}` }),
      });
      sessions.push(session);

      await typeIntoChildAndResume(session, 'EDITOR_READY', 'composed-in-editor');
      expect(await session.expectExit(PHASE_TIMEOUT_MS)).toBe(0);

      const result = readResult(outputPath);
      expect(result.success).toBe(true);
      expect(result.message).toBe('composed-in-editor');
    },
    TEST_TIMEOUT_MS,
  );
});
