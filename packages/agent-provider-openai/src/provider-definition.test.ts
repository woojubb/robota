import { describe, expect, it } from 'vitest';
import { createOpenAIProviderDefinition, DEFAULT_OPENAI_PROVIDER_MODEL } from './index';

describe('createOpenAIProviderDefinition', () => {
  it('does not provide a Gemma model-family default', () => {
    const definition = createOpenAIProviderDefinition();
    const modelStep = definition.setupSteps?.find((step) => step.key === 'model');

    expect(DEFAULT_OPENAI_PROVIDER_MODEL).toBeUndefined();
    expect(definition.defaults?.model).toBeUndefined();
    expect(modelStep).toMatchObject({
      key: 'model',
      title: 'OpenAI-compatible model',
      required: true,
    });
    expect(modelStep?.defaultValue).toBeUndefined();
  });
});
