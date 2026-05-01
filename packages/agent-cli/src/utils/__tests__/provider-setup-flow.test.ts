import { describe, expect, it, vi } from 'vitest';
import {
  createProviderSetupFlow,
  formatProviderSetupPromptLabel,
  getProviderSetupStep,
  runProviderSetupPromptFlow,
  submitProviderSetupValue,
} from '../provider-setup-flow.js';
import type { IProviderDefinition } from '../provider-definition.js';

const openaiDefaults = {
  model: 'supergemma4-26b-uncensored-v2',
  apiKey: 'lm-studio',
  baseURL: 'http://localhost:1234/v1',
};

const providerDefinitions: readonly IProviderDefinition[] = [
  {
    type: 'openai',
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
    type: 'anthropic',
    defaults: { model: 'claude-sonnet-4-6' },
    setupSteps: [
      { key: 'apiKey', title: 'Anthropic API key', required: true, masked: true },
      { key: 'model', title: 'Anthropic model', defaultValue: 'claude-sonnet-4-6' },
    ],
    requiresApiKey: true,
    createProvider: () => {
      throw new Error('not used');
    },
  },
];

describe('provider setup prompt flow', () => {
  it('builds OpenAI-compatible setup input from defaulted prompt submissions', () => {
    let state = createProviderSetupFlow('openai', providerDefinitions);
    expect(getProviderSetupStep(state)).toMatchObject({
      key: 'baseURL',
      defaultValue: openaiDefaults.baseURL,
    });

    const baseURLResult = submitProviderSetupValue(state, '');
    expect(baseURLResult.status).toBe('next');
    if (baseURLResult.status !== 'next') throw new Error('expected next');
    state = baseURLResult.state;

    const modelResult = submitProviderSetupValue(state, '');
    expect(modelResult.status).toBe('next');
    if (modelResult.status !== 'next') throw new Error('expected next');
    state = modelResult.state;

    const apiKeyResult = submitProviderSetupValue(state, '');
    expect(apiKeyResult).toEqual({
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

  it('keeps Anthropic API key validation outside the TUI component', () => {
    const state = createProviderSetupFlow('anthropic', providerDefinitions);

    expect(submitProviderSetupValue(state, '')).toEqual({
      status: 'error',
      state,
      message: 'Required',
    });
  });

  it('runs prompt input with masked API key steps', async () => {
    const promptInput = vi.fn(async () => '');

    const input = await runProviderSetupPromptFlow('openai', promptInput, providerDefinitions);

    expect(input.apiKey).toBe(openaiDefaults.apiKey);
    expect(promptInput).toHaveBeenNthCalledWith(
      1,
      formatProviderSetupPromptLabel({
        key: 'baseURL',
        title: 'OpenAI-compatible base URL',
        defaultValue: openaiDefaults.baseURL,
      }),
      false,
    );
    expect(promptInput).toHaveBeenNthCalledWith(
      3,
      formatProviderSetupPromptLabel({
        key: 'apiKey',
        title: 'OpenAI-compatible API key',
        defaultValue: openaiDefaults.apiKey,
        masked: true,
      }),
      true,
    );
  });
});
