import { join } from 'node:path';
import { homedir } from 'node:os';
import type { IProviderDefinition } from './provider-definition.js';
import type { IParsedCliArgs } from './cli-args.js';
import { checkSettingsFile } from './settings-check.js';
import { getUserSettingsPath, readSettings, writeSettings } from './settings-io.js';
import { applyProviderConfiguration, applyProviderSwitch } from './provider-configuration.js';
import { readMergedProviderSettings } from './provider-factory.js';
import { DEFAULT_PROVIDER_DEFINITIONS } from './provider-default-definitions.js';
import { type IProviderSetupInput } from './provider-settings.js';
import {
  runProviderSetupPromptFlow,
  type TPromptInput,
  type TProviderSetupType,
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
    applyProviderSwitch(settingsPath, args.provider, {
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
  const checks = getSettingsCheckPaths(cwd).map((path) => ({
    path,
    status: checkSettingsFile(path, providerDefinitions),
  }));
  if (checks.some((check) => check.status === 'valid')) {
    return;
  }
  if (!isInteractiveTerminal()) {
    throw new Error(formatMissingProviderConfigMessage());
  }
  await runInteractiveProviderSetup(cwd, args, promptInput, providerDefinitions);
}

export async function runInteractiveProviderSetup(
  cwd: string,
  args: IParsedCliArgs,
  promptInput: TPromptInput,
  providerDefinitions: readonly IProviderDefinition[] = DEFAULT_PROVIDER_DEFINITIONS,
): Promise<void> {
  const defaultProviderType = providerDefinitions[0]?.type ?? '';
  const supportedTypes = providerDefinitions.map((definition) => definition.type).join('/');
  const providerChoice =
    (await promptInput(`  Provider (${supportedTypes}, default: ${defaultProviderType}): `)) ||
    defaultProviderType;
  const type = parseProviderSetupType(providerChoice);
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

function parseProviderSetupType(value: string): TProviderSetupType {
  return value.trim();
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

function getSettingsCheckPaths(cwd: string): string[] {
  return [
    getUserSettingsPath(),
    join(homedir(), '.claude', 'settings.json'),
    join(cwd, '.robota', 'settings.json'),
    join(cwd, '.robota', 'settings.local.json'),
    join(cwd, '.claude', 'settings.json'),
    join(cwd, '.claude', 'settings.local.json'),
  ];
}

function isInteractiveTerminal(): boolean {
  return process.stdin.isTTY === true && process.stdout.isTTY === true;
}

export function formatMissingProviderConfigMessage(): string {
  return [
    'No provider configuration found.',
    'Run `robota --configure` in an interactive terminal, or configure a provider:',
    '  robota --configure-provider gemma --type gemma --base-url http://localhost:1234/v1 --model supergemma4-26b-uncensored-v2 --api-key lm-studio --set-current',
    '  robota --configure-provider openai --type openai --model <openai-compatible-model> --api-key-env OPENAI_API_KEY --set-current',
  ].join('\n');
}
