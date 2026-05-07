import { describe, expect, it, vi } from 'vitest';
import {
  createProviderSetupFlow,
  formatProviderSetupSelectionPrompt,
  formatProviderSetupPromptLabel,
  getProviderSetupStep,
  resolveProviderSetupSelection,
  runProviderSetupPromptFlow,
  submitProviderSetupValue,
} from '../provider-setup-flow.js';
import type { IProviderDefinition } from '../provider-definition.js';

const openaiDefaults = {
  apiKey: '$ENV:OPENAI_API_KEY',
};

const providerDefinitions: readonly IProviderDefinition[] = [
  {
    type: 'openai',
    displayName: 'OpenAI',
    description: 'Use OpenAI Responses API',
    defaults: openaiDefaults,
    setupSteps: [
      {
        key: 'model',
        title: 'OpenAI model',
        required: true,
      },
      {
        key: 'apiKey',
        title: 'OpenAI API key',
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
    displayName: 'Anthropic',
    description: 'Use Claude models through Anthropic',
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
  it('formats provider selection prompts from injected provider definitions', () => {
    expect(formatProviderSetupSelectionPrompt(providerDefinitions)).toBe(
      [
        '  Select provider:',
        '    1. OpenAI (openai) - Use OpenAI Responses API',
        '    2. Anthropic (anthropic) - Use Claude models through Anthropic',
        '  Provider [1-2] (default: 1): ',
      ].join('\n'),
    );
  });

  it('resolves provider selection by index or type without provider-specific branches', () => {
    expect(resolveProviderSetupSelection('2', providerDefinitions)).toBe('anthropic');
    expect(resolveProviderSetupSelection('openai', providerDefinitions)).toBe('openai');
    expect(resolveProviderSetupSelection('', providerDefinitions)).toBe('openai');
    expect(() => resolveProviderSetupSelection('gemma', providerDefinitions)).toThrow(
      'Unknown provider: gemma',
    );
  });

  it('builds OpenAI setup input from model and default API key submissions', () => {
    let state = createProviderSetupFlow('openai', providerDefinitions);
    expect(getProviderSetupStep(state)).toMatchObject({
      key: 'model',
      required: true,
    });

    const emptyModelResult = submitProviderSetupValue(state, '');
    expect(emptyModelResult.status).toBe('error');

    const modelResult = submitProviderSetupValue(state, 'gpt-4o');
    expect(modelResult.status).toBe('next');
    if (modelResult.status !== 'next') throw new Error('expected next');
    state = modelResult.state;

    const apiKeyResult = submitProviderSetupValue(state, '');
    expect(apiKeyResult).toEqual({
      status: 'complete',
      input: {
        profile: 'gpt-4o',
        type: 'openai',
        model: 'gpt-4o',
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

  it('suggests unique profile names from model ids without exposing credentials', () => {
    let state = createProviderSetupFlow('anthropic', providerDefinitions, {
      existingProfileNames: ['claude-sonnet-4-6'],
    });
    const apiKeyResult = submitProviderSetupValue(state, 'sk-ant-test');
    expect(apiKeyResult.status).toBe('next');
    if (apiKeyResult.status !== 'next') throw new Error('expected next');
    state = apiKeyResult.state;

    const modelResult = submitProviderSetupValue(state, '');

    expect(modelResult).toEqual({
      status: 'complete',
      input: {
        profile: 'claude-sonnet-4-6-2',
        type: 'anthropic',
        model: 'claude-sonnet-4-6',
        apiKey: 'sk-ant-test',
        setCurrent: true,
      },
    });
  });

  it('builds edit input for a fixed profile from current profile values', () => {
    let state = createProviderSetupFlow('anthropic', providerDefinitions, {
      profileName: 'work-claude',
      setCurrent: false,
      initialValues: {
        apiKey: '$ENV:ANTHROPIC_API_KEY',
        model: 'claude-sonnet-4-6',
      },
    });

    expect(getProviderSetupStep(state)).toMatchObject({
      key: 'apiKey',
      defaultValue: '$ENV:ANTHROPIC_API_KEY',
      required: false,
    });

    const apiKeyResult = submitProviderSetupValue(state, '');
    expect(apiKeyResult.status).toBe('next');
    if (apiKeyResult.status !== 'next') throw new Error('expected next');
    state = apiKeyResult.state;

    const modelResult = submitProviderSetupValue(state, 'claude-opus-4-5');

    expect(modelResult).toEqual({
      status: 'complete',
      input: {
        profile: 'work-claude',
        type: 'anthropic',
        model: 'claude-opus-4-5',
        apiKey: '$ENV:ANTHROPIC_API_KEY',
        setCurrent: false,
      },
    });
  });

  it('runs prompt input with masked API key steps', async () => {
    const promptInput = vi.fn(async (label: string) => (label.includes('model') ? 'gpt-4o' : ''));

    const input = await runProviderSetupPromptFlow('openai', promptInput, providerDefinitions);

    expect(input.model).toBe('gpt-4o');
    expect(input.profile).toBe('gpt-4o');
    expect(input.apiKey).toBe(openaiDefaults.apiKey);
    expect(promptInput).toHaveBeenNthCalledWith(
      1,
      formatProviderSetupPromptLabel({
        key: 'model',
        title: 'OpenAI model',
        required: true,
      }),
      false,
    );
    expect(promptInput).toHaveBeenNthCalledWith(
      2,
      formatProviderSetupPromptLabel({
        key: 'apiKey',
        title: 'OpenAI API key',
        defaultValue: openaiDefaults.apiKey,
        masked: true,
      }),
      true,
    );
  });
});
