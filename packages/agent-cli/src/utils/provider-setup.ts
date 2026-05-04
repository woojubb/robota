import { join } from 'node:path';
import { formatSupportedProviderTypes, type IProviderDefinition } from './provider-definition.js';
import type { IParsedCliArgs } from './cli-args.js';
import { checkSettingsDocument } from './settings-check.js';
import { getUserSettingsPath, readSettings, writeSettings } from './settings-io.js';
import {
  applyProviderConfiguration,
  applyProviderSwitch,
  resolveProviderSettingsWriteTargetPath,
} from './provider-configuration.js';
import { getProviderSettingsPaths, readMergedProviderSettings } from './provider-factory.js';
import { DEFAULT_PROVIDER_DEFINITIONS } from './provider-default-definitions.js';
import { type IProviderSetupInput } from './provider-settings.js';
import {
  formatProviderSetupSelectionPrompt,
  resolveProviderSetupSelection,
  runProviderSetupPromptFlow,
  type TPromptInput,
} from './provider-setup-flow.js';

export function getSettingsPathForScope(cwd: string, scope: string | undefined): string {
  if (scope === undefined || scope === 'user') {
    return getUserSettingsPath();
  }
  if (scope === 'project-local') {
    return join(cwd, '.robota', 'settings.local.json');
  }
  throw new Error(`Invalid --settings-scope "${scope}". Valid: user | project-local`);
}

export function handleProviderConfigurationArgs(
  cwd: string,
  args: IParsedCliArgs,
  providerDefinitions: readonly IProviderDefinition[] = DEFAULT_PROVIDER_DEFINITIONS,
): boolean {
  const settingsPath = getSettingsPathForScope(cwd, args.settingsScope);
  if (args.configureProvider) {
    applyProviderConfiguration(settingsPath, buildSetupInputFromArgs(args), {
      providerDefinitions,
    });
    process.stdout.write(`Provider profile saved to ${settingsPath}\n`);
    return !args.printMode && args.positional.length === 0;
  }
  if (args.provider && args.setCurrent) {
    const switchSettingsPath =
      args.settingsScope === undefined ? resolveProviderSettingsWriteTargetPath(cwd) : settingsPath;
    applyProviderSwitch(switchSettingsPath, args.provider, {
      knownProviders: readMergedProviderSettings(cwd).providers,
    });
    process.stdout.write(`Current provider set to ${args.provider}\n`);
    return !args.printMode && args.positional.length === 0;
  }
  return false;
}

export async function ensureConfig(
  cwd: string,
  args: IParsedCliArgs,
  promptInput: TPromptInput,
  providerDefinitions: readonly IProviderDefinition[] = DEFAULT_PROVIDER_DEFINITIONS,
): Promise<void> {
  const merged = readMergedProviderSettings(cwd);
  const selectedSettings =
    args.provider !== undefined ? { ...merged, currentProvider: args.provider } : merged;
  if (checkSettingsDocument(selectedSettings, providerDefinitions) === 'valid') {
    return;
  }
  if (!isInteractiveTerminal()) {
    throw new Error(formatMissingProviderConfigMessage(providerDefinitions));
  }
  await runInteractiveProviderSetup(
    cwd,
    selectStartupSetupArgs(cwd, args),
    promptInput,
    providerDefinitions,
  );
  const updated = readMergedProviderSettings(cwd);
  const updatedSettings =
    args.provider !== undefined ? { ...updated, currentProvider: args.provider } : updated;
  if (checkSettingsDocument(updatedSettings, providerDefinitions) !== 'valid') {
    throw new Error(formatMissingProviderConfigMessage(providerDefinitions));
  }
}

export async function runInteractiveProviderSetup(
  cwd: string,
  args: IParsedCliArgs,
  promptInput: TPromptInput,
  providerDefinitions: readonly IProviderDefinition[] = DEFAULT_PROVIDER_DEFINITIONS,
): Promise<void> {
  const providerChoice = await promptInput(formatProviderSetupSelectionPrompt(providerDefinitions));
  const type = resolveProviderSetupSelection(providerChoice, providerDefinitions);
  const settingsPath = getSettingsPathForScope(cwd, args.settingsScope);
  const input = await runProviderSetupPromptFlow(type, promptInput, providerDefinitions);
  applyProviderConfiguration(settingsPath, input, {
    providerDefinitions,
  });
  const language = await promptInput('  Response language (ko/en/ja/zh, default: en): ');
  if (language) {
    const settings = readSettings(settingsPath);
    settings.language = language;
    writeSettings(settingsPath, settings);
  }
  process.stdout.write(`\n  Config saved to ${settingsPath}\n\n`);
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

function selectStartupSetupArgs(cwd: string, args: IParsedCliArgs): IParsedCliArgs {
  if (args.settingsScope !== undefined || args.provider !== undefined) {
    return args;
  }

  const currentProviderPath = findHighestPriorityCurrentProviderPath(getProviderSettingsPaths(cwd));
  if (currentProviderPath === undefined) {
    return args;
  }

  const projectSettingsPath = join(cwd, '.robota', 'settings.json');
  const projectLocalSettingsPath = join(cwd, '.robota', 'settings.local.json');
  if (
    currentProviderPath === projectSettingsPath ||
    currentProviderPath === projectLocalSettingsPath
  ) {
    return { ...args, settingsScope: 'project-local' };
  }

  return args;
}

function findHighestPriorityCurrentProviderPath(
  settingsPaths: readonly string[],
): string | undefined {
  for (let index = settingsPaths.length - 1; index >= 0; index -= 1) {
    const settingsPath = settingsPaths[index];
    if (settingsPath === undefined) continue;
    const settings = readSettings(settingsPath);
    if (typeof settings.currentProvider === 'string') {
      return settingsPath;
    }
  }
  return undefined;
}

function isInteractiveTerminal(): boolean {
  return process.stdin.isTTY === true && process.stdout.isTTY === true;
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
