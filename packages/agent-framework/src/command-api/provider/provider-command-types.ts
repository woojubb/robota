import type { TProviderSettingsDocument } from './provider-settings.js';
import type { IOrgPolicy } from '../org-policy/org-policy-types.js';
import type { IProviderDefinition } from '@robota-sdk/agent-core';

export interface IProviderCommandSettingsAdapter {
  readMergedSettings(): TProviderSettingsDocument;
  readTargetSettings(): TProviderSettingsDocument;
  writeTargetSettings(settings: TProviderSettingsDocument): void;
}

export interface IProviderCommandModuleOptions {
  providerDefinitions: readonly IProviderDefinition[];
  settings: IProviderCommandSettingsAdapter;
  orgPolicy?: IOrgPolicy;
  /**
   * The environment a `$ENV:` credential or a definition's default credential variable is checked
   * against. A host that withholds its own credentials from `process.env` (so commands it runs do not
   * inherit them) passes the snapshot it took first; absent, the live `process.env` is read.
   */
  env?: Readonly<Record<string, string | undefined>>;
}
