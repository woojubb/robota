import type { ICommandHostContext, ICommandResult } from '@robota-sdk/agent-sdk';

export function executeResetCommand(_context: ICommandHostContext, _args: string): ICommandResult {
  return {
    success: true,
    message: 'Reset requested.',
    data: { resetRequested: true },
    effects: [{ type: 'settings-reset-requested' }],
  };
}
