import type {
  ICommand,
  ICommandModule,
  ICommandSource,
  ISystemCommand,
} from '@robota-sdk/agent-sdk';
import {
  buildModelCommandSubcommands,
  MODEL_COMMAND_ARGUMENT_HINT,
  MODEL_COMMAND_DESCRIPTION,
} from '@robota-sdk/agent-sdk';
import { executeModelCommand } from './model-command.js';

export function createModelCommandEntry(): ICommand {
  return {
    name: 'model',
    description: MODEL_COMMAND_DESCRIPTION,
    source: 'model',
    argumentHint: MODEL_COMMAND_ARGUMENT_HINT,
    subcommands: buildModelCommandSubcommands('model'),
  };
}

function createModelSystemCommand(): ISystemCommand {
  const entry = createModelCommandEntry();
  return {
    name: entry.name,
    description: entry.description,
    userInvocable: true,
    argumentHint: entry.argumentHint,
    subcommands: entry.subcommands,
    lifecycle: 'inline',
    execute: executeModelCommand,
  };
}

export class ModelCommandSource implements ICommandSource {
  readonly name = 'model';

  getCommands(): ICommand[] {
    return [createModelCommandEntry()];
  }
}

export function createModelCommandModule(): ICommandModule {
  return {
    name: 'agent-command-model',
    commandSources: [new ModelCommandSource()],
    systemCommands: [createModelSystemCommand()],
  };
}
