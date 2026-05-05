import type { ICommandHostContext, ICommandResult } from '@robota-sdk/agent-sdk';
import {
  RENAME_COMMAND_USAGE,
  clearConversationHistory,
  createSessionPickerRequestedEffect,
  createSessionRenamedEffect,
  formatCommandSessionReplayValidationReport,
  parseSessionNameArgument,
  readCommandSessionInfo,
  validateCommandSessionReplayLog,
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

export function executeResumeCommand(_context: ICommandHostContext, _args: string): ICommandResult {
  return {
    success: true,
    message: 'Opening session picker...',
    data: { triggerResumePicker: true },
    effects: [createSessionPickerRequestedEffect()],
  };
}

export function executeCostCommand(context: ICommandHostContext, _args: string): ICommandResult {
  const sessionInfo = readCommandSessionInfo(context);
  return {
    success: true,
    message: `Session: ${sessionInfo.sessionId}\nMessages: ${sessionInfo.messageCount}`,
    data: {
      sessionId: sessionInfo.sessionId,
      messageCount: sessionInfo.messageCount,
    },
  };
}

export function executeValidateSessionCommand(
  context: ICommandHostContext,
  _args: string,
): ICommandResult {
  const report = validateCommandSessionReplayLog(context);
  return {
    success: report.validation.ok,
    message: formatCommandSessionReplayValidationReport(report),
    data: {
      logFile: report.logFile,
      entryCount: report.entryCount,
      issueCount: report.validation.issues.length,
      ok: report.validation.ok,
    },
  };
}
