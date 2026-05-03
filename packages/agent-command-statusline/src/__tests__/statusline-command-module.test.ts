import { describe, expect, it } from 'vitest';
import type { ICommandHostContext } from '@robota-sdk/agent-sdk';
import { SystemCommandExecutor } from '@robota-sdk/agent-sdk';
import { createStatusLineCommandModule } from '../statusline-command-module.js';

const COMMAND_CONTEXT = {} as ICommandHostContext;

describe('createStatusLineCommandModule', () => {
  it('provides statusline metadata and user-only executable command from one module owner', () => {
    const module = createStatusLineCommandModule();
    const command = module.systemCommands?.[0];
    const entry = module.commandSources?.[0]?.getCommands()[0];

    expect(module.name).toBe('agent-command-statusline');
    expect(entry).toEqual(
      expect.objectContaining({
        name: 'statusline',
        description:
          'Configure TUI status-line visibility and fields such as model, context, tokens, session, and git branch.',
        source: 'statusline',
        argumentHint: 'on | off | reset | git on | git off',
        modelInvocable: false,
      }),
    );
    expect(entry?.subcommands?.map((subcommand) => subcommand.name)).toEqual([
      'on',
      'off',
      'reset',
      'git',
    ]);
    expect(command).toEqual(
      expect.objectContaining({
        name: 'statusline',
        lifecycle: 'inline',
        userInvocable: true,
        modelInvocable: false,
      }),
    );
  });

  it.each([
    {
      args: 'on',
      message: 'Status line enabled.',
      patch: { enabled: true },
    },
    {
      args: 'off',
      message: 'Status line disabled.',
      patch: { enabled: false },
    },
    {
      args: 'reset',
      message: 'Status line settings reset.',
      patch: { enabled: true, gitBranch: true },
    },
    {
      args: 'git on',
      message: 'Status line git branch shown.',
      patch: { gitBranch: true },
    },
    {
      args: 'git off',
      message: 'Status line git branch hidden.',
      patch: { gitBranch: false },
    },
  ])(
    'emits a statusline settings patch for /statusline $args',
    async ({ args, message, patch }) => {
      const executor = new SystemCommandExecutor([
        ...(createStatusLineCommandModule().systemCommands ?? []),
      ]);

      const result = await executor.execute('statusline', COMMAND_CONTEXT, args);

      expect(result).toEqual({
        success: true,
        message,
        effects: [{ type: 'statusline-settings-patch', patch }],
      });
    },
  );

  it('reports usage for unsupported arguments without effects', async () => {
    const executor = new SystemCommandExecutor([
      ...(createStatusLineCommandModule().systemCommands ?? []),
    ]);

    const result = await executor.execute('statusline', COMMAND_CONTEXT, 'wat');

    expect(result?.success).toBe(false);
    expect(result?.message).toContain('Usage: /statusline');
    expect(result?.effects).toBeUndefined();
  });
});
