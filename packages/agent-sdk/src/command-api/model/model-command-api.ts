import {
  CLAUDE_MODELS,
  findProviderDefinition,
  formatTokenCount,
  type IProviderDefinition,
  type IProviderModelCatalog,
  type IProviderModelCatalogEntry,
  type IProviderProfileConfig,
} from '@robota-sdk/agent-core';
import type { ICommand } from '../types.js';
import type { TProviderSettingsDocument } from '../provider/provider-settings.js';
import { resolveEnvReference } from '@robota-sdk/agent-core';

export const MODEL_COMMAND_DESCRIPTION = 'Change AI model';
export const MODEL_COMMAND_ARGUMENT_HINT = '<model-id>';

export interface IModelCommandSettingsAdapter {
  readMergedSettings(): TProviderSettingsDocument;
}

export interface IModelCommandModuleOptions {
  providerDefinitions: readonly IProviderDefinition[];
  settings: IModelCommandSettingsAdapter;
}

export interface IBuildModelCommandSubcommandsOptions {
  source?: string;
  providerDefinitions?: readonly IProviderDefinition[];
  settings?: TProviderSettingsDocument;
}

export interface IActiveProviderModelCatalogState {
  providerType: string;
  catalog?: IProviderModelCatalog;
  refreshAttempted: boolean;
  refreshMessage?: string;
}

export interface IResolveActiveProviderModelCatalogStateOptions {
  settings?: TProviderSettingsDocument;
  providerDefinitions?: readonly IProviderDefinition[];
  refresh?: boolean;
}

export function buildModelCommandSubcommands(
  sourceOrOptions: string | IBuildModelCommandSubcommandsOptions = 'model',
): ICommand[] {
  const options =
    typeof sourceOrOptions === 'string' ? { source: sourceOrOptions } : sourceOrOptions;
  const source = options.source ?? 'model';
  const catalog = resolveActiveProviderModelCatalog(options.settings, options.providerDefinitions);
  if (catalog !== undefined) {
    return buildCatalogSubcommands(catalog, source);
  }
  if (options.settings !== undefined) {
    return [];
  }
  return buildClaudeModelSubcommands(source);
}

export function formatModelCommandUsageMessage(
  options: {
    settings?: TProviderSettingsDocument;
    providerDefinitions?: readonly IProviderDefinition[];
  } = {},
): string {
  const snapshot = resolveActiveProviderModelCatalogSnapshot(
    options.settings,
    options.providerDefinitions,
  );
  return formatModelUsageMessage(snapshot === undefined ? undefined : toCatalogState(snapshot));
}

export async function formatModelCommandUsageMessageAsync(
  options: IResolveActiveProviderModelCatalogStateOptions = {},
): Promise<string> {
  return formatModelUsageMessage(await resolveActiveProviderModelCatalogState(options));
}

export function resolveActiveProviderModelCatalog(
  settings: TProviderSettingsDocument | undefined,
  providerDefinitions: readonly IProviderDefinition[] = [],
): IProviderModelCatalog | undefined {
  return resolveActiveProviderModelCatalogSnapshot(settings, providerDefinitions)?.catalog;
}

export async function resolveActiveProviderModelCatalogState(
  options: IResolveActiveProviderModelCatalogStateOptions,
): Promise<IActiveProviderModelCatalogState | undefined> {
  const snapshot = resolveActiveProviderModelCatalogSnapshot(
    options.settings,
    options.providerDefinitions,
  );
  if (snapshot === undefined) return undefined;
  if (options.refresh !== true || snapshot.definition?.refreshModelCatalog === undefined) {
    return toCatalogState(snapshot);
  }

  try {
    const refreshed = await snapshot.definition.refreshModelCatalog({
      profile: resolveRefreshProfile(snapshot),
    });
    if (refreshed.status !== 'unavailable') {
      return {
        providerType: snapshot.providerType,
        catalog: refreshed,
        refreshAttempted: true,
      };
    }
    return {
      providerType: snapshot.providerType,
      catalog: snapshot.catalog ?? refreshed,
      refreshAttempted: true,
      ...(refreshed.message !== undefined ? { refreshMessage: refreshed.message } : {}),
    };
  } catch (error) {
    return {
      providerType: snapshot.providerType,
      ...(snapshot.catalog !== undefined ? { catalog: snapshot.catalog } : {}),
      refreshAttempted: true,
      refreshMessage: error instanceof Error ? error.message : String(error),
    };
  }
}

function buildClaudeModelSubcommands(source: string): ICommand[] {
  const seen = new Set<string>();
  const commands: ICommand[] = [];
  for (const model of Object.values(CLAUDE_MODELS)) {
    if (seen.has(model.name)) continue;
    seen.add(model.name);
    commands.push({
      name: model.id,
      description: `${model.name} (${formatTokenCount(model.contextWindow).toUpperCase()})`,
      source,
    });
  }
  return commands;
}

