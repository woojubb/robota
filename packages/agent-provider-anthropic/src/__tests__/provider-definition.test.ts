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
  it('allows either API key or auth token credentials', () => {
    const definition = createAnthropicProviderDefinition();

    expect(definition.credentialRequirement).toEqual({ anyOf: ['apiKey', 'authToken'] });
    expect(definition.requiresApiKey).toBeUndefined();
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

  it('creates a provider from an auth token', () => {
    const definition = createAnthropicProviderDefinition();

    definition.createProvider({
      name: 'anthropic',
      model: 'claude-sonnet-4-6',
      authToken: 'sk-ant-oat01-test',
    });

    expect(AnthropicProvider).toHaveBeenCalledWith({
      authToken: 'sk-ant-oat01-test',
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
    ).toThrow('Provider anthropic requires apiKey or authToken');
  });
});
