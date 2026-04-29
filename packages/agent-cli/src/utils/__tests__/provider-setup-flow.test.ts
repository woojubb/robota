import { describe, expect, it, vi } from 'vitest';
import {
  createProviderSetupFlow,
  formatProviderSetupPromptLabel,
  getProviderSetupStep,
  runProviderSetupPromptFlow,
  submitProviderSetupValue,
} from '../provider-setup-flow.js';
import {
  DEFAULT_OPENAI_COMPATIBLE_API_KEY,
  DEFAULT_OPENAI_COMPATIBLE_BASE_URL,
  DEFAULT_PROVIDER_MODELS,
} from '../provider-settings.js';

describe('provider setup prompt flow', () => {
  it('builds OpenAI-compatible setup input from defaulted prompt submissions', () => {
    let state = createProviderSetupFlow('openai');
    expect(getProviderSetupStep(state)).toMatchObject({
      key: 'baseURL',
      defaultValue: DEFAULT_OPENAI_COMPATIBLE_BASE_URL,
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
        baseURL: DEFAULT_OPENAI_COMPATIBLE_BASE_URL,
        model: DEFAULT_PROVIDER_MODELS.openai,
        apiKey: DEFAULT_OPENAI_COMPATIBLE_API_KEY,
        setCurrent: true,
      },
    });
  });

  it('keeps Anthropic API key validation outside the TUI component', () => {
    const state = createProviderSetupFlow('anthropic');

    expect(submitProviderSetupValue(state, '')).toEqual({
      status: 'error',
      state,
      message: 'Required',
    });
  });

  it('runs prompt input with masked API key steps', async () => {
    const promptInput = vi.fn(async () => '');

    const input = await runProviderSetupPromptFlow('openai', promptInput);

    expect(input.apiKey).toBe(DEFAULT_OPENAI_COMPATIBLE_API_KEY);
    expect(promptInput).toHaveBeenNthCalledWith(
      1,
      formatProviderSetupPromptLabel({
        key: 'baseURL',
        title: 'OpenAI-compatible base URL',
        defaultValue: DEFAULT_OPENAI_COMPATIBLE_BASE_URL,
      }),
      false,
    );
    expect(promptInput).toHaveBeenNthCalledWith(
      3,
      formatProviderSetupPromptLabel({
        key: 'apiKey',
        title: 'OpenAI-compatible API key',
        defaultValue: DEFAULT_OPENAI_COMPATIBLE_API_KEY,
        masked: true,
      }),
      true,
    );
  });
});
