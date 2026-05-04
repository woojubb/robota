import {
  CLAUDE_MODELS,
  findProviderDefinition,
  formatTokenCount,
  type IProviderDefinition,
  type IProviderModelCatalog,
  type IProviderModelCatalogEntry,
} from '@robota-sdk/agent-core';
import type { ICommand } from '../types.js';
import type { TProviderSettingsDocument } from '../provider/provider-settings.js';

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
  const active = resolveActiveProviderModelCatalogState(
    options.settings,
    options.providerDefinitions,
  );
  if (active?.catalog?.entries !== undefined && active.catalog.entries.length > 0) {
    return 'Usage: model <model-id>';
  }
  if (active?.providerType !== undefined) {
    return `No model catalog available for provider ${active.providerType}. Usage: model <model-id>`;
  }
  return 'Usage: model <model-id>';
}

export function resolveActiveProviderModelCatalog(
  settings: TProviderSettingsDocument | undefined,
  providerDefinitions: readonly IProviderDefinition[] = [],
): IProviderModelCatalog | undefined {
  return resolveActiveProviderModelCatalogState(settings, providerDefinitions)?.catalog;
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

function resolveActiveProviderModelCatalogState(
  settings: TProviderSettingsDocument | undefined,
  providerDefinitions: readonly IProviderDefinition[] = [],
): { providerType: string; catalog?: IProviderModelCatalog } | undefined {
  const providerType = resolveActiveProviderType(settings);
  if (providerType === undefined) {
    return undefined;
  }
  const definition = findProviderDefinition(providerDefinitions, providerType);
  return {
    providerType,
    ...(definition?.modelCatalog !== undefined ? { catalog: definition.modelCatalog } : {}),
  };
}

function resolveActiveProviderType(
  settings: TProviderSettingsDocument | undefined,
): string | undefined {
  if (settings?.currentProvider !== undefined) {
    return settings.providers?.[settings.currentProvider]?.type;
  }
  return settings?.provider?.name;
}
