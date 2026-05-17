import { formatSupportedProviderTypes, type IProviderDefinition } from '@robota-sdk/agent-core';
import type { IParsedCliArgs } from '../utils/cli-args.js';
import {
  applyProviderConfiguration,
  applyProviderSwitch,
  readMergedProviderSettings,
  resolveProviderSettingsWriteTargetPath,
  resolveSettingsPathForScope,
} from '@robota-sdk/agent-framework';
import type { TSettingsScope } from '@robota-sdk/agent-framework';
import { DEFAULT_PROVIDER_DEFINITIONS } from '../utils/provider-default-definitions.js';
import { type IProviderSetupInput } from '@robota-sdk/agent-framework';
import {
  ensureProviderConfig,
  runProviderStartupSetup,
  type TPromptInput,
} from '@robota-sdk/agent-command';
import type { ITerminalOutput } from '@robota-sdk/agent-core';

function validateSettingsScope(scope: string | undefined): TSettingsScope | undefined {
  if (scope === undefined || scope === 'user' || scope === 'project-local') {
    return scope as TSettingsScope | undefined;
  }
  throw new Error(`Invalid --settings-scope "${scope}". Valid: user | project-local`);
}

export function handleProviderConfigurationArgs(
  cwd: string,
  args: IParsedCliArgs,
  terminal: ITerminalOutput,
  providerDefinitions: readonly IProviderDefinition[] = DEFAULT_PROVIDER_DEFINITIONS,
): boolean {
  const settingsPath = resolveSettingsPathForScope(cwd, validateSettingsScope(args.settingsScope));
  if (args.configureProvider) {
    applyProviderConfiguration(settingsPath, buildSetupInputFromArgs(args), {
      providerDefinitions,
    });
    terminal.writeLine(`Provider profile saved to ${settingsPath}`);
    return !args.printMode && args.positional.length === 0;
  }
  if (args.provider && args.setCurrent) {
    const switchSettingsPath =
      args.settingsScope === undefined ? resolveProviderSettingsWriteTargetPath(cwd) : settingsPath;
    applyProviderSwitch(switchSettingsPath, args.provider, {
      knownProviders: readMergedProviderSettings(cwd).providers,
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
  providerDefinitions: readonly IProviderDefinition[] = DEFAULT_PROVIDER_DEFINITIONS,
): Promise<void> {
  await ensureProviderConfig(
    cwd,
    { provider: args.provider, settingsScope: validateSettingsScope(args.settingsScope) },
    promptInput,
    terminal,
    providerDefinitions,
    { formatError: formatMissingProviderConfigMessage },
  );
}

export async function runInteractiveProviderSetup(
  cwd: string,
  args: IParsedCliArgs,
  promptInput: TPromptInput,
  terminal: ITerminalOutput,
  providerDefinitions: readonly IProviderDefinition[] = DEFAULT_PROVIDER_DEFINITIONS,
): Promise<void> {
  await runProviderStartupSetup(
    cwd,
    { settingsScope: validateSettingsScope(args.settingsScope) },
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
  providerDefinitions: readonly IProviderDefinition[] = DEFAULT_PROVIDER_DEFINITIONS,
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
