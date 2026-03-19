/**
 * ITerminalOutput implementation for Ink TUI.
 *
 * Permission prompts are handled by setting React state via a callback,
 * which triggers the PermissionPrompt component to render.
 * All other output methods are no-ops since Ink manages rendering.
 */

import type { ITerminalOutput, ISpinner, TToolArgs } from '@robota-sdk/agent-sdk';

export type TPermissionResolver = (toolName: string, toolArgs: TToolArgs) => Promise<boolean>;

/**
 * Create an ITerminalOutput adapter for the Ink UI.
 *
 * @param _onPermissionRequest - Called when a tool needs user approval.
 *   The function should show a UI prompt and resolve with true (allow) or false (deny).
 */
export function createInkTerminal(_onPermissionRequest: TPermissionResolver): ITerminalOutput {
  const noopSpinner: ISpinner = {
    stop: () => {},
    update: () => {},
  };

  return {
    write: () => {},
    writeLine: () => {},
    writeMarkdown: () => {},
    writeError: () => {},

    prompt: (_question: string) => Promise.resolve(''),

    select: async (options: string[], initialIndex = 0) => {
      // Called by permission-prompt.ts via promptForApproval
      // We intercept at checkPermission level instead, so this shouldn't be called
      return initialIndex;
    },

    spinner: () => noopSpinner,
  };
}
