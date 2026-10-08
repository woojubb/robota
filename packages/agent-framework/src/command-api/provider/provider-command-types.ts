import type { TProviderSettingsDocument } from './provider-settings.js';
import type { IOrgPolicy } from '../org-policy/org-policy-types.js';
import type {
  IProviderDefinition,
  ICredentialKey,
  TProviderCredentialResolver,
} from '@robota-sdk/agent-core';

export type TProviderConnectionStage = 'awaiting-approval' | 'exchanging' | 'validating' | 'saving';
export interface IProviderConnectionRequest {
  type: string;
  profile: string;
  method: 'browser' | 'api-key';
  apiKey?: string;
  signal?: AbortSignal;
  onProgress?: (stage: TProviderConnectionStage) => void;
}
/** Host-owned key acquisition; successful persistence is the commit point. */
export interface IProviderConnectionHost {
  connect(
    request: IProviderConnectionRequest,
    persist: (reference: ICredentialKey, signal: AbortSignal) => void | Promise<void>,
  ): Promise<ICredentialKey>;
}

export interface IProviderCommandSettingsAdapter {
  readMergedSettings(): TProviderSettingsDocument;
  readTargetSettings(): TProviderSettingsDocument;
  writeTargetSettings(settings: TProviderSettingsDocument): void;
}

export interface IProviderCommandModuleOptions {
  providerDefinitions: readonly IProviderDefinition[];
  settings: IProviderCommandSettingsAdapter;
  orgPolicy?: IOrgPolicy;
  connectionHost?: IProviderConnectionHost;
  resolveCredential?: TProviderCredentialResolver;
  /**
   * The environment a `$ENV:` credential or a definition's default credential variable is checked
   * against. A host that withholds its own credentials from `process.env` (so commands it runs do not
   * inherit them) passes the snapshot it took first; absent, the live `process.env` is read.
   */
  env?: Readonly<Record<string, string | undefined>>;
}
