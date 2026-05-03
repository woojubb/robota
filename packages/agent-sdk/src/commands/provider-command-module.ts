import type { ICommand, ICommandSource } from './types.js';
import type { ICommandModule as TCommandModule } from './command-module.js';
import type { ISystemCommand as TSystemCommand } from './system-command.js';
import { executeProviderCommand } from './provider-command-execution.js';
import type { IProviderCommandModuleOptions } from './provider-command-types.js';
export type {
  IProviderCommandModuleOptions,
  IProviderCommandSettingsAdapter,
} from './provider-command-types.js';

function buildProviderSubcommands(): ICommand[] {
  return [
    { name: 'current', description: 'Show current provider', source: 'builtin' },
    { name: 'list', description: 'List provider profiles', source: 'builtin' },
    { name: 'use', description: 'Switch provider profile', source: 'builtin' },
    { name: 'add', description: 'Configure a provider profile', source: 'builtin' },
    { name: 'test', description: 'Test provider profile', source: 'builtin' },
  ];
}

export function createProviderCommandEntry(): ICommand {
  return {
    name: 'provider',
    description: 'Manage provider profiles',
    source: 'builtin',
    modelInvocable: false,
    argumentHint: 'current | list | use <profile> | add [type] | test [profile]',
    subcommands: buildProviderSubcommands(),
  };
}

class ProviderCommandSource implements ICommandSource {
  readonly name = 'sdk-provider';

  getCommands(): ICommand[] {
    return [createProviderCommandEntry()];
  }
}

function createProviderSystemCommand(options: IProviderCommandModuleOptions): TSystemCommand {
  const entry = createProviderCommandEntry();
  return {
    name: entry.name,
    description: entry.description,
    userInvocable: true,
    modelInvocable: false,
    argumentHint: entry.argumentHint,
    subcommands: entry.subcommands,
    execute: async (_session, args) => executeProviderCommand(args, options),
  };
}

export function createProviderCommandModule(
  options: IProviderCommandModuleOptions,
): TCommandModule {
  return {
    name: 'sdk-provider',
    commandSources: [new ProviderCommandSource()],
    systemCommands: [createProviderSystemCommand(options)],
  };
}
