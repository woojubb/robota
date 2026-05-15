import { findProviderDefinition, formatSupportedProviderTypes } from '@robota-sdk/agent-core';
import type {
  ICommandResult,
  IProviderCommandModuleOptions,
  IProviderProfileSettings,
} from '@robota-sdk/agent-sdk';
import { testProviderProfileCommand } from '@robota-sdk/agent-sdk';
import { formatProviderSetupChoiceLabel } from './provider-setup-flow.js';
import { createSetupFlow, createProviderSetupInteraction } from './provider-command-setup.js';
import { buildProviderSwitch } from './provider-command-profile-operations.js';
import { createProviderProfileSelectionInteraction } from './provider-command-profile.js';

export async function executeProviderCommand(
  args: string,
  options: IProviderCommandModuleOptions,
): Promise<ICommandResult> {
  const settings = options.settings.readMergedSettings();
  const trimmedArgs = args.trim();
  if (trimmedArgs.length === 0) {
    return buildProviderProfilePicker(settings.currentProvider, settings.providers, options);
  }
  const [subcommand = 'current', profileArg] = trimmedArgs.split(/\s+/);

  if (subcommand === 'list') {
    return buildProviderProfilePicker(settings.currentProvider, settings.providers, options);
  }
  if (subcommand === 'current' || subcommand === '') {
    return {
      message: formatCurrentProvider(settings.currentProvider, settings.providers),
      success: true,
    };
  }
  if (subcommand === 'use') {
    return buildProviderSwitch(settings.providers, profileArg, options);
  }
  if (subcommand === 'test') {
    return await testProviderProfileCommand(
      settings.currentProvider,
      settings.providers,
      profileArg,
      options,
    );
  }
  if (subcommand === 'add') {
    return buildProviderSetup(profileArg, options);
  }

  return {
    message: 'Usage: provider [current|list|use <profile>|add <type>|test [profile]]',
    success: false,
  };
}

function buildProviderProfilePicker(
  currentProvider: string | undefined,
  providers: Record<string, IProviderProfileSettings> | undefined,
  options: IProviderCommandModuleOptions,
): ICommandResult {
  const message = formatProviderList(currentProvider, providers);
  if (Object.keys(providers ?? {}).length === 0) {
    return { message, success: true };
  }
  return {
    message,
    success: true,
    interaction: createProviderProfileSelectionInteraction(currentProvider, providers, options),
  };
}

function formatProviderList(
  currentProvider: string | undefined,
  providers: Record<string, IProviderProfileSettings> | undefined,
): string {
  const entries = Object.entries(providers ?? {});
  if (entries.length === 0) {
    return 'No provider profiles configured.';
  }
  return entries
    .map(([name, profile]) => {
      const marker = name === currentProvider ? '*' : '-';
      return `${marker} ${name}: ${profile.type ?? 'unknown'} ${profile.model ?? '(no model)'}`;
    })
    .join('\n');
}

function formatCurrentProvider(
  currentProvider: string | undefined,
  providers: Record<string, IProviderProfileSettings> | undefined,
): string {
  if (!currentProvider) {
    return 'No current provider configured.';
  }
  const profile = providers?.[currentProvider];
  if (!profile) {
    return `Current provider "${currentProvider}" was not found in providers.`;
  }
  return [
    `Current provider: ${currentProvider}`,
    `Type: ${profile.type ?? 'unknown'}`,
    `Model: ${profile.model ?? '(no model)'}`,
    ...(profile.baseURL ? [`Base URL: ${profile.baseURL}`] : []),
  ].join('\n');
}

function buildProviderSetup(
  type: string | undefined,
  options: IProviderCommandModuleOptions,
): ICommandResult {
  if (type === undefined || type.length === 0) {
    return {
      message: 'Provider setup requested. Select a provider to continue.',
      success: true,
      interaction: createProviderSelectionInteraction(options),
    };
  }
  if (findProviderDefinition(options.providerDefinitions, type) === undefined) {
    return {
      message: `Usage: provider add <type>. Supported: ${formatSupportedProviderTypes(options.providerDefinitions)}`,
      success: false,
    };
  }
  return {
    message: `Provider setup requested: ${type}`,
    success: true,
    interaction: createProviderSetupInteraction(createSetupFlow(type, options), options),
  };
}

function createProviderSelectionInteraction(options: IProviderCommandModuleOptions) {
  return {
    prompt: {
      kind: 'choice' as const,
      title: 'Select provider',
      options: options.providerDefinitions.map((definition) => ({
        value: definition.type,
        label: formatProviderSetupChoiceLabel(definition),
      })),
      maxVisible: 6,
    },
    submit: (value: string) => {
      const flow = createSetupFlow(value, options);
      return {
        message: `Provider setup requested: ${value}`,
        success: true,
        interaction: createProviderSetupInteraction(flow, options),
      };
    },
    cancel: () => ({ message: 'Provider setup cancelled.', success: true }),
  };
}
