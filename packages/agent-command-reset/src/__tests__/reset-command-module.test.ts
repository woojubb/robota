import { describe, expect, it } from 'vitest';
import type { ICommandHostContext } from '@robota-sdk/agent-sdk';
import { SystemCommandExecutor } from '@robota-sdk/agent-sdk';
import {
  createResetCommandEntry,
  createResetCommandModule,
  executeResetCommand,
} from '../index.js';

const COMMAND_CONTEXT = {} as ICommandHostContext;

describe('createResetCommandModule', () => {
  it('provides reset metadata and a user-only executable command from one module owner', () => {
    const module = createResetCommandModule();
    const command = module.systemCommands?.[0];
    const entry = module.commandSources?.[0]?.getCommands()[0];

    expect(module.name).toBe('agent-command-reset');
    expect(createResetCommandEntry()).toEqual({
      name: 'reset',
      description: 'Delete settings',
      source: 'reset',
      modelInvocable: false,
    });
    expect(entry).toEqual(createResetCommandEntry());
    expect(command).toEqual(
      expect.objectContaining({
        name: 'reset',
        description: 'Delete settings',
        lifecycle: 'inline',
        userInvocable: true,
        modelInvocable: false,
      }),
    );
  });

  it('emits a typed settings reset effect without host file I/O', () => {
    const result = executeResetCommand(COMMAND_CONTEXT, '');

    expect(result).toEqual({
      success: true,
      message: 'Reset requested.',
      data: { resetRequested: true },
      effects: [{ type: 'settings-reset-requested' }],
    });
  });

  it('executes through the SDK system command executor', async () => {
    const executor = new SystemCommandExecutor([
      ...(createResetCommandModule().systemCommands ?? []),
    ]);

    const result = await executor.execute('reset', COMMAND_CONTEXT, '');

    expect(result).toEqual({
      success: true,
      message: 'Reset requested.',
      data: { resetRequested: true },
      effects: [{ type: 'settings-reset-requested' }],
    });
  });
});