function buildCatalogSubcommands(catalog: IProviderModelCatalog, source: string): ICommand[] {
  return (catalog.entries ?? [])
    .filter((entry) => entry.lifecycle !== 'unavailable')
    .map((entry) => ({
      name: entry.id,
      description: formatCatalogEntryDescription(entry),
      source,
    }));
}

function formatCatalogEntryDescription(entry: IProviderModelCatalogEntry): string {
  if (entry.contextWindow === undefined) {
    return entry.displayName;
  }
  return `${entry.displayName} (${formatTokenCount(entry.contextWindow).toUpperCase()})`;
}

interface IActiveProviderModelCatalogSnapshot {
  providerType: string;
  profile?: IProviderProfileConfig;
  definition?: IProviderDefinition;
  catalog?: IProviderModelCatalog;
}

function resolveActiveProviderModelCatalogSnapshot(
  settings: TProviderSettingsDocument | undefined,
  providerDefinitions: readonly IProviderDefinition[] = [],
): IActiveProviderModelCatalogSnapshot | undefined {
  const profile = resolveActiveProviderProfile(settings);
  const providerType = profile?.type ?? profile?.name;
  if (providerType === undefined) {
    return undefined;
  }
  const definition = findProviderDefinition(providerDefinitions, providerType);
  return {
    providerType,
    ...(profile !== undefined ? { profile } : {}),
    ...(definition !== undefined ? { definition } : {}),
    ...(definition?.modelCatalog !== undefined ? { catalog: definition.modelCatalog } : {}),
  };
}

function resolveActiveProviderProfile(
  settings: TProviderSettingsDocument | undefined,
): (IProviderProfileConfig & { name?: string }) | undefined {
  if (settings?.currentProvider !== undefined) {
    return settings.providers?.[settings.currentProvider];
  }
  return settings?.provider;
}

function toCatalogState(
  snapshot: IActiveProviderModelCatalogSnapshot,
): IActiveProviderModelCatalogState {
  return {
    providerType: snapshot.providerType,
    ...(snapshot.catalog !== undefined ? { catalog: snapshot.catalog } : {}),
    refreshAttempted: false,
  };
}

function resolveRefreshProfile(
  snapshot: IActiveProviderModelCatalogSnapshot,
): IProviderProfileConfig {
  const profile = snapshot.profile;
  const defaults = snapshot.definition?.defaults;
  const apiKey = resolveOptionalEnvReference(profile?.apiKey ?? defaults?.apiKey);
  const model = resolveProfileValue(profile?.model, defaults?.model);
  const baseURL = resolveProfileValue(profile?.baseURL, defaults?.baseURL);
  const timeout = resolveProfileValue(profile?.timeout, defaults?.timeout);
  const options = resolveProfileValue(profile?.options, defaults?.options);
  const refreshProfile: IProviderProfileConfig = {
    type: profile?.type ?? snapshot.providerType,
  };

  if (model !== undefined) refreshProfile.model = model;
  if (apiKey !== undefined) refreshProfile.apiKey = apiKey;
  if (baseURL !== undefined) refreshProfile.baseURL = baseURL;
  if (timeout !== undefined) refreshProfile.timeout = timeout;
  if (options !== undefined) refreshProfile.options = options;
  return refreshProfile;
}

function resolveProfileValue<T>(
  profileValue: T | undefined,
  defaultValue: T | undefined,
): T | undefined {
  return profileValue ?? defaultValue;
}

function resolveOptionalEnvReference(value: string | undefined): string | undefined {
  return value === undefined ? undefined : resolveEnvReference(value);
}

function formatModelUsageMessage(active: IActiveProviderModelCatalogState | undefined): string {
  const base =
    active?.providerType !== undefined &&
    (active.catalog?.entries === undefined || active.catalog.entries.length === 0)
      ? `No model catalog available for provider ${active.providerType}. Usage: model <model-id>`
      : 'Usage: model <model-id>';
  const freshness = formatCatalogFreshness(active);
  return freshness === undefined ? base : `${base}\n${freshness}`;
}

function formatCatalogFreshness(
  active: IActiveProviderModelCatalogState | undefined,
): string | undefined {
  const catalog = active?.catalog;
  if (catalog === undefined) return undefined;

  const parts = [`Catalog: ${catalog.status}`];
  if (catalog.entries !== undefined) {
    parts.push(`${catalog.entries.length} model(s)`);
  }
  if (catalog.lastVerifiedAt !== undefined) {
    parts.push(`verified ${catalog.lastVerifiedAt}`);
  }
  if (catalog.sourceUrl !== undefined) {
    parts.push(`source ${catalog.sourceUrl}`);
  }
  const refreshMessage = active?.refreshMessage;
  if (refreshMessage !== undefined) {
    parts.push(`refresh ${refreshMessage}`);
  } else if (catalog.message !== undefined) {
    parts.push(catalog.message);
  }
  return parts.join('; ');
}
