import { existsSync, readFileSync } from 'node:fs';
import type { IProviderConfig, IProviderDefinition } from '@robota-sdk/agent-core';
import { normalizeProviderConfig } from '@robota-sdk/agent-runtime';
import type { IProviderProfileSettings, TProviderSettingsDocument } from './provider-settings.js';

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
    // allow-fallback: unparseable settings file is skipped to allow the config chain to continue
    return undefined;
  }
}

export function mergeSettings(
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

export function mergeProviders(
  base: TProviderSettingsDocument['providers'],
  override: TProviderSettingsDocument['providers'],
): TProviderSettingsDocument['providers'] {
  const result: Record<string, IProviderProfileSettings> = { ...(base ?? {}) };
  for (const [name, profile] of Object.entries(override ?? {})) {
    result[name] = { ...result[name], ...profile };
  }
  return result;
}

export function resolveActiveProvider(
  settings: TProviderSettingsDocument,
  providerOverride: string | undefined,
  providerDefinitions: readonly IProviderDefinition[],
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
        baseURL: provider.baseURL,
        timeout: provider.timeout,
        options: provider.options,
      },
      providerDefinitions,
    );
  }

  return undefined;
}
