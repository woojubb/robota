import type { IProviderDefinition } from '@robota-sdk/agent-core';
import type { TProviderSettingsDocument } from './provider-settings.js';

export interface IProviderCommandSettingsAdapter {
  readMergedSettings(): TProviderSettingsDocument;
  readTargetSettings(): TProviderSettingsDocument;
  writeTargetSettings(settings: TProviderSettingsDocument): void;
}

export interface IProviderCommandModuleOptions {
  providerDefinitions: readonly IProviderDefinition[];
  settings: IProviderCommandSettingsAdapter;
}
