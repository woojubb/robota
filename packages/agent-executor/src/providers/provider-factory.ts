import {
  resolveEnvReference,
  normalizeProviderConfig,
  createProviderFromConfig,
} from '@robota-sdk/agent-core';

import type { ISerializableProviderProfile } from '../background-tasks/types.js';
import type { IAIProvider, IProviderDefinition } from '@robota-sdk/agent-core';

/*
 * ARCH-111: `normalizeProviderConfig` and `createProviderFromConfig` are NOT re-exported.
 *
 * ARCH-PROVIDER-003 relocated them into `agent-core` and left a re-export here "so existing
 * consumers are unaffected" — a backward-compatibility guarantee this repository does not make. What
 * the duplicate name bought instead was two consumers inside one product disagreeing about the owner:
 * `agent-framework` imported them from here while `agent-product` imported the same function from
 * `agent-core`, and both compiled.
 *
 * They are imported above because this file's own helpers call them. That is a use, not a surface.
 */

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
