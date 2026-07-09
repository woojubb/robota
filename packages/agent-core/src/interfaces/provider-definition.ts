import type { IAIProvider } from './provider';
import type { TUniversalValue } from './types';

export interface IProviderDefinitionConfig {
  name: string;
  model: string;
  apiKey?: string;
  baseURL?: string;
  timeout?: number;
  options?: Record<string, TUniversalValue>;
  /**
   * Resolution origin. `'env-default'` means no settings profile existed and the config
   * was synthesized from a provider definition's defaults because its `$ENV:` apiKey
   * reference resolved — callers surface a startup notice for this case.
   */
  source?: 'env-default';
  /**
   * Name of the environment variable the env-default key was resolved from
   * (set only when `source` is `'env-default'`) — lets callers name the variable in the
   * startup notice without exposing the key value.
   */
  sourceEnvVar?: string;
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
  /**
   * Per-model USD cost per input/output token (ARCH-PROVIDER-003). This is the correct SSOT home for
   * cost — it is a per-**model** attribute, not per-provider — consumed by cost-estimating nodes/commands
   * so pricing is not hardcoded in the execution layer. Both optional; absent means cost is unknown for
   * this model and estimators must degrade explicitly rather than assume a default price.
   */
  costPerInputToken?: number;
  costPerOutputToken?: number;
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

export type TProviderCategory = 'cloud-paid' | 'cloud-free' | 'local-free';

export interface IProviderDefinition {
  type: string;
  aliases?: readonly string[];
  displayName?: string;
  description?: string;
  /** Billing/hosting category shown as a badge in provider selection UI. */
  category?: TProviderCategory;
  defaults?: IProviderProfileDefaults;
  /**
   * Optional enforced model allowlist (ARCH-PROVIDER-003). Distinct from {@link modelCatalog}: the catalog
   * is the *descriptive* model inventory (often `status:'unavailable'` with no entries), whereas
   * `allowedModels` is the *enforced* execution allowlist — a node rejects a requested model outside it.
   * When present it should be a subset/override consistent with `modelCatalog.entries[].id`, not a second
   * drifting inventory. Absent means no allowlist enforcement (any model the provider accepts is allowed).
   */
  allowedModels?: readonly string[];
  modelCatalog?: IProviderModelCatalog;
  refreshModelCatalog?: TProviderModelCatalogRefresh;
  /** Maximum age in seconds before the model catalog is considered stale and auto-refreshed. */
  modelCatalogCacheTtlSeconds?: number;
  setupHelpLinks?: readonly IProviderSetupHelpLink[];
  setupSteps?: readonly IProviderSetupStepDefinition[];
  credentialRequirement?: IProviderCredentialRequirement;
  requiresApiKey?: boolean;
  createProvider: (config: IProviderDefinitionConfig) => IAIProvider;
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
