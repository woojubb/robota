/**
 * TERM-003: `/shell` — framework functional test.
 *
 * Drives the command through a REAL InteractiveSession (scripted provider) with an injected fake
 * terminal-handoff capability: the command routes a one-shot shell command through `runWithTerminal`
 * (suspend → spawn shell with inherited stdio → restore) and reports its exit code; and is
 * unavailable when no interactive terminal exists. (Real interactive input is manual — TERM-002.)
 */
import { afterEach, describe, expect, it } from 'vitest';

import { scriptedSession, type ScriptedSessionHarness } from '@robota-sdk/agent-framework/testing';

import { createShellCommandModule } from '../shell-command-module.js';

import type { ITerminalHandoff } from '@robota-sdk/agent-interface-transport';

const TEST_TIMEOUT = 20_000;

function fakeHandoff(canHandoff: boolean): ITerminalHandoff & { readonly events: string[] } {
  const events: string[] = [];
  return {
    events,
    canHandoffTerminal: canHandoff,
    async runWithTerminal<T>(fn: () => Promise<T>): Promise<T> {
      events.push('suspend');
      try {
        return await fn();
      } finally {
        events.push('restore');
      }
    },
  };
}

let h: ScriptedSessionHarness | undefined;
afterEach(async () => {
  await h?.dispose();
  h = undefined;
});

describe('/shell command (framework functional)', () => {
  it(
    'runs a one-shot command through the handoff and returns exit code 0',
    async () => {
      const handoff = fakeHandoff(true);
      h = scriptedSession({
        turns: [{ text: 'unused' }],
        terminalHandoff: handoff,
        commandModules: [createShellCommandModule()],
      });

      const result = await h.command('shell', 'exit 0');

      expect(result?.success).toBe(true);
      expect((result?.data as { exitCode: number }).exitCode).toBe(0);
      // The command went through the transport handoff (suspend → run → restore).
      expect(handoff.events).toEqual(['suspend', 'restore']);
    },
    TEST_TIMEOUT,
  );

  it(
    'reports a non-zero exit code from the child',
    async () => {
      const handoff = fakeHandoff(true);
      h = scriptedSession({
        turns: [{ text: 'unused' }],
        terminalHandoff: handoff,
        commandModules: [createShellCommandModule()],
      });

      const result = await h.command('shell', 'exit 3');

      expect(result?.success).toBe(false);
      expect((result?.data as { exitCode: number }).exitCode).toBe(3);
    },
    TEST_TIMEOUT,
  );

  it(
    'is unavailable when there is no interactive terminal',
    async () => {
      // No terminalHandoff injected → canHandoffTerminal() is false.
      h = scriptedSession({
        turns: [{ text: 'unused' }],
        commandModules: [createShellCommandModule()],
      });

      const result = await h.command('shell', 'exit 0');

      expect(result?.success).toBe(false);
      expect(result?.message).toMatch(/unavailable/i);
    },
    TEST_TIMEOUT,
  );
});
