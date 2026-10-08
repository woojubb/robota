import { executeProviderCommand } from './provider-command-execution.js';

import type {
  ICommandModule as TCommandModule,
  IProviderCommandModuleOptions,
  IProviderCommandSettingsAdapter,
  ISystemCommand as TSystemCommand,
} from '@robota-sdk/agent-framework';
import type { ICommand, ICommandSource } from '@robota-sdk/agent-interface-command';
export type { IProviderCommandModuleOptions, IProviderCommandSettingsAdapter };

function buildProviderSubcommands(): ICommand[] {
  return [
    { name: 'current', description: 'Show current provider', source: 'provider' },
    { name: 'list', description: 'List provider profiles', source: 'provider' },
    { name: 'switch', description: 'Hot-swap to another provider profile', source: 'provider' },
    { name: 'add', description: 'Configure a provider profile', source: 'provider' },
    {
      name: 'edit',
      description: 'Edit a profile, including optional server credentials',
      source: 'provider',
    },
    { name: 'test', description: 'Test provider profile', source: 'provider' },
  ];
}

export function createProviderCommandEntry(): ICommand {
  return {
    name: 'provider',
    displayName: 'Provider Setup',
    description:
      'Show, configure or switch provider profiles. Suggest editing a profile when its URL, model or credentials need correction; returns profile details or the result of the change.',
    source: 'provider',
    // User-only: provider profiles hold account credentials; a credential action.
    modelInvocable: false,
    argumentHint:
      'current | list | switch <profile> | add [type] | edit <profile> | test [profile]',
    subcommands: buildProviderSubcommands(),
    example: '/provider switch production',
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
    displayName: entry.displayName,
    description: entry.description,
    example: entry.example,
    requiresPermission: false,
    userInvocable: true,
    modelInvocable: false,
    argumentHint: entry.argumentHint,
    subcommands: entry.subcommands,
    lifecycle: 'inline',
    execute: (context, args) => executeProviderCommand(context, args, options),
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
