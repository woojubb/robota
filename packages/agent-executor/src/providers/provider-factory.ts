import type {
  IAIProvider,
  IProviderConfig,
  IProviderCredentialRequirement,
  IProviderDefinition,
  TProviderCredentialField,
  TUniversalValue,
} from '@robota-sdk/agent-core';
import {
  findProviderDefinition,
  formatSupportedProviderTypes,
  getProviderCredentialRequirement,
  resolveEnvReference,
} from '@robota-sdk/agent-core';
import type { ISerializableProviderProfile } from '../background-tasks/types.js';

export function normalizeProviderConfig(
  settings: {
    name: string;
    model?: string;
    apiKey?: string;
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
  const options = settings.options ?? defaults.options;
  return {
    name: settings.name,
    model,
    apiKey: apiKeyReference !== undefined ? resolveEnvReference(apiKeyReference) : undefined,
    baseURL: settings.baseURL ?? defaults.baseURL,
    timeout: settings.timeout,
    ...(options !== undefined && { options }),
  };
}

export function resolveProfileApiKey(profile: ISerializableProviderProfile): string | undefined {
  if (profile.apiKey !== undefined) {
    return resolveEnvReference(profile.apiKey);
  }
  if (profile.apiKeyEnv !== undefined) {
    return process.env[profile.apiKeyEnv];
  }
  return undefined;
}

export function createProviderFromConfig(
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

export function createProviderFromProfile(
  profile: ISerializableProviderProfile,
  modelOverride: string | undefined,
  providerDefinitions: readonly IProviderDefinition[],
): IAIProvider {
  return createProviderFromConfig(
    normalizeProviderConfig(
      {
        name: profile.type,
        model: modelOverride ?? profile.model,
        apiKey: resolveProfileApiKey(profile),
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
