import type { ICommandHostContext } from '../host-context.js';
import type { TCommandEffect } from '../effects.js';

export const CLEAR_COMMAND_DESCRIPTION = 'Clear conversation history';
export const RENAME_COMMAND_DESCRIPTION = 'Rename the current session';
export const RENAME_COMMAND_USAGE = 'Usage: rename <name>';
export const RESUME_COMMAND_DESCRIPTION = 'Resume a previous session';
export const COST_COMMAND_DESCRIPTION = 'Show session info';
export const EXIT_COMMAND_DESCRIPTION = 'Exit CLI';

export interface ICommandSessionInfo {
  sessionId: string;
  messageCount: number;
}

export function clearConversationHistory(context: ICommandHostContext): void {
  if (context.clearConversationHistory !== undefined) {
    context.clearConversationHistory();
    return;
  }

  context.getSession().clearHistory();
}

export function parseSessionNameArgument(args: string): string | undefined {
  const name = args.trim();
  return name.length > 0 ? name : undefined;
}

export function createSessionRenamedEffect(name: string): TCommandEffect {
  return { type: 'session-renamed', name };
}

export function createSessionPickerRequestedEffect(): TCommandEffect {
  return { type: 'session-picker-requested' };
}

export function createSessionExitRequestedEffect(): TCommandEffect {
  return { type: 'session-exit-requested' };
}

export function readCommandSessionInfo(context: ICommandHostContext): ICommandSessionInfo {
  const session = context.getSession();
  return {
    sessionId: session.getSessionId(),
    messageCount: session.getMessageCount(),
  };
}
