import {
  findProviderDefinition,
  getProviderCredentialRequirement,
  hasUsableSecretReference,
  type IProviderCredentialRequirement,
  type IProviderDefinition,
  type TEnvResolver,
  type TProviderCredentialField,
  type TProviderCredentialReference,
} from '@robota-sdk/agent-core';

import { resolveProviderEnvironment } from './provider-environment.js';

import type { TProviderEnvironment } from './provider-environment.js';
import type { TProviderSettingsDocument } from './provider-settings.js';

export type TSettingsCheck = 'missing' | 'valid' | 'corrupt' | 'incomplete';

/**
 * `environment` is what `$ENV:` references resolve against — the host's startup snapshot, since the
 * live process environment may have dropped credentials it holds for itself. Absent, every reference
 * reads as unset, so a document whose credential is an environment reference is `incomplete`.
 */
export function checkSettingsDocument(
  settings: TProviderSettingsDocument,
  providerDefinitions: readonly IProviderDefinition[] = [],
  environment?: TProviderEnvironment,
): TSettingsCheck {
  const resolve: TEnvResolver = resolveProviderEnvironment(environment);
  return hasUsableProviderConfig(settings, providerDefinitions, resolve) ? 'valid' : 'incomplete';
}

function hasUsableProviderConfig(
  settings: TProviderSettingsDocument,
  providerDefinitions: readonly IProviderDefinition[],
  resolve: TEnvResolver,
): boolean {
  if (typeof settings.currentProvider === 'string') {
    const profile = settings.providers?.[settings.currentProvider];
    return isUsableProviderProfile(profile?.type, profile, providerDefinitions, resolve);
  }
  if (
    settings.provider &&
    isUsableProviderProfile(settings.provider.name, settings.provider, providerDefinitions, resolve)
  ) {
    return true;
  }
  return false;
}

function isUsableProviderProfile(
  type: string | undefined,
  profile: { apiKey?: string; apiKeyRef?: TProviderCredentialReference } | undefined,
  providerDefinitions: readonly IProviderDefinition[],
  resolve: TEnvResolver,
): boolean {
  if (!profile) return false;
  if (!type) return hasUsableSecretReference(profile.apiKey, resolve);
  const definition = findProviderDefinition(providerDefinitions, type);
  if (definition === undefined) return false;
  if (profile.apiKeyRef !== undefined)
    return (
      profile.apiKey === undefined &&
      !!profile.apiKeyRef.service?.trim() &&
      !!profile.apiKeyRef.account?.trim()
    );
  const credentialRequirement = getProviderCredentialRequirement(definition);
  if (credentialRequirement === undefined) return true;
  return hasUsableRequiredProviderCredential(profile, definition, credentialRequirement, resolve);
}

function hasUsableRequiredProviderCredential(
  profile: { apiKey?: string },
  definition: IProviderDefinition,
  requirement: IProviderCredentialRequirement,
  resolve: TEnvResolver,
): boolean {
  return requirement.anyOf.some((field) =>
    hasUsableSecretReference(resolveProviderCredentialValue(field, profile, definition), resolve),
  );
}

function resolveProviderCredentialValue(
  field: TProviderCredentialField,
  profile: { apiKey?: string },
  definition: IProviderDefinition,
): string | undefined {
  return profile[field] ?? definition.defaults?.[field];
}
