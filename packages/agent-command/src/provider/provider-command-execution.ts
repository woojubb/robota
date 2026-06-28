import {
  findProviderDefinition,
  formatSupportedProviderTypes,
  selectAction,
} from '@robota-sdk/agent-core';
import { testProviderProfileCommand } from '@robota-sdk/agent-framework';

import { buildProviderSwitch } from './provider-command-profile-operations.js';
import { askProviderProfileSelection } from './provider-command-profile.js';
import { createSetupFlow, runProviderAddSetup } from './provider-command-setup.js';
import { formatProviderSetupChoiceLabel } from './provider-setup-flow.js';

import type { IUserInteraction } from '@robota-sdk/agent-core';
import type {
  ICommandHostContext,
  IProviderCommandModuleOptions,
  IProviderProfileSettings,
} from '@robota-sdk/agent-framework';
import type { ICommandResult } from '@robota-sdk/agent-interface-transport';

export async function executeProviderCommand(
  context: ICommandHostContext,
  args: string,
  options: IProviderCommandModuleOptions,
): Promise<ICommandResult> {
  const ui = context.getUserInteraction?.();
  const settings = options.settings.readMergedSettings();
  const trimmedArgs = args.trim();
  if (trimmedArgs.length === 0) {
    return buildProviderProfilePicker(ui, settings.currentProvider, settings.providers, options);
  }
  const [subcommand = 'current', profileArg] = trimmedArgs.split(/\s+/);

  if (subcommand === 'list') {
    return buildProviderProfilePicker(ui, settings.currentProvider, settings.providers, options);
  }
  if (subcommand === 'current' || subcommand === '') {
    return {
      message: formatCurrentProvider(settings.currentProvider, settings.providers),
      success: true,
    };
  }
  if (subcommand === 'switch') {
    return buildProviderSwitch(settings.providers, profileArg, options);
  }
  if (subcommand === 'test') {
    return testProviderProfileCommand(
      settings.currentProvider,
      settings.providers,
      profileArg,
      options,
    );
  }
  if (subcommand === 'add') {
    return buildProviderSetup(ui, profileArg, options);
  }

  return {
    message: 'Usage: provider [current|list|switch <profile>|add <type>|test [profile]]',
    success: false,
  };
}

/**
 * List the provider profiles. With an interactive renderer attached, drive the inline profile picker
 * (CMD-004); without one (headless/automation) or with no profiles, return the formatted list as text.
 */
function buildProviderProfilePicker(
  ui: IUserInteraction | undefined,
  currentProvider: string | undefined,
  providers: Record<string, IProviderProfileSettings> | undefined,
  options: IProviderCommandModuleOptions,
): Promise<ICommandResult> | ICommandResult {
  if (!ui || Object.keys(providers ?? {}).length === 0) {
    return { message: formatProviderList(currentProvider, providers), success: true };
  }
  return askProviderProfileSelection(ui, currentProvider, providers, options);
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

/**
 * Configure a provider profile. With an explicit `type`, run the setup wizard directly; without one,
 * ask the user to pick a provider type first (CMD-004). Without an interactive renderer, setup cannot
 * proceed — return usage text instead of a silent guess.
 */
function buildProviderSetup(
  ui: IUserInteraction | undefined,
  type: string | undefined,
  options: IProviderCommandModuleOptions,
): Promise<ICommandResult> | ICommandResult {
  if (type === undefined || type.length === 0) {
    if (!ui) {
      return {
        message: `Usage: provider add <type>. Supported: ${formatSupportedProviderTypes(options.providerDefinitions)}`,
        success: false,
      };
    }
    return askProviderSetupType(ui, options);
  }
  if (findProviderDefinition(options.providerDefinitions, type) === undefined) {
    return {
      message: `Usage: provider add <type>. Supported: ${formatSupportedProviderTypes(options.providerDefinitions)}`,
      success: false,
    };
  }
  if (!ui) {
    return {
      message: `Provider setup for "${type}" requires an interactive session.`,
      success: false,
    };
  }
  return runProviderAddSetup(ui, createSetupFlow(type, options), options);
}

async function askProviderSetupType(
  ui: IUserInteraction,
  options: IProviderCommandModuleOptions,
): Promise<ICommandResult> {
  const typeOptions = options.providerDefinitions.map((definition) => ({
    value: definition.type,
    label: formatProviderSetupChoiceLabel(definition),
  }));
  const response = await ui.ask(
    selectAction('provider-type', 'Select provider', typeOptions, { maxVisible: 6 }),
  );
  if (response.type !== 'answer' || response.values[0] === undefined) {
    return { message: 'Provider setup cancelled.', success: true };
  }
  const type = response.values[0];
  if (findProviderDefinition(options.providerDefinitions, type) === undefined) {
    return {
      message: `Usage: provider add <type>. Supported: ${formatSupportedProviderTypes(options.providerDefinitions)}`,
      success: false,
    };
  }
  return runProviderAddSetup(ui, createSetupFlow(type, options), options);
}
