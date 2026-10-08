import { describe, expect, it, vi } from 'vitest';
import OpenAI from 'openai';
import { createGemmaProviderDefinition, GemmaProvider } from './index';

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

describe('createGemmaProviderDefinition', () => {
  it('exposes local setup help through the provider-definition contract', () => {
    const definition = createGemmaProviderDefinition();

    expect(definition.type).toBe('gemma');
    expect(definition.setupHelpLinks).toEqual([
      {
        kind: 'official',
        label: 'LM Studio local API documentation',
        url: 'https://lmstudio.ai/docs/developer',
        sourceUrl: 'https://lmstudio.ai/docs/developer',
        lastVerifiedAt: '2026-05-08',
      },
    ]);
  });

  it('creates a GemmaProvider from a resolved provider profile', () => {
    const definition = createGemmaProviderDefinition();

    const provider = definition.createProvider({
      name: 'gemma',
      model: 'supergemma4-26b-uncensored-v2',
      apiKey: 'lm-studio',
      baseURL: 'http://localhost:1234/v1',
    });

    expect(provider).toBeInstanceOf(GemmaProvider);
  });

  it('keeps the SDK placeholder out of local setup and saved profile defaults', () => {
    const definition = createGemmaProviderDefinition();

    expect(definition.requiresApiKey).toBe(false);
    expect(definition.defaults?.apiKey).toBeUndefined();
    expect(definition.setupSteps?.find((step) => step.key === 'apiKey')).toMatchObject({
      masked: true,
      editOnly: true,
    });
    expect(
      definition.setupSteps?.find((step) => step.key === 'apiKey')?.defaultValue,
    ).toBeUndefined();
  });

  it('creates a keyless local provider using an internal SDK placeholder', () => {
    const provider = createGemmaProviderDefinition().createProvider({
      name: 'gemma',
      model: 'fixture-model',
      baseURL: 'http://localhost:1234/v1',
    });

    expect(provider).toBeInstanceOf(GemmaProvider);
    expect(OpenAI).toHaveBeenLastCalledWith({
      apiKey: 'lm-studio',
      baseURL: 'http://localhost:1234/v1',
    });
  });

  it('preserves a supplied local-server token instead of replacing it with the placeholder', () => {
    createGemmaProviderDefinition().createProvider({
      name: 'gemma',
      model: 'fixture-model',
      apiKey: 'synthetic-server-token',
      baseURL: 'http://localhost:1234/v1',
    });

    expect(OpenAI).toHaveBeenLastCalledWith({
      apiKey: 'synthetic-server-token',
      baseURL: 'http://localhost:1234/v1',
    });
  });

  it('rejects a missing explicitly configured environment credential', () => {
    expect(() =>
      createGemmaProviderDefinition().createProvider({
        name: 'gemma',
        model: 'fixture-model',
        apiKeyEnv: 'SYNTHETIC_LOCAL_SERVER_TOKEN',
      }),
    ).toThrow('Environment variable SYNTHETIC_LOCAL_SERVER_TOKEN is not set');
  });
});
