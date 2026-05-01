import { existsSync, readFileSync } from 'node:fs';
import { findProviderDefinition, type IProviderDefinition } from './provider-definition.js';

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

function hasUsableProviderConfig(
  settings: IProviderSettingsShape,
  providerDefinitions: readonly IProviderDefinition[],
): boolean {
  if (
    settings.provider &&
    isUsableProviderProfile(settings.provider.name, settings.provider, providerDefinitions)
  ) {
    return true;
  }
  if (typeof settings.currentProvider !== 'string') {
    return false;
  }
  const profile = settings.providers?.[settings.currentProvider];
  return isUsableProviderProfile(profile?.type, profile, providerDefinitions);
}

function isUsableProviderProfile(
  type: string | undefined,
  profile: { apiKey?: string } | undefined,
  providerDefinitions: readonly IProviderDefinition[],
): boolean {
  if (!profile) {
    return false;
  }
  if (profile.apiKey) {
    return true;
  }
  if (!type) {
    return false;
  }
  const definition = findProviderDefinition(providerDefinitions, type);
  if (definition === undefined) {
    return false;
  }
  return definition.requiresApiKey !== true || definition.defaults?.apiKey !== undefined;
}
