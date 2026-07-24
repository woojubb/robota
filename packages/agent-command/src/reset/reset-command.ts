import type { ICommandHostContext } from '@robota-sdk/agent-framework';
import type { ICommandResult } from '@robota-sdk/agent-interface-transport';

export function executeResetCommand(_context: ICommandHostContext, _args: string): ICommandResult {
  return {
    success: true,
    message: 'Reset requested.',
    data: { resetRequested: true },
    hostActions: [{ type: 'settings-reset' }],
  };
}
