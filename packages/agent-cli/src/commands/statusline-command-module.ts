import type {
  ICommand,
  ICommandModule,
  ICommandSource,
  ISystemCommand,
} from '@robota-sdk/agent-sdk';
import type { TStatusLineSettingsPatch } from '../utils/statusline-settings.js';

type TStatusLineCommandAction =
  | { success: true; message: string; patch: TStatusLineSettingsPatch }
  | { success: false; message: string };

const USAGE = [
  'Usage: /statusline on | off | reset | git on | git off',
  'Fields: model, context, permission mode, message count, session name, thinking state, git branch.',
].join('\n');

function createStatusLineEntry(): ICommand {
  return {
    name: 'statusline',
    description:
      'Configure TUI status-line visibility and fields such as model, context, tokens, session, and git branch.',
    source: 'cli',
    modelInvocable: false,
    argumentHint: 'on | off | reset | git on | git off',
    subcommands: [
      { name: 'on', description: 'Show the status line', source: 'cli' },
      { name: 'off', description: 'Hide the status line', source: 'cli' },
      { name: 'reset', description: 'Restore default status-line fields', source: 'cli' },
      { name: 'git', description: 'Show or hide git branch field', source: 'cli' },
    ],
  };
}

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
      patch: { enabled: true, gitBranch: true },
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

  return { success: false, message: USAGE };
}

function createStatusLineSystemCommand(): ISystemCommand {
  const entry = createStatusLineEntry();
  return {
    name: entry.name,
    description: entry.description,
    modelInvocable: false,
    userInvocable: true,
    argumentHint: entry.argumentHint,
    execute: (_session, args) => {
      const action = parseStatusLineArgs(args);
      if (!action.success) {
        return { success: false, message: action.message };
      }
      return {
        success: true,
        message: action.message,
        effects: [{ type: 'statusline-settings-patch', patch: action.patch }],
      };
    },
  };
}

class StatusLineCommandSource implements ICommandSource {
  readonly name = 'cli-statusline';

  getCommands(): ICommand[] {
    return [createStatusLineEntry()];
  }
}

export function createStatusLineCommandModule(): ICommandModule {
  return {
    name: 'cli-statusline',
    commandSources: [new StatusLineCommandSource()],
    systemCommands: [createStatusLineSystemCommand()],
  };
}
