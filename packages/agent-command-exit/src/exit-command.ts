import type { ICommandHostContext, ICommandResult } from '@robota-sdk/agent-sdk';
import { createSessionExitRequestedEffect } from '@robota-sdk/agent-sdk';

export function executeExitCommand(_context: ICommandHostContext, _args: string): ICommandResult {
  return {
    success: true,
    message: 'Exit requested.',
    effects: [createSessionExitRequestedEffect()],
  };
}
