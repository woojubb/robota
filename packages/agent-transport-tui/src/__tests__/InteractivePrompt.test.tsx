import React from 'react';
import { render } from 'ink-testing-library';
import { describe, expect, it, vi } from 'vitest';
import InteractivePrompt from '../InteractivePrompt.js';

const delay = () => new Promise((resolve) => setTimeout(resolve, 20));

describe('InteractivePrompt', () => {
  it('renders a generic choice prompt and submits the selected value', async () => {
    const onSubmit = vi.fn();
    const { stdin, lastFrame } = render(
      <InteractivePrompt
        prompt={{
          kind: 'choice',
          title: 'Select item',
          options: [
            { value: 'first', label: 'First item' },
            { value: 'second', label: 'Second item' },
          ],
        }}
        onSubmit={onSubmit}
        onCancel={() => {}}
      />,
    );

    expect(lastFrame()!).toContain('Select item');
    expect(lastFrame()!).toContain('First item');

    stdin.write('\u001B[B');
    await delay();
    stdin.write('\r');
    await delay();

    expect(onSubmit).toHaveBeenCalledWith('second');
  });

  it('renders a generic text prompt and validates submitted values', async () => {
    const onSubmit = vi.fn();
    const { stdin, lastFrame } = render(
      <InteractivePrompt
        prompt={{
          kind: 'text',
          title: 'Secret',
          masked: true,
          validate: (value) => (value.length === 0 ? 'Required' : undefined),
        }}
        onSubmit={onSubmit}
        onCancel={() => {}}
      />,
    );

    stdin.write('\r');
    await delay();
    expect(onSubmit).not.toHaveBeenCalled();
    expect(lastFrame()!).toContain('Required');

    stdin.write('abc');
    await delay();
    stdin.write('\r');
    await delay();
    expect(onSubmit).toHaveBeenCalledWith('abc');
  });

  it('renders generic prompt descriptions without command-specific UI branches', () => {
    const { lastFrame } = render(
      <InteractivePrompt
        prompt={{
          kind: 'text',
          title: 'OpenAI API key',
          description:
            'Setup help: API key: OpenAI API keys - https://platform.openai.com/api-keys',
        }}
        onSubmit={() => {}}
        onCancel={() => {}}
      />,
    );

    expect(lastFrame()!).toContain('OpenAI API key');
    expect(lastFrame()!).toContain('OpenAI API keys');
    expect(lastFrame()!).toContain('https://platform.openai.com/api-keys');
  });
});
