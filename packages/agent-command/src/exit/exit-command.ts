import { confirmAction, isConfirmed } from '@robota-sdk/agent-core';
import { createSessionExitHostAction } from '@robota-sdk/agent-framework';

import type { ICommandHostContext } from '@robota-sdk/agent-framework';
import type { ICommandResult } from '@robota-sdk/agent-interface-transport';

export async function executeExitCommand(
  context: ICommandHostContext,
  _args: string,
): Promise<ICommandResult> {
  // Confirm only when an interactive renderer is attached. With no human (headless/automation) the
  // user explicitly invoked /exit, so proceed — the confirm is an interactive safety prompt, not a gate.
  const ui = context.getUserInteraction?.();
  if (ui) {
    const response = await ui.ask(confirmAction('exit', 'Exit the session?'));
    if (!isConfirmed(response)) {
      return { success: true, message: 'Exit cancelled.' };
    }
  }

  return {
    success: true,
    message: 'Exit requested.',
    hostActions: [createSessionExitHostAction()],
  };
}
