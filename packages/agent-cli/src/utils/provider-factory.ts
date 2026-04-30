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
import type { ISerializableProviderProfile } from '@robota-sdk/agent-sdk';
import {
  DEFAULT_OPENAI_COMPATIBLE_API_KEY,
  DEFAULT_OPENAI_COMPATIBLE_BASE_URL,
  DEFAULT_PROVIDER_MODELS,
  type TProviderSettingsDocument,
} from './provider-settings.js';

export interface IProviderConfig {
  name: string;
  model: string;
  apiKey?: string;
  baseURL?: string;
  timeout?: number;
}

export interface IReadProviderSettingsOptions {
  providerOverride?: string;
}

/** Read provider settings from the settings file chain. */
export function readProviderSettings(
  cwd: string,
  options: IReadProviderSettingsOptions = {},
): IProviderConfig {
  const merged = readMergedProviderSettings(cwd);
  const providerConfig = resolveActiveProvider(merged, options.providerOverride);
  if (providerConfig !== undefined) {
    return providerConfig;
  }

  throw new Error('No provider configuration found. Run `robota` to set up.');
}

export function readMergedProviderSettings(cwd: string): TProviderSettingsDocument {
  const paths = [
    join(homedir(), '.robota', 'settings.json'),
    join(homedir(), '.claude', 'settings.json'),
    join(cwd, '.robota', 'settings.json'),
    join(cwd, '.robota', 'settings.local.json'),
    join(cwd, '.claude', 'settings.json'),
    join(cwd, '.claude', 'settings.local.json'),
  ];

  return paths.reduce<TProviderSettingsDocument>((settings, filePath) => {
    const parsed = readSettingsFile(filePath);
    if (parsed === undefined) {
      return settings;
    }
    return mergeSettings(settings, parsed);
  }, {});
}

function readSettingsFile(filePath: string): TProviderSettingsDocument | undefined {
  if (!existsSync(filePath)) {
    return undefined;
  }
  try {
    const raw = readFileSync(filePath, 'utf8');
    return JSON.parse(raw) as TProviderSettingsDocument;
  } catch {
    return undefined;
  }
}

function mergeSettings(
  base: TProviderSettingsDocument,
  override: TProviderSettingsDocument,
): TProviderSettingsDocument {
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
  base: TProviderSettingsDocument['providers'],
  override: TProviderSettingsDocument['providers'],
): TProviderSettingsDocument['providers'] {
  const result: NonNullable<TProviderSettingsDocument['providers']> = { ...(base ?? {}) };
  for (const [name, profile] of Object.entries(override ?? {})) {
    result[name] = { ...result[name], ...profile };
  }
  return result;
}

function resolveActiveProvider(
  settings: TProviderSettingsDocument,
  providerOverride?: string,
): IProviderConfig | undefined {
  const activeProvider = providerOverride ?? settings.currentProvider;
  if (activeProvider !== undefined) {
    const profile = settings.providers?.[activeProvider];
    if (profile === undefined) {
      throw new Error(`Provider profile "${activeProvider}" was not found in providers`);
    }
    if (!profile.type) {
      throw new Error(`Provider profile "${activeProvider}" is missing type`);
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
      model: DEFAULT_PROVIDER_MODELS['openai'] ?? 'supergemma4-26b-uncensored-v2',
      apiKey: DEFAULT_OPENAI_COMPATIBLE_API_KEY,
      baseURL: DEFAULT_OPENAI_COMPATIBLE_BASE_URL,
    };
  }
  return {
    model:
      DEFAULT_PROVIDER_MODELS[name] ?? DEFAULT_PROVIDER_MODELS['anthropic'] ?? 'claude-sonnet-4-6',
  };
}

function requireApiKey(settings: IProviderConfig): string {
  if (!settings.apiKey) {
    throw new Error(`Provider ${settings.name} requires apiKey`);
  }
  return settings.apiKey;
}

function resolveProfileApiKey(profile: ISerializableProviderProfile): string | undefined {
  if (profile.apiKey !== undefined) {
    return profile.apiKey;
  }
  if (profile.apiKeyEnv !== undefined) {
    return process.env[profile.apiKeyEnv];
  }
  return undefined;
}

function createProviderFromConfig(settings: IProviderConfig): IAIProvider {
  switch (settings.name) {
    case 'anthropic':
      return new AnthropicProvider({
        apiKey: requireApiKey(settings),
        ...(settings.baseURL !== undefined && { baseURL: settings.baseURL }),
        ...(settings.timeout !== undefined && { timeout: settings.timeout }),
        defaultModel: settings.model,
      });
    case 'openai':
      return new OpenAIProvider({
        apiKey: requireApiKey(settings),
        ...(settings.baseURL !== undefined && { baseURL: settings.baseURL }),
        ...(settings.timeout !== undefined && { timeout: settings.timeout }),
        defaultModel: settings.model,
      });
    default:
      throw new Error(`Unknown provider: ${settings.name}. Currently supported: anthropic, openai`);
  }
}

/** Create a provider instance from settings. */
export function createProviderFromSettings(
  cwd: string,
  modelOverride?: string,
  options: IReadProviderSettingsOptions = {},
): IAIProvider {
  const settings = readProviderSettings(cwd, options);
  const model = modelOverride ?? settings.model;

  return createProviderFromConfig({ ...settings, model });
}

/** Create a provider instance from a serialized background worker profile. */
export function createProviderFromProfile(
  profile: ISerializableProviderProfile,
  modelOverride?: string,
): IAIProvider {
  return createProviderFromConfig({
    name: profile.type,
    model: modelOverride ?? profile.model,
    apiKey: resolveProfileApiKey(profile),
    baseURL: profile.baseURL,
    timeout: profile.timeout,
  });
}
