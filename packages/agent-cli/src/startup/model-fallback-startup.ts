/**
 * Put the model fallback chain in front of the session's provider.
 *
 * The chain comes from `--fallback-model` when it is given and from the `fallbackModel` setting
 * otherwise. Only this process's sessions and the in-process subagents that share its provider use
 * it; a child-process subagent is bound to one connection and runs without it.
 */

import { createLogger } from '@robota-sdk/agent-core';
import {
  FallbackProvider,
  readMergedProviderSettings,
  resolveModelFallbackChain,
  selectFallbackModelEntries,
} from '@robota-sdk/agent-framework';

import type {
  IAIProvider,
  IProviderDefinition,
  IProviderDefinitionConfig,
} from '@robota-sdk/agent-core';
import type { IOrgPolicy, TSettingsSource } from '@robota-sdk/agent-framework';

const logger = createLogger('agent-cli:model-fallback');

export interface IApplyModelFallbackChainInput {
  provider: IAIProvider;
  /** `--fallback-model`, already split; wins over the setting when given. */
  fallbackFlag: readonly string[] | undefined;
  settingsSources: readonly TSettingsSource[];
  /** The primary's resolved config, on the model the session runs. */
  primaryConfig: IProviderDefinitionConfig;
  /** `--provider`, when given. */
  providerOverride?: string;
  providerDefinitions: readonly IProviderDefinition[];
  orgPolicy?: IOrgPolicy;
  /** Where a dropped entry is announced. */
  notice: (message: string) => void;
}

/** The provider to run sessions on: the one given, or a {@link FallbackProvider} over it. */
export function applyModelFallbackChain(input: IApplyModelFallbackChainInput): IAIProvider {
  const settings = readMergedProviderSettings(input.settingsSources);
  const entries = selectFallbackModelEntries(input.fallbackFlag, settings);
  if (entries.length === 0) return input.provider;
  const profile =
    input.primaryConfig.source === 'env-default'
      ? undefined
      : (input.providerOverride ?? settings.currentProvider);
  const chain = resolveModelFallbackChain({
    entries,
    settings,
    primary: { ...(profile !== undefined && { profile }), config: input.primaryConfig },
    providerDefinitions: input.providerDefinitions,
    ...(input.orgPolicy?.allowedProviders !== undefined && {
      allowedProviders: input.orgPolicy.allowedProviders,
    }),
  });
  for (const message of chain.notices) input.notice(message);
  if (chain.targets.length === 0) return input.provider;
  return new FallbackProvider(input.provider, chain.targets, {
    onUnreachable: (target, error) =>
      logger.warn(
        `Fallback model ${target.ref.model} (${target.ref.provider}) could not be reached; trying the next one: ${
          error instanceof Error ? error.message : String(error)
        }`,
      ),
  });
}
