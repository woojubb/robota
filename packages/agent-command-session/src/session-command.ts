import type { ICommandHostContext, ICommandResult } from '@robota-sdk/agent-sdk';
import {
  RENAME_COMMAND_USAGE,
  clearConversationHistory,
  createSessionRenamedEffect,
  parseSessionNameArgument,
} from '@robota-sdk/agent-sdk';

export const CLEAR_COMMAND_MESSAGE = 'Conversation cleared.';

export function executeClearCommand(context: ICommandHostContext, _args: string): ICommandResult {
  clearConversationHistory(context);
  return {
    success: true,
    message: CLEAR_COMMAND_MESSAGE,
    effects: [{ type: 'conversation-history-cleared' }],
  };
}

export function executeRenameCommand(_context: ICommandHostContext, args: string): ICommandResult {
  const name = parseSessionNameArgument(args);
  if (name === undefined) {
    return { success: false, message: RENAME_COMMAND_USAGE };
  }

  return {
    success: true,
    message: `Session renamed to "${name}".`,
    data: { name },
    effects: [createSessionRenamedEffect(name)],
  };
}
