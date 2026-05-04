import { describe, expect, it } from 'vitest';
import {
  createOpenAIProviderDefinition,
  DEFAULT_OPENAI_PROVIDER_API_KEY_REFERENCE,
  DEFAULT_OPENAI_PROVIDER_MODEL,
} from './index';

describe('createOpenAIProviderDefinition', () => {
  it('uses official OpenAI setup defaults without a model-family default', () => {
    const definition = createOpenAIProviderDefinition();
    const modelStep = definition.setupSteps?.find((step) => step.key === 'model');
    const apiKeyStep = definition.setupSteps?.find((step) => step.key === 'apiKey');

    expect(DEFAULT_OPENAI_PROVIDER_MODEL).toBeUndefined();
    expect(definition.defaults?.model).toBeUndefined();
    expect(definition.defaults?.apiKey).toBe(DEFAULT_OPENAI_PROVIDER_API_KEY_REFERENCE);
    expect(definition.defaults?.baseURL).toBeUndefined();
    expect(definition.displayName).toBe('OpenAI');
    expect(modelStep).toMatchObject({
      key: 'model',
      title: 'OpenAI model',
      required: true,
    });
    expect(modelStep?.defaultValue).toBeUndefined();
    expect(apiKeyStep).toMatchObject({
      key: 'apiKey',
      title: 'OpenAI API key',
      defaultValue: '$ENV:OPENAI_API_KEY',
    });
    expect(typeof definition.refreshModelCatalog).toBe('function');
  });

  it('passes explicit apiSurface provider options into construction', () => {
    const definition = createOpenAIProviderDefinition();

    const provider = definition.createProvider({
      name: 'openai',
      model: 'gpt-4o',
      apiKey: 'sk-test',
      options: { apiSurface: 'chat-completions' },
    });

    expect(provider.name).toBe('openai');
  });

  it('rejects native web tools for OpenAI-compatible baseURL profiles', () => {
    const definition = createOpenAIProviderDefinition();

    expect(() =>
      definition.createProvider({
        name: 'openai',
        model: 'local-model',
        apiKey: 'lm-studio',
        baseURL: 'http://localhost:1234/v1',
        options: {
          builtInWebTools: {
            webSearch: true,
            webFetch: true,
          },
        },
      }),
    ).toThrow(
      'Provider openai profile uses an OpenAI-compatible Chat Completions endpoint; native web search/fetch is not supported for this profile.',
    );
  });
});
