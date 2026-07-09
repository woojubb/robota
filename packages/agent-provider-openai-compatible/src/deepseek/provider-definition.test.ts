import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createDeepSeekProviderDefinition,
  DeepSeekProvider,
  DEFAULT_DEEPSEEK_PROVIDER_API_KEY_ENV,
  DEFAULT_DEEPSEEK_PROVIDER_API_KEY_REFERENCE,
  DEFAULT_DEEPSEEK_PROVIDER_BASE_URL,
  DEFAULT_DEEPSEEK_PROVIDER_MODEL,
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

describe('createDeepSeekProviderDefinition', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('exposes DeepSeek defaults, setup steps, and model catalog metadata', () => {
    const definition = createDeepSeekProviderDefinition();

    expect(definition.type).toBe('deepseek');
    expect(definition.requiresApiKey).toBe(true);
    expect(definition.probeProfile).toBeTypeOf('function');
    expect(definition.refreshModelCatalog).toBeTypeOf('function');
    expect(definition.defaults).toEqual({
      model: DEFAULT_DEEPSEEK_PROVIDER_MODEL,
      apiKey: DEFAULT_DEEPSEEK_PROVIDER_API_KEY_REFERENCE,
      baseURL: DEFAULT_DEEPSEEK_PROVIDER_BASE_URL,
    });
    expect(definition.setupHelpLinks).toEqual([
      {
        kind: 'api-key',
        label: 'DeepSeek API keys',
        url: 'https://platform.deepseek.com/api_keys',
        sourceUrl: 'https://api-docs.deepseek.com/',
        lastVerifiedAt: '2026-05-08',
      },
    ]);
    expect(DEFAULT_DEEPSEEK_PROVIDER_API_KEY_ENV).toBe('DEEPSEEK_API_KEY');
    expect(definition.setupSteps).toEqual([
      {
        key: 'baseURL',
        title: 'DeepSeek OpenAI-compatible base URL',
        defaultValue: DEFAULT_DEEPSEEK_PROVIDER_BASE_URL,
      },
      {
        key: 'model',
        title: 'DeepSeek model',
        defaultValue: DEFAULT_DEEPSEEK_PROVIDER_MODEL,
      },
      {
        key: 'apiKey',
        title: 'DeepSeek API key',
        defaultValue: DEFAULT_DEEPSEEK_PROVIDER_API_KEY_REFERENCE,
        masked: true,
      },
    ]);
    expect(definition.modelCatalog?.entries?.map((entry) => entry.id)).toEqual([
      'deepseek-v4-flash',
      'deepseek-v4-pro',
      'deepseek-chat',
      'deepseek-reasoner',
    ]);
    expect(definition.modelCatalog?.entries?.[2]).toMatchObject({
      id: 'deepseek-chat',
      lifecycle: 'deprecated',
      aliases: ['deepseek-v4-flash'],
    });
  });

  it('creates a DeepSeekProvider from a resolved provider profile', () => {
    const definition = createDeepSeekProviderDefinition();

    const provider = definition.createProvider({
      name: 'deepseek',
      model: 'deepseek-v4-pro',
      apiKey: 'deepseek-key',
      baseURL: 'https://api.deepseek.com',
      timeout: 12_000,
      options: {
        thinking: { type: 'enabled' },
        reasoningEffort: 'max',
      },
    });

    expect(provider).toBeInstanceOf(DeepSeekProvider);
    expect(provider.name).toBe('deepseek');
  });

  it('rejects provider creation without an API key', () => {
    const definition = createDeepSeekProviderDefinition();

    expect(() =>
      definition.createProvider({
        name: 'deepseek',
        model: 'deepseek-v4-flash',
      }),
    ).toThrow('Provider deepseek requires apiKey');
  });
});
