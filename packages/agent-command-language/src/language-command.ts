import type { ICommandHostContext, ICommandResult } from '@robota-sdk/agent-sdk';
import { formatLanguageUsageMessage, parseLanguageArgument } from '@robota-sdk/agent-sdk';

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
