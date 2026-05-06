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
    activeToolCount: 0,
    activeBackgroundTaskCount: 0,
    hasPendingPrompt: false,
    contextPercentage: 10,
    contextUsedTokens: 1000,
    contextMaxTokens: 200000,
  };

  it('renders without session name', () => {
    const { lastFrame } = render(<StatusBar {...baseProps} />);
    const frame = lastFrame()!;
    expect(frame).toContain('test-model');
    expect(frame).not.toContain('Mode: default');
  });

  it('hides default permission mode', () => {
    const { lastFrame } = render(<StatusBar {...baseProps} permissionMode="default" />);
    const frame = lastFrame()!;
    expect(frame).not.toContain('Mode:');
    expect(frame).not.toContain('default');
  });

  it('shows non-default permission modes', () => {
    for (const permissionMode of ['plan', 'acceptEdits', 'bypassPermissions'] as const) {
      const { lastFrame, unmount } = render(
        <StatusBar {...baseProps} permissionMode={permissionMode} />,
      );
      const frame = lastFrame()!;
      expect(frame).toContain('Mode:');
      expect(frame).toContain(permissionMode);
      unmount();
    }
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

  it('renders active provider profile identity when provided', () => {
    const { lastFrame } = render(
      <StatusBar {...baseProps} providerProfileName="claude-sonnet-4-6" providerType="anthropic" />,
    );
    const frame = lastFrame()!;
    expect(frame).toContain('claude-sonnet-4-6');
    expect(frame).toContain('anthropic');
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
    expect(frame).not.toContain('Activity:');
    expect(frame).toContain('Thinking');
    expect(frame.indexOf('Thinking')).toBeLessThan(frame.indexOf('test-model'));
  });

  it('does not duplicate thinking state next to the message count', () => {
    const { lastFrame } = render(<StatusBar {...baseProps} isThinking={true} />);
    const frame = lastFrame()!;
    expect(frame).toContain('Thinking');
    expect(frame).not.toContain('thinking...');
    expect(frame).toContain('msgs: 5');
  });

  it('hides the lower-right prompt-processing indicator while idle', () => {
    const { lastFrame } = render(<StatusBar {...baseProps} isThinking={false} />);
    const frame = lastFrame()!;
    expect(frame).not.toContain('thinking...');
  });

  it('prioritizes tool activity in the primary scan path', () => {
    const { lastFrame } = render(
      <StatusBar
        {...baseProps}
        isThinking={true}
        activeToolCount={2}
        activeBackgroundTaskCount={1}
        hasPendingPrompt={true}
      />,
    );
    const frame = lastFrame()!;
    expect(frame).not.toContain('Activity:');
    expect(frame).toContain('Tools x2');
    expect(frame).toContain('queued');
    expect(frame).not.toContain('thinking...');
    expect(frame.indexOf('Tools x2')).toBeLessThan(frame.indexOf('test-model'));
    expect(frame).not.toContain('Thinking...');
  });

  it('shows background activity when no foreground execution is active', () => {
    const { lastFrame } = render(<StatusBar {...baseProps} activeBackgroundTaskCount={3} />);
    const frame = lastFrame()!;
    expect(frame).toContain('Background x3');
    expect(frame.indexOf('Background x3')).toBeLessThan(frame.indexOf('test-model'));
  });

  it('keeps the activity segment compact for narrow terminals', () => {
    const { lastFrame } = render(
      <StatusBar
        {...baseProps}
        isThinking={true}
        activeToolCount={12}
        activeBackgroundTaskCount={9}
        hasPendingPrompt={true}
      />,
    );
    const frame = lastFrame()!;
    const firstLine = frame.split('\n')[1] ?? '';
    const activityEnd = firstLine.indexOf('test-model');
    const activitySegment = firstLine.slice(0, activityEnd);
    expect(activitySegment).toContain('Tools x12');
    expect(activitySegment.length).toBeLessThanOrEqual(40);
  });

  it('renders git branch when provided', () => {
    const { lastFrame } = render(<StatusBar {...baseProps} gitBranch="feat/status-line" />);
    const frame = lastFrame()!;
    expect(frame).toContain('feat/status-line');
  });

  it('does not render git branch when visibility is disabled', () => {
    const { lastFrame } = render(
      <StatusBar {...baseProps} gitBranch="feat/status-line" showGitBranch={false} />,
    );
    const frame = lastFrame()!;
    expect(frame).not.toContain('feat/status-line');
  });
});
