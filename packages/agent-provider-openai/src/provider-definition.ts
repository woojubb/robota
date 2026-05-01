import type { IProviderDefinition } from '@robota-sdk/agent-core';
import { probeOpenAICompatibleProfile } from '@robota-sdk/agent-provider-openai-compatible';
import { OpenAIProvider } from './provider';

export const DEFAULT_OPENAI_PROVIDER_MODEL: string | undefined = undefined;
export const DEFAULT_OPENAI_COMPATIBLE_PROVIDER_API_KEY = 'lm-studio';
export const DEFAULT_OPENAI_COMPATIBLE_PROVIDER_BASE_URL = 'http://localhost:1234/v1';

export function createOpenAIProviderDefinition(): IProviderDefinition {
  return {
    type: 'openai',
    displayName: 'OpenAI Compatible',
    description: 'OpenAI or OpenAI-compatible Chat Completions endpoint',
    defaults: {
      apiKey: DEFAULT_OPENAI_COMPATIBLE_PROVIDER_API_KEY,
      baseURL: DEFAULT_OPENAI_COMPATIBLE_PROVIDER_BASE_URL,
    },
    setupSteps: [
      {
        key: 'baseURL',
        title: 'OpenAI-compatible base URL',
        defaultValue: DEFAULT_OPENAI_COMPATIBLE_PROVIDER_BASE_URL,
      },
      {
        key: 'model',
        title: 'OpenAI-compatible model',
        required: true,
      },
      {
        key: 'apiKey',
        title: 'OpenAI-compatible API key',
        defaultValue: DEFAULT_OPENAI_COMPATIBLE_PROVIDER_API_KEY,
        masked: true,
      },
    ],
    requiresApiKey: true,
    probeProfile: probeOpenAICompatibleProfile,
    createProvider: (config) =>
      new OpenAIProvider({
        apiKey: requireApiKey(config.apiKey),
        ...(config.baseURL !== undefined && { baseURL: config.baseURL }),
        ...(config.timeout !== undefined && { timeout: config.timeout }),
        defaultModel: config.model,
      }),
  };
}

function requireApiKey(apiKey: string | undefined): string {
  if (!apiKey) {
    throw new Error('Provider openai requires apiKey');
  }
  return apiKey;
}
