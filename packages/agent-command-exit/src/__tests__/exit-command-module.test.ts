import { describe, expect, it } from 'vitest';
import {
  ExitCommandSource,
  createExitCommandEntry,
  createExitCommandModule,
  executeExitCommand,
} from '../index.js';

describe('exit command module', () => {
  it('provides command metadata and executable registration from one module', () => {
    const entry = createExitCommandEntry();
    const module = createExitCommandModule();

    expect(entry).toEqual({
      name: 'exit',
      description: 'Exit CLI',
      source: 'exit',
      modelInvocable: false,
    });
    expect(new ExitCommandSource().getCommands()).toEqual([entry]);
    expect(module.systemCommands?.map((command) => command.name)).toEqual(['exit']);
    expect(module.commandSources?.flatMap((source) => source.getCommands())).toEqual([entry]);
  });

  it('returns the session exit effect without owning process exit', () => {
    const result = executeExitCommand({} as never, '');

    expect(result).toEqual({
      success: true,
      message: 'Exit requested.',
      effects: [{ type: 'session-exit-requested' }],
    });
  });
});
