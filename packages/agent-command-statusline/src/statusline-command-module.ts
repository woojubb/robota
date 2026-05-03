import type {
  ICommand,
  ICommandModule,
  ICommandSource,
  ISystemCommand,
} from '@robota-sdk/agent-sdk';
import {
  buildStatusLineCommandSubcommands,
  STATUSLINE_COMMAND_ARGUMENT_HINT,
  STATUSLINE_COMMAND_DESCRIPTION,
} from '@robota-sdk/agent-sdk';
import { executeStatusLineCommand } from './statusline-command.js';

export function createStatusLineCommandEntry(): ICommand {
  return {
    name: 'statusline',
    description: STATUSLINE_COMMAND_DESCRIPTION,
    source: 'statusline',
    argumentHint: STATUSLINE_COMMAND_ARGUMENT_HINT,
    subcommands: buildStatusLineCommandSubcommands('statusline'),
    modelInvocable: false,
  };
}

function createStatusLineSystemCommand(): ISystemCommand {
  const entry = createStatusLineCommandEntry();
  return {
    name: entry.name,
    description: entry.description,
    userInvocable: true,
    modelInvocable: false,
    argumentHint: entry.argumentHint,
    subcommands: entry.subcommands,
    lifecycle: 'inline',
    execute: executeStatusLineCommand,
  };
}

export class StatusLineCommandSource implements ICommandSource {
  readonly name = 'statusline';

  getCommands(): ICommand[] {
    return [createStatusLineCommandEntry()];
  }
}

export function createStatusLineCommandModule(): ICommandModule {
  return {
    name: 'agent-command-statusline',
    commandSources: [new StatusLineCommandSource()],
    systemCommands: [createStatusLineSystemCommand()],
  };
}
