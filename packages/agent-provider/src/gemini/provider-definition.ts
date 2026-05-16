import type { IProviderDefinition } from '@robota-sdk/agent-core';
import { refreshGeminiModelCatalog } from './model-catalog-refresh';
import { GeminiProvider } from './provider';

export const DEFAULT_GEMINI_PROVIDER_API_KEY_ENV = 'GEMINI_API_KEY';
export const DEFAULT_GEMINI_PROVIDER_API_KEY_REFERENCE = `$ENV:${DEFAULT_GEMINI_PROVIDER_API_KEY_ENV}`;
export const DEFAULT_GEMINI_PROVIDER_MODEL = 'gemini-3-flash-preview';
export const GEMINI_MODEL_SOURCE_URL = 'https://ai.google.dev/api/models';
export const GEMINI_MODEL_LAST_VERIFIED_AT = '2026-05-04';
const GEMINI_API_KEY_URL = 'https://aistudio.google.com/apikey';
const GEMINI_SETUP_SOURCE_URL = 'https://ai.google.dev/gemini-api/docs/api-key';
const GEMINI_SETUP_LAST_VERIFIED_AT = '2026-05-08';
const GEMINI_SETUP_HELP_LINKS: NonNullable<IProviderDefinition['setupHelpLinks']> = [
  {
    kind: 'api-key',
    label: 'Google AI Studio API keys',
    url: GEMINI_API_KEY_URL,
    sourceUrl: GEMINI_SETUP_SOURCE_URL,
    lastVerifiedAt: GEMINI_SETUP_LAST_VERIFIED_AT,
  },
];

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
    setupHelpLinks: GEMINI_SETUP_HELP_LINKS,
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
    refreshModelCatalog: ({ profile }) => refreshGeminiModelCatalog(profile),
    modelCatalogCacheTtlSeconds: 86400,
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
