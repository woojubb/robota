import {
  CLAUDE_MODELS,
  type IProviderDefinition,
  type IProviderModelCatalogEntry,
} from '@robota-sdk/agent-core';
import { AnthropicProvider } from './provider';

export const DEFAULT_ANTHROPIC_PROVIDER_MODEL = 'claude-sonnet-4-6';
const ANTHROPIC_MODEL_SOURCE_URL = 'https://platform.claude.com/docs/en/api/models/list';
const ANTHROPIC_MODEL_LAST_VERIFIED_AT = '2026-05-04';

export function createAnthropicProviderDefinition(): IProviderDefinition {
  return {
    type: 'anthropic',
    displayName: 'Anthropic',
    description: 'Claude models through Anthropic API',
    defaults: {
      model: DEFAULT_ANTHROPIC_PROVIDER_MODEL,
    },
    modelCatalog: {
      status: 'fallback',
      sourceUrl: ANTHROPIC_MODEL_SOURCE_URL,
      lastVerifiedAt: ANTHROPIC_MODEL_LAST_VERIFIED_AT,
      entries: buildAnthropicModelCatalogEntries(),
    },
    setupSteps: [
      { key: 'apiKey', title: 'Anthropic API key', required: true, masked: true },
      {
        key: 'model',
        title: 'Anthropic model',
        defaultValue: DEFAULT_ANTHROPIC_PROVIDER_MODEL,
      },
    ],
    requiresApiKey: true,
    createProvider: (config) =>
      new AnthropicProvider({
        apiKey: requireApiKey(config.apiKey),
        ...(config.baseURL !== undefined && { baseURL: config.baseURL }),
        ...(config.timeout !== undefined && { timeout: config.timeout }),
        defaultModel: config.model,
      }),
  };
}

function buildAnthropicModelCatalogEntries(): IProviderModelCatalogEntry[] {
  const seen = new Set<string>();
  const entries: IProviderModelCatalogEntry[] = [];
  for (const model of Object.values(CLAUDE_MODELS)) {
    if (seen.has(model.name)) continue;
    seen.add(model.name);
    entries.push({
      id: model.id,
      displayName: model.name,
      contextWindow: model.contextWindow,
      capabilities: ['tools', 'vision', 'json_schema', 'reasoning', 'streaming'],
      lifecycle: 'active',
      sourceUrl: ANTHROPIC_MODEL_SOURCE_URL,
      lastVerifiedAt: ANTHROPIC_MODEL_LAST_VERIFIED_AT,
    });
  }
  return entries;
}

function requireApiKey(apiKey: string | undefined): string {
  if (!apiKey) {
    throw new Error('Provider anthropic requires apiKey');
  }
  return apiKey;
}
