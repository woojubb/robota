import type { IProviderDefinition } from '@robota-sdk/agent-core';
import { probeOpenAICompatibleProfile } from '@robota-sdk/agent-provider-openai-compatible';
import { QwenProvider } from './provider';
import {
  DEFAULT_QWEN_PROVIDER_API_KEY_REFERENCE,
  DEFAULT_QWEN_PROVIDER_BASE_URL,
  DEFAULT_QWEN_PROVIDER_MODEL,
} from './defaults';

export {
  DEFAULT_QWEN_PROVIDER_API_KEY_ENV,
  DEFAULT_QWEN_PROVIDER_API_KEY_REFERENCE,
  DEFAULT_QWEN_PROVIDER_BASE_URL,
  DEFAULT_QWEN_PROVIDER_MODEL,
  QWEN_PROVIDER_BASE_URLS,
} from './defaults';
export type { TQwenProviderRegion } from './defaults';

export function createQwenProviderDefinition(): IProviderDefinition {
  return {
    type: 'qwen',
    defaults: {
      model: DEFAULT_QWEN_PROVIDER_MODEL,
      apiKey: DEFAULT_QWEN_PROVIDER_API_KEY_REFERENCE,
      baseURL: DEFAULT_QWEN_PROVIDER_BASE_URL,
    },
    setupSteps: [
      {
        key: 'baseURL',
        title: 'Qwen OpenAI-compatible base URL',
        defaultValue: DEFAULT_QWEN_PROVIDER_BASE_URL,
      },
      {
        key: 'model',
        title: 'Qwen model',
        defaultValue: DEFAULT_QWEN_PROVIDER_MODEL,
      },
      {
        key: 'apiKey',
        title: 'Qwen Model Studio API key',
        defaultValue: DEFAULT_QWEN_PROVIDER_API_KEY_REFERENCE,
        masked: true,
      },
    ],
    requiresApiKey: true,
    probeProfile: probeOpenAICompatibleProfile,
    createProvider: (config) =>
      new QwenProvider({
        apiKey: requireApiKey(config.apiKey),
        ...(config.baseURL !== undefined && { baseURL: config.baseURL }),
        ...(config.timeout !== undefined && { timeout: config.timeout }),
        defaultModel: config.model,
      }),
  };
}

function requireApiKey(apiKey: string | undefined): string {
  if (!apiKey) {
    throw new Error('Provider qwen requires apiKey');
  }
  return apiKey;
}
