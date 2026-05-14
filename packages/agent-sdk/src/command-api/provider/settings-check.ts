import {
  findProviderDefinition,
  getProviderCredentialRequirement,
  hasUsableSecretReference,
  type IProviderCredentialRequirement,
  type IProviderDefinition,
  type TProviderCredentialField,
} from '@robota-sdk/agent-core';
import type { TProviderSettingsDocument } from './provider-settings.js';

export type TSettingsCheck = 'missing' | 'valid' | 'corrupt' | 'incomplete';

export function checkSettingsDocument(
  settings: TProviderSettingsDocument,
  providerDefinitions: readonly IProviderDefinition[] = [],
): TSettingsCheck {
  return hasUsableProviderConfig(settings, providerDefinitions) ? 'valid' : 'incomplete';
}

function hasUsableProviderConfig(
  settings: TProviderSettingsDocument,
  providerDefinitions: readonly IProviderDefinition[],
): boolean {
  if (typeof settings.currentProvider === 'string') {
    const profile = settings.providers?.[settings.currentProvider];
    return isUsableProviderProfile(profile?.type, profile, providerDefinitions);
  }
  if (
    settings.provider &&
    isUsableProviderProfile(settings.provider.name, settings.provider, providerDefinitions)
  ) {
    return true;
  }
  return false;
}

function isUsableProviderProfile(
  type: string | undefined,
  profile: { apiKey?: string } | undefined,
  providerDefinitions: readonly IProviderDefinition[],
): boolean {
  if (!profile) return false;
  if (!type) return hasUsableSecretReference(profile.apiKey);
  const definition = findProviderDefinition(providerDefinitions, type);
  if (definition === undefined) return false;
  const credentialRequirement = getProviderCredentialRequirement(definition);
  if (credentialRequirement === undefined) return true;
  return hasUsableRequiredProviderCredential(profile, definition, credentialRequirement);
}

function hasUsableRequiredProviderCredential(
  profile: { apiKey?: string },
  definition: IProviderDefinition,
  requirement: IProviderCredentialRequirement,
): boolean {
  return requirement.anyOf.some((field) =>
    hasUsableSecretReference(resolveProviderCredentialValue(field, profile, definition)),
  );
}

function resolveProviderCredentialValue(
  field: TProviderCredentialField,
  profile: { apiKey?: string },
  definition: IProviderDefinition,
): string | undefined {
  return profile[field] ?? definition.defaults?.[field];
}
