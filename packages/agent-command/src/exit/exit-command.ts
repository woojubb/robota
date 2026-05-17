import { createSessionExitRequestedEffect } from '@robota-sdk/agent-framework';

import type { ICommandHostContext, ICommandResult } from '@robota-sdk/agent-framework';

export function executeExitCommand(_context: ICommandHostContext, _args: string): ICommandResult {
  return {
    success: true,
    message: 'Exit requested.',
    effects: [createSessionExitRequestedEffect()],
  };
}
