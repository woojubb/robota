import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  createProviderFromProfile,
  createProviderFromSettings,
  readProviderSettings,
} from '../provider-factory.js';
import { AnthropicProvider } from '@robota-sdk/agent-provider-anthropic';
import { OpenAIProvider } from '@robota-sdk/agent-provider-openai';
import { GemmaProvider } from '@robota-sdk/agent-provider-gemma';
import { QwenProvider } from '@robota-sdk/agent-provider-qwen';

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
          apiKey: config.apiKey,
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
      }) =>
        new MockQwenProvider({
          apiKey: config.apiKey,
          ...(config.baseURL !== undefined && { baseURL: config.baseURL }),
          ...(config.timeout !== undefined && { timeout: config.timeout }),
          defaultModel: config.model,
        }),
    }),
  };
});

const TMP_BASE = join(tmpdir(), `robota-provider-factory-test-${process.pid}`);

function writeJson(path: string, data: unknown): void {
  writeFileSync(path, JSON.stringify(data, null, 2), 'utf8');
}

describe('provider-factory', () => {
  let cwd: string;

  beforeEach(() => {
    vi.clearAllMocks();
    cwd = join(TMP_BASE, Math.random().toString(36).slice(2));
    mkdirSync(join(cwd, '.robota'), { recursive: true });
  });

  afterEach(() => {
    delete process.env.ROBOTA_TEST_ANTHROPIC_API_KEY;
    rmSync(TMP_BASE, { recursive: true, force: true });
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

  it('keeps legacy Anthropic provider creation working', () => {
    writeJson(join(cwd, '.robota', 'settings.json'), {
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
