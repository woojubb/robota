import { readMergedProviderSettingsFromSources } from './provider-merge.js';
import {
  buildProviderSetupPatch,
  mergeProviderPatch,
  setCurrentProvider,
  type IProviderProfileSettings,
  type IProviderSetupInput,
  type IProviderSettingsBuildOptions,
  type TProviderSettingsDocument,
} from './provider-settings.js';

import type { TSettingsSource } from '../../config/settings-source.js';
import type { ISettingsDocumentStore } from '../../config/settings-store.js';

export interface IProviderSwitchOptions {
  knownProviders?: Record<string, IProviderProfileSettings>;
}

export interface IActiveModelChangeOptions {
  providerOverride?: string | undefined;
}

export interface IActiveModelChangeResult {
  settingsPath: string;
  settings: TProviderSettingsDocument;
  profileName?: string;
}

export function resolveProviderSettingsWriteTarget(
  stores: readonly ISettingsDocumentStore[],
): ISettingsDocumentStore {
  const target = findLastStoreWithCurrentProvider(stores) ?? stores[0];
  if (target === undefined) {
    throw new Error('No settings store available for provider update');
  }
  return target;
}

function readProviderDocument(store: ISettingsDocumentStore): TProviderSettingsDocument {
  return store.read() as TProviderSettingsDocument;
}

export function applyProviderConfiguration(
  store: ISettingsDocumentStore,
  input: IProviderSetupInput,
  options: IProviderSettingsBuildOptions = {},
): TProviderSettingsDocument {
  const settings = readProviderDocument(store);
  const patch = buildProviderSetupPatch(input, options);
  const next = mergeProviderPatch(settings, patch);
  store.write(next);
  return next;
}

export function applyProviderSwitch(
  store: ISettingsDocumentStore,
  profileName: string,
  options: IProviderSwitchOptions = {},
): TProviderSettingsDocument {
  const settings = readProviderDocument(store);
  const hasLocalProfile = settings.providers?.[profileName] !== undefined;
  const hasKnownProfile = options.knownProviders?.[profileName] !== undefined;
  const next =
    hasLocalProfile || hasKnownProfile
      ? { ...settings, currentProvider: profileName }
      : setCurrentProvider(settings, profileName);
  store.write(next);
  return next;
}

export function applyActiveModelChange(
  sources: readonly TSettingsSource[],
  stores: readonly ISettingsDocumentStore[],
  modelId: string,
  options: IActiveModelChangeOptions = {},
): IActiveModelChangeResult {
  const merged = readMergedProviderSettingsFromSources(sources);
  const activeProfileName = options.providerOverride ?? merged.currentProvider;

  if (typeof activeProfileName !== 'string') {
    throw new Error(
      'Cannot update model: no active provider profile. Set "currentProvider" in settings.',
    );
  }

  return updateActiveProviderProfileModel(stores, activeProfileName, modelId);
}

function updateActiveProviderProfileModel(
  stores: readonly ISettingsDocumentStore[],
  profileName: string,
  modelId: string,
): IActiveModelChangeResult {
  const store = findLastStoreWithProviderProfile(stores, profileName) ?? stores[0];
  if (store === undefined) {
    throw new Error('No settings store available for model update');
  }

  const settings = readProviderDocument(store);
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
  store.write(next);
  return { settingsPath: store.displayName, settings: next, profileName };
}

function findLastStoreWithProviderProfile(
  stores: readonly ISettingsDocumentStore[],
  profileName: string,
): ISettingsDocumentStore | undefined {
  for (let index = stores.length - 1; index >= 0; index -= 1) {
    const store = stores[index];
    if (store === undefined) continue;
    const settings = readProviderDocument(store);
    if (settings.providers?.[profileName] !== undefined) return store;
  }
  return undefined;
}

function findLastStoreWithCurrentProvider(
  stores: readonly ISettingsDocumentStore[],
): ISettingsDocumentStore | undefined {
  for (let index = stores.length - 1; index >= 0; index -= 1) {
    const store = stores[index];
    if (store === undefined) continue;
    const settings = readProviderDocument(store);
    if (settings.currentProvider !== undefined) return store;
  }
  return undefined;
}
