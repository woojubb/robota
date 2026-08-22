import { ENV_REFERENCE_PREFIX, isEnvReference } from '@robota-sdk/agent-core';
import { createProviderFromConfig } from '@robota-sdk/agent-executor';

import { readMergedProviderSettingsFromSources, resolveActiveProvider } from './provider-merge.js';

import type { TProviderSettingsDocument } from './provider-settings.js';
import type { TSettingsSource } from '../../config/settings-source.js';
import type {
  IAIProvider,
  IProviderDefinitionConfig,
  IProviderDefinition,
} from '@robota-sdk/agent-core';

export interface IReadProviderSettingsOptions {
  providerOverride?: string;
  providerDefinitions?: readonly IProviderDefinition[];
  /** Environment map for env-default synthesis (test seam, default: process.env). */
  env?: Record<string, string | undefined>;
}

/**
 * Missing or unusable provider configuration at session start.
 * Typed so callers can map it to a distinct exit code without message matching.
 */
export class ProviderConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProviderConfigError';
  }
}

export function readMergedProviderSettings(
  sources: readonly TSettingsSource[],
): TProviderSettingsDocument {
  return readMergedProviderSettingsFromSources(sources);
}

/**
 * Zero-config fallback: synthesize an in-memory provider config from the first
 * definition (in order) whose defaults are complete — `$ENV:` apiKey reference with the
 * referenced variable set, plus a default model. Settings profiles always win; nothing
 * is persisted. Returns undefined when no definition qualifies.
 */
export function resolveEnvDefaultProvider(
  providerDefinitions: readonly IProviderDefinition[],
  env: Record<string, string | undefined> = process.env,
): IProviderDefinitionConfig | undefined {
  for (const definition of providerDefinitions) {
    const defaults = definition.defaults;
    if (defaults?.apiKey === undefined || defaults.model === undefined) continue;
    if (!isEnvReference(defaults.apiKey)) continue;
    const envName = defaults.apiKey.slice(ENV_REFERENCE_PREFIX.length).trim();
    if (envName.length === 0) continue;
    const envValue = env[envName];
    if (envValue === undefined || envValue.length === 0) continue;
    // The key is resolved here (profile-path parity: resolveActiveProvider also returns
    // resolved keys via normalizeProviderConfig); the env var NAME travels separately in
    // sourceEnvVar so notices never need the value.
    return {
      name: definition.type,
      model: defaults.model,
      apiKey: envValue,
      ...(defaults.baseURL !== undefined && { baseURL: defaults.baseURL }),
      ...(defaults.timeout !== undefined && { timeout: defaults.timeout }),
      ...(defaults.options !== undefined && { options: defaults.options }),
      source: 'env-default',
      sourceEnvVar: envName,
    };
  }
  return undefined;
}

export function readProviderSettings(
  sources: readonly TSettingsSource[],
  options: IReadProviderSettingsOptions = {},
): IProviderDefinitionConfig {
  const merged = readMergedProviderSettings(sources);
  const providerConfig = resolveActiveProvider(
    merged,
    options.providerOverride,
    options.providerDefinitions ?? [],
  );
  if (providerConfig !== undefined) {
    return providerConfig;
  }

  const envDefault = resolveEnvDefaultProvider(options.providerDefinitions ?? [], options.env);
  if (envDefault !== undefined) {
    return envDefault;
  }

  throw new ProviderConfigError('No provider configuration found. Run `robota` to set up.');
}

export function createProviderFromSettings(
  sources: readonly TSettingsSource[],
  modelOverride?: string,
  options: IReadProviderSettingsOptions = {},
): IAIProvider {
  const providerDefinitions = options.providerDefinitions ?? [];
  const settings = readProviderSettings(sources, { ...options, providerDefinitions });
  const model = modelOverride ?? settings.model;

  return createProviderFromConfig({ ...settings, model }, providerDefinitions);
}
