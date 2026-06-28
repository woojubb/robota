/**
 * Slash-command execution — framework functional test (TEST-004).
 *
 * Runs a `/command` through the REAL session command pipeline (scripted provider, no CLI): the
 * composed command module's execute runs and returns its result.
 */
import { afterEach, describe, expect, it } from 'vitest';

import { scriptedSession, type ScriptedSessionHarness } from '../index.js';

import type { ICommandModule } from '../../command-api/index.js';

const TEST_TIMEOUT = 20_000;

/** A minimal inline command module: `/echo <text>` returns the text. */
function echoCommandModule(): ICommandModule {
  return {
    name: 'test-echo',
    systemCommands: [
      {
        name: 'echo',
        description: 'Echo the argument back.',
        userInvocable: true,
        lifecycle: 'inline',
        execute: (_context, args) => ({ message: `echo: ${args}`, success: true }),
      },
    ],
  };
}

let h: ScriptedSessionHarness | undefined;
afterEach(async () => {
  await h?.dispose();
  h = undefined;
});

describe('slash-command execution (framework functional)', () => {
  it(
    'a composed command runs through the real session pipeline and returns its result',
    async () => {
      h = scriptedSession({ turns: [{ text: 'unused' }], commandModules: [echoCommandModule()] });

      const result = await h.command('echo', 'hello world');

      expect(result).not.toBeNull();
      expect(result?.success).toBe(true);
      expect(result?.message).toBe('echo: hello world');
    },
    TEST_TIMEOUT,
  );

  it(
    'an unknown command returns null (not registered)',
    async () => {
      h = scriptedSession({ turns: [{ text: 'unused' }], commandModules: [echoCommandModule()] });
      expect(await h.command('does-not-exist')).toBeNull();
    },
    TEST_TIMEOUT,
  );
});
