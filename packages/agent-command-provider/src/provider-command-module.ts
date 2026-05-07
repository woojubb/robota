import type {
  ICommand,
  ICommandModule as TCommandModule,
  ICommandSource,
  IProviderCommandModuleOptions,
  IProviderCommandSettingsAdapter,
  ISystemCommand as TSystemCommand,
} from '@robota-sdk/agent-sdk';
import { executeProviderCommand } from './provider-command-execution.js';
export type { IProviderCommandModuleOptions, IProviderCommandSettingsAdapter };

function buildProviderSubcommands(): ICommand[] {
  return [
    { name: 'current', description: 'Show current provider', source: 'provider' },
    { name: 'list', description: 'List provider profiles', source: 'provider' },
    { name: 'use', description: 'Switch provider profile', source: 'provider' },
    { name: 'add', description: 'Configure a provider profile', source: 'provider' },
    { name: 'test', description: 'Test provider profile', source: 'provider' },
  ];
}

export function createProviderCommandEntry(): ICommand {
  return {
    name: 'provider',
    description: 'Manage provider profiles',
    source: 'provider',
    modelInvocable: false,
    argumentHint: 'current | list | use <profile> | add [type] | test [profile]',
    subcommands: buildProviderSubcommands(),
  };
}

export class ProviderCommandSource implements ICommandSource {
  readonly name = 'provider';

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
    name: 'agent-command-provider',
    commandSources: [new ProviderCommandSource()],
    systemCommands: [createProviderSystemCommand(options)],
  };
}
