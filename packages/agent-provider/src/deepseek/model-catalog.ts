import type { IProviderModelCatalogEntry } from '@robota-sdk/agent-core';
import { DEFAULT_DEEPSEEK_PROVIDER_MODEL } from './defaults';

export const DEEPSEEK_MODEL_CATALOG_SOURCE_URL =
  'https://api-docs.deepseek.com/quick_start/pricing';
export const DEEPSEEK_MODEL_LIST_SOURCE_URL = 'https://api-docs.deepseek.com/api/list-models';
export const DEEPSEEK_MODEL_LAST_VERIFIED_AT = '2026-05-07';
export const DEEPSEEK_DEPRECATED_ALIAS_RETIREMENT_DATE = '2026-07-24';

export const DEEPSEEK_MODEL_CATALOG_ENTRIES: readonly IProviderModelCatalogEntry[] = [
  {
    id: DEFAULT_DEEPSEEK_PROVIDER_MODEL,
    displayName: 'DeepSeek V4 Flash',
    contextWindow: 1_000_000,
    capabilities: ['tools', 'reasoning', 'json_schema', 'streaming'],
    lifecycle: 'active',
    sourceUrl: DEEPSEEK_MODEL_CATALOG_SOURCE_URL,
    lastVerifiedAt: DEEPSEEK_MODEL_LAST_VERIFIED_AT,
  },
  {
    id: 'deepseek-v4-pro',
    displayName: 'DeepSeek V4 Pro',
    contextWindow: 1_000_000,
    capabilities: ['tools', 'reasoning', 'json_schema', 'streaming'],
    lifecycle: 'active',
    sourceUrl: DEEPSEEK_MODEL_CATALOG_SOURCE_URL,
    lastVerifiedAt: DEEPSEEK_MODEL_LAST_VERIFIED_AT,
  },
  {
    id: 'deepseek-chat',
    displayName: `DeepSeek Chat compatibility alias, deprecated ${DEEPSEEK_DEPRECATED_ALIAS_RETIREMENT_DATE}`,
    aliases: [DEFAULT_DEEPSEEK_PROVIDER_MODEL],
    contextWindow: 1_000_000,
    capabilities: ['tools', 'json_schema', 'streaming'],
    lifecycle: 'deprecated',
    sourceUrl: DEEPSEEK_MODEL_CATALOG_SOURCE_URL,
    lastVerifiedAt: DEEPSEEK_MODEL_LAST_VERIFIED_AT,
  },
  {
    id: 'deepseek-reasoner',
    displayName: `DeepSeek Reasoner compatibility alias, deprecated ${DEEPSEEK_DEPRECATED_ALIAS_RETIREMENT_DATE}`,
    aliases: [DEFAULT_DEEPSEEK_PROVIDER_MODEL],
    contextWindow: 1_000_000,
    capabilities: ['reasoning', 'json_schema', 'streaming'],
    lifecycle: 'deprecated',
    sourceUrl: DEEPSEEK_MODEL_CATALOG_SOURCE_URL,
    lastVerifiedAt: DEEPSEEK_MODEL_LAST_VERIFIED_AT,
  },
];

export function getDeepSeekFallbackModelCatalogEntry(
  id: string,
): IProviderModelCatalogEntry | undefined {
  return DEEPSEEK_MODEL_CATALOG_ENTRIES.find((entry) => entry.id === id);
}
