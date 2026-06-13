import { formatLanguageUsageMessage, parseLanguageArgument } from '@robota-sdk/agent-framework';

import type { ICommandHostContext } from '@robota-sdk/agent-framework';
import type { ICommandResult } from '@robota-sdk/agent-interface-transport';

export function executeLanguageCommand(
  _context: ICommandHostContext,
  args: string,
): ICommandResult {
  const language = parseLanguageArgument(args);
  if (language === undefined) {
    return {
      message: formatLanguageUsageMessage(),
      success: false,
    };
  }

  return {
    message: `Language set to "${language}".`,
    success: true,
    data: { language },
    effects: [{ type: 'language-change-requested', language }],
  };
}
