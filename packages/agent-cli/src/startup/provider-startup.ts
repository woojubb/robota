import { formatSupportedProviderTypes, type IProviderDefinition } from '@robota-sdk/agent-core';
import type { IConfigPhaseOptions } from './args-to-options.js';
import {
  applyProviderConfiguration,
  applyProviderSwitch,
  readMergedProviderSettings,
  resolveProviderSettingsWriteTargetPath,
  resolveSettingsPathForScope,
} from '@robota-sdk/agent-framework';
import type { TSettingsScope } from '@robota-sdk/agent-framework';
import { createDefaultProviderDefinitions } from '@robota-sdk/agent-provider';
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
  opts: IConfigPhaseOptions,
  terminal: ITerminalOutput,
  providerDefinitions: readonly IProviderDefinition[] = createDefaultProviderDefinitions(),
): boolean {
  const settingsPath = resolveSettingsPathForScope(cwd, validateSettingsScope(opts.settingsScope));
  if (opts.configureProvider) {
    applyProviderConfiguration(settingsPath, buildSetupInputFromOptions(opts), {
      providerDefinitions,
    });
    terminal.writeLine(`Provider profile saved to ${settingsPath}`);
    return !opts.printMode && opts.positional.length === 0;
  }
  if (opts.provider && opts.setCurrent) {
    const switchSettingsPath =
      opts.settingsScope === undefined ? resolveProviderSettingsWriteTargetPath(cwd) : settingsPath;
    applyProviderSwitch(switchSettingsPath, opts.provider, {
      knownProviders: readMergedProviderSettings(cwd).providers,
    });
    terminal.writeLine(`Current provider set to ${opts.provider}`);
    return !opts.printMode && opts.positional.length === 0;
  }
  return false;
}

export async function ensureConfig(
  cwd: string,
  opts: IConfigPhaseOptions,
  promptInput: TPromptInput,
  terminal: ITerminalOutput,
  providerDefinitions: readonly IProviderDefinition[] = createDefaultProviderDefinitions(),
): Promise<void> {
  await ensureProviderConfig(
    cwd,
    { provider: opts.provider, settingsScope: validateSettingsScope(opts.settingsScope) },
    promptInput,
    terminal,
    providerDefinitions,
    {
      formatError: formatMissingProviderConfigMessage,
      isInteractive: () => process.stdin.isTTY === true && process.stdout.isTTY === true,
    },
  );
}

export async function runInteractiveProviderSetup(
  cwd: string,
  opts: IConfigPhaseOptions,
  promptInput: TPromptInput,
  terminal: ITerminalOutput,
  providerDefinitions: readonly IProviderDefinition[] = createDefaultProviderDefinitions(),
): Promise<void> {
  await runProviderStartupSetup(
    cwd,
    { settingsScope: validateSettingsScope(opts.settingsScope) },
    promptInput,
    terminal,
    providerDefinitions,
  );
}

function buildSetupInputFromOptions(opts: IConfigPhaseOptions): IProviderSetupInput {
  const type = opts.providerType ?? opts.configureProvider;
  if (!opts.configureProvider || !type) {
    throw new Error('--configure-provider requires a provider profile and --type');
  }
  return {
    profile: opts.configureProvider,
    type,
    ...(opts.model !== undefined && { model: opts.model }),
    ...(opts.apiKey !== undefined && { apiKey: opts.apiKey }),
    ...(opts.apiKeyEnv !== undefined && { apiKeyEnv: opts.apiKeyEnv }),
    ...(opts.baseURL !== undefined && { baseURL: opts.baseURL }),
    setCurrent: opts.setCurrent,
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
