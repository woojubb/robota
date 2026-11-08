/**
 * What the parent's config contributes to the child's wire payload.
 *
 * Its own module because "which config members cross a process boundary" is a different question
 * from "how a child process is run", and the runner answered both until this file existed.
 */

import type { ISubagentWorkerParentConfig } from './child-process-subagent-ipc.js';
import type { IInProcessSubagentRunnerDeps } from '@robota-sdk/agent-framework';

/**
 * The config members the CHILD reads, and no others.
 *
 * `parentConfig` was the parent's whole `IResolvedConfig`, so the payload's shape was derived from a
 * runtime type and grew whenever that type grew. It carried the resolved `provider.apiKey` — two
 * lines above `createProviderProfile`, which keeps that secret off the
 * wire — and an `env` map, and **nothing in the child read either**. Measured: the child touches
 * `provider.model`, `permissions`, `defaultTrustLevel` and `hooks`, and no spread, `Object.keys` or
 * whole-object pass reaches the rest.
 *
 * Declared as an explicit shape rather than an `Omit` of the runtime type, so a new field on
 * `IResolvedConfig` does NOT reach the child by default — which is the point of this projection. It is
 * built key by key for the same reason: structural typing would accept the whole config where this
 * type is expected, so the type documents the intent and this function is what enforces it.
 */
export function projectParentConfig(
  config: IInProcessSubagentRunnerDeps['config'],
): ISubagentWorkerParentConfig {
  return {
    provider: { model: config.provider.model },
    permissions: config.permissions,
    defaultTrustLevel: config.defaultTrustLevel,
    ...(config.hooks === undefined ? {} : { hooks: config.hooks }),
  };
}
