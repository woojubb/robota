import type {
  ICommandHostContext,
  ICommandResult,
  TStatusLineCommandSettingsPatch,
} from '@robota-sdk/agent-sdk';
import { DEFAULT_STATUS_LINE_COMMAND_SETTINGS } from '@robota-sdk/agent-sdk';

interface IStatusLineCommandSuccessAction {
  success: true;
  message: string;
  patch: TStatusLineCommandSettingsPatch;
}

interface IStatusLineCommandFailureAction {
  success: false;
  message: string;
}

type TStatusLineCommandAction = IStatusLineCommandSuccessAction | IStatusLineCommandFailureAction;

export const STATUSLINE_USAGE = [
  'Usage: /statusline on | off | reset | git on | git off',
  'Fields: model, context, permission mode, message count, session name, thinking state, git branch.',
].join('\n');

function parseStatusLineArgs(args: string): TStatusLineCommandAction {
  const parts = args
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter((part) => part.length > 0);
  const [first, second] = parts;

  if (first === 'on' && second === undefined) {
    return { success: true, message: 'Status line enabled.', patch: { enabled: true } };
  }
  if (first === 'off' && second === undefined) {
    return { success: true, message: 'Status line disabled.', patch: { enabled: false } };
  }
  if (first === 'reset' && second === undefined) {
    return {
      success: true,
      message: 'Status line settings reset.',
      patch: { ...DEFAULT_STATUS_LINE_COMMAND_SETTINGS },
    };
  }
  if (first === 'git' && second === 'on' && parts.length === 2) {
    return {
      success: true,
      message: 'Status line git branch shown.',
      patch: { gitBranch: true },
    };
  }
  if (first === 'git' && second === 'off' && parts.length === 2) {
    return {
      success: true,
      message: 'Status line git branch hidden.',
      patch: { gitBranch: false },
    };
  }

  return { success: false, message: STATUSLINE_USAGE };
}

export function executeStatusLineCommand(
  _context: ICommandHostContext,
  args: string,
): ICommandResult {
  const action = parseStatusLineArgs(args);
  if (!action.success) {
    return { success: false, message: action.message };
  }

  return {
    success: true,
    message: action.message,
    effects: [{ type: 'statusline-settings-patch', patch: action.patch }],
  };
}
