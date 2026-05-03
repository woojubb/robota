import { describe, expect, it } from 'vitest';
import { BuiltinCommandSource } from '../builtin-source.js';
import { CommandRegistry } from '../command-registry.js';
import type { ICommandModule } from '../../command-api/command-module.js';

describe('CommandRegistry capability descriptors', () => {
  it('does not project /agent from core built-ins when the agent source is not composed', () => {
    const registry = new CommandRegistry();
    registry.addSource(new BuiltinCommandSource());

    const descriptors = registry.getCapabilityDescriptors();
    const agent = descriptors.find((descriptor) => descriptor.name === '/agent');

    expect(agent).toBeUndefined();
  });

  it('does not expose ordinary built-ins as model-invocable commands', () => {
    const registry = new CommandRegistry();
    registry.addSource(new BuiltinCommandSource());

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
