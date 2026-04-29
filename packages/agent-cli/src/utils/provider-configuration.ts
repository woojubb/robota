import { readSettings, writeSettings } from './settings-io.js';
import {
  buildProviderSetupPatch,
  mergeProviderPatch,
  setCurrentProvider,
  type IProviderProfileSettings,
  type IProviderSetupInput,
  type TProviderSettingsDocument,
} from './provider-settings.js';

export interface IProviderSwitchOptions {
  knownProviders?: Record<string, IProviderProfileSettings>;
}

function readProviderDocument(settingsPath: string): TProviderSettingsDocument {
  return readSettings(settingsPath) as TProviderSettingsDocument;
}

export function applyProviderConfiguration(
  settingsPath: string,
  input: IProviderSetupInput,
): TProviderSettingsDocument {
  const settings = readProviderDocument(settingsPath);
  const patch = buildProviderSetupPatch(input);
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
