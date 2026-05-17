import { formatCommandHelpMessage } from '@robota-sdk/agent-framework';

import type { ICommandHostContext, ICommandResult } from '@robota-sdk/agent-framework';

export function executeHelpCommand(context: ICommandHostContext, _args: string): ICommandResult {
  return {
    success: true,
    message: formatCommandHelpMessage(context),
  };
}
