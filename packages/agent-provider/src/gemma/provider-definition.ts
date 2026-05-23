import { GemmaProvider } from './provider';
import { probeOpenAICompatibleProfile } from '../shared/openai-compatible/index.js';

import type { IProviderDefinition } from '@robota-sdk/agent-core';

export const DEFAULT_GEMMA_PROVIDER_MODEL = 'supergemma4-26b-uncensored-v2';
export const DEFAULT_GEMMA_PROVIDER_API_KEY = 'lm-studio';
export const DEFAULT_GEMMA_PROVIDER_BASE_URL = 'http://localhost:1234/v1';
const GEMMA_MODEL_SOURCE_URL = 'https://ai.google.dev/gemma';
const GEMMA_MODEL_LAST_VERIFIED_AT = '2026-05-04';
const GEMMA_SETUP_URL = 'https://lmstudio.ai/docs/developer';
const GEMMA_SETUP_LAST_VERIFIED_AT = '2026-05-08';
const GEMMA_SETUP_HELP_LINKS: NonNullable<IProviderDefinition['setupHelpLinks']> = [
  {
    kind: 'official',
    label: 'LM Studio local API documentation',
    url: GEMMA_SETUP_URL,
    sourceUrl: GEMMA_SETUP_URL,
    lastVerifiedAt: GEMMA_SETUP_LAST_VERIFIED_AT,
  },
];
const GEMMA_MODEL_CATALOG: NonNullable<IProviderDefinition['modelCatalog']> = {
  status: 'fallback',
  sourceUrl: GEMMA_MODEL_SOURCE_URL,
  lastVerifiedAt: GEMMA_MODEL_LAST_VERIFIED_AT,
  entries: [
    {
      id: DEFAULT_GEMMA_PROVIDER_MODEL,
      displayName: 'SuperGemma 4 26B',
      capabilities: ['tools', 'streaming'],
      lifecycle: 'active',
      sourceUrl: GEMMA_MODEL_SOURCE_URL,
      lastVerifiedAt: GEMMA_MODEL_LAST_VERIFIED_AT,
    },
  ],
};

export function createGemmaProviderDefinition(): IProviderDefinition {
  return {
    type: 'gemma',
    displayName: 'Gemma / LM Studio',
    description: 'Local models via LM Studio or Ollama. No API key needed.',
    category: 'local-free',
    defaults: {
      model: DEFAULT_GEMMA_PROVIDER_MODEL,
      apiKey: DEFAULT_GEMMA_PROVIDER_API_KEY,
      baseURL: DEFAULT_GEMMA_PROVIDER_BASE_URL,
    },
    modelCatalog: GEMMA_MODEL_CATALOG,
    setupHelpLinks: GEMMA_SETUP_HELP_LINKS,
    setupSteps: [
      {
        key: 'baseURL',
        title: 'Gemma OpenAI-compatible base URL',
        defaultValue: DEFAULT_GEMMA_PROVIDER_BASE_URL,
      },
      {
        key: 'model',
        title: 'Gemma model',
        defaultValue: DEFAULT_GEMMA_PROVIDER_MODEL,
      },
      {
        key: 'apiKey',
        title: 'Gemma OpenAI-compatible API key',
        defaultValue: DEFAULT_GEMMA_PROVIDER_API_KEY,
        masked: true,
      },
    ],
    requiresApiKey: true,
    probeProfile: probeOpenAICompatibleProfile,
    createProvider: (config) =>
      new GemmaProvider({
        apiKey: requireApiKey(config.apiKey),
        ...(config.baseURL !== undefined && { baseURL: config.baseURL }),
        ...(config.timeout !== undefined && { timeout: config.timeout }),
        defaultModel: config.model,
      }),
  };
}

function requireApiKey(apiKey: string | undefined): string {
  if (!apiKey) {
    throw new Error('Provider gemma requires apiKey');
  }
  return apiKey;
}
