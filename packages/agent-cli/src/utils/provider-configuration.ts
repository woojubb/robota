import { readSettings, writeSettings } from './settings-io.js';
import {
  getProviderSettingsPaths,
  readMergedProviderSettingsFromPaths,
} from './provider-factory.js';
import {
  buildProviderSetupPatch,
  mergeProviderPatch,
  setCurrentProvider,
  type IProviderProfileSettings,
  type IProviderSetupInput,
  type IProviderSettingsBuildOptions,
  type TProviderSettingsDocument,
} from './provider-settings.js';

export interface IProviderSwitchOptions {
  knownProviders?: Record<string, IProviderProfileSettings>;
}

export interface IActiveModelChangeOptions {
  settingsPaths?: readonly string[];
  providerOverride?: string | undefined;
}

export interface IActiveModelChangeResult {
  settingsPath: string;
  settings: TProviderSettingsDocument;
  profileName?: string;
  legacyProvider?: boolean;
}

function readProviderDocument(settingsPath: string): TProviderSettingsDocument {
  return readSettings(settingsPath) as TProviderSettingsDocument;
}

export function applyProviderConfiguration(
  settingsPath: string,
  input: IProviderSetupInput,
  options: IProviderSettingsBuildOptions = {},
): TProviderSettingsDocument {
  const settings = readProviderDocument(settingsPath);
  const patch = buildProviderSetupPatch(input, options);
  const next = mergeProviderPatch(settings, patch);
  writeSettings(settingsPath, next);
  return next;
}

export function applyProviderSwitch(
  settingsPath: string,
  profileName: string,
  options: IProviderSwitchOptions = {},
): TProviderSettingsDocument {
  const settings = readProviderDocument(settingsPath);
  const hasLocalProfile = settings.providers?.[profileName] !== undefined;
  const hasKnownProfile = options.knownProviders?.[profileName] !== undefined;
  const next =
    hasLocalProfile || hasKnownProfile
      ? { ...settings, currentProvider: profileName }
      : setCurrentProvider(settings, profileName);
  writeSettings(settingsPath, next);
  return next;
}

export function applyActiveModelChange(
  cwd: string,
  modelId: string,
  options: IActiveModelChangeOptions = {},
): IActiveModelChangeResult {
  const settingsPaths = options.settingsPaths ?? getProviderSettingsPaths(cwd);
  const merged = readMergedProviderSettingsFromPaths(settingsPaths);
  const activeProfileName = options.providerOverride ?? merged.currentProvider;

  if (typeof activeProfileName === 'string') {
    return updateActiveProviderProfileModel(settingsPaths, activeProfileName, modelId);
  }

  return updateLegacyProviderModel(settingsPaths, modelId);
}

function updateActiveProviderProfileModel(
  settingsPaths: readonly string[],
  profileName: string,
  modelId: string,
): IActiveModelChangeResult {
  const settingsPath =
    findLastPathWithProviderProfile(settingsPaths, profileName) ?? settingsPaths[0];
  if (settingsPath === undefined) {
    throw new Error('No settings path available for model update');
  }

  const settings = readProviderDocument(settingsPath);
  const providers = settings.providers ?? {};
  const existing = providers[profileName] ?? {};
  const next: TProviderSettingsDocument = {
    ...settings,
    providers: {
      ...providers,
      [profileName]: {
        ...existing,
        model: modelId,
      },
    },
  };
  writeSettings(settingsPath, next);
  return { settingsPath, settings: next, profileName };
}

function updateLegacyProviderModel(
  settingsPaths: readonly string[],
  modelId: string,
): IActiveModelChangeResult {
  const settingsPath = findLastPathWithLegacyProvider(settingsPaths) ?? settingsPaths[0];
  if (settingsPath === undefined) {
    throw new Error('No settings path available for model update');
  }

  const settings = readProviderDocument(settingsPath);
  const next: TProviderSettingsDocument = {
    ...settings,
    provider: {
      ...(settings.provider ?? {}),
      model: modelId,
    },
  };
  writeSettings(settingsPath, next);
  return { settingsPath, settings: next, legacyProvider: true };
}

function findLastPathWithProviderProfile(
  settingsPaths: readonly string[],
  profileName: string,
): string | undefined {
  for (let index = settingsPaths.length - 1; index >= 0; index -= 1) {
    const settingsPath = settingsPaths[index];
    if (settingsPath === undefined) continue;
    const settings = readProviderDocument(settingsPath);
    if (settings.providers?.[profileName] !== undefined) return settingsPath;
  }
  return undefined;
}

function findLastPathWithLegacyProvider(settingsPaths: readonly string[]): string | undefined {
  for (let index = settingsPaths.length - 1; index >= 0; index -= 1) {
    const settingsPath = settingsPaths[index];
    if (settingsPath === undefined) continue;
    const settings = readProviderDocument(settingsPath);
    if (settings.provider !== undefined) return settingsPath;
  }
  return undefined;
}
