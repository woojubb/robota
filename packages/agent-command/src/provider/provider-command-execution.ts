import {
  confirmAction,
  findProviderDefinition,
  formatSupportedProviderTypes,
  isConfirmed,
  selectAction,
} from '@robota-sdk/agent-core';
import { testProviderProfileCommand } from '@robota-sdk/agent-framework';

import {
  buildProviderDuplicate,
  buildProviderProfileDelete,
} from './provider-command-profile-lifecycle.js';
import { buildProviderEdit, buildProviderSwitch } from './provider-command-profile-operations.js';
import { askProviderProfileSelection } from './provider-command-profile.js';
import { createSetupFlow, runProviderAddSetup } from './provider-command-setup.js';
import { formatProviderSetupChoiceLabel } from './provider-setup-flow.js';

import type { IUserInteraction } from '@robota-sdk/agent-core';
import type {
  ICommandHostSetupState,
  ICommandHostUserInteraction,
  IProviderCommandModuleOptions,
  IProviderProfileSettings,
} from '@robota-sdk/agent-framework';
import type { ICommandResult } from '@robota-sdk/agent-interface-command';

export async function executeProviderCommand(
  context: ICommandHostUserInteraction & ICommandHostSetupState,
  args: string,
  options: IProviderCommandModuleOptions,
): Promise<ICommandResult> {
  const ui = context.getUserInteraction();
  // #3282 §3: the session's own live state, never inferred from settings — an ordinary env-default
  // session also has no persisted `currentProvider`, and is not in setup mode either.
  const isSetupRequired = context.isSetupRequired?.() === true;
  const settings = options.settings.readMergedSettings();
  const trimmedArgs = args.trim();
  if (trimmedArgs.length === 0) {
    return buildProviderProfilePicker(ui, settings.currentProvider, settings.providers, options);
  }
  const argTokens = trimmedArgs.split(/\s+/);
  const [subcommand = 'current', profileArg] = argTokens;

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
  // #3282 §4b: direct, non-interactive forms of what the profile-action menu otherwise reaches
  // through two asks (`askProviderProfileSelection` then `askProviderProfileAction`) — for a caller
  // (the Settings screen, or a typed command) that already names the profile and does not want the
  // "which profile" ask repeated. `edit`/`duplicate` still ask their own follow-up questions (the
  // new name, the changed fields) exactly as the menu's Edit/Duplicate do.
  if (subcommand === 'edit') {
    if (!ui) return { message: 'Provider edit requires an interactive session.', success: false };
    if (!profileArg) return { message: 'Usage: provider edit <profile>', success: false };
    return buildProviderEdit(ui, profileArg, options);
  }
  if (subcommand === 'duplicate') {
    if (!ui) return { message: 'Provider duplicate requires an interactive session.', success: false };
    if (!profileArg) return { message: 'Usage: provider duplicate <profile>', success: false };
    return buildProviderDuplicate(ui, profileArg, options);
  }
  if (subcommand === 'delete') {
    // #3282 §4b: `--confirmed` is set ONLY by the Settings screen's own write (`settings-reporter.ts`)
    // — its "Delete…" button already confirmed through its own ConfirmDialog before sending this, and
    // a modal write has nowhere to ask a follow-up question. A plainly-typed `delete <profile>` never
    // carries it, so it confirms here first when a human can answer (matching `/clear`'s "confirm only
    // when interactive; with no human the explicit form proceeds") — deleting a profile also deletes
    // its stored key, unlike `switch`, which this direct-form family otherwise mirrors.
    if (!profileArg) return { message: 'Usage: provider delete <profile>', success: false };
    const preConfirmed = argTokens.includes('--confirmed');
    if (!preConfirmed && ui) {
      const response = await ui.ask(confirmAction('provider-delete', `Delete profile "${profileArg}"?`));
      if (!isConfirmed(response)) {
        return { message: 'Provider delete cancelled.', success: true };
      }
    }
    return buildProviderProfileDelete(settings.providers, settings.currentProvider, profileArg, options);
  }
  if (subcommand === 'add') {
    return buildProviderSetup(ui, profileArg, options, isSetupRequired);
  }

  return {
    message:
      'Usage: provider [current|list|switch <profile>|edit <profile>|duplicate <profile>|delete <profile>|add <type>|test [profile]]',
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
  isSetupRequired: boolean,
): Promise<ICommandResult> | ICommandResult {
  if (type === undefined || type.length === 0) {
    if (!ui) {
      return {
        message: `Usage: provider add <type>. Supported: ${formatSupportedProviderTypes(options.providerDefinitions)}`,
        success: false,
      };
    }
    return askProviderSetupType(ui, options, isSetupRequired);
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
  return runProviderAddSetup(ui, createSetupFlow(type, options), options, isSetupRequired);
}

async function askProviderSetupType(
  ui: IUserInteraction,
  options: IProviderCommandModuleOptions,
  isSetupRequired: boolean,
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
  return runProviderAddSetup(ui, createSetupFlow(type, options), options, isSetupRequired);
}
