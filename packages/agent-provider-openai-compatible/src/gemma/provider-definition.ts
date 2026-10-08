import { GemmaProvider } from './provider';
import { probeGemmaProfile } from './endpoint-probe';

import type { IProviderDefinition, IProviderDefinitionConfig } from '@robota-sdk/agent-core';

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
    displayName: 'Ollama / LM Studio / llama.cpp',
    description:
      'Local models via LM Studio or Ollama. API key optional for authenticated servers.',
    category: 'local-free',
    defaults: {
      model: DEFAULT_GEMMA_PROVIDER_MODEL,
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
        title: 'Optional local-server API key',
        masked: true,
        editOnly: true,
      },
    ],
    requiresApiKey: false,
    probeProfile: probeGemmaProfile,
    // Built on the OpenAI SDK: its base URL variable is read only when none is configured, and a
    // default is (the parent applies it), but it still sends the organization and project these name.
    destinationEnvironment: ['OPENAI_BASE_URL', 'OPENAI_ORG_ID', 'OPENAI_PROJECT_ID'],
    createProvider: (config) =>
      new GemmaProvider({
        apiKey: resolveSdkApiKey(config),
        ...(config.baseURL !== undefined && { baseURL: config.baseURL }),
        ...(config.timeout !== undefined && { timeout: config.timeout }),
        defaultModel: config.model,
      }),
  };
}

function resolveSdkApiKey(config: IProviderDefinitionConfig): string {
  if (config.apiKeyEnv !== undefined && !config.apiKey) {
    throw new Error(
      `Environment variable ${config.apiKeyEnv} is not set — set it before using this provider`,
    );
  }
  // The SDK requires a key even when the server does not; this is never a saved credential default.
  return config.apiKey ?? DEFAULT_GEMMA_PROVIDER_API_KEY;
}
