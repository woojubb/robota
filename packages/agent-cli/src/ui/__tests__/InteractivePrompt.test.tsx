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
});
