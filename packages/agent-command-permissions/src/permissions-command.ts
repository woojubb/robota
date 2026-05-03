import type { ICommandHostContext, ICommandResult } from '@robota-sdk/agent-sdk';
import {
  formatCommandPermissionsMessage,
  readCommandPermissionsState,
} from '@robota-sdk/agent-sdk';

export function executePermissionsCommand(
  context: ICommandHostContext,
  _args: string,
): ICommandResult {
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
