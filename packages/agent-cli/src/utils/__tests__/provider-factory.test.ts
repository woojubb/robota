import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createProviderFromSettings, readProviderSettings } from '../provider-factory.js';
import { AnthropicProvider } from '@robota-sdk/agent-provider-anthropic';
import { OpenAIProvider } from '@robota-sdk/agent-provider-openai';

vi.mock('@robota-sdk/agent-provider-anthropic', () => ({
  AnthropicProvider: vi.fn().mockImplementation((options: unknown) => ({
    name: 'anthropic',
    version: 'test',
    options,
  })),
}));

vi.mock('@robota-sdk/agent-provider-openai', () => ({
  OpenAIProvider: vi.fn().mockImplementation((options: unknown) => ({
    name: 'openai',
    version: 'test',
    options,
  })),
}));

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
});
