import { createOpenAIProviderDefinition } from '@robota-sdk/agent-provider-openai';
import { probeOpenAICompatibleProfile } from '@robota-sdk/agent-provider-openai-compatible/shared';

import type { IProviderDefinition } from '@robota-sdk/agent-core';

const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';
const OPENROUTER_DEFAULT_MODEL = 'anthropic/claude-sonnet-4.6';
const OPENROUTER_API_KEY_REFERENCE = '$ENV:OPENROUTER_API_KEY';
const OPENROUTER_AUTH_DOCUMENTATION = 'https://openrouter.ai/docs/guides/overview/auth/oauth';

/** The OpenRouter service shares a compatible protocol client across both connection methods. */
export function createOpenRouterProviderDefinition(): IProviderDefinition {
  const compatible = createOpenAIProviderDefinition();
  return {
    type: 'openrouter',
    displayName: 'OpenRouter',
    description: 'Connect in your browser or enter an OpenRouter API key.',
    category: 'cloud-paid',
    connectionMethods: ['api-key', 'browser'],
    defaults: {
      apiKey: OPENROUTER_API_KEY_REFERENCE,
      baseURL: OPENROUTER_BASE_URL,
      model: OPENROUTER_DEFAULT_MODEL,
    },
    requiresApiKey: true,
    modelCatalog: {
      status: 'unavailable',
      sourceUrl: 'https://openrouter.ai/docs/guides/overview/models',
      message: 'Discover available OpenRouter model IDs live from GET /api/v1/models.',
    },
    setupHelpLinks: [
      {
        kind: 'api-key',
        label: 'OpenRouter API keys',
        url: 'https://openrouter.ai/keys',
        sourceUrl: OPENROUTER_AUTH_DOCUMENTATION,
        lastVerifiedAt: '2026-10-09',
      },
      {
        kind: 'official',
        label: 'OpenRouter browser connection',
        url: OPENROUTER_AUTH_DOCUMENTATION,
      },
    ],
    setupSteps: [
      {
        key: 'apiKey',
        title: 'OpenRouter API key',
        defaultValue: OPENROUTER_API_KEY_REFERENCE,
        masked: true,
      },
      {
        key: 'model',
        title: 'OpenRouter model',
        defaultValue: OPENROUTER_DEFAULT_MODEL,
        required: true,
      },
    ],
    // The explicit service URL bypasses OPENAI_BASE_URL; the reused SDK still reads these headers.
    destinationEnvironment: ['OPENAI_ORG_ID', 'OPENAI_PROJECT_ID'],
    probeProfile: (profile) =>
      probeOpenAICompatibleProfile({
        ...profile,
        baseURL: profile.baseURL ?? OPENROUTER_BASE_URL,
      }),
    createProvider: (config) => {
      if (!config.apiKey) throw new Error('Provider openrouter requires apiKey');
      return compatible.createProvider({
        ...config,
        baseURL: config.baseURL ?? OPENROUTER_BASE_URL,
        options: { ...config.options, apiSurface: 'chat-completions' },
      });
    },
  };
}
