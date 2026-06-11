import { createProviderFromConfig } from '@robota-sdk/agent-executor';

import { readMergedProviderSettingsFromPaths, resolveActiveProvider } from './provider-merge.js';
import { getProviderSettingsPaths } from '../../config/provider-paths.js';

import type { TProviderSettingsDocument } from './provider-settings.js';
import type { IAIProvider, IProviderConfig, IProviderDefinition } from '@robota-sdk/agent-core';

export interface IReadProviderSettingsOptions {
  providerOverride?: string;
  providerDefinitions?: readonly IProviderDefinition[];
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

export function readMergedProviderSettings(cwd: string): TProviderSettingsDocument {
  return readMergedProviderSettingsFromPaths(getProviderSettingsPaths(cwd));
}

export function readProviderSettings(
  cwd: string,
  options: IReadProviderSettingsOptions = {},
): IProviderConfig {
  const merged = readMergedProviderSettings(cwd);
  const providerConfig = resolveActiveProvider(
    merged,
    options.providerOverride,
    options.providerDefinitions ?? [],
  );
  if (providerConfig !== undefined) {
    return providerConfig;
  }

  throw new ProviderConfigError('No provider configuration found. Run `robota` to set up.');
}

export function createProviderFromSettings(
  cwd: string,
  modelOverride?: string,
  options: IReadProviderSettingsOptions = {},
): IAIProvider {
  const providerDefinitions = options.providerDefinitions ?? [];
  const settings = readProviderSettings(cwd, { ...options, providerDefinitions });
  const model = modelOverride ?? settings.model;

  return createProviderFromConfig({ ...settings, model }, providerDefinitions);
}
