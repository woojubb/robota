import type { ICommandHostContext, ICommandResult } from '@robota-sdk/agent-sdk';
import { clearConversationHistory } from '@robota-sdk/agent-sdk';

export const CLEAR_COMMAND_MESSAGE = 'Conversation cleared.';

export function executeClearCommand(context: ICommandHostContext, _args: string): ICommandResult {
  clearConversationHistory(context);
  return {
    success: true,
    message: CLEAR_COMMAND_MESSAGE,
    effects: [{ type: 'conversation-history-cleared' }],
  };
}
