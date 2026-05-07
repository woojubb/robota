import type { IProviderDefinition, TUniversalValue } from '@robota-sdk/agent-core';
import { probeOpenAICompatibleProfile } from '@robota-sdk/agent-provider-openai-compatible';
import {
  DEFAULT_DEEPSEEK_PROVIDER_API_KEY_REFERENCE,
  DEFAULT_DEEPSEEK_PROVIDER_BASE_URL,
  DEFAULT_DEEPSEEK_PROVIDER_MODEL,
} from './defaults';
import {
  DEEPSEEK_MODEL_CATALOG_ENTRIES,
  DEEPSEEK_MODEL_CATALOG_SOURCE_URL,
  DEEPSEEK_MODEL_LAST_VERIFIED_AT,
} from './model-catalog';
import { refreshDeepSeekModelCatalog } from './model-catalog-refresh';
import { DeepSeekProvider } from './provider';
import type { TDeepSeekReasoningEffort, TDeepSeekThinkingMode } from './types';

const DEEPSEEK_MODEL_CATALOG: NonNullable<IProviderDefinition['modelCatalog']> = {
  status: 'fallback',
  sourceUrl: DEEPSEEK_MODEL_CATALOG_SOURCE_URL,
  lastVerifiedAt: DEEPSEEK_MODEL_LAST_VERIFIED_AT,
  entries: DEEPSEEK_MODEL_CATALOG_ENTRIES,
};
const DEEPSEEK_API_KEY_URL = 'https://platform.deepseek.com/api_keys';
const DEEPSEEK_SETUP_SOURCE_URL = 'https://api-docs.deepseek.com/';
const DEEPSEEK_SETUP_LAST_VERIFIED_AT = '2026-05-08';
const DEEPSEEK_SETUP_HELP_LINKS: NonNullable<IProviderDefinition['setupHelpLinks']> = [
  {
    kind: 'api-key',
    label: 'DeepSeek API keys',
    url: DEEPSEEK_API_KEY_URL,
    sourceUrl: DEEPSEEK_SETUP_SOURCE_URL,
    lastVerifiedAt: DEEPSEEK_SETUP_LAST_VERIFIED_AT,
  },
];

export function createDeepSeekProviderDefinition(): IProviderDefinition {
  return {
    type: 'deepseek',
    displayName: 'DeepSeek',
    description: 'DeepSeek OpenAI-compatible endpoint',
    defaults: {
      model: DEFAULT_DEEPSEEK_PROVIDER_MODEL,
      apiKey: DEFAULT_DEEPSEEK_PROVIDER_API_KEY_REFERENCE,
      baseURL: DEFAULT_DEEPSEEK_PROVIDER_BASE_URL,
    },
    modelCatalog: DEEPSEEK_MODEL_CATALOG,
    setupHelpLinks: DEEPSEEK_SETUP_HELP_LINKS,
    setupSteps: [
      {
        key: 'baseURL',
        title: 'DeepSeek OpenAI-compatible base URL',
        defaultValue: DEFAULT_DEEPSEEK_PROVIDER_BASE_URL,
      },
      {
        key: 'model',
        title: 'DeepSeek model',
        defaultValue: DEFAULT_DEEPSEEK_PROVIDER_MODEL,
      },
      {
        key: 'apiKey',
        title: 'DeepSeek API key',
        defaultValue: DEFAULT_DEEPSEEK_PROVIDER_API_KEY_REFERENCE,
        masked: true,
      },
    ],
    requiresApiKey: true,
    probeProfile: probeOpenAICompatibleProfile,
    refreshModelCatalog: ({ profile }) => refreshDeepSeekModelCatalog(profile),
    createProvider: (config) => {
      const options = parseDeepSeekProviderOptions(config.options);
      return new DeepSeekProvider({
        apiKey: requireApiKey(config.apiKey),
        ...(config.baseURL !== undefined && { baseURL: config.baseURL }),
        ...(config.timeout !== undefined && { timeout: config.timeout }),
        ...(options.thinking !== undefined && { thinking: options.thinking }),
        ...(options.reasoningEffort !== undefined && { reasoningEffort: options.reasoningEffort }),
        defaultModel: config.model,
      });
    },
  };
}

function requireApiKey(apiKey: string | undefined): string {
  if (!apiKey) {
    throw new Error('Provider deepseek requires apiKey');
  }
  return apiKey;
}

function parseDeepSeekProviderOptions(options: Record<string, TUniversalValue> | undefined): {
  thinking?: TDeepSeekThinkingMode;
  reasoningEffort?: TDeepSeekReasoningEffort;
} {
  const thinking = parseThinkingMode(options?.['thinking']);
  const reasoningEffort = parseReasoningEffort(options?.['reasoningEffort']);
  return {
    ...(thinking !== undefined && { thinking }),
    ...(reasoningEffort !== undefined && { reasoningEffort }),
  };
}

function parseThinkingMode(value: TUniversalValue | undefined): TDeepSeekThinkingMode | undefined {
  if (value === true) return 'enabled';
  if (value === false) return 'disabled';
  if (value === 'enabled' || value === 'disabled') return value;
  const record = asRecord(value);
  const type = record?.['type'];
  return type === 'enabled' || type === 'disabled' ? type : undefined;
}

function parseReasoningEffort(
  value: TUniversalValue | undefined,
): TDeepSeekReasoningEffort | undefined {
  if (
    value === 'low' ||
    value === 'medium' ||
    value === 'high' ||
    value === 'xhigh' ||
    value === 'max'
  ) {
    return value;
  }
  return undefined;
}

function asRecord(value: TUniversalValue | undefined): Record<string, TUniversalValue> | undefined {
  if (value === null || value === undefined || value instanceof Date || Array.isArray(value)) {
    return undefined;
  }
  return typeof value === 'object' ? value : undefined;
}
