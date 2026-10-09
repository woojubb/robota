import {
  findProviderDefinition,
  formatSupportedProviderTypes,
  getProviderCredentialRequirement,
} from '../interfaces/provider-definition.js';
import { ENV_REFERENCE_PREFIX, isEnvReference, resolveEnvReference } from '../utils/env-ref.js';
import { processEnvResolver, type TEnvResolver } from '../utils/env-resolver.js';

import type {
  IProviderDefinition,
  IProviderDefinitionConfig,
  IProviderCredentialRequirement,
  TProviderCredentialField,
  TProviderCredentialReference,
} from '../interfaces/provider-definition.js';
import type { IAIProvider } from '../interfaces/provider.js';
import type { TUniversalValue } from '../interfaces/types.js';

/**
 * Normalize loose provider settings into a fully-resolved {@link IProviderDefinitionConfig}.
 *
 * The default model comes from the provider definition's `defaults.model` (the single SSOT for a
 * provider's default model — never a second field); `apiKey` `$ENV:` references are resolved here via
 * {@link resolveEnvReference}. This resolver lives in `agent-core` (it imports only `agent-core` symbols)
 * so any consumer — including the `dag-node-llm-text` leaf, which depends on `agent-core` alone — reuses
 * the one credential-resolution path instead of re-reading `process.env` (ARCH-PROVIDER-003).
 *
 * #2347: the environment is INJECTED as `resolve`. This function is deterministic from its arguments
 * and that resolver; it never reads `process.env` itself (guarded by the `provider-env-resolution`
 * scan). The default is the host environment so composition roots need not pass one.
 */
export function normalizeProviderConfig(
  settings: {
    name: string;
    model?: string;
    apiKey?: string;
    apiKeyRef?: TProviderCredentialReference;
    baseURL?: string;
    timeout?: number;
    options?: Record<string, TUniversalValue>;
  },
  providerDefinitions: readonly IProviderDefinition[],
  resolve: TEnvResolver = processEnvResolver,
): IProviderDefinitionConfig {
  const defaults = findProviderDefinition(providerDefinitions, settings.name)?.defaults ?? {};
  const model = settings.model ?? defaults.model;
  if (!model) {
    throw new Error(`Provider ${settings.name} requires model`);
  }
  if (settings.apiKeyRef !== undefined && settings.apiKey !== undefined) {
    throw new Error(`Provider ${settings.name} has conflicting credential origins`);
  }
  if (
    settings.apiKeyRef !== undefined &&
    (!settings.apiKeyRef.service?.trim() || !settings.apiKeyRef.account?.trim())
  ) {
    throw new Error(`Provider ${settings.name} has an invalid host credential reference`);
  }
  const apiKeyReference =
    settings.apiKeyRef === undefined ? (settings.apiKey ?? defaults.apiKey) : undefined;
  const apiKeyEnv =
    apiKeyReference !== undefined && isEnvReference(apiKeyReference)
      ? apiKeyReference.slice(ENV_REFERENCE_PREFIX.length).trim()
      : undefined;
  if (apiKeyEnv === '') {
    throw new Error(
      `Provider ${settings.name} has an invalid API key environment reference; use $ENV:VARIABLE_NAME`,
    );
  }
  const options = settings.options ?? defaults.options;
  return {
    name: settings.name,
    model,
    apiKey:
      apiKeyReference !== undefined ? resolveEnvReference(apiKeyReference, resolve) : undefined,
    ...(apiKeyEnv ? { apiKeyEnv } : {}),
    ...(settings.apiKeyRef !== undefined ? { apiKeyRef: settings.apiKeyRef } : {}),
    baseURL: settings.baseURL ?? defaults.baseURL,
    timeout: settings.timeout,
    ...(options !== undefined && { options }),
  };
}

/**
 * Construct an {@link IAIProvider} from a resolved config against the injected provider-definition
 * registry, enforcing the definition's credential requirement. Throws a typed error naming the supported
 * provider types when the requested provider is not in the registry.
 */
export function createProviderFromConfig(
  settings: IProviderDefinitionConfig,
  providerDefinitions: readonly IProviderDefinition[],
): IAIProvider {
  if (settings.apiKeyRef !== undefined && !settings.apiKey) {
    throw new Error(
      `Provider ${settings.name} requires host credential resolution before construction`,
    );
  }
  const definition = findProviderDefinition(providerDefinitions, settings.name);
  if (definition === undefined) {
    throw new Error(
      `Unknown provider: ${settings.name}. Currently supported: ${formatSupportedProviderTypes(providerDefinitions)}`,
    );
  }
  const credentialRequirement = getProviderCredentialRequirement(definition);
  if (
    credentialRequirement !== undefined &&
    !hasRequiredProviderCredential(settings, credentialRequirement)
  ) {
    throw new Error(
      `Provider ${settings.name} requires ${formatCredentialRequirement(credentialRequirement)}`,
    );
  }
  return definition.createProvider(settings);
}

/** Whether `settings` satisfies at least one of the credential fields the requirement allows. */
function hasRequiredProviderCredential(
  settings: IProviderDefinitionConfig,
  requirement: IProviderCredentialRequirement,
): boolean {
  return requirement.anyOf.some((field) => hasProviderCredentialValue(settings, field));
}

function hasProviderCredentialValue(
  settings: IProviderDefinitionConfig,
  field: TProviderCredentialField,
): boolean {
  const value = settings[field];
  return value !== undefined && value.length > 0;
}

function formatCredentialRequirement(requirement: IProviderCredentialRequirement): string {
  return requirement.anyOf
    .map((field) => (field === 'apiKey' ? 'apiKey (API key)' : field))
    .join(' or ');
}
