import type { ICommandHostContext, ISystemCommand } from '../command-api/index.js';
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
  ];
}
