import { selectAction } from '@robota-sdk/agent-core';
import {
  buildLanguageCommandSubcommands,
  formatLanguageUsageMessage,
  parseLanguageArgument,
} from '@robota-sdk/agent-framework';

import type { ICommandHostContext } from '@robota-sdk/agent-framework';
import type { ICommandResult } from '@robota-sdk/agent-interface-transport';

/**
 * Ask the user to pick a language (CMD-004 inline ask). Returns a validated language, or `undefined`
 * when no interactive renderer is attached or the user cancelled — the caller then shows usage.
 */
async function resolveLanguageViaAsk(context: ICommandHostContext): Promise<string | undefined> {
  const ui = context.getUserInteraction?.();
  if (!ui) return undefined;
  const options = buildLanguageCommandSubcommands().map((sub) => ({
    value: sub.name,
    label: sub.name,
    description: sub.description,
  }));
  const response = await ui.ask(selectAction('language', 'Select language', options));
  const picked = response.type === 'answer' ? response.values[0] : undefined;
  return picked === undefined ? undefined : parseLanguageArgument(picked);
}

export async function executeLanguageCommand(
  context: ICommandHostContext,
  args: string,
): Promise<ICommandResult> {
  let language = parseLanguageArgument(args);

  if (language === undefined) {
    language = await resolveLanguageViaAsk(context);
    if (language === undefined) {
      return {
        message: formatLanguageUsageMessage(),
        success: false,
      };
    }
  }

  return {
    message: `Language set to "${language}".`,
    success: true,
    data: { language },
    hostActions: [{ type: 'language-change', language }],
  };
}
