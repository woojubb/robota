import { describe, expect, it, vi } from 'vitest';
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
});
