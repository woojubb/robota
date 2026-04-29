/**
 * Provider factory — creates AI provider instance from settings.
 *
 * CLI owns provider creation. Reads settings to determine which
 * provider package to use, creates the instance, passes to SDK.
 */

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { IAIProvider } from '@robota-sdk/agent-core';
import { AnthropicProvider } from '@robota-sdk/agent-provider-anthropic';
import { OpenAIProvider } from '@robota-sdk/agent-provider-openai';

interface IProviderConfig {
  name: string;
  model: string;
  apiKey?: string;
  baseURL?: string;
  timeout?: number;
}

interface IProviderProfileSettings {
  type?: string;
  model?: string;
  apiKey?: string;
  baseURL?: string;
  timeout?: number;
}

interface ILegacyProviderSettings {
  name?: string;
  model?: string;
  apiKey?: string;
  baseURL?: string;
  timeout?: number;
}

interface IProviderSettingsFile {
  currentProvider?: string;
  providers?: Record<string, IProviderProfileSettings>;
  provider?: ILegacyProviderSettings;
}

const DEFAULT_MODELS: Record<string, string> = {
  anthropic: 'claude-sonnet-4-6',
  openai: 'supergemma4-26b-uncensored-v2',
};

const DEFAULT_OPENAI_COMPATIBLE_BASE_URL = 'http://localhost:1234/v1';
const DEFAULT_OPENAI_COMPATIBLE_API_KEY = 'lm-studio';

/** Read provider settings from the settings file chain. */
export function readProviderSettings(cwd: string): IProviderConfig {
  const paths = [
    join(homedir(), '.robota', 'settings.json'),
    join(homedir(), '.claude', 'settings.json'),
    join(cwd, '.robota', 'settings.json'),
    join(cwd, '.robota', 'settings.local.json'),
    join(cwd, '.claude', 'settings.json'),
    join(cwd, '.claude', 'settings.local.json'),
  ];

  const merged = paths.reduce<IProviderSettingsFile>((settings, filePath) => {
    const parsed = readSettingsFile(filePath);
    if (parsed === undefined) {
      return settings;
    }
    return mergeSettings(settings, parsed);
  }, {});

  const providerConfig = resolveActiveProvider(merged);
  if (providerConfig !== undefined) {
    return providerConfig;
  }

  throw new Error('No provider configuration found. Run `robota` to set up.');
}

function readSettingsFile(filePath: string): IProviderSettingsFile | undefined {
  if (!existsSync(filePath)) {
    return undefined;
  }
  try {
    const raw = readFileSync(filePath, 'utf8');
    return JSON.parse(raw) as IProviderSettingsFile;
  } catch {
    return undefined;
  }
}

function mergeSettings(
  base: IProviderSettingsFile,
  override: IProviderSettingsFile,
): IProviderSettingsFile {
  return {
    ...base,
    ...override,
    provider:
      base.provider !== undefined || override.provider !== undefined
        ? { ...base.provider, ...override.provider }
        : undefined,
    providers:
      base.providers !== undefined || override.providers !== undefined
        ? mergeProviders(base.providers, override.providers)
        : undefined,
  };
}

function mergeProviders(
  base: IProviderSettingsFile['providers'],
  override: IProviderSettingsFile['providers'],
): IProviderSettingsFile['providers'] {
  const result: NonNullable<IProviderSettingsFile['providers']> = { ...(base ?? {}) };
  for (const [name, profile] of Object.entries(override ?? {})) {
    result[name] = { ...result[name], ...profile };
  }
  return result;
}

function resolveActiveProvider(settings: IProviderSettingsFile): IProviderConfig | undefined {
  if (settings.currentProvider !== undefined) {
    const profile = settings.providers?.[settings.currentProvider];
    if (profile === undefined) {
      throw new Error(`currentProvider "${settings.currentProvider}" was not found in providers`);
    }
    if (!profile.type) {
      throw new Error(`Provider profile "${settings.currentProvider}" is missing type`);
    }
    return normalizeProviderConfig({
      name: profile.type,
      model: profile.model,
      apiKey: profile.apiKey,
      baseURL: profile.baseURL,
      timeout: profile.timeout,
    });
  }

  const provider = settings.provider;
  if (provider?.name) {
    return normalizeProviderConfig({
      name: provider.name,
      model: provider.model,
      apiKey: provider.apiKey,
      baseURL: provider.baseURL,
      timeout: provider.timeout,
    });
  }

  return undefined;
}

function normalizeProviderConfig(settings: {
  name: string;
  model?: string;
  apiKey?: string;
  baseURL?: string;
  timeout?: number;
}): IProviderConfig {
  const defaults = getProviderDefaults(settings.name);
  return {
    name: settings.name,
    model: settings.model ?? defaults.model,
    apiKey: settings.apiKey !== undefined ? resolveEnvRef(settings.apiKey) : defaults.apiKey,
    baseURL: settings.baseURL ?? defaults.baseURL,
    timeout: settings.timeout,
  };
}

function resolveEnvRef(value: string): string {
  const envPrefix = '$ENV:';
  if (!value.startsWith(envPrefix)) {
    return value;
  }
  const envName = value.slice(envPrefix.length);
  return process.env[envName] ?? value;
}

function getProviderDefaults(name: string): { model: string; apiKey?: string; baseURL?: string } {
  if (name === 'openai') {
    return {
      model: DEFAULT_MODELS['openai'] ?? 'supergemma4-26b-uncensored-v2',
      apiKey: DEFAULT_OPENAI_COMPATIBLE_API_KEY,
      baseURL: DEFAULT_OPENAI_COMPATIBLE_BASE_URL,
    };
  }
  return {
    model: DEFAULT_MODELS[name] ?? DEFAULT_MODELS['anthropic'] ?? 'claude-sonnet-4-6',
  };
}

function requireApiKey(settings: IProviderConfig): string {
  if (!settings.apiKey) {
    throw new Error(`Provider ${settings.name} requires apiKey`);
  }
  return settings.apiKey;
}

/** Create a provider instance from settings. */
export function createProviderFromSettings(cwd: string, modelOverride?: string): IAIProvider {
  const settings = readProviderSettings(cwd);
  const model = modelOverride ?? settings.model;

  switch (settings.name) {
    case 'anthropic':
      return new AnthropicProvider({
        apiKey: requireApiKey(settings),
        ...(settings.baseURL !== undefined && { baseURL: settings.baseURL }),
        ...(settings.timeout !== undefined && { timeout: settings.timeout }),
        defaultModel: model,
      });
    case 'openai':
      return new OpenAIProvider({
        apiKey: requireApiKey(settings),
        ...(settings.baseURL !== undefined && { baseURL: settings.baseURL }),
        ...(settings.timeout !== undefined && { timeout: settings.timeout }),
        defaultModel: model,
      });
    default:
      throw new Error(`Unknown provider: ${settings.name}. Currently supported: anthropic, openai`);
  }
}
