/**
 * Read a model fallback chain from what the user wrote, and describe a move along it.
 *
 * An entry names a provider profile (`openai`, on that profile's model), a profile and a model
 * (`openai:gpt-x`), a bare model on the primary's provider, or `default` (the settings' current
 * profile on its model). Entries are read once, when the session starts: what cannot be used is
 * dropped with a notice then, and what cannot be reached is only found out when a request needs it.
 */

import { createProviderFromConfig, findProviderDefinition } from '@robota-sdk/agent-core';

import { resolveActiveProvider } from '../command-api/provider/provider-merge.js';

import { FallbackProvider } from './fallback-provider.js';

import type { IFallbackModelTarget, IFallbackProviderOptions } from './fallback-provider.js';
import type { TProviderSettingsDocument } from '../command-api/provider/provider-settings.js';
import type {
  IAIProvider,
  IModelFallbackNotice,
  IProviderDefinition,
  IProviderDefinitionConfig,
} from '@robota-sdk/agent-core';

/** A request moves along at most this many models after the primary. */
export const MAX_FALLBACK_MODELS = 3;

/** The settings key holding the chain. */
export const FALLBACK_MODEL_SETTINGS_KEY = 'fallbackModel';

export interface IModelFallbackPrimary {
  /** The settings profile the primary comes from; absent for a legacy or environment config. */
  profile?: string;
  /** The primary's resolved config, on the model the session runs. */
  config: IProviderDefinitionConfig;
}

export interface IResolveModelFallbackChainInput {
  /** The entries as written, flag or settings. */
  entries: readonly string[];
  /** Merged provider settings. */
  settings: TProviderSettingsDocument;
  primary: IModelFallbackPrimary;
  providerDefinitions: readonly IProviderDefinition[];
  /** The organization's provider allowlist, by profile name. */
  allowedProviders?: readonly string[];
}

export interface IModelFallbackChain {
  targets: IFallbackModelTarget[];
  /** Why entries were left out, one line each, for the user. */
  notices: string[];
}

interface IChainEntry {
  written: string;
  profile?: string;
  providerType: string;
  model: string;
}

