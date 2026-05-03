import type { ICommandHostContext, ISystemCommand } from '../command-api/index.js';
import { executeBackgroundCommand } from './background-command.js';
import { executeMemoryCommand } from './memory-command.js';
import {
  buildBackgroundSubcommands,
  buildMemorySubcommands,
  MEMORY_COMMAND_ARGUMENT_HINT,
  MEMORY_COMMAND_DESCRIPTION,
} from './system-command-metadata.js';
export { SystemCommandExecutor } from './system-command-executor.js';
export type {
  ICommandInteraction,
  ICommandChoicePromptOption,
  ICommandResult,
  TCommandEffect,
  TCommandResultDataValue,
  TCommandInteractionPrompt,
} from '../command-api/index.js';
export type { ISystemCommand, TSystemCommandLifecycle } from '../command-api/index.js';

function formatHelpMessage(session: ICommandHostContext): string {
  const commands =
    session.listCommands?.() ??
    createSystemCommands().map((command) => ({
      name: command.name,
      description: command.description,
    }));
  return [
    'Available commands:',
    ...commands.map((command) => `  ${command.name.padEnd(16)} — ${command.description}`),
  ].join('\n');
}

/** Built-in system commands. */
export function createSystemCommands(): ISystemCommand[] {
  return [
    {
      name: 'help',
      description: 'Show available commands',
      execute: (session, _args) => ({
        message: formatHelpMessage(session),
        success: true,
      }),
    },
    {
      name: 'memory',
      description: MEMORY_COMMAND_DESCRIPTION,
      modelInvocable: true,
      argumentHint: MEMORY_COMMAND_ARGUMENT_HINT,
      safety: 'write',
      subcommands: buildMemorySubcommands(),
      execute: executeMemoryCommand,
    },
    {
      name: 'background',
      description: 'List and control background tasks',
      subcommands: buildBackgroundSubcommands(),
      execute: executeBackgroundCommand,
    },
  ];
}
