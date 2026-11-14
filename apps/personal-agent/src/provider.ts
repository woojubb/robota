/**
 * Build the model provider a profile names, from the SDK's built-in provider definitions.
 */
import { findProviderDefinition, formatSupportedProviderTypes } from '@robota-sdk/agent-core';
import { createDefaultProviderDefinitions } from '@robota-sdk/agent-provider/builtin';

import type { IAIProvider } from '@robota-sdk/agent-core';
import type { IProviderProfile } from './config.js';

export function createProviderFromProfile(
  profile: IProviderProfile,
  environment: Readonly<Record<string, string | undefined>>,
): IAIProvider {
  const definitions = createDefaultProviderDefinitions();
  const definition = findProviderDefinition(definitions, profile.type);
  if (definition === undefined) {
    throw new Error(
      `Unknown provider type "${profile.type}". Supported: ${formatSupportedProviderTypes(definitions)}`,
    );
  }
  const apiKey = profile.apiKeyEnv === undefined ? undefined : environment[profile.apiKeyEnv];
  if (profile.apiKeyEnv !== undefined && (apiKey === undefined || apiKey === '')) {
    throw new Error(`The provider key variable ${profile.apiKeyEnv} is not set`);
  }
  return definition.createProvider({
    name: profile.type,
    model: profile.model,
    ...(apiKey !== undefined && { apiKey }),
    ...(profile.baseURL !== undefined && { baseURL: profile.baseURL }),
  });
}
