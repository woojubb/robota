import type { TUniversalValue } from '@robota-sdk/agent-core';

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

export const DEFAULT_PROVIDER_MODELS: Record<string, string> = {
  anthropic: 'claude-sonnet-4-6',
  openai: 'supergemma4-26b-uncensored-v2',
};

export const DEFAULT_OPENAI_COMPATIBLE_BASE_URL = 'http://localhost:1234/v1';
export const DEFAULT_OPENAI_COMPATIBLE_API_KEY = 'lm-studio';

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
): void {
  if (!profile.type) {
    throw new Error(`Provider profile "${profileName}" is missing type`);
  }
  if (!profile.model) {
    throw new Error(`Provider profile "${profileName}" is missing model`);
  }
  if (profile.type === 'anthropic' && !profile.apiKey) {
    throw new Error(`Provider profile "${profileName}" is missing apiKey`);
  }
}

export function buildProviderSetupPatch(input: IProviderSetupInput): IProviderSetupPatch {
  const profile = buildProviderProfile(input);
  validateProviderProfile(input.profile, profile);
  return {
    ...(input.setCurrent && { currentProvider: input.profile }),
    providers: {
      [input.profile]: profile,
    },
  };
}

export function buildProviderProfile(input: IProviderSetupInput): IProviderProfileSettings {
  const apiKey =
    input.apiKeyEnv !== undefined
      ? `$ENV:${input.apiKeyEnv}`
      : (input.apiKey ?? (input.type === 'openai' ? DEFAULT_OPENAI_COMPATIBLE_API_KEY : undefined));
  const baseURL =
    input.baseURL ?? (input.type === 'openai' ? DEFAULT_OPENAI_COMPATIBLE_BASE_URL : undefined);

  return {
    type: input.type,
    model: input.model ?? DEFAULT_PROVIDER_MODELS[input.type],
    ...(apiKey !== undefined && { apiKey }),
    ...(baseURL !== undefined && { baseURL }),
    ...(input.timeout !== undefined && { timeout: input.timeout }),
  };
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
