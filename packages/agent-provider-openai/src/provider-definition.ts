import type { IProviderDefinition, TUniversalValue } from '@robota-sdk/agent-core';
import { probeOpenAICompatibleProfile } from '@robota-sdk/agent-provider-openai-compatible';
import { OpenAIProvider } from './provider';
import type { TOpenAIApiSurface } from './types';

export const DEFAULT_OPENAI_PROVIDER_MODEL: string | undefined = undefined;
export const DEFAULT_OPENAI_PROVIDER_API_KEY_REFERENCE = '$ENV:OPENAI_API_KEY';

export function createOpenAIProviderDefinition(): IProviderDefinition {
  return {
    type: 'openai',
    displayName: 'OpenAI',
    description: 'Official OpenAI Responses API provider',
    defaults: {
      apiKey: DEFAULT_OPENAI_PROVIDER_API_KEY_REFERENCE,
    },
    setupSteps: [
      {
        key: 'model',
        title: 'OpenAI model',
        required: true,
      },
      {
        key: 'apiKey',
        title: 'OpenAI API key',
        defaultValue: DEFAULT_OPENAI_PROVIDER_API_KEY_REFERENCE,
        masked: true,
      },
    ],
    requiresApiKey: true,
    probeProfile: probeOpenAICompatibleProfile,
    createProvider: (config) => {
      const apiSurface = readApiSurface(config.options);
      return new OpenAIProvider({
        apiKey: requireApiKey(config.apiKey),
        ...(config.baseURL !== undefined && { baseURL: config.baseURL }),
        ...(config.timeout !== undefined && { timeout: config.timeout }),
        ...(apiSurface !== undefined && { apiSurface }),
        defaultModel: config.model,
      });
    },
  };
}

function requireApiKey(apiKey: string | undefined): string {
  if (!apiKey) {
    throw new Error('Provider openai requires apiKey');
  }
  return apiKey;
}

function readApiSurface(
  options: Record<string, TUniversalValue> | undefined,
): TOpenAIApiSurface | undefined {
  const apiSurface = options?.['apiSurface'];
  if (apiSurface === 'responses' || apiSurface === 'chat-completions') {
    return apiSurface;
  }
  return undefined;
}
