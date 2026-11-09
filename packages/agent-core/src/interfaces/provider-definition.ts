import type { IAIProvider } from './provider';
import type { IProviderNativeWebToolRequest } from './provider-capabilities';
import type { TUniversalValue } from './types';

/** A serializable name of a host-held credential, never the credential itself. */
export type TProviderCredentialReference = { readonly service: string; readonly account: string };
export type TProviderCredentialResolver = (
  config: IProviderDefinitionConfig,
) => Promise<IProviderDefinitionConfig>;

export interface IProviderDefinitionConfig {
  name: string;
  model: string;
  apiKey?: string;
  /**
   * Name of the environment variable `apiKey` was resolved FROM, when the stored settings value
   * was a `$ENV:` reference. Config loading resolves such a reference into the secret
   * itself, which is correct for an in-process provider and wrong for anything that has to
   * SERIALIZE the config — the resolved value then crosses a boundary the credential's owner
   * never opted into. Keeping the variable name lets a serializing caller carry the reference and
   * leave the secret behind; `ISerializableProviderProfile` already declares the same field, and
   * `resolveProfileApiKey` already reads it.
   *
   * Distinct from `sourceEnvVar`, which is set only for a synthesized `'env-default'` config.
   */
  apiKeyEnv?: string;
  /** Retained after host resolution so serialization can omit the resolved secret. */
  apiKeyRef?: TProviderCredentialReference;
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
  apiKeyRef?: TProviderCredentialReference;
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

export type { TProviderModelCapability } from './provider-model-capability-kind';
import type { TProviderModelCapability } from './provider-model-capability-kind';

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
   * Per-model USD cost per input/output token. This is the correct SSOT home for
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

export interface IProviderSetupStepDefinition {
  key: TProviderSetupField;
  title: string;
  defaultValue?: string;
  required?: boolean;
  masked?: boolean;
  /** Omitted from ordinary setup; exposed when the user explicitly edits a profile. */
  editOnly?: boolean;
}

export type TProviderCategory = 'cloud-paid' | 'cloud-free' | 'local-free';

/**
 * Passive reachability declaration for diagnostics.
 *
 * The host and port a pre-session doctor may TCP-probe when a profile declares no `baseURL` and the
 * definition declares no `defaults.baseURL` — the case for vendors whose SDK embeds its endpoint. It
 * is deliberately not a URL and not part of `defaults`: nothing in setup, persistence or provider
 * construction reads it, so declaring it cannot switch an API surface or persist a base URL. It is
 * distinct from `probeProfile`, which is an active HTTP probe.
 */
export interface IProviderEndpoint {
  readonly host: string;
  readonly port: number;
}

export interface IProviderDefinition {
  type: string;
  aliases?: readonly string[];
  displayName?: string;
  description?: string;
  /** Billing/hosting category shown as a badge in provider selection UI. */
  category?: TProviderCategory;
  /** Available credential acquisition methods; concrete authorization belongs to the host. */
  connectionMethods?: readonly ('api-key' | 'browser')[];
  /**
   * The provider-hosted web tools a host may turn on by default through `options.nativeWebTools`,
   * answered for the profile being built and the environment its client reads, because they can
   * depend on where that profile connects. The host passes that environment: a platform-neutral
   * provider cannot read it for itself. Declaring a tool is the definition's judgment that a host may
   * switch it on without the profile asking. A tool left out, or an absent function, is no such
   * judgment: asking for it explicitly fails, is ignored, or is the caller's own choice, and the
   * provider's capabilities report whether it is on.
   */
  nativeWebTools?: (
    profile: Pick<IProviderDefinitionConfig, 'baseURL' | 'options'>,
    environment: Readonly<Record<string, string | undefined>>,
  ) => readonly (keyof IProviderNativeWebToolRequest)[];
  defaults?: IProviderProfileDefaults;
  /**
   * Optional enforced model allowlist. Distinct from {@link modelCatalog}: the catalog
   * is the *descriptive* model inventory (often `status:'unavailable'` with no entries), whereas
   * `allowedModels` is the *enforced* execution allowlist — a node rejects a requested model outside it.
   * When present it should be a subset/override consistent with `modelCatalog.entries[].id`, not a second
   * drifting inventory. Absent means no allowlist enforcement (any model the provider accepts is allowed).
   */
  allowedModels?: readonly string[];
  /**
   * INTERIM provider-level cost per token in USD, migrated verbatim from the per-vendor
   * LLM nodes' single `COST_PER_TOKEN_USD` scalar. The correct long-term home is the per-model
   * {@link IProviderModelCatalogEntry.costPerInputToken}/`costPerOutputToken`; this flat scalar is a
   * fidelity-preserving interim used only while model catalogs are `status:'unavailable'` (no per-model
   * entries to attach cost to). Consumed by the collapsed `llm-text` node's cost estimate. Absent
   * means cost is unknown for this provider and estimators must degrade explicitly.
   */
  costPerTokenUsd?: number;
  modelCatalog?: IProviderModelCatalog;
  setupHelpLinks?: readonly IProviderSetupHelpLink[];
  setupSteps?: readonly IProviderSetupStepDefinition[];
  credentialRequirement?: IProviderCredentialRequirement;
  requiresApiKey?: boolean;
  /**
   * The environment variables this provider's client reads to decide where it connects or which
   * credential it sends, beyond its configuration (for example a base-URL variable the SDK falls
   * back to). A process that builds this provider from another process's configuration must see
   * the same values, or the credential goes somewhere its owner did not choose.
   */
  destinationEnvironment?: readonly string[];
  createProvider: (config: IProviderDefinitionConfig) => IAIProvider;
  probeProfile?: (profile: IProviderProfileConfig) => Promise<IProviderProbeResult>;
  /** Diagnostic-only reachability declaration; read by no setup, persistence or runtime path. */
  endpoint?: IProviderEndpoint;
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
