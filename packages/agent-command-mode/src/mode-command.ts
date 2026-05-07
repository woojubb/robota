import type { ICommandHostContext, ICommandResult } from '@robota-sdk/agent-sdk';
import {
  formatInvalidPermissionModeMessage,
  isPermissionMode,
  parsePermissionModeArgument,
  readCommandPermissionMode,
  writeCommandPermissionMode,
} from '@robota-sdk/agent-sdk';

export function executeModeCommand(context: ICommandHostContext, args: string): ICommandResult {
  const arg = parsePermissionModeArgument(args);
  if (arg === undefined) {
    const mode = readCommandPermissionMode(context);
    return {
      message: `Current mode: ${mode}`,
      success: true,
      data: { mode },
    };
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
