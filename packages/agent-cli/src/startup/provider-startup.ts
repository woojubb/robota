import { formatSupportedProviderTypes, type IProviderDefinition } from '@robota-sdk/agent-core';
import type { IParsedCliArgs } from '../utils/cli-args.js';
import {
  applyProviderConfiguration,
  applyProviderSwitch,
  readMergedProviderSettings,
  readProviderSettings,
  resolveProviderSettingsWriteTarget,
  WorkspaceAuthorityRequiredError,
} from '@robota-sdk/agent-framework';
import type {
  ISettingsDocumentStore,
  TSettingsScope,
  TSettingsSource,
  IProviderConnectionHost,
  IOrgPolicy,
} from '@robota-sdk/agent-framework';
import { createDefaultProviderDefinitions } from '@robota-sdk/agent-builtin-providers';
import { type IProviderSetupInput } from '@robota-sdk/agent-framework';
import {
  ensureProviderConfig,
  runProviderStartupSetup,
  type TPromptInput,
} from '@robota-sdk/agent-command';
import type { ITerminalOutput, IUserInteraction } from '@robota-sdk/agent-core';
import type { IProviderDefinitionConfig } from '@robota-sdk/agent-core';
import type { ICliRuntimeContext } from '../product/runtime-context.js';

/** All CLI provider reads use the selected invocation's file and explicit environment snapshot. */
export function readCliProviderSettings(
  runtime: ICliRuntimeContext,
  settingsSources: readonly TSettingsSource[],
  providerDefinitions: readonly IProviderDefinition[],
  providerOverride?: string,
): IProviderDefinitionConfig {
  return readProviderSettings(settingsSources, {
    providerDefinitions,
    env: runtime.environment,
    ...(providerOverride !== undefined ? { providerOverride } : {}),
  });
}

export interface IProviderStartupSettingsAccess {
  readonly cliName: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly settingsSources: readonly TSettingsSource[];
  readonly settingsStores: readonly ISettingsDocumentStore[];
  readonly connectionHost?: IProviderConnectionHost;
  readonly interaction?: IUserInteraction;
  readonly orgPolicy?: IOrgPolicy;
}

function resolveStartupSettingsAccess(
  access: IProviderStartupSettingsAccess,
): IProviderStartupSettingsAccess {
  if (
    access.settingsSources === undefined ||
    access.settingsStores === undefined ||
    access.env === undefined
  )
    throw new Error(
      'Provider startup requires host-configured settings sources, stores and environment.',
    );
  return access;
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

export async function handleProviderConfigurationArgs(
  _cwd: string,
  args: IParsedCliArgs,
  terminal: ITerminalOutput,
  providerDefinitions: readonly IProviderDefinition[] = createDefaultProviderDefinitions(),
  settingsAccess: IProviderStartupSettingsAccess,
): Promise<boolean> {
  const scope = validateSettingsScope(args.settingsScope);
  const access = resolveStartupSettingsAccess(settingsAccess);
  const settingsStore = selectStartupSettingsStore(access.settingsStores, scope);
  const settingsSources = access.settingsSources;
  if (args.configureProvider) {
    const input = buildSetupInputFromArgs(args);
    const persist = (setup: IProviderSetupInput): void => {
      applyProviderConfiguration(settingsStore, setup, { providerDefinitions, env: access.env });
    };
    if (
      input.type === 'openrouter' &&
      input.apiKey !== undefined &&
      !input.apiKey.startsWith('$ENV:')
    ) {
      if (access.orgPolicy?.requireApiKeyFromEnv === true) {
        throw new Error(
          'Your organization requires environment variable API key references. Use --api-key-env <ENV_NAME>.',
        );
      }
      if (input.baseURL !== undefined && input.baseURL !== 'https://openrouter.ai/api/v1') {
        throw new Error('Stored OpenRouter credentials require https://openrouter.ai/api/v1.');
      }
      if (access.connectionHost === undefined)
        throw new Error('OpenRouter API key setup requires the local host credential port.');
      const initial = readMergedProviderSettings(settingsSources);
      const previous = JSON.stringify(initial.providers?.[input.profile]);
      await access.connectionHost.connect(
        { type: input.type, profile: input.profile, method: 'api-key', apiKey: input.apiKey },
        (reference, signal) => {
          const current = readMergedProviderSettings(settingsSources);
          if (
            JSON.stringify(current.providers?.[input.profile]) !== previous ||
            current.currentProvider !== initial.currentProvider
          ) {
            throw new Error('Provider connection changed while setup was pending.');
          }
          const { apiKey: _secret, ...rest } = input;
          signal.throwIfAborted();
          persist({ ...rest, apiKeyRef: reference });
        },
      );
    } else persist(input);
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
  isInteractive: boolean | undefined,
  settingsAccess: IProviderStartupSettingsAccess,
): Promise<void> {
  const access = resolveStartupSettingsAccess(settingsAccess);
  await ensureProviderConfig(
    cwd,
    {
      provider: args.provider,
      settingsScope: validateSettingsScope(args.settingsScope),
      settingsSources: access.settingsSources,
      settingsStores: access.settingsStores,
      env: access.env,
      connectionHost: access.connectionHost,
      interaction: access.interaction,
      orgPolicy: access.orgPolicy,
    },
    promptInput,
    terminal,
    providerDefinitions,
    {
      formatError: (definitions) => formatMissingProviderConfigMessage(definitions, access.cliName),
      env: access.env,
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
  settingsAccess: IProviderStartupSettingsAccess,
): Promise<void> {
  const access = resolveStartupSettingsAccess(settingsAccess);
  await runProviderStartupSetup(
    cwd,
    {
      settingsScope: validateSettingsScope(args.settingsScope),
      settingsSources: access.settingsSources,
      settingsStores: access.settingsStores,
      env: access.env,
      connectionHost: access.connectionHost,
      interaction: access.interaction,
      orgPolicy: access.orgPolicy,
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
  providerDefinitions: readonly IProviderDefinition[],
  cliName: string,
): string {
  return [
    'No provider configuration found.',
    `Run \`${cliName} --configure\` in an interactive terminal, or configure a provider:`,
    `Supported providers: ${formatSupportedProviderTypes(providerDefinitions)}`,
    ...providerDefinitions.map((definition) => formatConfigureProviderExample(definition, cliName)),
  ].join('\n');
}

function formatConfigureProviderExample(definition: IProviderDefinition, cliName: string): string {
  const flags = [
    `${cliName} --configure-provider ${definition.type}`,
    `--type ${definition.type}`,
    ...(definition.defaults?.baseURL !== undefined ? ['--base-url <url>'] : []),
    '--model <model>',
    ...(definition.requiresApiKey === true ? ['--api-key-env <ENV_NAME>'] : []),
    '--set-current',
  ];
  return `  ${flags.join(' ')}`;
}
