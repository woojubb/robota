import type { ICommandHostContext, ICommandResult } from '@robota-sdk/agent-sdk';
import { formatCommandHelpMessage } from '@robota-sdk/agent-sdk';

export function executeHelpCommand(context: ICommandHostContext, _args: string): ICommandResult {
  return {
    success: true,
    message: formatCommandHelpMessage(context),
  };
}
