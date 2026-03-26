import React from 'react';
import { render } from 'ink-testing-library';
import { describe, it, expect } from 'vitest';
import StatusBar from '../StatusBar.js';

describe('StatusBar', () => {
  const baseProps = {
    permissionMode: 'default' as const,
    modelName: 'test-model',
    sessionId: 'sess-1',
    messageCount: 5,
    isThinking: false,
    contextPercentage: 10,
    contextUsedTokens: 1000,
    contextMaxTokens: 200000,
  };

  it('renders without session name', () => {
    const { lastFrame } = render(<StatusBar {...baseProps} />);
    const frame = lastFrame()!;
    expect(frame).toContain('Mode:');
    expect(frame).toContain('default');
  });

  it('renders session name when provided', () => {
    const { lastFrame } = render(<StatusBar {...baseProps} sessionName="my-feature" />);
    const frame = lastFrame()!;
    expect(frame).toContain('my-feature');
  });

  it('does not show session name when undefined', () => {
    const { lastFrame } = render(<StatusBar {...baseProps} sessionName={undefined} />);
    const frame = lastFrame()!;
    // Should not have extra separator for missing name
    expect(frame).not.toContain('my-feature');
  });

  it('renders model name', () => {
    const { lastFrame } = render(<StatusBar {...baseProps} />);
    const frame = lastFrame()!;
    expect(frame).toContain('test-model');
  });

  it('renders message count', () => {
    const { lastFrame } = render(<StatusBar {...baseProps} />);
    const frame = lastFrame()!;
    expect(frame).toContain('msgs: 5');
  });

  it('shows thinking indicator when isThinking is true', () => {
    const { lastFrame } = render(<StatusBar {...baseProps} isThinking={true} />);
    const frame = lastFrame()!;
    expect(frame).toContain('Thinking');
  });
});
