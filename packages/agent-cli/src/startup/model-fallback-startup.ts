/**
 * Put the model fallback chain in front of the session's provider.
 *
 * The chain comes from `--fallback-model` when it is given and from the `fallbackModel` setting
 * otherwise. Only this process's sessions and the in-process subagents that share its provider use
 * it; a child-process subagent is bound to one connection and runs without it.
 */

import { createLogger } from '@robota-sdk/agent-core';
import {
  applyModelFallback,
  describeModelFallback,
  readMergedProviderSettings,
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
  /**
   * Also announce each move there. For print mode, which shows no turn history, so the note a
   * session adds to its history would never be seen.
   */
  announceMoves?: boolean;
}

/** The provider to run sessions on: the one given, or a fallback chain over it. */
export function applyModelFallbackChain(input: IApplyModelFallbackChainInput): IAIProvider {
  const settings = readMergedProviderSettings(input.settingsSources);
  const entries = selectFallbackModelEntries(input.fallbackFlag, settings);
  const profile =
    input.primaryConfig.source === 'env-default'
      ? undefined
      : (input.providerOverride ?? settings.currentProvider);
  const { provider, notices } = applyModelFallback({
    provider: input.provider,
    entries,
    settings,
    primary: { ...(profile !== undefined && { profile }), config: input.primaryConfig },
    providerDefinitions: input.providerDefinitions,
    ...(input.orgPolicy?.allowedProviders !== undefined && {
      allowedProviders: input.orgPolicy.allowedProviders,
    }),
    providerOptions: {
      ...(input.announceMoves === true && {
        onFallback: (notice) => input.notice(describeModelFallback(notice)),
      }),
      onUnreachable: (target, error) =>
        logger.warn(
          `Fallback model ${target.ref.model} (${target.ref.provider}) could not be reached; trying the next one: ${
            error instanceof Error ? error.message : String(error)
          }`,
        ),
    },
  });
  for (const message of notices) input.notice(message);
  return provider;
}
