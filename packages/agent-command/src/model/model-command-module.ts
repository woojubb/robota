import { executeModelCommand } from './model-command.js';

import type {
  ICommandModule as TCommandModule,
  IProviderCommandModuleOptions,
  ISystemCommand as TSystemCommand,
} from '@robota-sdk/agent-framework';
import type { ICommand, ICommandSource } from '@robota-sdk/agent-interface-command';
export type { IProviderCommandModuleOptions };

const MODEL_COMMAND_DESCRIPTION = 'Show/change the model';

export function createModelCommandEntry(): ICommand {
  return {
    name: 'model',
    displayName: 'Model',
    description: MODEL_COMMAND_DESCRIPTION,
    source: 'model',
    argumentHint: '[<id>]',
    example: '/model claude-sonnet-4-6',
    // User-only: switching the model changes cost and capability, so the person decides.
    modelInvocable: false,
  };
}

function createModelSystemCommand(options: IProviderCommandModuleOptions): TSystemCommand {
  const entry = createModelCommandEntry();
  return {
    name: entry.name,
    displayName: entry.displayName,
    description: entry.description,
    example: entry.example,
    requiresPermission: false,
    userInvocable: true,
    modelInvocable: false,
    argumentHint: entry.argumentHint,
    lifecycle: 'inline',
    execute: (context, args) => executeModelCommand(context, args, options),
  };
}

export class ModelCommandSource implements ICommandSource {
  readonly name = 'model';

  getCommands(): ICommand[] {
    return [createModelCommandEntry()];
  }
}

export function createModelCommandModule(options: IProviderCommandModuleOptions): TCommandModule {
  return {
    name: 'agent-command-model',
    commandSources: [new ModelCommandSource()],
    systemCommands: [createModelSystemCommand(options)],
  };
}
