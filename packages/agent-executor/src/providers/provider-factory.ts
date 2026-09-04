import {
  resolveEnvReference,
  normalizeProviderConfig,
  createProviderFromConfig,
  processEnvResolver,
} from '@robota-sdk/agent-core';

import type { ISerializableProviderProfile } from '../background-tasks/types.js';
import type { IAIProvider, IProviderDefinition, TEnvResolver } from '@robota-sdk/agent-core';

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
 * {@link ISerializableProviderProfile} type.
 *
 * #2347: BOTH branches go through the injected resolver. Before, the `apiKey` branch used
 * `resolveEnvReference` (a resolver) while the `apiKeyEnv` branch read the ambient environment around
 * it — a fix that reached one of two paths carrying the same value. Neither reads the ambient
 * environment now; the `provider-env-resolution` scan refuses it in this module.
 */
export function resolveProfileApiKey(
  profile: ISerializableProviderProfile,
  resolve: TEnvResolver = processEnvResolver,
): string | undefined {
  if (profile.apiKey !== undefined) {
    return resolveEnvReference(profile.apiKey, resolve);
  }
  if (profile.apiKeyEnv !== undefined) {
    return resolve(profile.apiKeyEnv);
  }
  return undefined;
}

export function createProviderFromProfile(
  profile: ISerializableProviderProfile,
  modelOverride: string | undefined,
  providerDefinitions: readonly IProviderDefinition[],
  resolve: TEnvResolver = processEnvResolver,
): IAIProvider {
  return createProviderFromConfig(
    normalizeProviderConfig(
      {
        name: profile.type,
        model: modelOverride ?? profile.model,
        apiKey: resolveProfileApiKey(profile, resolve),
        baseURL: profile.baseURL,
        timeout: profile.timeout,
        options: profile.options,
      },
      providerDefinitions,
      resolve,
    ),
    providerDefinitions,
  );
}
