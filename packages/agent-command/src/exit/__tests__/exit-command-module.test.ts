import { describe, expect, it } from 'vitest';
import { createTestCommandHost } from '@robota-sdk/agent-framework/testing';
import {
  ExitCommandSource,
  createExitCommandEntry,
  createExitCommandModule,
  executeExitCommand,
} from '../index.js';

function contextWithAnswer(value: string) {
  // The double answers "no capability of that kind" by default; this fixture states the one
  // capability it exercises, so the precondition is declared rather than inherited.
  return createTestCommandHost({
    overrides: {
      getUserInteraction: () => ({ ask: async () => ({ type: 'answer', values: [value] }) }),
    },
  });
}

describe('exit command module', () => {
  it('provides command metadata and executable registration from one module', () => {
    const entry = createExitCommandEntry();
    const module = createExitCommandModule();

    expect(entry).toEqual({
      name: 'exit',
      displayName: 'Exit Session',
      description: 'Exit CLI',
      source: 'exit',
      modelInvocable: false,
    });
    expect(new ExitCommandSource().getCommands()).toEqual([entry]);
    expect(module.systemCommands?.map((command) => command.name)).toEqual(['exit']);
    expect(module.commandSources?.flatMap((source) => source.getCommands())).toEqual([entry]);
  });

  it('proceeds to exit with no renderer attached (no human to confirm)', async () => {
    // ARCH-029 TC-09: "no renderer attached" is a VALUE — `getUserInteraction()` returns undefined —
    // not an absent member. `{} as never` expressed it as absence, which the required member no
    // longer permits, and the double's default answers exactly this case.
    const result = await executeExitCommand(createTestCommandHost(), '');

    expect(result).toEqual({
      success: true,
      message: 'Exit requested.',
      hostActions: [{ type: 'session-exit' }],
    });
  });

  it('confirms before exiting and proceeds on yes (CMD-004)', async () => {
    const result = await executeExitCommand(contextWithAnswer('yes'), '');
    expect(result.hostActions).toEqual([{ type: 'session-exit' }]);
  });

  it('cancels the exit when the user declines (CMD-004)', async () => {
    const result = await executeExitCommand(contextWithAnswer('no'), '');
    expect(result.success).toBe(true);
    expect(result.message).toBe('Exit cancelled.');
    expect(result.hostActions).toBeUndefined();
  });
});
