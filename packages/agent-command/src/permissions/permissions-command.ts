import {
  formatCommandPermissionsMessage,
  formatInvalidPermissionModeMessage,
  isPermissionMode,
  parsePermissionModeArgument,
  readCommandPermissionsState,
  writeCommandPermissionMode,
} from '@robota-sdk/agent-framework';

import type { ICommandHostContext } from '@robota-sdk/agent-framework';
import type { ICommandResult } from '@robota-sdk/agent-interface-transport';

export function executePermissionsCommand(
  context: ICommandHostContext,
  args: string,
): ICommandResult {
  const arg = parsePermissionModeArgument(args);
  if (arg !== undefined) {
    if (!isPermissionMode(arg)) {
      return {
        message: formatInvalidPermissionModeMessage(),
        success: false,
      };
    }

    writeCommandPermissionMode(context, arg);
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
