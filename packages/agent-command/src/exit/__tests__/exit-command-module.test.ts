import { describe, expect, it } from 'vitest';
import type { ICommandHostContext } from '@robota-sdk/agent-framework';
import {
  ExitCommandSource,
  createExitCommandEntry,
  createExitCommandModule,
  executeExitCommand,
} from '../index.js';

function contextWithAnswer(value: string): ICommandHostContext {
  return {
    getUserInteraction: () => ({ ask: async () => ({ type: 'answer', values: [value] }) }),
  } as unknown as ICommandHostContext;
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
    const result = await executeExitCommand({} as never, '');

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
