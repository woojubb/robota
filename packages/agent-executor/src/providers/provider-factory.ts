import {
  resolveEnvReference,
  normalizeProviderConfig,
  createProviderFromConfig,
} from '@robota-sdk/agent-core';

import type { ISerializableProviderProfile } from '../background-tasks/types.js';
import type { IAIProvider, IProviderDefinition } from '@robota-sdk/agent-core';

/**
 * `normalizeProviderConfig` and `createProviderFromConfig` were relocated into `agent-core`
 * (ARCH-PROVIDER-003) — they import only `agent-core` symbols, so the one credential-resolution path can be
 * reused by the `dag-node-llm-text` leaf (which depends on `agent-core` alone). Re-exported here so existing
 * `@robota-sdk/agent-executor` consumers are unaffected.
 */
export { normalizeProviderConfig, createProviderFromConfig };

/**
 * Profile-based helpers stay in `agent-executor`: they depend on the executor-owned
 * {@link ISerializableProviderProfile} type and `resolveProfileApiKey` reads `process.env` directly.
 */
export function resolveProfileApiKey(profile: ISerializableProviderProfile): string | undefined {
  if (profile.apiKey !== undefined) {
    return resolveEnvReference(profile.apiKey);
  }
  if (profile.apiKeyEnv !== undefined) {
    return process.env[profile.apiKeyEnv];
  }
  return undefined;
}

export function createProviderFromProfile(
  profile: ISerializableProviderProfile,
  modelOverride: string | undefined,
  providerDefinitions: readonly IProviderDefinition[],
): IAIProvider {
  return createProviderFromConfig(
    normalizeProviderConfig(
      {
        name: profile.type,
        model: modelOverride ?? profile.model,
        apiKey: resolveProfileApiKey(profile),
        baseURL: profile.baseURL,
        timeout: profile.timeout,
        options: profile.options,
      },
      providerDefinitions,
    ),
    providerDefinitions,
  );
}
