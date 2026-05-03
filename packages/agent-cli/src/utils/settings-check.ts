import { existsSync, readFileSync } from 'node:fs';
import { findProviderDefinition, type IProviderDefinition } from './provider-definition.js';
import { hasUsableSecretReference } from './env-ref.js';

/** Result of checking a settings file. */
export type TSettingsCheck = 'missing' | 'valid' | 'corrupt' | 'incomplete';

interface IProviderSettingsShape {
  provider?: { name?: string; apiKey?: string };
  currentProvider?: string;
  providers?: Record<string, { type?: string; apiKey?: string }>;
}

/** Check a settings file's state for first-run setup. */
export function checkSettingsFile(
  filePath: string,
  providerDefinitions: readonly IProviderDefinition[] = [],
): TSettingsCheck {
  if (!existsSync(filePath)) return 'missing';
  try {
    const raw = readFileSync(filePath, 'utf8').trim();
    if (raw.length === 0) return 'incomplete';
    const parsed = JSON.parse(raw) as IProviderSettingsShape;
    if (!hasUsableProviderConfig(parsed, providerDefinitions)) return 'incomplete';
    return 'valid';
  } catch {
    return 'corrupt';
  }
}

/** Check a parsed settings document for a usable active provider. */
export function checkSettingsDocument(
  settings: IProviderSettingsShape,
  providerDefinitions: readonly IProviderDefinition[] = [],
): TSettingsCheck {
  return hasUsableProviderConfig(settings, providerDefinitions) ? 'valid' : 'incomplete';
}

function hasUsableProviderConfig(
  settings: IProviderSettingsShape,
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
  if (!profile) {
    return false;
  }
  if (hasUsableSecretReference(profile.apiKey)) {
    return true;
  }
  if (!type) {
    return false;
  }
  const definition = findProviderDefinition(providerDefinitions, type);
  if (definition === undefined) {
    return false;
  }
  return (
    definition.requiresApiKey !== true || hasUsableSecretReference(definition.defaults?.apiKey)
  );
}
