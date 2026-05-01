import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  createQwenProviderDefinition,
  DEFAULT_QWEN_PROVIDER_API_KEY_ENV,
  DEFAULT_QWEN_PROVIDER_API_KEY_REFERENCE,
  DEFAULT_QWEN_PROVIDER_BASE_URL,
  DEFAULT_QWEN_PROVIDER_MODEL,
  QWEN_PROVIDER_BASE_URLS,
  QwenProvider,
} from './index';

vi.mock('openai', () => {
  const MockOpenAI = vi.fn().mockImplementation(() => ({
    chat: {
      completions: {
        create: vi.fn(),
      },
    },
  }));
  return { default: MockOpenAI };
});

describe('createQwenProviderDefinition', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('exposes Qwen defaults and setup steps through the provider-definition contract', () => {
    const definition = createQwenProviderDefinition();

    expect(definition.type).toBe('qwen');
    expect(definition.requiresApiKey).toBe(true);
    expect(definition.probeProfile).toBeTypeOf('function');
    expect(definition.defaults).toEqual({
      model: DEFAULT_QWEN_PROVIDER_MODEL,
      apiKey: DEFAULT_QWEN_PROVIDER_API_KEY_REFERENCE,
      baseURL: DEFAULT_QWEN_PROVIDER_BASE_URL,
    });
    expect(DEFAULT_QWEN_PROVIDER_API_KEY_ENV).toBe('DASHSCOPE_API_KEY');
    expect(QWEN_PROVIDER_BASE_URLS).toMatchObject({
      singapore: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
      usVirginia: 'https://dashscope-us.aliyuncs.com/compatible-mode/v1',
      beijing: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      hongKong: 'https://cn-hongkong.dashscope.aliyuncs.com/compatible-mode/v1',
    });
    expect(definition.setupSteps).toEqual([
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
    ]);
  });

  it('creates a QwenProvider from a resolved provider profile', () => {
    const definition = createQwenProviderDefinition();

    const provider = definition.createProvider({
      name: 'qwen',
      model: 'qwen-plus',
      apiKey: 'dashscope-key',
      baseURL: QWEN_PROVIDER_BASE_URLS.usVirginia,
      timeout: 12_000,
    });

    expect(provider).toBeInstanceOf(QwenProvider);
    expect(provider.name).toBe('qwen');
  });

  it('rejects provider creation without an API key', () => {
    const definition = createQwenProviderDefinition();

    expect(() =>
      definition.createProvider({
        name: 'qwen',
        model: 'qwen-plus',
      }),
    ).toThrow('Provider qwen requires apiKey');
  });
});
