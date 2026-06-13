import { formatCommandHelpMessage } from '@robota-sdk/agent-framework';

import type { ICommandHostContext } from '@robota-sdk/agent-framework';
import type { ICommandResult } from '@robota-sdk/agent-interface-transport';

export function executeHelpCommand(context: ICommandHostContext, _args: string): ICommandResult {
  return {
    success: true,
    message: formatCommandHelpMessage(context),
  };
}
