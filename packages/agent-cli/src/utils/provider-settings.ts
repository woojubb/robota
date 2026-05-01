import type { TUniversalValue } from '@robota-sdk/agent-core';
import { findProviderDefinition, type IProviderDefinition } from './provider-definition.js';
import { hasUsableSecretReference } from './env-ref.js';

export interface IProviderProfileSettings {
  [key: string]: TUniversalValue;
  type?: string;
  model?: string;
  apiKey?: string;
  baseURL?: string;
  timeout?: number;
}

export interface ILegacyProviderSettings {
  [key: string]: TUniversalValue;
  name?: string;
  model?: string;
  apiKey?: string;
  baseURL?: string;
  timeout?: number;
}

export type TProviderSettingsDocument = Record<string, TUniversalValue> & {
  currentProvider?: string;
  providers?: Record<string, IProviderProfileSettings>;
  provider?: ILegacyProviderSettings;
};

export interface IProviderSetupInput {
  profile: string;
  type: string;
  model?: string;
  apiKey?: string;
  apiKeyEnv?: string;
  baseURL?: string;
  timeout?: number;
  setCurrent?: boolean;
}

export interface IProviderSetupPatch {
  currentProvider?: string;
  providers: Record<string, IProviderProfileSettings>;
}

export interface IProviderSettingsBuildOptions {
  providerDefinitions?: readonly IProviderDefinition[];
}

export function upsertProviderProfile(
  settings: TProviderSettingsDocument,
  profileName: string,
  profile: IProviderProfileSettings,
): TProviderSettingsDocument {
  return {
    ...settings,
    providers: {
      ...(settings.providers ?? {}),
      [profileName]: profile,
    },
  };
}

export function setCurrentProvider(
  settings: TProviderSettingsDocument,
  profileName: string,
): TProviderSettingsDocument {
  if (!settings.providers?.[profileName]) {
    throw new Error(`Provider profile "${profileName}" was not found`);
  }
  return {
    ...settings,
    currentProvider: profileName,
  };
}

export function validateProviderProfile(
  profileName: string,
  profile: IProviderProfileSettings,
  options: IProviderSettingsBuildOptions = {},
): void {
  if (!profile.type) {
    throw new Error(`Provider profile "${profileName}" is missing type`);
  }
  if (!profile.model) {
    throw new Error(`Provider profile "${profileName}" is missing model`);
  }
  const definition = findProviderDefinition(options.providerDefinitions ?? [], profile.type);
  if (
    definition?.requiresApiKey === true &&
    !hasUsableSecretReference(profile.apiKey ?? definition.defaults?.apiKey)
  ) {
    throw new Error(`Provider profile "${profileName}" is missing apiKey`);
  }
}

export function buildProviderSetupPatch(
  input: IProviderSetupInput,
  options: IProviderSettingsBuildOptions = {},
): IProviderSetupPatch {
  const profile = buildProviderProfile(input, options);
  validateProviderProfile(input.profile, profile, options);
  return {
    ...(input.setCurrent && { currentProvider: input.profile }),
    providers: {
      [input.profile]: profile,
    },
  };
}

export function buildProviderProfile(
  input: IProviderSetupInput,
  options: IProviderSettingsBuildOptions = {},
): IProviderProfileSettings {
  const defaults = getProviderDefaults(input.type, options.providerDefinitions ?? []);
  const apiKey =
    input.apiKeyEnv !== undefined ? `$ENV:${input.apiKeyEnv}` : (input.apiKey ?? defaults.apiKey);
  const baseURL = input.baseURL ?? defaults.baseURL;

  return {
    type: input.type,
    model: input.model ?? defaults.model,
    ...(apiKey !== undefined && { apiKey }),
    ...(baseURL !== undefined && { baseURL }),
    ...(input.timeout !== undefined && { timeout: input.timeout }),
  };
}

function getProviderDefaults(
  type: string,
  providerDefinitions: readonly IProviderDefinition[],
): { model?: string; apiKey?: string; baseURL?: string } {
  return findProviderDefinition(providerDefinitions, type)?.defaults ?? {};
}

export function mergeProviderPatch(
  settings: TProviderSettingsDocument,
  patch: IProviderSetupPatch,
): TProviderSettingsDocument {
  const [profileName, profile] = Object.entries(patch.providers)[0] ?? [];
  if (!profileName || !profile) {
    return settings;
  }
  const withProfile = upsertProviderProfile(settings, profileName, profile);
  return patch.currentProvider
    ? setCurrentProvider(withProfile, patch.currentProvider)
    : withProfile;
}
