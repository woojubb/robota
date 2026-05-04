import type { IProviderDefinition, TUniversalValue } from '@robota-sdk/agent-core';
import { probeOpenAICompatibleProfile } from '@robota-sdk/agent-provider-openai-compatible';
import { refreshOpenAIModelCatalog } from './model-catalog-refresh';
import { OpenAIProvider } from './provider';
import type { IOpenAINativeWebToolsOptions, TOpenAIApiSurface } from './types';

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
    modelCatalog: {
      status: 'unavailable',
      sourceUrl: 'https://platform.openai.com/docs/api-reference/models/list',
      message: 'OpenAI model availability should be discovered live from GET /v1/models.',
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
    refreshModelCatalog: ({ profile }) => refreshOpenAIModelCatalog(profile),
    createProvider: (config) => {
      const apiSurface = readApiSurface(config.options);
      const nativeWebTools = readNativeWebTools(config.options);
      validateOpenAINativeWebTools(config.baseURL, apiSurface, nativeWebTools);
      return new OpenAIProvider({
        apiKey: requireApiKey(config.apiKey),
        ...(config.baseURL !== undefined && { baseURL: config.baseURL }),
        ...(config.timeout !== undefined && { timeout: config.timeout }),
        ...(apiSurface !== undefined && { apiSurface }),
        ...(nativeWebTools !== undefined && { nativeWebTools }),
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

function readNativeWebTools(
  options: Record<string, TUniversalValue> | undefined,
): IOpenAINativeWebToolsOptions | undefined {
  const nativeWebTools =
    readNativeWebToolsRecord(options?.['nativeWebTools']) ??
    readNativeWebToolsRecord(options?.['builtInWebTools']);
  if (nativeWebTools === undefined) {
    return undefined;
  }
  return nativeWebTools;
}

function readNativeWebToolsRecord(
  value: TUniversalValue | undefined,
): IOpenAINativeWebToolsOptions | undefined {
  if (value === null || value === undefined || value instanceof Date || Array.isArray(value)) {
    return undefined;
  }
  if (typeof value !== 'object') {
    return undefined;
  }
  const webSearch = value['webSearch'];
  const webFetch = value['webFetch'];
  return {
    ...(typeof webSearch === 'boolean' && { webSearch }),
    ...(typeof webFetch === 'boolean' && { webFetch }),
  };
}

function validateOpenAINativeWebTools(
  baseURL: string | undefined,
  apiSurface: TOpenAIApiSurface | undefined,
  nativeWebTools: IOpenAINativeWebToolsOptions | undefined,
): void {
  if (nativeWebTools?.webSearch !== true && nativeWebTools?.webFetch !== true) {
    return;
  }
  if (baseURL !== undefined || apiSurface === 'chat-completions') {
    throw new Error(
      'Provider openai profile uses an OpenAI-compatible Chat Completions endpoint; native web search/fetch is not supported for this profile. Use Robota local WebSearch/WebFetch tools or a provider with documented hosted web support.',
    );
  }
  throw new Error(
    'Provider openai native web search/fetch is not wired in this Robota provider version. Use Robota local WebSearch/WebFetch tools or a provider with documented hosted web support.',
  );
}
