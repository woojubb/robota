import {
  findProviderDefinition,
  formatSupportedProviderTypes,
  getProviderCredentialRequirement,
} from '../interfaces/provider-definition.js';
import { resolveEnvReference } from '../utils/env-ref.js';

import type {
  IProviderDefinition,
  IProviderDefinitionConfig,
  IProviderCredentialRequirement,
  TProviderCredentialField,
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
 */
export function normalizeProviderConfig(
  settings: {
    name: string;
    model?: string;
    apiKey?: string;
    baseURL?: string;
    timeout?: number;
    options?: Record<string, TUniversalValue>;
  },
  providerDefinitions: readonly IProviderDefinition[],
): IProviderDefinitionConfig {
  const defaults = findProviderDefinition(providerDefinitions, settings.name)?.defaults ?? {};
  const model = settings.model ?? defaults.model;
  if (!model) {
    throw new Error(`Provider ${settings.name} requires model`);
  }
  const apiKeyReference = settings.apiKey ?? defaults.apiKey;
  const options = settings.options ?? defaults.options;
  return {
    name: settings.name,
    model,
    apiKey: apiKeyReference !== undefined ? resolveEnvReference(apiKeyReference) : undefined,
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
  return requirement.anyOf.join(' or ');
}
