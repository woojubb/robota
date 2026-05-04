import type {
  ICommand,
  ICommandModule,
  ICommandSource,
  IModelCommandModuleOptions,
  ISystemCommand,
} from '@robota-sdk/agent-sdk';
import {
  buildModelCommandSubcommands,
  MODEL_COMMAND_ARGUMENT_HINT,
  MODEL_COMMAND_DESCRIPTION,
} from '@robota-sdk/agent-sdk';
import { executeModelCommand } from './model-command.js';

export function createModelCommandEntry(options?: IModelCommandModuleOptions): ICommand {
  return {
    name: 'model',
    description: MODEL_COMMAND_DESCRIPTION,
    source: 'model',
    argumentHint: MODEL_COMMAND_ARGUMENT_HINT,
    subcommands: buildModelSubcommands(options),
  };
}

function createModelSystemCommand(options?: IModelCommandModuleOptions): ISystemCommand {
  const entry = createModelCommandEntry(options);
  return {
    name: entry.name,
    description: entry.description,
    userInvocable: true,
    argumentHint: entry.argumentHint,
    subcommands: entry.subcommands,
    lifecycle: 'inline',
    execute: (context, args) => executeModelCommand(context, args, options),
  };
}

export class ModelCommandSource implements ICommandSource {
  readonly name = 'model';

  constructor(private readonly options?: IModelCommandModuleOptions) {}

  getCommands(): ICommand[] {
    return [createModelCommandEntry(this.options)];
  }
}

export function createModelCommandModule(options?: IModelCommandModuleOptions): ICommandModule {
  return {
    name: 'agent-command-model',
    commandSources: [new ModelCommandSource(options)],
    systemCommands: [createModelSystemCommand(options)],
  };
}

function buildModelSubcommands(options?: IModelCommandModuleOptions): ICommand[] {
  if (options === undefined) {
    return buildModelCommandSubcommands('model');
  }
  return buildModelCommandSubcommands({
    source: 'model',
    providerDefinitions: options.providerDefinitions,
    settings: options.settings.readMergedSettings(),
  });
}
