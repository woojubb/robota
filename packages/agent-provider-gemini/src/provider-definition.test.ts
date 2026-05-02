import { describe, expect, it, vi } from 'vitest';
import { GeminiProvider } from './provider';
import {
  DEFAULT_GEMINI_PROVIDER_API_KEY_REFERENCE,
  DEFAULT_GEMINI_PROVIDER_MODEL,
  createGeminiProviderDefinition,
} from './provider-definition';

vi.mock('@google/genai', () => {
  class GoogleGenAI {
    public constructor(_options: { apiKey: string }) {}
  }
  return {
    GoogleGenAI,
    Type: {
      STRING: 'STRING',
      NUMBER: 'NUMBER',
      INTEGER: 'INTEGER',
      BOOLEAN: 'BOOLEAN',
      ARRAY: 'ARRAY',
      OBJECT: 'OBJECT',
    },
  };
});

describe('createGeminiProviderDefinition', () => {
  it('exposes Gemini as the canonical provider type with Google compatibility alias', () => {
    const definition = createGeminiProviderDefinition();

    expect(definition.type).toBe('gemini');
    expect(definition.aliases).toEqual(['google']);
    expect(definition.displayName).toBe('Gemini');
    expect(definition.defaults).toEqual({
      model: DEFAULT_GEMINI_PROVIDER_MODEL,
      apiKey: DEFAULT_GEMINI_PROVIDER_API_KEY_REFERENCE,
    });
  });

  it('creates the Gemini API provider implementation from generic provider config', () => {
    const definition = createGeminiProviderDefinition();

    const provider = definition.createProvider({
      name: 'gemini',
      model: 'gemini-3-flash-preview',
      apiKey: 'gemini-key',
    });

    expect(provider).toBeInstanceOf(GeminiProvider);
  });

  it('fails clearly when apiKey is missing', () => {
    const definition = createGeminiProviderDefinition();

    expect(() =>
      definition.createProvider({
        name: 'gemini',
        model: 'gemini-3-flash-preview',
      }),
    ).toThrow('Provider gemini requires apiKey');
  });
});
