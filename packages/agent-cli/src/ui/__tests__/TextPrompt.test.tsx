import React from 'react';
import { render } from 'ink-testing-library';
import { describe, it, expect } from 'vitest';
import TextPrompt from '../TextPrompt.js';

describe('TextPrompt', () => {
  it('renders title', () => {
    const { lastFrame } = render(
      <TextPrompt title="Enter URL" onSubmit={() => {}} onCancel={() => {}} />,
    );
    expect(lastFrame()!).toContain('Enter URL');
  });

  it('renders placeholder when provided', () => {
    const { lastFrame } = render(
      <TextPrompt title="Enter" placeholder="owner/repo" onSubmit={() => {}} onCancel={() => {}} />,
    );
    expect(lastFrame()!).toContain('owner/repo');
  });

  it('calls onCancel on Escape', async () => {
    let cancelled = false;
    const { stdin } = render(
      <TextPrompt
        title="Enter"
        onSubmit={() => {}}
        onCancel={() => {
          cancelled = true;
        }}
      />,
    );
    stdin.write('\x1B');
    await new Promise((r) => setTimeout(r, 50));
    expect(cancelled).toBe(true);
  });

  it('calls onSubmit with value on Enter', () => {
    let submitted = '';
    const { stdin } = render(
      <TextPrompt
        title="Enter"
        onSubmit={(v) => {
          submitted = v;
        }}
        onCancel={() => {}}
      />,
    );
    stdin.write('hello');
    stdin.write('\r');
    expect(submitted).toBe('hello');
  });

  it('shows validation error and blocks submit', () => {
    let submitted = false;
    const validate = (v: string) => (v.length < 3 ? 'Too short' : undefined);
    const { stdin, lastFrame } = render(
      <TextPrompt
        title="Enter"
        onSubmit={() => {
          submitted = true;
        }}
        onCancel={() => {}}
        validate={validate}
      />,
    );
    stdin.write('ab');
    stdin.write('\r');
    expect(submitted).toBe(false);
    expect(lastFrame()!).toContain('Too short');
  });
});
