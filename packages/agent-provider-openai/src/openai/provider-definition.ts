import { readNativeWebSearchOption } from '@robota-sdk/agent-core';
import { probeOpenAICompatibleProfile } from '@robota-sdk/agent-provider-openai-compatible/shared';

import { parseExtraBody } from './extra-body';
import { OpenAIProvider } from './provider';
import { parseParallelToolCalls } from './parallel-tool-policy';

import type { TOpenAIApiSurface } from './types';
import type {
  IProviderDefinition,
  IProviderDefinitionConfig,
  TUniversalValue,
} from '@robota-sdk/agent-core';

export const DEFAULT_OPENAI_PROVIDER_MODEL: string | undefined = undefined;
export const DEFAULT_OPENAI_PROVIDER_API_KEY_REFERENCE = '$ENV:OPENAI_API_KEY';
const OPENAI_API_KEY_URL = 'https://platform.openai.com/api-keys';
const OPENAI_SETUP_SOURCE_URL =
  'https://developers.openai.com/api/reference/overview#authentication';
const OPENAI_SETUP_LAST_VERIFIED_AT = '2026-05-08';
const OPENAI_SETUP_HELP_LINKS: NonNullable<IProviderDefinition['setupHelpLinks']> = [
  {
    kind: 'api-key',
    label: 'OpenAI API keys',
    url: OPENAI_API_KEY_URL,
    sourceUrl: OPENAI_SETUP_SOURCE_URL,
    lastVerifiedAt: OPENAI_SETUP_LAST_VERIFIED_AT,
  },
];

export function createOpenAIProviderDefinition(): IProviderDefinition {
  return {
    type: 'openai',
    displayName: 'OpenAI',
    description: 'GPT series — general-purpose assistant. API key required.',
    category: 'cloud-paid',
    // Interim provider-level cost, migrated from the former llm-text-openai node.
    costPerTokenUsd: 0.001,
    defaults: {
      apiKey: DEFAULT_OPENAI_PROVIDER_API_KEY_REFERENCE,
    },
    // the SDK embeds this endpoint; declared here for the pre-session doctor only.
    endpoint: { host: 'api.openai.com', port: 443 },
    modelCatalog: {
      status: 'unavailable',
      sourceUrl: 'https://platform.openai.com/docs/api-reference/models/list',
      message: 'OpenAI model availability should be discovered live from GET /v1/models.',
    },
    setupHelpLinks: OPENAI_SETUP_HELP_LINKS,
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
    // The OpenAI SDK falls back to the base URL variable when none is configured, and sends the
    // organization and project the others name.
    destinationEnvironment: ['OPENAI_BASE_URL', 'OPENAI_ORG_ID', 'OPENAI_PROJECT_ID'],
    // The SDK falls back to OPENAI_BASE_URL: with it set, the endpoint is one we cannot vouch for.
    nativeWebTools: (profile, environment) =>
      runsOpenAIHostedTools(profile) && !environment['OPENAI_BASE_URL'] ? ['webSearch'] : [],
    createProvider: (config) => {
      const parallelToolCalls = parseParallelToolCalls(
        config.options?.parallelToolCalls,
        config.options?.apiSurface,
      );
      const extraBody = parseExtraBody(config.options?.extraBody);
      const apiSurface = readApiSurface(config.options);
      const webSearch = readNativeWebSearchOption('openai', config.options);
      if (webSearch && !runsOpenAIHostedTools(config)) {
        throw new Error(
          "Provider openai profile uses an OpenAI-compatible endpoint or Chat Completions; hosted web search runs only on OpenAI's own Responses API. Connect an MCP server that offers web search.",
        );
      }
      return new OpenAIProvider({
        apiKey: requireApiKey(config.apiKey),
        ...(config.baseURL !== undefined && { baseURL: config.baseURL }),
        ...(config.timeout !== undefined && { timeout: config.timeout }),
        ...(apiSurface !== undefined && { apiSurface }),
        ...(parallelToolCalls !== undefined && { parallelToolCalls }),
        ...(extraBody !== undefined && { extraBody }),
        ...(webSearch && { nativeWebTools: { webSearch: true } }),
        ...(config.options?.durableOperations === true && { durableOperations: true }),
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

/** Hosted tools run only on OpenAI's own Responses API: no custom endpoint, not Chat Completions. */
function runsOpenAIHostedTools(
  profile: Pick<IProviderDefinitionConfig, 'baseURL' | 'options'>,
): boolean {
  return profile.baseURL === undefined && readApiSurface(profile.options) !== 'chat-completions';
}
