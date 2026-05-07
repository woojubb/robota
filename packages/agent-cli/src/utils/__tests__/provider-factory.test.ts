import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  createProviderFromProfile,
  createProviderFromSettings,
  getProviderSettingsPaths,
  readProviderSettings,
} from '../provider-factory.js';
import { AnthropicProvider } from '@robota-sdk/agent-provider-anthropic';
import { OpenAIProvider } from '@robota-sdk/agent-provider-openai';
import { GemmaProvider } from '@robota-sdk/agent-provider-gemma';
import { QwenProvider } from '@robota-sdk/agent-provider-qwen';
import { GeminiProvider } from '@robota-sdk/agent-provider-gemini';

vi.mock('@robota-sdk/agent-provider-anthropic', () => {
  const MockAnthropicProvider = vi.fn().mockImplementation((options: unknown) => ({
    name: 'anthropic',
    version: 'test',
    options,
  }));
  return {
    AnthropicProvider: MockAnthropicProvider,
    createAnthropicProviderDefinition: () => ({
      type: 'anthropic',
      defaults: { model: 'claude-sonnet-4-6' },
      requiresApiKey: true,
      createProvider: (config: {
        model: string;
        apiKey?: string;
        baseURL?: string;
        timeout?: number;
      }) =>
        new MockAnthropicProvider({
          ...(config.apiKey !== undefined && { apiKey: config.apiKey }),
          ...(config.baseURL !== undefined && { baseURL: config.baseURL }),
          ...(config.timeout !== undefined && { timeout: config.timeout }),
          defaultModel: config.model,
        }),
    }),
  };
});

vi.mock('@robota-sdk/agent-provider-openai', () => {
  const MockOpenAIProvider = vi.fn().mockImplementation((options: unknown) => ({
    name: 'openai',
    version: 'test',
    options,
  }));
  return {
    OpenAIProvider: MockOpenAIProvider,
    createOpenAIProviderDefinition: () => ({
      type: 'openai',
      defaults: {
        apiKey: '$ENV:OPENAI_API_KEY',
      },
      requiresApiKey: true,
      createProvider: (config: {
        model: string;
        apiKey?: string;
        baseURL?: string;
        timeout?: number;
      }) =>
        new MockOpenAIProvider({
          apiKey: config.apiKey,
          ...(config.baseURL !== undefined && { baseURL: config.baseURL }),
          ...(config.timeout !== undefined && { timeout: config.timeout }),
          defaultModel: config.model,
        }),
    }),
  };
});

vi.mock('@robota-sdk/agent-provider-gemma', () => {
  const MockGemmaProvider = vi.fn().mockImplementation((options: unknown) => ({
    name: 'gemma',
    version: 'test',
    options,
  }));
  return {
    GemmaProvider: MockGemmaProvider,
    createGemmaProviderDefinition: () => ({
      type: 'gemma',
      defaults: {
        model: 'supergemma4-26b-uncensored-v2',
        apiKey: 'lm-studio',
        baseURL: 'http://localhost:1234/v1',
      },
      requiresApiKey: true,
      createProvider: (config: {
        model: string;
        apiKey?: string;
        baseURL?: string;
        timeout?: number;
      }) =>
        new MockGemmaProvider({
          apiKey: config.apiKey,
          ...(config.baseURL !== undefined && { baseURL: config.baseURL }),
          ...(config.timeout !== undefined && { timeout: config.timeout }),
          defaultModel: config.model,
        }),
    }),
  };
});

vi.mock('@robota-sdk/agent-provider-qwen', () => {
  const MockQwenProvider = vi.fn().mockImplementation((options: unknown) => ({
    name: 'qwen',
    version: 'test',
    options,
  }));
  return {
    QwenProvider: MockQwenProvider,
    createQwenProviderDefinition: () => ({
      type: 'qwen',
      defaults: {
        model: 'qwen-plus',
        apiKey: '$ENV:DASHSCOPE_API_KEY',
        baseURL: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
      },
      requiresApiKey: true,
      createProvider: (config: {
        model: string;
        apiKey?: string;
        baseURL?: string;
        timeout?: number;
        options?: Record<string, unknown>;
      }) =>
        new MockQwenProvider({
          apiKey: config.apiKey,
          ...(config.baseURL !== undefined && { baseURL: config.baseURL }),
          ...(config.timeout !== undefined && { timeout: config.timeout }),
          ...(config.options?.['responsesBaseURL'] !== undefined && {
            responsesBaseURL: config.options['responsesBaseURL'],
          }),
          ...(config.options?.['builtInWebTools'] !== undefined && {
            builtInWebTools: config.options['builtInWebTools'],
          }),
          defaultModel: config.model,
        }),
    }),
  };
});

