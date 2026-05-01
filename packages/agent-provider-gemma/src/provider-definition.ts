import type { IProviderDefinition } from '@robota-sdk/agent-core';
import { probeOpenAICompatibleProfile } from '@robota-sdk/agent-provider-openai-compatible';
import { GemmaProvider } from './provider';

export const DEFAULT_GEMMA_PROVIDER_MODEL = 'supergemma4-26b-uncensored-v2';
export const DEFAULT_GEMMA_PROVIDER_API_KEY = 'lm-studio';
export const DEFAULT_GEMMA_PROVIDER_BASE_URL = 'http://localhost:1234/v1';

export function createGemmaProviderDefinition(): IProviderDefinition {
  return {
    type: 'gemma',
    defaults: {
      model: DEFAULT_GEMMA_PROVIDER_MODEL,
      apiKey: DEFAULT_GEMMA_PROVIDER_API_KEY,
      baseURL: DEFAULT_GEMMA_PROVIDER_BASE_URL,
    },
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
