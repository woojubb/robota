import type { IProviderDefinition } from '@robota-sdk/agent-core';
import { AnthropicProvider } from './provider';

export const DEFAULT_ANTHROPIC_PROVIDER_MODEL = 'claude-sonnet-4-6';

export function createAnthropicProviderDefinition(): IProviderDefinition {
  return {
    type: 'anthropic',
    displayName: 'Anthropic',
    description: 'Claude models through Anthropic API',
    defaults: {
      model: DEFAULT_ANTHROPIC_PROVIDER_MODEL,
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

function requireApiKey(apiKey: string | undefined): string {
  if (!apiKey) {
    throw new Error('Provider anthropic requires apiKey');
  }
  return apiKey;
}
