import type { IProviderDefinition } from '@robota-sdk/agent-core';
import { GeminiProvider } from './provider';

export const DEFAULT_GEMINI_PROVIDER_API_KEY_ENV = 'GEMINI_API_KEY';
export const DEFAULT_GEMINI_PROVIDER_API_KEY_REFERENCE = `$ENV:${DEFAULT_GEMINI_PROVIDER_API_KEY_ENV}`;
export const DEFAULT_GEMINI_PROVIDER_MODEL = 'gemini-3-flash-preview';
const GEMINI_MODEL_SOURCE_URL = 'https://ai.google.dev/api/models';
const GEMINI_MODEL_LAST_VERIFIED_AT = '2026-05-04';

export function createGeminiProviderDefinition(): IProviderDefinition {
  return {
    type: 'gemini',
    aliases: ['google'],
    displayName: 'Gemini',
    description: 'Google Gemini API provider',
    defaults: {
      model: DEFAULT_GEMINI_PROVIDER_MODEL,
      apiKey: DEFAULT_GEMINI_PROVIDER_API_KEY_REFERENCE,
    },
    modelCatalog: {
      status: 'fallback',
      sourceUrl: GEMINI_MODEL_SOURCE_URL,
      lastVerifiedAt: GEMINI_MODEL_LAST_VERIFIED_AT,
      entries: [
        {
          id: DEFAULT_GEMINI_PROVIDER_MODEL,
          displayName: 'Gemini 3 Flash Preview',
          capabilities: ['tools', 'vision', 'json_schema', 'reasoning', 'streaming'],
          lifecycle: 'preview',
          sourceUrl: GEMINI_MODEL_SOURCE_URL,
          lastVerifiedAt: GEMINI_MODEL_LAST_VERIFIED_AT,
        },
      ],
    },
    setupSteps: [
      {
        key: 'model',
        title: 'Gemini model',
        defaultValue: DEFAULT_GEMINI_PROVIDER_MODEL,
      },
      {
        key: 'apiKey',
        title: 'Gemini API key',
        defaultValue: DEFAULT_GEMINI_PROVIDER_API_KEY_REFERENCE,
        masked: true,
      },
    ],
    requiresApiKey: true,
    createProvider: (config) =>
      new GeminiProvider({
        apiKey: requireApiKey(config.apiKey),
        defaultModel: config.model,
      }),
  };
}

function requireApiKey(apiKey: string | undefined): string {
  if (!apiKey) {
    throw new Error('Provider gemini requires apiKey');
  }
  return apiKey;
}
