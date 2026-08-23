import { formatSupportedProviderTypes, type IProviderDefinition } from '@robota-sdk/agent-core';
import type { IParsedCliArgs } from '../utils/cli-args.js';
import {
  applyProviderConfiguration,
  applyProviderSwitch,
  createDefaultUserSettingsSources,
  createNodeHostSettingsStore,
  getUserSettingsPath,
  readMergedProviderSettings,
  resolveProviderSettingsWriteTarget,
  WorkspaceAuthorityRequiredError,
} from '@robota-sdk/agent-framework';
import type {
  ISettingsDocumentStore,
  TSettingsScope,
  TSettingsSource,
} from '@robota-sdk/agent-framework';
import { createDefaultProviderDefinitions } from '@robota-sdk/agent-builtin-providers';
import { type IProviderSetupInput } from '@robota-sdk/agent-framework';
import {
  ensureProviderConfig,
  runProviderStartupSetup,
  type TPromptInput,
} from '@robota-sdk/agent-command';
import type { ITerminalOutput } from '@robota-sdk/agent-core';

export interface IProviderStartupSettingsAccess {
  readonly settingsSources?: readonly TSettingsSource[];
  readonly settingsStores?: readonly ISettingsDocumentStore[];
}

function resolveStartupSettingsAccess(
  access: IProviderStartupSettingsAccess,
): Required<IProviderStartupSettingsAccess> {
  return {
    settingsSources: access.settingsSources ?? createDefaultUserSettingsSources(),
    settingsStores: access.settingsStores ?? [
      createNodeHostSettingsStore('user', getUserSettingsPath()),
    ],
  };
}

function selectStartupSettingsStore(
  stores: readonly ISettingsDocumentStore[],
  scope: TSettingsScope | undefined,
): ISettingsDocumentStore {
  if (scope === undefined) return resolveProviderSettingsWriteTarget(stores);
  const targetScope = scope === 'user' ? 'user' : 'project-local';
  const store = stores.findLast((candidate) => candidate.scope === targetScope);
  if (store !== undefined) return store;
  throw new WorkspaceAuthorityRequiredError(
    `No authorized ${targetScope} settings store is available.`,
  );
}

function validateSettingsScope(scope: string | undefined): TSettingsScope | undefined {
  if (scope === undefined || scope === 'user' || scope === 'project-local') {
    return scope as TSettingsScope | undefined;
  }
  throw new Error(`Invalid --settings-scope "${scope}". Valid: user | project-local`);
}

export function handleProviderConfigurationArgs(
  _cwd: string,
  args: IParsedCliArgs,
  terminal: ITerminalOutput,
  providerDefinitions: readonly IProviderDefinition[] = createDefaultProviderDefinitions(),
  settingsAccess: IProviderStartupSettingsAccess = {},
): boolean {
  const scope = validateSettingsScope(args.settingsScope);
  const access = resolveStartupSettingsAccess(settingsAccess);
  const settingsStore = selectStartupSettingsStore(access.settingsStores, scope);
  const settingsSources = access.settingsSources;
  if (args.configureProvider) {
    applyProviderConfiguration(settingsStore, buildSetupInputFromArgs(args), {
      providerDefinitions,
    });
    terminal.writeLine(`Provider profile saved to ${settingsStore.displayName}`);
    return !args.printMode && args.positional.length === 0;
  }
  if (args.provider && args.setCurrent) {
    applyProviderSwitch(settingsStore, args.provider, {
      knownProviders: readMergedProviderSettings(settingsSources).providers,
    });
    terminal.writeLine(`Current provider set to ${args.provider}`);
    return !args.printMode && args.positional.length === 0;
  }
  return false;
}

export async function ensureConfig(
  cwd: string,
  args: IParsedCliArgs,
  promptInput: TPromptInput,
  terminal: ITerminalOutput,
  providerDefinitions: readonly IProviderDefinition[] = createDefaultProviderDefinitions(),
  isInteractive?: boolean,
  settingsAccess: IProviderStartupSettingsAccess = {},
): Promise<void> {
  const access = resolveStartupSettingsAccess(settingsAccess);
  await ensureProviderConfig(
    cwd,
    {
      provider: args.provider,
      settingsScope: validateSettingsScope(args.settingsScope),
      settingsSources: access.settingsSources,
      settingsStores: access.settingsStores,
    },
    promptInput,
    terminal,
    providerDefinitions,
    {
      formatError: formatMissingProviderConfigMessage,
      isInteractive:
        isInteractive !== undefined
          ? () => isInteractive
          : () => process.stdin.isTTY === true && process.stdout.isTTY === true,
    },
  );
}

export async function runInteractiveProviderSetup(
  cwd: string,
  args: IParsedCliArgs,
  promptInput: TPromptInput,
  terminal: ITerminalOutput,
  providerDefinitions: readonly IProviderDefinition[] = createDefaultProviderDefinitions(),
  settingsAccess: IProviderStartupSettingsAccess = {},
): Promise<void> {
  const access = resolveStartupSettingsAccess(settingsAccess);
  await runProviderStartupSetup(
    cwd,
    {
      settingsScope: validateSettingsScope(args.settingsScope),
      settingsSources: access.settingsSources,
      settingsStores: access.settingsStores,
    },
    promptInput,
    terminal,
    providerDefinitions,
  );
}

function buildSetupInputFromArgs(args: IParsedCliArgs): IProviderSetupInput {
  const type = args.providerType ?? args.configureProvider;
  if (!args.configureProvider || !type) {
    throw new Error('--configure-provider requires a provider profile and --type');
  }
  return {
    profile: args.configureProvider,
    type,
    ...(args.model !== undefined && { model: args.model }),
    ...(args.apiKey !== undefined && { apiKey: args.apiKey }),
    ...(args.apiKeyEnv !== undefined && { apiKeyEnv: args.apiKeyEnv }),
    ...(args.baseURL !== undefined && { baseURL: args.baseURL }),
    setCurrent: args.setCurrent,
  };
}

export function formatMissingProviderConfigMessage(
  providerDefinitions: readonly IProviderDefinition[] = createDefaultProviderDefinitions(),
): string {
  return [
    'No provider configuration found.',
    'Run `robota --configure` in an interactive terminal, or configure a provider:',
    `Supported providers: ${formatSupportedProviderTypes(providerDefinitions)}`,
    ...providerDefinitions.map(formatConfigureProviderExample),
  ].join('\n');
}

function formatConfigureProviderExample(definition: IProviderDefinition): string {
  const flags = [
    `robota --configure-provider ${definition.type}`,
    `--type ${definition.type}`,
    ...(definition.defaults?.baseURL !== undefined ? ['--base-url <url>'] : []),
    '--model <model>',
    ...(definition.requiresApiKey === true ? ['--api-key-env <ENV_NAME>'] : []),
    '--set-current',
  ];
  return `  ${flags.join(' ')}`;
}
