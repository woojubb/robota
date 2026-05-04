import type { IProviderDefinition } from '@robota-sdk/agent-core';
import type { TUniversalValue } from '@robota-sdk/agent-core';
import { probeOpenAICompatibleProfile } from '@robota-sdk/agent-provider-openai-compatible';
import { QwenProvider } from './provider';
import {
  DEFAULT_QWEN_PROVIDER_API_KEY_REFERENCE,
  DEFAULT_QWEN_PROVIDER_BASE_URL,
  DEFAULT_QWEN_PROVIDER_MODEL,
} from './defaults';
import type { IQwenBuiltInWebToolsOptions } from './types';

const QWEN_MODEL_SOURCE_URL =
  'https://www.alibabacloud.com/help/en/model-studio/compatibility-of-openai-with-dashscope';
const QWEN_MODEL_LAST_VERIFIED_AT = '2026-05-04';
const QWEN_MODEL_CATALOG: NonNullable<IProviderDefinition['modelCatalog']> = {
  status: 'fallback',
  sourceUrl: QWEN_MODEL_SOURCE_URL,
  lastVerifiedAt: QWEN_MODEL_LAST_VERIFIED_AT,
  entries: [
    {
      id: DEFAULT_QWEN_PROVIDER_MODEL,
      displayName: 'Qwen Plus',
      capabilities: ['tools', 'reasoning', 'native_web', 'streaming'],
      lifecycle: 'active',
      sourceUrl: QWEN_MODEL_SOURCE_URL,
      lastVerifiedAt: QWEN_MODEL_LAST_VERIFIED_AT,
    },
    {
      id: 'qwen-max',
      displayName: 'Qwen Max',
      capabilities: ['tools', 'reasoning', 'native_web', 'streaming'],
      lifecycle: 'active',
      sourceUrl: QWEN_MODEL_SOURCE_URL,
      lastVerifiedAt: QWEN_MODEL_LAST_VERIFIED_AT,
    },
    {
      id: 'qwen-flash',
      displayName: 'Qwen Flash',
      capabilities: ['tools', 'native_web', 'streaming'],
      lifecycle: 'active',
      sourceUrl: QWEN_MODEL_SOURCE_URL,
      lastVerifiedAt: QWEN_MODEL_LAST_VERIFIED_AT,
    },
  ],
};

export {
  DEFAULT_QWEN_PROVIDER_API_KEY_ENV,
  DEFAULT_QWEN_PROVIDER_API_KEY_REFERENCE,
  DEFAULT_QWEN_PROVIDER_BASE_URL,
  DEFAULT_QWEN_PROVIDER_MODEL,
  DEFAULT_QWEN_PROVIDER_RESPONSES_BASE_URL,
  QWEN_PROVIDER_BASE_URLS,
  QWEN_PROVIDER_RESPONSES_BASE_URLS,
} from './defaults';
export type { TQwenProviderRegion, TQwenProviderResponsesRegion } from './defaults';

export function createQwenProviderDefinition(): IProviderDefinition {
  return {
    type: 'qwen',
    displayName: 'Qwen',
    description: 'Alibaba Cloud Model Studio OpenAI-compatible endpoint',
    defaults: {
      model: DEFAULT_QWEN_PROVIDER_MODEL,
      apiKey: DEFAULT_QWEN_PROVIDER_API_KEY_REFERENCE,
      baseURL: DEFAULT_QWEN_PROVIDER_BASE_URL,
    },
    modelCatalog: QWEN_MODEL_CATALOG,
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
    createProvider: (config) => {
      const qwenOptions = parseQwenProviderOptions(config.options);
      return new QwenProvider({
        apiKey: requireApiKey(config.apiKey),
        ...(config.baseURL !== undefined && { baseURL: config.baseURL }),
        ...(qwenOptions.responsesBaseURL !== undefined && {
          responsesBaseURL: qwenOptions.responsesBaseURL,
        }),
        ...(config.timeout !== undefined && { timeout: config.timeout }),
        ...(qwenOptions.builtInWebTools !== undefined && {
          builtInWebTools: qwenOptions.builtInWebTools,
        }),
        defaultModel: config.model,
      });
    },
  };
}

function requireApiKey(apiKey: string | undefined): string {
  if (!apiKey) {
    throw new Error('Provider qwen requires apiKey');
  }
  return apiKey;
}

function parseQwenProviderOptions(options: Record<string, TUniversalValue> | undefined): {
  responsesBaseURL?: string;
  builtInWebTools?: IQwenBuiltInWebToolsOptions;
} {
  const builtInWebTools = parseBuiltInWebTools(asRecord(options?.['builtInWebTools']));
  const responsesBaseURL = asString(options?.['responsesBaseURL']);
  return {
    ...(responsesBaseURL !== undefined && { responsesBaseURL }),
    ...(builtInWebTools !== undefined && { builtInWebTools }),
  };
}

function parseBuiltInWebTools(
  options: Record<string, TUniversalValue> | undefined,
): IQwenBuiltInWebToolsOptions | undefined {
  if (options === undefined) {
    return undefined;
  }
  return {
    ...(asBoolean(options['webSearch']) !== undefined && {
      webSearch: asBoolean(options['webSearch']),
    }),
    ...(asBoolean(options['webFetch']) !== undefined && {
      webFetch: asBoolean(options['webFetch']),
    }),
    ...(asBoolean(options['enableThinking']) !== undefined && {
      enableThinking: asBoolean(options['enableThinking']),
    }),
  };
}

function asRecord(value: TUniversalValue | undefined): Record<string, TUniversalValue> | undefined {
  if (value === null || value === undefined || value instanceof Date || Array.isArray(value)) {
    return undefined;
  }
  return typeof value === 'object' ? value : undefined;
}

function asBoolean(value: TUniversalValue | undefined): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function asString(value: TUniversalValue | undefined): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}
