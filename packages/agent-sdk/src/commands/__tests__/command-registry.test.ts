import { describe, expect, it } from 'vitest';
import { BuiltinCommandSource } from '../builtin-source.js';
import { CommandRegistry } from '../command-registry.js';
import type { ICommandModule } from '../../command-api/command-module.js';

describe('CommandRegistry capability descriptors', () => {
  it('replaces a named command source', () => {
    const registry = new CommandRegistry();
    registry.addSource({
      name: 'plugin',
      getCommands: () => [{ name: 'old-skill', description: 'Old skill', source: 'plugin' }],
    });
    registry.replaceSource('plugin', {
      name: 'plugin',
      getCommands: () => [{ name: 'new-skill', description: 'New skill', source: 'plugin' }],
    });

    expect(registry.getCommands().map((command) => command.name)).toEqual(['new-skill']);
  });

  it('removes a named command source when no replacement is provided', () => {
    const registry = new CommandRegistry();
    registry.addSource({
      name: 'plugin',
      getCommands: () => [{ name: 'plugin-skill', description: 'Plugin skill', source: 'plugin' }],
    });

    registry.replaceSource('plugin');

    expect(registry.getCommands()).toEqual([]);
  });

  it('does not project /agent from core built-ins when the agent source is not composed', () => {
    const registry = new CommandRegistry();
    registry.addSource(new BuiltinCommandSource());

    const descriptors = registry.getCapabilityDescriptors();
    const agent = descriptors.find((descriptor) => descriptor.name === '/agent');

    expect(agent).toBeUndefined();
  });

  it('does not expose ordinary injected commands as model-invocable commands', () => {
    const registry = new CommandRegistry();
    registry.addSource({
      name: 'help',
      getCommands: () => [
        {
          name: 'help',
          description: 'Show available commands',
          source: 'help',
          modelInvocable: false,
        },
      ],
    });

    const descriptors = registry.getCapabilityDescriptors();
    const help = descriptors.find((descriptor) => descriptor.name === '/help');

    expect(help?.modelInvocable).toBe(false);
  });

  it('projects capabilities from any injected command module', () => {
    const module: ICommandModule = {
      name: 'diagnostics-command',
      commandSources: [
        {
          name: 'diagnostics',
          getCommands: () => [
            {
              name: 'diagnose',
              description: 'Run read-only diagnostics for the current workspace',
              source: 'diagnostics',
              modelInvocable: true,
              argumentHint: '[scope]',
              safety: 'read-only',
            },
          ],
        },
      ],
    };
    const registry = new CommandRegistry();

    registry.addModule(module);

    expect(registry.getCommands().map((command) => command.name)).toEqual(['diagnose']);
    expect(registry.getCapabilityDescriptors()).toEqual([
      {
        name: '/diagnose',
        kind: 'builtin-command',
        description: 'Run read-only diagnostics for the current workspace',
        userInvocable: true,
        modelInvocable: true,
        argumentHint: '[scope]',
        safety: 'read-only',
      },
    ]);
  });
});
