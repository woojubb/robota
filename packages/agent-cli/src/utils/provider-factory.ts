/**
 * Provider factory — creates AI provider instances from injected definitions.
 *
 * CLI owns provider profile resolution. Provider packages own their
 * defaults, validation metadata, probes, and concrete construction.
 */

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { IAIProvider, TUniversalValue } from '@robota-sdk/agent-core';
import type { ISerializableProviderProfile } from '@robota-sdk/agent-sdk';
import { type TProviderSettingsDocument } from './provider-settings.js';
import { DEFAULT_PROVIDER_DEFINITIONS } from './provider-default-definitions.js';
import {
  findProviderDefinition,
  formatSupportedProviderTypes,
  getProviderCredentialRequirement,
  type IProviderConfig,
  type IProviderCredentialRequirement,
  type IProviderDefinition,
  type TProviderCredentialField,
} from './provider-definition.js';
import { resolveEnvReference } from './env-ref.js';

export type { IProviderConfig, IProviderDefinition } from './provider-definition.js';

export interface IReadProviderSettingsOptions {
  providerOverride?: string;
  providerDefinitions?: readonly IProviderDefinition[];
}

/** Read provider settings from the settings file chain. */
export function readProviderSettings(
  cwd: string,
  options: IReadProviderSettingsOptions = {},
): IProviderConfig {
  const merged = readMergedProviderSettings(cwd);
  const providerConfig = resolveActiveProvider(
    merged,
    options.providerOverride,
    getProviderDefinitions(options),
  );
  if (providerConfig !== undefined) {
    return providerConfig;
  }

  throw new Error('No provider configuration found. Run `robota` to set up.');
}

export function readMergedProviderSettings(cwd: string): TProviderSettingsDocument {
  return readMergedProviderSettingsFromPaths(getProviderSettingsPaths(cwd));
}

export function getProviderSettingsPaths(cwd: string): string[] {
  const userHome = getUserHome();
  return [
    join(userHome, '.robota', 'settings.json'),
    join(userHome, '.claude', 'settings.json'),
    join(cwd, '.robota', 'settings.json'),
    join(cwd, '.robota', 'settings.local.json'),
    join(cwd, '.claude', 'settings.json'),
    join(cwd, '.claude', 'settings.local.json'),
  ];
}

function getUserHome(): string {
  return process.env.HOME ?? process.env.USERPROFILE ?? '/';
}

export function readMergedProviderSettingsFromPaths(
  paths: readonly string[],
): TProviderSettingsDocument {
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
  providerDefinitions: readonly IProviderDefinition[] = DEFAULT_PROVIDER_DEFINITIONS,
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
    return normalizeProviderConfig(
      {
        name: profile.type,
        model: profile.model,
        apiKey: profile.apiKey,
        authToken: profile.authToken,
        baseURL: profile.baseURL,
        timeout: profile.timeout,
        options: profile.options,
      },
      providerDefinitions,
    );
  }

  const provider = settings.provider;
  if (provider?.name) {
    return normalizeProviderConfig(
      {
        name: provider.name,
        model: provider.model,
        apiKey: provider.apiKey,
        authToken: provider.authToken,
        baseURL: provider.baseURL,
        timeout: provider.timeout,
        options: provider.options,
      },
      providerDefinitions,
    );
  }

  return undefined;
}

function normalizeProviderConfig(
  settings: {
    name: string;
    model?: string;
    apiKey?: string;
    authToken?: string;
    baseURL?: string;
    timeout?: number;
    options?: Record<string, TUniversalValue>;
  },
  providerDefinitions: readonly IProviderDefinition[],
): IProviderConfig {
  const defaults = findProviderDefinition(providerDefinitions, settings.name)?.defaults ?? {};
  const model = settings.model ?? defaults.model;
  if (!model) {
    throw new Error(`Provider ${settings.name} requires model`);
  }
  const apiKeyReference = settings.apiKey ?? defaults.apiKey;
  const authTokenReference = settings.authToken ?? defaults.authToken;
  const authToken =
    authTokenReference !== undefined ? resolveEnvReference(authTokenReference) : undefined;
  const options = settings.options ?? defaults.options;
  return {
    name: settings.name,
    model,
    apiKey: apiKeyReference !== undefined ? resolveEnvReference(apiKeyReference) : undefined,
    ...(authToken !== undefined && authToken.length > 0 && { authToken }),
    baseURL: settings.baseURL ?? defaults.baseURL,
    timeout: settings.timeout,
    ...(options !== undefined && { options }),
  };
}

