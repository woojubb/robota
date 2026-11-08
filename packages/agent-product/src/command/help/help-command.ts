import { formatCommandHelpMessage } from '@robota-sdk/agent-framework';

import type { ICommandHostCatalog } from '@robota-sdk/agent-framework';
import type { ICommandResult } from '@robota-sdk/agent-interface-command';

export function executeHelpCommand(context: ICommandHostCatalog, _args: string): ICommandResult {
  return {
    success: true,
    message: formatCommandHelpMessage(context),
  };
}
