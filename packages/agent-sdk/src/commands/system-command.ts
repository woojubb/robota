import type { ICommandHostContext, ISystemCommand } from '../command-api/index.js';
import { executeBackgroundCommand } from './background-command.js';
import { executeMemoryCommand } from './memory-command.js';
import { executeRewindCommand } from './rewind-command.js';
import {
  buildBackgroundSubcommands,
  buildMemorySubcommands,
  buildRewindSubcommands,
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
      name: 'clear',
      description: 'Clear conversation history',
      execute: (session, _args) => {
        const underlying = session.getSession();
        underlying.clearHistory();
        return { message: 'Conversation cleared.', success: true };
      },
    },
    {
      name: 'cost',
      description: 'Show session info',
      execute: (session, _args) => {
        const underlying = session.getSession();
        const sessionId = underlying.getSessionId();
        const messageCount = underlying.getMessageCount();
        return {
          message: `Session: ${sessionId}\nMessages: ${messageCount}`,
          success: true,
          data: { sessionId, messageCount },
        };
      },
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
      name: 'rewind',
      description: 'List edit checkpoints or restore code to a previous checkpoint.',
      argumentHint: 'list | restore CHECKPOINT_ID | code CHECKPOINT_ID | rollback CHECKPOINT_ID',
      safety: 'write',
      subcommands: buildRewindSubcommands(),
      execute: executeRewindCommand,
    },
    {
      name: 'resume',
      description: 'Resume a previous session',
      execute: (_session, _args) => ({
        message: 'Opening session picker...',
        success: true,
        data: { triggerResumePicker: true },
        effects: [{ type: 'session-picker-requested' }],
      }),
    },
    {
      name: 'background',
      description: 'List and control background tasks',
      subcommands: buildBackgroundSubcommands(),
      execute: executeBackgroundCommand,
    },
    {
      name: 'rename',
      description: 'Rename the current session',
      execute: (_session, args) => {
        const name = args.trim();
        if (!name) {
          return { message: 'Usage: rename <name>', success: false };
        }
        return {
          message: `Session renamed to "${name}".`,
          success: true,
          data: { name },
          effects: [{ type: 'session-renamed', name }],
        };
      },
    },
    {
      name: 'reset',
      description: 'Delete settings',
      execute: (_session, _args) => {
        // Settings deletion logic — caller handles actual file I/O and exit
        return {
          message: 'Reset requested.',
          success: true,
          data: { resetRequested: true },
          effects: [{ type: 'settings-reset-requested' }],
        };
      },
    },
  ];
}
