import React from 'react';
import { render } from 'ink-testing-library';
import { describe, it, expect, vi } from 'vitest';
import ProviderSetupPrompt from '../ProviderSetupPrompt.js';
import {
  DEFAULT_OPENAI_COMPATIBLE_API_KEY,
  DEFAULT_OPENAI_COMPATIBLE_BASE_URL,
  DEFAULT_PROVIDER_MODELS,
} from '../../utils/provider-settings.js';

const delay = () => new Promise((resolve) => setTimeout(resolve, 20));

describe('ProviderSetupPrompt', () => {
  it('submits OpenAI-compatible defaults when fields are left empty', async () => {
    const onSubmit = vi.fn();
    const { stdin } = render(
      <ProviderSetupPrompt type="openai" onSubmit={onSubmit} onCancel={() => {}} />,
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
      baseURL: DEFAULT_OPENAI_COMPATIBLE_BASE_URL,
      model: DEFAULT_PROVIDER_MODELS.openai,
      apiKey: DEFAULT_OPENAI_COMPATIBLE_API_KEY,
      setCurrent: true,
    });
  });

  it('requires an Anthropic API key before model selection', async () => {
    const onSubmit = vi.fn();
    const { stdin, lastFrame } = render(
      <ProviderSetupPrompt type="anthropic" onSubmit={onSubmit} onCancel={() => {}} />,
    );

    stdin.write('\r');
    await delay();

    expect(onSubmit).not.toHaveBeenCalled();
    expect(lastFrame()!).toContain('Required');
  });
});
