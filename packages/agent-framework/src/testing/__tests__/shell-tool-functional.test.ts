/**
 * TERM-008: cross-platform shell tool, proven through the TEST-003 functional harness.
 *
 * Drives a REAL InteractiveSession (real agent loop + builtin tools) so the OS-aware Shell tool — and
 * its model-familiar `Bash` alias — are verified end to end after the rename, not just in isolation.
 * The command executes on the host shell resolved by `resolvePlatformShell`; the per-OS resolution
 * branches (POSIX sh/bash, Windows cmd/PowerShell) are unit-tested in agent-core's platform-shell
 * tests, which can mock the platform a functional run on a single host cannot.
 */
import { resolvePlatformShell } from '@robota-sdk/agent-core';
import { afterEach, describe, expect, it } from 'vitest';

import { scriptedSession, type ScriptedSessionHarness } from '../index.js';

const TEST_TIMEOUT = 20_000;

let harness: ScriptedSessionHarness | undefined;

afterEach(async () => {
  await harness?.dispose();
  harness = undefined;
});

describe('Shell tool (TERM-008) — functional, via the scripted-session harness', () => {
  it(
    'runs a command through the real `Shell` tool and writes a file',
    async () => {
      harness = scriptedSession({
        turns: [
          {
            toolCalls: [{ name: 'Shell', args: { command: 'echo shell-fn > {{cwd}}/shell.txt' } }],
          },
          { text: 'done' },
        ],
      });

      await harness.submit('run the shell command');

      expect(harness.exists('shell.txt')).toBe(true);
      expect(harness.readFile('shell.txt').trim()).toBe('shell-fn');
      expect(harness.toolCalls().some((call) => call.name === 'Shell')).toBe(true);
    },
    TEST_TIMEOUT,
  );

  it(
    'runs the same capability through the `Bash` alias',
    async () => {
      harness = scriptedSession({
        turns: [
          { toolCalls: [{ name: 'Bash', args: { command: 'echo bash-fn > {{cwd}}/bash.txt' } }] },
          { text: 'done' },
        ],
      });

      await harness.submit('run via the bash alias');

      expect(harness.exists('bash.txt')).toBe(true);
      expect(harness.readFile('bash.txt').trim()).toBe('bash-fn');
      expect(harness.toolCalls().some((call) => call.name === 'Bash')).toBe(true);
    },
    TEST_TIMEOUT,
  );

  it('resolves a runnable host shell for this platform', () => {
    // Sanity: the functional runs above execute against whatever this resolves to.
    const shell = resolvePlatformShell();
    expect(shell.command.length).toBeGreaterThan(0);
    expect(shell.commandArgs('noop').length).toBeGreaterThan(0);
    expect(shell.label.length).toBeGreaterThan(0);
    expect(shell.syntaxHint.length).toBeGreaterThan(0);
  });
});
