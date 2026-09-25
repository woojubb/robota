import { describe, expect, it, vi } from 'vitest';

import { commandToCapabilityDescriptor } from '../capability-descriptors.js';
import { SystemCommandExecutor } from '../system-command-executor.js';
import { createTestCommandHost } from '../../testing/command-host-double.js';

import type { ISystemCommand } from '../../command-api/index.js';

/** A command mixing a read-only view with user-only actions, like `/mcp`. */
function mixedCommand(execute = vi.fn(() => ({ success: true, message: 'ran' }))): ISystemCommand {
  return {
    name: 'servers',
    description: 'Manage servers',
    modelDescription: 'Show servers. Use it when a server is missing. Returns names and states.',
    argumentHint: '[status] | <approve|revoke> <id>',
    modelInvocable: true,
    subcommands: [
      { name: 'status', description: 'Show states', source: 'test', modelInvocable: true },
      {
        name: 'approve',
        description: 'Trust a server',
        argumentHint: '<id>',
        source: 'test',
        modelInvocable: false,
      },
      // Declared without a flag — e.g. added later by someone who did not know about the gate.
      { name: 'revoke', description: 'Withdraw trust', source: 'test' },
    ],
    execute,
  };
}

describe('model subcommand gate', () => {
  it('runs the bare command and an allowed subcommand for the model', async () => {
    const execute = vi.fn(() => ({ success: true, message: 'ran' }));
    const executor = new SystemCommandExecutor([mixedCommand(execute)]);
    const host = createTestCommandHost();

    expect((await executor.executeModelInvocable('servers', host, ''))?.message).toBe('ran');
    expect((await executor.executeModelInvocable('servers', host, ' status '))?.message).toBe(
      'ran',
    );
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it('refuses every other first argument before the command runs — flagged, unflagged or unknown', async () => {
    const execute = vi.fn(() => ({ success: true, message: 'ran' }));
    const executor = new SystemCommandExecutor([mixedCommand(execute)]);
    const host = createTestCommandHost();

    for (const args of ['approve srv', 'APPROVE srv', 'revoke srv', 'trust srv']) {
      const result = await executor.executeModelInvocable('servers', host, args);
      expect(result?.success, args).toBe(false);
      expect(result?.message, args).toContain('only the user can');
      expect(result?.message, args).toContain('status');
    }
    expect(execute).not.toHaveBeenCalled();
  });

  it('leaves the user path ungated', async () => {
    const execute = vi.fn(() => ({ success: true, message: 'ran' }));
    const executor = new SystemCommandExecutor([mixedCommand(execute)]);

    await executor.execute('servers', createTestCommandHost(), 'approve srv');
    expect(execute).toHaveBeenCalledOnce();
  });

  it('offers the model only the allowed subset, described in model-facing words', () => {
    const executor = new SystemCommandExecutor([mixedCommand()]);
    const [descriptor] = executor.listModelInvocableCommands();

    expect(descriptor).toMatchObject({
      name: 'servers',
      argumentHint: '[status]',
      modelInvocable: true,
    });
    expect(descriptor?.description).toBe(
      [
        'Show servers. Use it when a server is missing. Returns names and states.',
        'Subcommands you may run (bare `servers` is also allowed):',
        '- status: Show states',
      ].join('\n'),
    );
    expect(descriptor?.description).not.toContain('approve');
    expect(descriptor?.description).not.toContain('revoke');
  });

  it('projects the same model view through the registry descriptor', () => {
    const command = mixedCommand();
    const descriptor = commandToCapabilityDescriptor({
      name: command.name,
      description: command.description,
      modelDescription: command.modelDescription,
      argumentHint: command.argumentHint,
      modelInvocable: true,
      subcommands: [...(command.subcommands ?? [])],
      source: 'test',
    });

    expect(descriptor.argumentHint).toBe('[status]');
    expect(descriptor.description).not.toContain('approve');
  });

  it('does not gate a command whose subcommands declare nothing', async () => {
    const execute = vi.fn(() => ({ success: true, message: 'ran' }));
    const executor = new SystemCommandExecutor([
      {
        name: 'jobs',
        description: 'Jobs',
        argumentHint: 'PROMPT | list',
        modelInvocable: true,
        subcommands: [{ name: 'list', description: 'List jobs', source: 'test' }],
        execute,
      },
    ]);

    await executor.executeModelInvocable('jobs', createTestCommandHost(), 'write a haiku');
    expect(execute).toHaveBeenCalledOnce();
    expect(executor.listModelInvocableCommands()[0]).toMatchObject({
      description: 'Jobs',
      argumentHint: 'PROMPT | list',
    });
  });
});
