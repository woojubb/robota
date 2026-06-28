/**
 * TERM-003: `/shell` — hand the real terminal to an interactive subshell (or run a single command
 * interactively), then return to the agent session. Uses the framework terminal-handoff capability;
 * the shell choice goes through the `resolveShell()` seam (macOS/Linux first).
 */
import { resolveShell } from './resolve-shell.js';
import { spawnInherited } from './spawn-inherited.js';

import type { ICommandHostContext } from '@robota-sdk/agent-framework';
import type { ICommandResult } from '@robota-sdk/agent-interface-transport';

export const SHELL_COMMAND_DESCRIPTION =
  'Drop to an interactive shell (or run `/shell <command>` interactively), then return to the agent.';

export async function executeShellCommand(
  context: ICommandHostContext,
  args: string,
): Promise<ICommandResult> {
  if (context.canHandoffTerminal?.() !== true || context.runWithTerminal === undefined) {
    return {
      message: 'An interactive shell is unavailable here (no interactive terminal).',
      success: false,
    };
  }

  const shell = resolveShell();
  const cwd = context.getCwd();
  const command = args.trim();

  const exitCode = await context.runWithTerminal(async () =>
    command.length > 0
      ? spawnInherited(shell.command, shell.commandArgs(command), cwd)
      : spawnInherited(shell.command, shell.interactiveArgs, cwd),
  );

  return {
    message:
      command.length > 0
        ? `Command exited (code ${exitCode}).`
        : `Shell session ended (code ${exitCode}).`,
    success: exitCode === 0,
    data: { exitCode },
  };
}
