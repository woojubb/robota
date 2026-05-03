import type { ICommandHostContext } from '../host-context.js';

export const CLEAR_COMMAND_DESCRIPTION = 'Clear conversation history';

export function clearConversationHistory(context: ICommandHostContext): void {
  if (context.clearConversationHistory !== undefined) {
    context.clearConversationHistory();
    return;
  }

  context.getSession().clearHistory();
}
