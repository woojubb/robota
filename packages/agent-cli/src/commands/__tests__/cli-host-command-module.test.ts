import { describe, expect, it } from 'vitest';
import { createCliHostCommandModule } from '../cli-host-command-module.js';

describe('createCliHostCommandModule', () => {
  it('contributes host-owned command metadata and executable commands', () => {
    const module = createCliHostCommandModule();
    const commands = module.commandSources?.flatMap((source) => source.getCommands()) ?? [];

    expect(module.name).toBe('cli-host');
    expect(commands.map((command) => command.name)).toEqual(['plugin', 'reload-plugins', 'exit']);
    expect(module.systemCommands?.map((command) => command.name)).toEqual([
      'plugin',
      'reload-plugins',
      'exit',
    ]);
  });

  it('returns typed command effects for host commands', async () => {
    const commands = createCliHostCommandModule().systemCommands ?? [];
    const plugin = commands.find((command) => command.name === 'plugin');
    const exit = commands.find((command) => command.name === 'exit');

    const pluginResult = await plugin?.execute({} as never, '');
    const exitResult = await exit?.execute({} as never, '');

    expect(pluginResult?.effects).toEqual([{ type: 'plugin-tui-requested' }]);
    expect(exitResult?.effects).toEqual([{ type: 'session-exit-requested' }]);
  });
});
