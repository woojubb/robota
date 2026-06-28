/**
 * TEST-007 / TERM-003 + TERM-004: `/shell` and `/editor` through a real terminal handoff, end-to-end
 * in a PTY. Drives `fixtures/command-handoff-driver.tsx` (real executors + real
 * `TerminalHandoffController`). Proves on a real TTY that the child (subshell / `$EDITOR`) receives
 * the driver's keystrokes and the command returns cleanly — the behavior only a PTY can validate
 * (the session command-pipeline path is covered by the framework functional tests with a fake
 * handoff).
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import { spawnPtyFixture } from './pty/spawn-pty.js';

import type { IPtyRunSession } from './pty/spawn-pty.js';

const FIXTURE = fileURLToPath(new URL('./fixtures/command-handoff-driver.tsx', import.meta.url));
const FAKE_EDITOR = fileURLToPath(new URL('./fixtures/fake-editor.sh', import.meta.url));
const PACKAGE_DIR = fileURLToPath(new URL('../..', import.meta.url));
const TEST_TIMEOUT_MS = 30_000;

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

describe('command handoff PTY E2E', () => {
  it(
    '/shell runs a one-shot command on the real terminal and returns its exit code',
    async () => {
      const dir = mkdtempSync(join(tmpdir(), 'robota-shell-pty-'));
      tempDirs.push(dir);
      const outputPath = join(dir, 'result.json');
      const session = spawnPtyFixture(FIXTURE, {
        argv: ['shell', outputPath, 'IFS= read -r line; printf "SHELL_GOT:[%s]\\n" "$line"'],
        cwd: PACKAGE_DIR,
        env: {
          PATH: process.env['PATH'] ?? '',
          HOME: process.env['HOME'] ?? '',
          TERM: 'xterm-256color',
        },
      });
      sessions.push(session);

      await session.waitFor('READY canHandoff=true', 10_000);
      await new Promise((resolve) => setTimeout(resolve, 300));
      await session.sendKeys('shell-input', 10);
      session.write('\r');
      await session.waitFor('CMD_DONE', 10_000);
      expect(await session.expectExit(5_000)).toBe(0);

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
      const dir = mkdtempSync(join(tmpdir(), 'robota-editor-pty-'));
      tempDirs.push(dir);
      const outputPath = join(dir, 'result.json');
      const session = spawnPtyFixture(FIXTURE, {
        argv: ['editor', outputPath, ''],
        cwd: PACKAGE_DIR,
        env: {
          PATH: process.env['PATH'] ?? '',
          HOME: process.env['HOME'] ?? '',
          TERM: 'xterm-256color',
          EDITOR: `sh ${FAKE_EDITOR}`,
        },
      });
      sessions.push(session);

      await session.waitFor('READY canHandoff=true', 10_000);
      await new Promise((resolve) => setTimeout(resolve, 300));
      await session.sendKeys('composed-in-editor', 10);
      session.write('\r');
      await session.waitFor('CMD_DONE', 10_000);
      expect(await session.expectExit(5_000)).toBe(0);

      const result = readResult(outputPath);
      expect(result.success).toBe(true);
      expect(result.message).toBe('composed-in-editor');
    },
    TEST_TIMEOUT_MS,
  );
});
