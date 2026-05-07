import { describe, expect, it, vi } from 'vitest';
import { AnthropicProvider } from '../provider.js';
import { createAnthropicProviderDefinition } from '../provider-definition.js';

vi.mock('../provider.js', () => {
  const MockAnthropicProvider = vi.fn().mockImplementation((options: object) => ({
    name: 'anthropic',
    options,
  }));
  return { AnthropicProvider: MockAnthropicProvider };
});

describe('createAnthropicProviderDefinition', () => {
  it('requires an API key credential', () => {
    const definition = createAnthropicProviderDefinition();

    expect(definition.credentialRequirement).toBeUndefined();
    expect(definition.requiresApiKey).toBe(true);
    expect(definition.setupHelpLinks).toEqual([
      {
        kind: 'api-key',
        label: 'Anthropic API keys',
        url: 'https://platform.claude.com/settings/keys',
        sourceUrl: 'https://platform.claude.com/docs/en/api/overview',
        lastVerifiedAt: '2026-05-08',
      },
    ]);
  });

  it('creates a provider from an API key', () => {
    const definition = createAnthropicProviderDefinition();

    definition.createProvider({
      name: 'anthropic',
      model: 'claude-sonnet-4-6',
      apiKey: 'sk-ant-test',
    });

    expect(AnthropicProvider).toHaveBeenCalledWith({
      apiKey: 'sk-ant-test',
      defaultModel: 'claude-sonnet-4-6',
    });
  });

  it('rejects missing credentials', () => {
    const definition = createAnthropicProviderDefinition();

    expect(() =>
      definition.createProvider({
        name: 'anthropic',
        model: 'claude-sonnet-4-6',
      }),
    ).toThrow('Provider anthropic requires apiKey');
  });
});
