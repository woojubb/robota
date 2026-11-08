import type { ICommandResult } from '@robota-sdk/agent-interface-command';

export function executeResetCommand(): ICommandResult {
  return {
    success: true,
    message: 'Reset requested.',
    data: { resetRequested: true },
    hostActions: [{ type: 'settings-reset' }],
  };
}
