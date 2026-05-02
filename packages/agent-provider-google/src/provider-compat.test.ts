import { describe, expect, it } from 'vitest';
import { GeminiProvider, createGeminiProviderDefinition } from '@robota-sdk/agent-provider-gemini';
import { GoogleProvider } from './provider.js';

describe('Google provider compatibility package', () => {
  it('keeps GoogleProvider as a compatibility subclass of GeminiProvider', () => {
    const provider = new GoogleProvider({ apiKey: 'test-key' });

    expect(provider).toBeInstanceOf(GeminiProvider);
    expect(provider.name).toBe('google');
  });

  it('re-exports the canonical Gemini provider definition metadata', () => {
    const definition = createGeminiProviderDefinition();

    expect(definition.type).toBe('gemini');
    expect(definition.aliases).toContain('google');
  });
});
