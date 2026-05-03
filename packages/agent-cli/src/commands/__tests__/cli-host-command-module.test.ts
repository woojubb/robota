import { describe, expect, it } from 'vitest';
import { createCliHostCommandModule } from '../cli-host-command-module.js';

describe('createCliHostCommandModule', () => {
  it('contributes host-owned command metadata and executable commands', () => {
    const module = createCliHostCommandModule();
    const commands = module.commandSources?.flatMap((source) => source.getCommands()) ?? [];

    expect(module.name).toBe('cli-host');
    expect(commands.map((command) => command.name)).toEqual(['reload-plugins']);
    expect(module.systemCommands?.map((command) => command.name)).toEqual(['reload-plugins']);
    expect(module.systemCommands?.map((command) => command.name)).not.toContain('plugin');
    expect(module.systemCommands?.map((command) => command.name)).not.toContain('exit');
    expect(module.systemCommands?.map((command) => command.name)).not.toContain('reset');
  });
});
