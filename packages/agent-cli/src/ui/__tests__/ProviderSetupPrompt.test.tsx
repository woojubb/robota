import React from 'react';
import { render } from 'ink-testing-library';
import { describe, it, expect, vi } from 'vitest';
import ProviderSetupPrompt from '../ProviderSetupPrompt.js';
import type { IProviderDefinition } from '../../utils/provider-definition.js';

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

const delay = () => new Promise((resolve) => setTimeout(resolve, 20));

describe('ProviderSetupPrompt', () => {
  it('submits OpenAI-compatible defaults when fields are left empty', async () => {
    const onSubmit = vi.fn();
    const { stdin } = render(
      <ProviderSetupPrompt
        type="openai"
        providerDefinitions={providerDefinitions}
        onSubmit={onSubmit}
        onCancel={() => {}}
      />,
    );

    stdin.write('\r');
    await delay();
    stdin.write('\r');
    await delay();
    stdin.write('\r');
    await delay();

    expect(onSubmit).toHaveBeenCalledWith({
      profile: 'openai',
      type: 'openai',
      baseURL: openaiDefaults.baseURL,
      model: openaiDefaults.model,
      apiKey: openaiDefaults.apiKey,
      setCurrent: true,
    });
  });

  it('requires an Anthropic API key before model selection', async () => {
    const onSubmit = vi.fn();
    const { stdin, lastFrame } = render(
      <ProviderSetupPrompt
        type="anthropic"
        providerDefinitions={providerDefinitions}
        onSubmit={onSubmit}
        onCancel={() => {}}
      />,
    );

    stdin.write('\r');
    await delay();

    expect(onSubmit).not.toHaveBeenCalled();
    expect(lastFrame()!).toContain('Required');
  });
});
