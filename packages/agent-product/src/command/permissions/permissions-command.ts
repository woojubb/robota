import {
  formatCommandPermissionsMessage,
  formatInvalidPermissionModeMessage,
  isPermissionMode,
  parsePermissionModeArgument,
  readCommandPermissionsState,
  retryCommandPermissionDenial,
  writeCommandPermissionMode,
} from '@robota-sdk/agent-framework';

import type {
  ICommandHostAdapterAccess,
  ICommandHostSessionAccess,
} from '@robota-sdk/agent-framework';
import type { TPermissionMode } from '@robota-sdk/agent-core';
import type { ICommandResult } from '@robota-sdk/agent-interface-command';

/** Switch the mode, or the refusal to show when the session will not enter it. */
export function tryWritePermissionMode(
  context: ICommandHostAdapterAccess & ICommandHostSessionAccess,
  mode: TPermissionMode,
): ICommandResult | undefined {
  try {
    writeCommandPermissionMode(context, mode);
    return undefined;
  } catch (error) {
    return { message: error instanceof Error ? error.message : String(error), success: false };
  }
}

function executeRetry(
  context: ICommandHostAdapterAccess & ICommandHostSessionAccess,
  args: string,
): ICommandResult {
  const position = Number(args.trim().split(/\s+/)[1]);
  const denial = retryCommandPermissionDenial(context, position);
  if (denial === undefined) {
    return {
      message:
        'Usage: /permissions retry <n>, where <n> numbers a call blocked by the auto-mode ' +
        'classifier in /permissions.',
      success: false,
    };
  }
  const call =
    denial.argument !== undefined ? `${denial.toolName}(${denial.argument})` : denial.toolName;
  return {
    message: `${call} will run once, without the classifier, when the model tries it again.`,
    success: true,
  };
}

export function executePermissionsCommand(
  context: ICommandHostAdapterAccess & ICommandHostSessionAccess,
  args: string,
): ICommandResult {
  const arg = parsePermissionModeArgument(args);
  if (arg === 'retry') return executeRetry(context, args);
  if (arg !== undefined) {
    if (!isPermissionMode(arg)) {
      return {
        message: formatInvalidPermissionModeMessage(),
        success: false,
      };
    }

    const refused = tryWritePermissionMode(context, arg);
    if (refused !== undefined) return refused;
    const state = readCommandPermissionsState(context);
    return {
      message: `Permission mode set to: ${arg}\n${formatCommandPermissionsMessage(state)}`,
      success: true,
      data: {
        mode: state.mode,
        sessionAllowed: state.sessionAllowed,
      },
    };
  }

  const state = readCommandPermissionsState(context);
  return {
    message: formatCommandPermissionsMessage(state),
    success: true,
    data: {
      mode: state.mode,
      sessionAllowed: state.sessionAllowed,
    },
  };
}
