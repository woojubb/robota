import { existsSync, readFileSync } from 'node:fs';

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

import type { TProviderSettingsDocument } from './provider-settings.js';

export type TSettingsCheck = 'missing' | 'valid' | 'corrupt' | 'incomplete';

/**
 * `environment` is the map `$ENV:` references resolve against — the host's startup snapshot, since
 * the live process environment may have dropped credentials it holds for itself.
 */
export function checkSettingsDocument(
  settings: TProviderSettingsDocument,
  providerDefinitions: readonly IProviderDefinition[] = [],
  environment?: Readonly<Record<string, string | undefined>>,
): TSettingsCheck {
  const resolve: TEnvResolver | undefined =
    environment === undefined ? undefined : (name) => environment[name];
  return hasUsableProviderConfig(settings, providerDefinitions, resolve) ? 'valid' : 'incomplete';
}

function hasUsableProviderConfig(
  settings: TProviderSettingsDocument,
  providerDefinitions: readonly IProviderDefinition[],
  resolve: TEnvResolver | undefined,
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
  resolve: TEnvResolver | undefined,
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
  resolve: TEnvResolver | undefined,
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

/** Explicit host-filesystem settings probe. This does not establish project trust. */
export function checkNodeHostSettingsFile(
  filePath: string,
  providerDefinitions: readonly IProviderDefinition[] = [],
): TSettingsCheck {
  if (!existsSync(filePath)) return 'missing';
  try {
    const raw = readFileSync(filePath, 'utf8').trim();
    if (raw.length === 0) return 'incomplete';
    const parsed = JSON.parse(raw) as TProviderSettingsDocument;
    return checkSettingsDocument(parsed, providerDefinitions);
  } catch {
    // allow-fallback: corrupt settings file is a valid terminal state ('corrupt')
    return 'corrupt';
  }
}
