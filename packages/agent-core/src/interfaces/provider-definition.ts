import type { IAIProvider } from './provider';
import type { TUniversalValue } from './types';

export interface IProviderConfig {
  name: string;
  model: string;
  apiKey?: string;
  baseURL?: string;
  timeout?: number;
  options?: Record<string, TUniversalValue>;
}

export interface IProviderProfileDefaults {
  model?: string;
  apiKey?: string;
  baseURL?: string;
  timeout?: number;
  options?: Record<string, TUniversalValue>;
}

export interface IProviderProfileConfig {
  type?: string;
  model?: string;
  apiKey?: string;
  baseURL?: string;
  timeout?: number;
  options?: Record<string, TUniversalValue>;
}

export interface IProviderProbeResult {
  ok: boolean;
  message: string;
  models?: string[];
}

export type TProviderCredentialField = 'apiKey';
export type TProviderSetupField = 'baseURL' | 'model' | TProviderCredentialField;
export type TProviderSetupHelpLinkKind = 'api-key' | 'console' | 'official';

export interface IProviderCredentialRequirement {
  anyOf: readonly TProviderCredentialField[];
}

export interface IProviderSetupHelpLink {
  kind: TProviderSetupHelpLinkKind;
  label: string;
  url: string;
  sourceUrl?: string;
  lastVerifiedAt?: string;
}

export type TProviderModelCatalogStatus = 'live' | 'generated' | 'fallback' | 'unavailable';
export type TProviderModelLifecycle = 'active' | 'preview' | 'deprecated' | 'unavailable';
export type TProviderModelCapability =
  | 'tools'
  | 'vision'
  | 'json_schema'
  | 'reasoning'
  | 'native_web'
  | 'streaming';

export interface IProviderModelCatalogEntry {
  id: string;
  displayName: string;
  aliases?: readonly string[];
  contextWindow?: number;
  capabilities?: readonly TProviderModelCapability[];
  lifecycle?: TProviderModelLifecycle;
  lastVerifiedAt?: string;
  sourceUrl?: string;
}

export interface IProviderModelCatalog {
  status: TProviderModelCatalogStatus;
  entries?: readonly IProviderModelCatalogEntry[];
  lastVerifiedAt?: string;
  sourceUrl?: string;
  message?: string;
}

export interface IProviderModelCatalogRefreshOptions {
  profile: IProviderProfileConfig;
}

export type TProviderModelCatalogRefresh = (
  options: IProviderModelCatalogRefreshOptions,
) => Promise<IProviderModelCatalog>;

export interface IProviderSetupStepDefinition {
  key: TProviderSetupField;
  title: string;
  defaultValue?: string;
  required?: boolean;
  masked?: boolean;
}

export interface IProviderDefinition {
  type: string;
  aliases?: readonly string[];
  displayName?: string;
  description?: string;
  defaults?: IProviderProfileDefaults;
  modelCatalog?: IProviderModelCatalog;
  refreshModelCatalog?: TProviderModelCatalogRefresh;
  /** Maximum age in seconds before the model catalog is considered stale and auto-refreshed. */
  modelCatalogCacheTtlSeconds?: number;
  setupHelpLinks?: readonly IProviderSetupHelpLink[];
  setupSteps?: readonly IProviderSetupStepDefinition[];
  credentialRequirement?: IProviderCredentialRequirement;
  requiresApiKey?: boolean;
  createProvider: (config: IProviderConfig) => IAIProvider;
  probeProfile?: (profile: IProviderProfileConfig) => Promise<IProviderProbeResult>;
}

export function findProviderDefinition(
  definitions: readonly IProviderDefinition[],
  type: string,
): IProviderDefinition | undefined {
  return definitions.find(
    (definition) => definition.type === type || definition.aliases?.includes(type) === true,
  );
}

export function formatSupportedProviderTypes(definitions: readonly IProviderDefinition[]): string {
  return definitions
    .map((definition) => {
      if (!definition.aliases || definition.aliases.length === 0) {
        return definition.type;
      }
      const aliasLabel = definition.aliases.length === 1 ? 'alias' : 'aliases';
      return `${definition.type} (${aliasLabel}: ${definition.aliases.join(', ')})`;
    })
    .join(', ');
}

export function getProviderCredentialRequirement(
  definition: IProviderDefinition | undefined,
): IProviderCredentialRequirement | undefined {
  if (definition?.credentialRequirement !== undefined) {
    return definition.credentialRequirement;
  }
  if (definition?.requiresApiKey === true) {
    return { anyOf: ['apiKey'] };
  }
  return undefined;
}