function resolveProfileApiKey(profile: ISerializableProviderProfile): string | undefined {
  if (profile.apiKey !== undefined) {
    return resolveEnvReference(profile.apiKey);
  }
  if (profile.apiKeyEnv !== undefined) {
    return process.env[profile.apiKeyEnv];
  }
  return undefined;
}

function resolveProfileAuthToken(profile: ISerializableProviderProfile): string | undefined {
  if (profile.authToken !== undefined) {
    return resolveEnvReference(profile.authToken);
  }
  if (profile.authTokenEnv !== undefined) {
    return process.env[profile.authTokenEnv];
  }
  return undefined;
}

function createProviderFromConfig(
  settings: IProviderConfig,
  providerDefinitions: readonly IProviderDefinition[],
): IAIProvider {
  const definition = findProviderDefinition(providerDefinitions, settings.name);
  if (definition === undefined) {
    throw new Error(
      `Unknown provider: ${settings.name}. Currently supported: ${formatSupportedProviderTypes(providerDefinitions)}`,
    );
  }
  const credentialRequirement = getProviderCredentialRequirement(definition);
  if (
    credentialRequirement !== undefined &&
    !hasRequiredProviderCredential(settings, credentialRequirement)
  ) {
    throw new Error(
      `Provider ${settings.name} requires ${formatCredentialRequirement(credentialRequirement)}`,
    );
  }
  return definition.createProvider(settings);
}

/** Create a provider instance from settings. */
export function createProviderFromSettings(
  cwd: string,
  modelOverride?: string,
  options: IReadProviderSettingsOptions = {},
): IAIProvider {
  const providerDefinitions = getProviderDefinitions(options);
  const settings = readProviderSettings(cwd, { ...options, providerDefinitions });
  const model = modelOverride ?? settings.model;

  return createProviderFromConfig({ ...settings, model }, providerDefinitions);
}

/** Create a provider instance from a serialized background worker profile. */
export function createProviderFromProfile(
  profile: ISerializableProviderProfile,
  modelOverride?: string,
  providerDefinitions: readonly IProviderDefinition[] = DEFAULT_PROVIDER_DEFINITIONS,
): IAIProvider {
  return createProviderFromConfig(
    normalizeProviderConfig(
      {
        name: profile.type,
        model: modelOverride ?? profile.model,
        apiKey: resolveProfileApiKey(profile),
        authToken: resolveProfileAuthToken(profile),
        baseURL: profile.baseURL,
        timeout: profile.timeout,
        options: profile.options,
      },
      providerDefinitions,
    ),
    providerDefinitions,
  );
}

function hasRequiredProviderCredential(
  settings: IProviderConfig,
  requirement: IProviderCredentialRequirement,
): boolean {
  return requirement.anyOf.some((field) => hasProviderCredentialValue(settings, field));
}

function hasProviderCredentialValue(
  settings: IProviderConfig,
  field: TProviderCredentialField,
): boolean {
  const value = settings[field];
  return value !== undefined && value.length > 0;
}

function formatCredentialRequirement(requirement: IProviderCredentialRequirement): string {
  return requirement.anyOf.join(' or ');
}

function getProviderDefinitions(
  options: IReadProviderSettingsOptions,
): readonly IProviderDefinition[] {
  return options.providerDefinitions ?? DEFAULT_PROVIDER_DEFINITIONS;
}
