import { render } from 'ink-testing-library';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

import PendingActionPrompt from '../PendingActionPrompt.js';

import type { IActionRequest } from '@robota-sdk/agent-core';

const delay = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 20));
const ESC = String.fromCharCode(27);
const DOWN = `${ESC}[B`;
const ENTER = '\r';

describe('PendingActionPrompt (CMD-004 unified action renderer)', () => {
  it('single-select: renders options and answers with the chosen value', async () => {
    const onAnswer = vi.fn();
    const request: IActionRequest = {
      id: 'mode',
      title: 'Select mode',
      options: [
        { value: 'plan', label: 'Plan' },
        { value: 'default', label: 'Default' },
      ],
      maxSelect: 1,
    };
    const { stdin, lastFrame } = render(
      <PendingActionPrompt request={request} onAnswer={onAnswer} />,
    );
    expect(lastFrame()).toContain('Select mode');
    expect(lastFrame()).toContain('Plan');

    stdin.write(DOWN);
    await delay();
    stdin.write(ENTER);
    await delay();
    expect(onAnswer).toHaveBeenCalledWith({ type: 'answer', values: ['default'] });
  });

  it('multi-select (maxSelect>1): toggles with Space and confirms with Enter', async () => {
    const onAnswer = vi.fn();
    const request: IActionRequest = {
      id: 'tags',
      title: 'Pick tags',
      options: [
        { value: 'a', label: 'Alpha' },
        { value: 'b', label: 'Beta' },
        { value: 'c', label: 'Gamma' },
      ],
      minSelect: 1,
      maxSelect: 3,
    };
    const { stdin, lastFrame } = render(
      <PendingActionPrompt request={request} onAnswer={onAnswer} />,
    );
    expect(lastFrame()).toContain('[ ] Alpha');

    stdin.write(' ');
    await delay();
    expect(lastFrame()).toContain('[x] Alpha');
    stdin.write(DOWN);
    await delay();
    stdin.write(' ');
    await delay();
    stdin.write(ENTER);
    await delay();
    expect(onAnswer).toHaveBeenCalledWith({ type: 'answer', values: ['a', 'b'] });
  });

  it('free-text with masked: hides input and answers with typed text', async () => {
    const onAnswer = vi.fn();
    const request: IActionRequest = {
      id: 'apiKey',
      title: 'Enter API key',
      allowFreeText: true,
      masked: true,
    };
    const { stdin, lastFrame } = render(
      <PendingActionPrompt request={request} onAnswer={onAnswer} />,
    );
    expect(lastFrame()).toContain('Enter API key');

    stdin.write('sk-secret');
    await delay();
    expect(lastFrame()).not.toContain('sk-secret');
    expect(lastFrame()).toContain('*'.repeat('sk-secret'.length));
    stdin.write(ENTER);
    await delay();
    expect(onAnswer).toHaveBeenCalledWith({ type: 'answer', values: [], text: 'sk-secret' });
  });

  it('Esc cancels the request (resolves cancelled)', async () => {
    const onAnswer = vi.fn();
    const request: IActionRequest = {
      id: 'exit',
      title: 'Exit?',
      options: [
        { value: 'yes', label: 'Yes' },
        { value: 'no', label: 'No' },
      ],
      maxSelect: 1,
    };
    const { stdin } = render(<PendingActionPrompt request={request} onAnswer={onAnswer} />);
    stdin.write(ESC);
    await delay();
    expect(onAnswer).toHaveBeenCalledWith({ type: 'cancelled' });
  });

  it('single-select + allowFreeText: "type a custom answer" opens text; Esc returns to picker (not cancel)', async () => {
    const onAnswer = vi.fn();
    const request: IActionRequest = {
      id: 'provider',
      title: 'Select provider',
      options: [{ value: 'openai', label: 'OpenAI' }],
      maxSelect: 1,
      allowFreeText: true,
    };
    const { stdin, lastFrame } = render(
      <PendingActionPrompt request={request} onAnswer={onAnswer} />,
    );
    expect(lastFrame()).toContain('Type a custom answer');

    stdin.write(DOWN); // move to the synthetic "type a custom answer" entry
    await delay();
    stdin.write(ENTER); // enter free-text mode
    await delay();
    stdin.write(ESC); // Esc here returns to the picker, does NOT cancel the request
    await delay();
    expect(onAnswer).not.toHaveBeenCalled();
    expect(lastFrame()).toContain('OpenAI'); // back at the picker
  });
});