/** Split a comma-separated `--fallback-model` value into its entries. */
export function parseFallbackModelList(value: string | undefined): string[] | undefined {
  if (value === undefined) return undefined;
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

/** The chain written in settings, or `undefined` when none is. */
export function readFallbackModelSetting(
  settings: TProviderSettingsDocument,
): string[] | undefined {
  const value = settings[FALLBACK_MODEL_SETTINGS_KEY];
  if (!Array.isArray(value)) return undefined;
  return value
    .filter((entry): entry is string => typeof entry === 'string' && entry.trim() !== '')
    .map((entry) => entry.trim());
}

/**
 * The entries to use: the flag's when it is given, the settings' otherwise. The flag replaces the
 * settings rather than adding to them, so one run can try a different chain.
 */
export function selectFallbackModelEntries(
  flag: readonly string[] | undefined,
  settings: TProviderSettingsDocument,
): readonly string[] {
  return flag ?? readFallbackModelSetting(settings) ?? [];
}

function profileModel(
  settings: TProviderSettingsDocument,
  profile: string,
  providerDefinitions: readonly IProviderDefinition[],
): { providerType: string; model: string | undefined } | undefined {
  const settingsProfile = settings.providers?.[profile];
  if (settingsProfile?.type === undefined) return undefined;
  return {
    providerType: settingsProfile.type,
    model:
      settingsProfile.model ??
      findProviderDefinition(providerDefinitions, settingsProfile.type)?.defaults?.model,
  };
}

function readEntry(
  written: string,
  input: IResolveModelFallbackChainInput,
  notices: string[],
): IChainEntry | string {
  const { settings, primary, providerDefinitions } = input;
  const onProfile = (profile: string, model?: string): IChainEntry | string => {
    const found = profileModel(settings, profile, providerDefinitions);
    if (found === undefined)
      return `Fallback model "${written}": profile "${profile}" has no provider type.`;
    const chosen = model ?? found.model;
    if (chosen === undefined)
      return `Fallback model "${written}": profile "${profile}" names no model.`;
    return { written, profile, providerType: found.providerType, model: chosen };
  };
  if (written === 'default') {
    if (settings.currentProvider !== undefined) return onProfile(settings.currentProvider);
    const model = settings.provider?.model ?? primary.config.model;
    return {
      written,
      ...(primary.profile !== undefined && { profile: primary.profile }),
      providerType: primary.config.name,
      model,
    };
  }
  if (settings.providers?.[written] !== undefined) return onProfile(written);
  const separator = written.indexOf(':');
  if (separator > 0) {
    const profile = written.slice(0, separator);
    const model = written.slice(separator + 1);
    // A model id may itself contain a colon; only a known profile before it makes it a pair.
    if (settings.providers?.[profile] !== undefined && model.length > 0)
      return onProfile(profile, model);
    notices.push(
      `Fallback model "${written}": "${profile}" is not a provider profile, so it is read as a model on the primary's provider.`,
    );
  }
  return {
    written,
    ...(primary.profile !== undefined && { profile: primary.profile }),
    providerType: primary.config.name,
    model: written,
  };
}

function entryKey(entry: { profile?: string; providerType: string; model: string }): string {
  return `${entry.profile ?? `type:${entry.providerType}`}\u0000${entry.model}`;
}

function buildTarget(
  entry: IChainEntry,
  input: IResolveModelFallbackChainInput,
): IFallbackModelTarget {
  const { settings, primary, providerDefinitions } = input;
  return {
    ref: { provider: entry.providerType, model: entry.model },
    create: () => {
      const config =
        entry.profile !== undefined && entry.profile !== primary.profile
          ? resolveActiveProvider(settings, entry.profile, providerDefinitions)
          : primary.config;
      if (config === undefined)
        throw new Error(`Provider profile "${entry.profile}" has no configuration`);
      return createProviderFromConfig({ ...config, model: entry.model }, providerDefinitions);
    },
  };
}

/**
 * Read the chain: entries in order, the primary and repeats removed, entries the organization does
 * not allow dropped, and at most {@link MAX_FALLBACK_MODELS} kept. Every drop is announced.
 */
export function resolveModelFallbackChain(
  input: IResolveModelFallbackChainInput,
): IModelFallbackChain {
  const notices: string[] = [];
  const seen = new Set<string>([
    entryKey({
      ...(input.primary.profile !== undefined && { profile: input.primary.profile }),
      providerType: input.primary.config.name,
      model: input.primary.config.model,
    }),
  ]);
  const kept: IChainEntry[] = [];
  const disallowed: string[] = [];
  for (const written of input.entries) {
    const entry = readEntry(written, input, notices);
    if (typeof entry === 'string') {
      notices.push(entry);
      continue;
    }
    if (
      input.allowedProviders !== undefined &&
      entry.profile !== undefined &&
      !input.allowedProviders.includes(entry.profile)
    ) {
      disallowed.push(written);
      continue;
    }
    const key = entryKey(entry);
    if (seen.has(key)) continue;
    seen.add(key);
    kept.push(entry);
  }
  if (disallowed.length > 0) {
    notices.push(
      `Fallback models not allowed by your organization policy were dropped: ${disallowed.join(', ')}.`,
    );
  }
  if (kept.length > MAX_FALLBACK_MODELS) {
    const dropped = kept.splice(MAX_FALLBACK_MODELS);
    notices.push(
      `Only the first ${MAX_FALLBACK_MODELS} fallback models are used; dropped: ${dropped
        .map((entry) => entry.written)
        .join(', ')}.`,
    );
  }
  return { targets: kept.map((entry) => buildTarget(entry, input)), notices };
}

export interface IApplyModelFallbackInput extends IResolveModelFallbackChainInput {
  /** The primary provider. */
  provider: IAIProvider;
  /** How the decorator reports; `entries` is filled in from `entries` above. */
  providerOptions?: Omit<IFallbackProviderOptions, 'entries'>;
}

/**
 * Put the chain in front of `provider`: a {@link FallbackProvider} when any entry survives, the
 * provider itself otherwise. Either way the notices say what was dropped.
 */
export function applyModelFallback(input: IApplyModelFallbackInput): {
  provider: IAIProvider;
  notices: string[];
} {
  if (input.entries.length === 0) return { provider: input.provider, notices: [] };
  const chain = resolveModelFallbackChain(input);
  if (chain.targets.length === 0) return { provider: input.provider, notices: chain.notices };
  return {
    provider: new FallbackProvider(input.provider, chain.targets, {
      ...input.providerOptions,
      entries: input.entries,
    }),
    notices: chain.notices,
  };
}

const FAILURE_PHRASES: Partial<Record<IModelFallbackNotice['reason'], string>> = {
  overloaded: 'was overloaded',
  'service-unavailable': 'was unavailable',
  'server-error': 'failed with a server error',
  'model-unavailable': 'is not available',
};

/** The note shown when a turn moved to another model. */
export function describeModelFallback(notice: IModelFallbackNotice): string {
  const phrase = FAILURE_PHRASES[notice.reason] ?? 'failed';
  return `${notice.from.model} ${phrase}; this turn continued on ${notice.to.model} (${notice.to.provider}).`;
}
