import type { IAIProvider } from '@robota-sdk/agent-core';
import { createProviderFromConfig, createProviderFromProfile } from '@robota-sdk/agent-executor';
import {
  getProviderSettingsPaths,
  readMergedProviderSettingsFromPaths,
  resolveActiveProvider,
} from '@robota-sdk/agent-framework';
import type { TProviderSettingsDocument } from './provider-settings.js';
import { DEFAULT_PROVIDER_DEFINITIONS } from './provider-default-definitions.js';
import type { IProviderConfig, IProviderDefinition } from './provider-definition.js';

export type { IProviderConfig, IProviderDefinition } from './provider-definition.js';
export { createProviderFromConfig, createProviderFromProfile } from '@robota-sdk/agent-executor';
export {
  mergeProviders,
  mergeSettings,
  readMergedProviderSettingsFromPaths,
  resolveActiveProvider,
  getProviderSettingsPaths,
} from '@robota-sdk/agent-framework';

export interface IReadProviderSettingsOptions {
  providerOverride?: string;
  providerDefinitions?: readonly IProviderDefinition[];
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
    getProviderDefinitions(options),
  );
  if (providerConfig !== undefined) {
    return providerConfig;
  }

  throw new Error('No provider configuration found. Run `robota` to set up.');
}

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

function getProviderDefinitions(
  options: IReadProviderSettingsOptions,
): readonly IProviderDefinition[] {
  return options.providerDefinitions ?? DEFAULT_PROVIDER_DEFINITIONS;
}
