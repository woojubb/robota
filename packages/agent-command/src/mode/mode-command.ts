import { selectAction } from '@robota-sdk/agent-core';
import {
  buildPermissionModeSubcommands,
  formatInvalidPermissionModeMessage,
  isPermissionMode,
  parsePermissionModeArgument,
  readCommandPermissionMode,
  writeCommandPermissionMode,
} from '@robota-sdk/agent-framework';

import type { ICommandHostContext } from '@robota-sdk/agent-framework';
import type { ICommandResult } from '@robota-sdk/agent-interface-transport';

/**
 * Ask the user to pick a permission mode (CMD-004 inline ask). Returns the chosen mode name, or
 * `undefined` when no interactive renderer is attached or the user cancelled — the caller then reports
 * the current mode instead of changing it (never a silent guess).
 */
async function resolveModeViaAsk(context: ICommandHostContext): Promise<string | undefined> {
  const ui = context.getUserInteraction?.();
  if (!ui) return undefined;
  const options = buildPermissionModeSubcommands().map((sub) => ({
    value: sub.name,
    label: sub.name,
    description: sub.description,
  }));
  const response = await ui.ask(selectAction('mode', 'Select interaction mode', options));
  return response.type === 'answer' ? response.values[0] : undefined;
}

export async function executeModeCommand(
  context: ICommandHostContext,
  args: string,
): Promise<ICommandResult> {
  let arg: string | undefined = parsePermissionModeArgument(args);

  if (arg === undefined) {
    arg = await resolveModeViaAsk(context);
    if (arg === undefined) {
      // No interactive answer — report the current mode without changing it.
      const mode = readCommandPermissionMode(context);
      return { message: `Current mode: ${mode}`, success: true, data: { mode } };
    }
  }

  if (!isPermissionMode(arg)) {
    return {
      message: formatInvalidPermissionModeMessage(),
      success: false,
    };
  }

  writeCommandPermissionMode(context, arg);
  return {
    message: `Permission mode set to: ${arg}`,
    success: true,
    data: { mode: arg },
  };
}