vi.mock('@robota-sdk/agent-provider-gemini', () => {
  const MockGeminiProvider = vi.fn().mockImplementation((options: unknown) => ({
    name: 'gemini',
    version: 'test',
    options,
  }));
  return {
    GeminiProvider: MockGeminiProvider,
    createGeminiProviderDefinition: () => ({
      type: 'gemini',
      aliases: ['google'],
      defaults: {
        model: 'gemini-3-flash-preview',
        apiKey: '$ENV:GEMINI_API_KEY',
      },
      requiresApiKey: true,
      createProvider: (config: {
        model: string;
        apiKey?: string;
        baseURL?: string;
        timeout?: number;
      }) =>
        new MockGeminiProvider({
          apiKey: config.apiKey,
          defaultModel: config.model,
        }),
    }),
  };
});

const TMP_BASE = join(tmpdir(), `robota-provider-factory-test-${process.pid}`);
const ORIGINAL_HOME = process.env.HOME;

function writeJson(path: string, data: unknown): void {
  writeFileSync(path, JSON.stringify(data, null, 2), 'utf8');
}

describe('provider-factory', () => {
  let cwd: string;

  beforeEach(() => {
    vi.clearAllMocks();
    cwd = join(TMP_BASE, Math.random().toString(36).slice(2));
    process.env.HOME = join(cwd, 'home');
    mkdirSync(join(cwd, '.robota'), { recursive: true });
  });

  afterEach(() => {
    process.env.HOME = ORIGINAL_HOME;
    delete process.env.ROBOTA_TEST_ANTHROPIC_API_KEY;
    delete process.env.DASHSCOPE_API_KEY;
    rmSync(TMP_BASE, { recursive: true, force: true });
  });

  it('resolves user settings paths from HOME for test and runtime isolation', () => {
    const paths = getProviderSettingsPaths(cwd);
    const home = process.env.HOME;
    if (home === undefined) {
      throw new Error('HOME is required for this test');
    }

    expect(paths[0]).toBe(join(home, '.robota', 'settings.json'));
    expect(paths[1]).toBe(join(home, '.claude', 'settings.json'));
  });

  it('reads active OpenAI-compatible provider profile', () => {
    writeJson(join(cwd, '.robota', 'settings.json'), {
      currentProvider: 'openai',
      provider: {
        name: 'anthropic',
        model: 'claude-sonnet-4-6',
        apiKey: 'sk-legacy',
      },
      providers: {
        openai: {
          type: 'openai',
          model: 'supergemma4-26b-uncensored-v2',
          apiKey: 'lm-studio',
          baseURL: 'http://localhost:1234/v1',
          timeout: 30000,
        },
      },
    });

    expect(readProviderSettings(cwd)).toEqual({
      name: 'openai',
      model: 'supergemma4-26b-uncensored-v2',
      apiKey: 'lm-studio',
      baseURL: 'http://localhost:1234/v1',
      timeout: 30000,
    });
  });

  it('selects a provider override without changing settings', () => {
    const settingsPath = join(cwd, '.robota', 'settings.json');
    writeJson(settingsPath, {
      currentProvider: 'openai',
      providers: {
        openai: {
          type: 'openai',
          model: 'supergemma4-26b-uncensored-v2',
          apiKey: 'lm-studio',
        },
        anthropic: {
          type: 'anthropic',
          model: 'claude-sonnet-4-6',
          apiKey: 'sk-ant-test',
        },
      },
    });

    const settings = readProviderSettings(cwd, { providerOverride: 'anthropic' });

    expect(settings.name).toBe('anthropic');
    expect(settings.model).toBe('claude-sonnet-4-6');
    expect(JSON.parse(readFileSync(settingsPath, 'utf8'))).toMatchObject({
      currentProvider: 'openai',
    });
  });

  it('creates OpenAIProvider for an OpenAI-compatible profile', () => {
    writeJson(join(cwd, '.robota', 'settings.json'), {
      currentProvider: 'openai',
      providers: {
        openai: {
          type: 'openai',
          model: 'supergemma4-26b-uncensored-v2',
          apiKey: 'lm-studio',
          baseURL: 'http://localhost:1234/v1',
        },
      },
    });

    const provider = createProviderFromSettings(cwd);

    expect(provider.name).toBe('openai');
    expect(OpenAIProvider).toHaveBeenCalledWith({
      apiKey: 'lm-studio',
      baseURL: 'http://localhost:1234/v1',
      defaultModel: 'supergemma4-26b-uncensored-v2',
    });
  });

  it('creates GemmaProvider for a Gemma OpenAI-compatible profile', () => {
    writeJson(join(cwd, '.robota', 'settings.json'), {
      currentProvider: 'gemma',
      providers: {
        gemma: {
          type: 'gemma',
          model: 'supergemma4-26b-uncensored-v2',
          apiKey: 'lm-studio',
          baseURL: 'http://localhost:1234/v1',
        },
      },
    });

    const provider = createProviderFromSettings(cwd);

    expect(provider.name).toBe('gemma');
    expect(GemmaProvider).toHaveBeenCalledWith({
      apiKey: 'lm-studio',
      baseURL: 'http://localhost:1234/v1',
      defaultModel: 'supergemma4-26b-uncensored-v2',
    });
  });

  it('keeps Anthropic provider creation working when legacy settings are present', () => {
    writeJson(join(cwd, '.robota', 'settings.json'), {
      currentProvider: 'anthropic',
      providers: {
        anthropic: {
          type: 'anthropic',
          model: 'claude-sonnet-4-6',
          apiKey: 'sk-ant-test',
        },
      },
      provider: {
        name: 'anthropic',
        model: 'claude-sonnet-4-6',
        apiKey: 'sk-ant-test',
      },
    });

    const provider = createProviderFromSettings(cwd);

    expect(provider.name).toBe('anthropic');
    expect(AnthropicProvider).toHaveBeenCalledWith({
      apiKey: 'sk-ant-test',
      defaultModel: 'claude-sonnet-4-6',
    });
  });

  it('resolves env references in provider api keys', () => {
    process.env.ROBOTA_TEST_ANTHROPIC_API_KEY = 'sk-ant-from-env';
    writeJson(join(cwd, '.robota', 'settings.json'), {
      currentProvider: 'anthropic',
      providers: {
        anthropic: {
          type: 'anthropic',
          model: 'claude-sonnet-4-6',
          apiKey: '$ENV:ROBOTA_TEST_ANTHROPIC_API_KEY',
        },
      },
      provider: {
        name: 'anthropic',
        model: 'claude-sonnet-4-6',
        apiKey: '$ENV:ROBOTA_TEST_ANTHROPIC_API_KEY',
      },
    });

    createProviderFromSettings(cwd);

    expect(AnthropicProvider).toHaveBeenCalledWith({
      apiKey: 'sk-ant-from-env',
      defaultModel: 'claude-sonnet-4-6',
    });
  });

  it('creates a provider from a serialized worker profile', () => {
    createProviderFromProfile({
      type: 'openai',
      model: 'worker-model',
      apiKey: 'worker-key',
      baseURL: 'http://localhost:1234/v1',
      timeout: 12_000,
    });

    expect(OpenAIProvider).toHaveBeenCalledWith({
      apiKey: 'worker-key',
      baseURL: 'http://localhost:1234/v1',
      timeout: 12_000,
      defaultModel: 'worker-model',
    });
  });

  it('creates GemmaProvider from a serialized worker profile', () => {
    createProviderFromProfile({
      type: 'gemma',
      model: 'worker-gemma',
      apiKey: 'worker-key',
      baseURL: 'http://localhost:1234/v1',
      timeout: 12_000,
    });

    expect(GemmaProvider).toHaveBeenCalledWith({
      apiKey: 'worker-key',
      baseURL: 'http://localhost:1234/v1',
      timeout: 12_000,
      defaultModel: 'worker-gemma',
    });
  });

  it('creates QwenProvider for a Qwen OpenAI-compatible profile', () => {
    writeJson(join(cwd, '.robota', 'settings.json'), {
      currentProvider: 'qwen',
      providers: {
        qwen: {
          type: 'qwen',
          model: 'qwen-plus',
          apiKey: 'dashscope-key',
          baseURL: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
          timeout: 45_000,
        },
      },
    });

    const provider = createProviderFromSettings(cwd);

    expect(provider.name).toBe('qwen');
    expect(QwenProvider).toHaveBeenCalledWith({
      apiKey: 'dashscope-key',
      baseURL: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
      timeout: 45_000,
      defaultModel: 'qwen-plus',
    });
  });

  it('passes provider-owned options through the generic provider config bag', () => {
    writeJson(join(cwd, '.robota', 'settings.json'), {
      currentProvider: 'qwen',
      providers: {
        qwen: {
          type: 'qwen',
          model: 'qwen3.6-plus',
          apiKey: 'dashscope-key',
          options: {
            responsesBaseURL:
              'https://dashscope-intl.aliyuncs.com/api/v2/apps/protocols/compatible-mode/v1',
            builtInWebTools: {
              webSearch: true,
              webFetch: true,
              enableThinking: true,
            },
          },
        },
      },
    });

    const settings = readProviderSettings(cwd);
    const provider = createProviderFromSettings(cwd);

    expect(settings.options).toEqual({
      responsesBaseURL:
        'https://dashscope-intl.aliyuncs.com/api/v2/apps/protocols/compatible-mode/v1',
      builtInWebTools: {
        webSearch: true,
        webFetch: true,
        enableThinking: true,
      },
    });
    expect(provider.name).toBe('qwen');
    expect(QwenProvider).toHaveBeenCalledWith({
      apiKey: 'dashscope-key',
      baseURL: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
      responsesBaseURL:
        'https://dashscope-intl.aliyuncs.com/api/v2/apps/protocols/compatible-mode/v1',
      builtInWebTools: {
        webSearch: true,
        webFetch: true,
        enableThinking: true,
      },
      defaultModel: 'qwen3.6-plus',
    });
  });

  it('creates GeminiProvider for canonical Gemini provider profiles', () => {
    writeJson(join(cwd, '.robota', 'settings.json'), {
      currentProvider: 'gemini',
      providers: {
        gemini: {
          type: 'gemini',
          model: 'gemini-3-flash-preview',
          apiKey: 'gemini-key',
        },
      },
    });

    const provider = createProviderFromSettings(cwd);

    expect(provider.name).toBe('gemini');
    expect(GeminiProvider).toHaveBeenCalledWith({
      apiKey: 'gemini-key',
      defaultModel: 'gemini-3-flash-preview',
    });
  });

  it('creates GeminiProvider for compatibility Google provider profiles through aliases', () => {
    writeJson(join(cwd, '.robota', 'settings.json'), {
      currentProvider: 'google',
      providers: {
        google: {
          type: 'google',
          model: 'gemini-3-flash-preview',
          apiKey: 'gemini-key',
        },
      },
    });

    createProviderFromSettings(cwd);

    expect(GeminiProvider).toHaveBeenCalledWith({
      apiKey: 'gemini-key',
      defaultModel: 'gemini-3-flash-preview',
    });
  });

  it('fails before provider construction when an API key environment reference is unset', () => {
    delete process.env.DASHSCOPE_API_KEY;
    writeJson(join(cwd, '.robota', 'settings.json'), {
      currentProvider: 'qwen',
      providers: {
        qwen: {
          type: 'qwen',
          model: 'qwen-plus',
          apiKey: '$ENV:DASHSCOPE_API_KEY',
        },
      },
    });

    expect(() => createProviderFromSettings(cwd)).toThrow('Provider qwen requires apiKey');
    expect(QwenProvider).not.toHaveBeenCalled();
  });

  it('creates providers from injected definitions without adding factory branches', () => {
    const createProvider = vi.fn((config: { name: string; model: string }) => ({
      name: config.name,
      version: 'test',
      config,
      chat: vi.fn(),
      generateResponse: vi.fn(),
      supportsTools: () => true,
      validateConfig: () => true,
    }));
    writeJson(join(cwd, '.robota', 'settings.json'), {
      currentProvider: 'custom',
      providers: {
        custom: {
          type: 'custom',
        },
      },
    });

    const provider = createProviderFromSettings(cwd, undefined, {
      providerDefinitions: [
        {
          type: 'custom',
          defaults: { model: 'custom-model' },
          createProvider,
        },
      ],
    });

    expect(provider.name).toBe('custom');
    expect(createProvider).toHaveBeenCalledWith({
      name: 'custom',
      model: 'custom-model',
      apiKey: undefined,
      baseURL: undefined,
      timeout: undefined,
    });
  });
});
