import { describe, expect, it } from 'vitest';
import type { IProviderDefinition } from '../provider-definition.js';
import {
  startProviderSetupInteraction,
  submitProviderSetupInteractionValue,
} from '../provider-setup-interaction.js';

const openaiDefaults = {
  model: 'supergemma4-26b-uncensored-v2',
  apiKey: 'lm-studio',
  baseURL: 'http://localhost:1234/v1',
};

const providerDefinitions: readonly IProviderDefinition[] = [
  {
    type: 'openai',
    displayName: 'OpenAI Compatible',
    description: 'Use OpenAI or an OpenAI-compatible endpoint',
    defaults: openaiDefaults,
    setupSteps: [
      {
        key: 'baseURL',
        title: 'OpenAI-compatible base URL',
        defaultValue: openaiDefaults.baseURL,
      },
      {
        key: 'model',
        title: 'OpenAI-compatible model',
        defaultValue: openaiDefaults.model,
      },
      {
        key: 'apiKey',
        title: 'OpenAI-compatible API key',
        defaultValue: openaiDefaults.apiKey,
        masked: true,
      },
    ],
    requiresApiKey: true,
    createProvider: () => {
      throw new Error('not used');
    },
  },
  {
    type: 'qwen',
    displayName: 'Qwen',
    description: 'Use Alibaba Cloud Model Studio',
    defaults: {
      model: 'qwen3.6-plus-2026-04-02',
      apiKey: '$ENV:DASHSCOPE_API_KEY',
      baseURL: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
    },
    setupSteps: [
      {
        key: 'baseURL',
        title: 'Qwen base URL',
        defaultValue: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
      },
      { key: 'model', title: 'Qwen model', defaultValue: 'qwen3.6-plus-2026-04-02' },
      {
        key: 'apiKey',
        title: 'Qwen API key or $ENV reference',
        defaultValue: '$ENV:DASHSCOPE_API_KEY',
        masked: true,
      },
    ],
    requiresApiKey: true,
    createProvider: () => {
      throw new Error('not used');
    },
  },
];

describe('provider setup interaction', () => {
  it('maps provider definitions to a generic choice prompt', () => {
    const result = startProviderSetupInteraction(providerDefinitions);

    expect(result).toMatchObject({
      status: 'prompt',
      prompt: {
        kind: 'choice',
        title: 'Select provider',
        options: [
          {
            value: 'openai',
            label: 'OpenAI Compatible (openai) - Use OpenAI or an OpenAI-compatible endpoint',
          },
          {
            value: 'qwen',
            label: 'Qwen (qwen) - Use Alibaba Cloud Model Studio',
          },
        ],
      },
    });
  });

  it('continues from provider selection to provider setup text prompts', () => {
    const result = startProviderSetupInteraction(providerDefinitions);
    if (result.status !== 'prompt') throw new Error('expected prompt');

    const next = submitProviderSetupInteractionValue(result.state, 'qwen');

    expect(next).toMatchObject({
      status: 'prompt',
      prompt: {
        kind: 'text',
        title: 'Qwen base URL',
        placeholder: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
        allowEmpty: true,
      },
    });
  });

  it('returns setup input after all provider field prompts complete', () => {
    const start = startProviderSetupInteraction(providerDefinitions, 'openai');
    if (start.status !== 'prompt') throw new Error('expected prompt');

    const baseURL = submitProviderSetupInteractionValue(start.state, '');
    if (baseURL.status !== 'prompt') throw new Error('expected prompt');
    const model = submitProviderSetupInteractionValue(baseURL.state, '');
    if (model.status !== 'prompt') throw new Error('expected prompt');
    const apiKey = submitProviderSetupInteractionValue(model.state, '');

    expect(apiKey).toEqual({
      status: 'complete',
      input: {
        profile: 'openai',
        type: 'openai',
        baseURL: openaiDefaults.baseURL,
        model: openaiDefaults.model,
        apiKey: openaiDefaults.apiKey,
        setCurrent: true,
      },
    });
  });
});
