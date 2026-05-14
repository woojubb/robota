/**
 * Provider factory — CLI entry point for provider construction.
 *
 * Business logic lives in @robota-sdk/agent-runtime and @robota-sdk/agent-sdk.
 * This file owns only: CLI path discovery, file I/O, and the assembly entry points.
 */

import { join } from 'node:path';
import type { IAIProvider } from '@robota-sdk/agent-core';
import { createProviderFromConfig, createProviderFromProfile } from '@robota-sdk/agent-runtime';
import { readMergedProviderSettingsFromPaths, resolveActiveProvider } from '@robota-sdk/agent-sdk';
import type { TProviderSettingsDocument } from './provider-settings.js';
import { DEFAULT_PROVIDER_DEFINITIONS } from './provider-default-definitions.js';
import type { IProviderConfig, IProviderDefinition } from './provider-definition.js';

export type { IProviderConfig, IProviderDefinition } from './provider-definition.js';
export { createProviderFromConfig, createProviderFromProfile } from '@robota-sdk/agent-runtime';
export {
  mergeProviders,
  mergeSettings,
  readMergedProviderSettingsFromPaths,
  resolveActiveProvider,
} from '@robota-sdk/agent-sdk';

export interface IReadProviderSettingsOptions {
  providerOverride?: string;
  providerDefinitions?: readonly IProviderDefinition[];
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

export function readMergedProviderSettings(cwd: string): TProviderSettingsDocument {
  return readMergedProviderSettingsFromPaths(getProviderSettingsPaths(cwd));
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

function getProviderDefinitions(
  options: IReadProviderSettingsOptions,
): readonly IProviderDefinition[] {
  return options.providerDefinitions ?? DEFAULT_PROVIDER_DEFINITIONS;
}
