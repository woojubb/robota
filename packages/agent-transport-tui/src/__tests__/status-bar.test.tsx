import React from 'react';
import { render } from 'ink-testing-library';
import { describe, it, expect, vi } from 'vitest';
import StatusBar from '../StatusBar.js';
import SessionStatusBar from '../SessionStatusBar.js';
import { ScreenReaderProvider } from '../screen-reader-context.js';
import { TuiCliAdapterProvider } from '../tui-cli-adapter-context.js';
import type { ITuiCliAdapter } from '../tui-cli-adapter.js';

describe('StatusBar', () => {
  const baseProps = {
    permissionMode: 'default' as const,
    modelName: 'test-model',
    sessionId: 'sess-1',
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

  it('renders provider display name and model when provided', () => {
    const { lastFrame } = render(<StatusBar {...baseProps} providerDisplayName="Anthropic" />);
    const frame = lastFrame()!;
    expect(frame).toContain('Anthropic');
    expect(frame).toContain('test-model');
  });

  it('does not render message count in the status bar', () => {
    const { lastFrame } = render(<StatusBar {...baseProps} />);
    const frame = lastFrame()!;
    expect(frame).not.toContain('msgs:');
  });

  it('shows thinking indicator when isThinking is true', () => {
    const { lastFrame } = render(<StatusBar {...baseProps} isThinking={true} />);
    const frame = lastFrame()!;
    expect(frame).not.toContain('Activity:');
    expect(frame).toContain('Thinking');
    expect(frame.indexOf('Thinking')).toBeLessThan(frame.indexOf('test-model'));
  });

  it('does not duplicate thinking state in secondary status text', () => {
    const { lastFrame } = render(<StatusBar {...baseProps} isThinking={true} />);
    const frame = lastFrame()!;
    expect(frame).toContain('Thinking');
    expect(frame).not.toContain('thinking...');
    expect(frame).not.toContain('msgs:');
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
    expect(frame).toContain('Tools (2)');
    expect(frame).not.toContain('Tools x2');
    expect(frame).toContain('queued');
    expect(frame).not.toContain('thinking...');
    expect(frame.indexOf('Tools (2)')).toBeLessThan(frame.indexOf('test-model'));
    expect(frame).not.toContain('Thinking...');
  });

  it('shows background activity when no foreground execution is active', () => {
    const { lastFrame } = render(<StatusBar {...baseProps} activeBackgroundTaskCount={3} />);
    const frame = lastFrame()!;
    expect(frame).toContain('Background (3)');
    expect(frame.indexOf('Background (3)')).toBeLessThan(frame.indexOf('test-model'));
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
    const firstLine = frame.split('\n')[0] ?? '';
    const activityEnd = firstLine.indexOf('test-model');
    const activitySegment = firstLine.slice(0, activityEnd);
    expect(activitySegment).toContain('Tools (12)');
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

  it('TC-03: shows the active preset id when set and non-default', () => {
    const { lastFrame } = render(<StatusBar {...baseProps} activePresetId="autonomous-builder" />);
    const frame = lastFrame()!;
    expect(frame).toContain('Preset:');
    expect(frame).toContain('autonomous-builder');
  });

  it('TC-03: hides the default active preset', () => {
    const { lastFrame } = render(<StatusBar {...baseProps} activePresetId="default" />);
    const frame = lastFrame()!;
    expect(frame).not.toContain('Preset:');
  });

  it('TC-03: hides the preset label when no active preset is provided', () => {
    const { lastFrame } = render(<StatusBar {...baseProps} activePresetId={undefined} />);
    const frame = lastFrame()!;
    expect(frame).not.toContain('Preset:');
  });
});

/**
 * CLI-2004 TC-16 / TC-21 — § Solution 13, asserted through `SessionStatusBar` (the way the App
 * reaches `StatusBar`) so the threading is covered too.
 *
 * The two halves are asserted TOGETHER on purpose: they pull in opposite directions — one field is
 * rendered MORE in the mode, two are rendered LESS — and stating them apart is how they drift into
 * contradicting each other.
 */
describe('CLI-2004: the status line in screen-reader mode', () => {
  const sessionProps = {
    cwd: '/tmp/project',
    permissionMode: 'default' as const,
    modelId: 'test-model',
    sessionId: 'sess-1',
    isThinking: false,
    activeToolCount: 0,
    activeBackgroundTaskCount: 0,
    hasPendingPrompt: false,
    contextState: { percentage: 42, usedTokens: 1000, maxTokens: 200000 },
    settings: { enabled: true, gitBranch: false } as never,
    activePresetId: 'reviewer',
  };

  function cliAdapter(): ITuiCliAdapter {
    return {
      getUserSettingsPath: () => '/tmp/fake-settings.json',
      readSettings: () => ({}),
      reloadPluginCommandSource: vi.fn(),
      applyActiveModelChange: vi.fn(),
      getGitBranch: vi.fn().mockReturnValue(undefined),
      getProviderDisplayName: vi.fn((type: string) => type),
    } as unknown as ITuiCliAdapter;
  }

  function renderStatus(enabled: boolean, overrides: Record<string, unknown> = {}): string {
    const { lastFrame, unmount } = render(
      <ScreenReaderProvider enabled={enabled}>
        <TuiCliAdapterProvider value={cliAdapter()}>
          <SessionStatusBar {...sessionProps} {...overrides} />
        </TuiCliAdapterProvider>
      </ScreenReaderProvider>,
    );
    const frame = lastFrame() ?? '';
    unmount();
    return frame;
  }

  it('TC-16: renders the permission mode even when it is `default`', () => {
    const frame = renderStatus(true);
    expect(frame).toContain('Mode:');
    expect(frame).toContain('default');
  });

  it('TC-16: still hides the `default` permission mode outside the mode', () => {
    const frame = renderStatus(false);
    expect(frame).not.toContain('Mode:');
  });

  it('TC-21: suppresses the volatile fields and keeps the stable ones', () => {
    const frame = renderStatus(true, { isThinking: true, activeToolCount: 2 });

    // Volatile — re-rendered on their own cadence and on every token.
    expect(frame).not.toContain('Context:');
    expect(frame).not.toContain('42%');
    expect(frame).not.toContain('Idle');
    expect(frame).not.toContain('Thinking');

    // Stable — anchors a reader can go back to.
    expect(frame).toContain('Mode:');
    expect(frame).toContain('default');
    expect(frame).toContain('Preset:');
    expect(frame).toContain('reviewer');
    expect(frame).toContain('test-model');
  });

  it('TC-21: renders all four exactly as today outside the mode', () => {
    const frame = renderStatus(false, { isThinking: true, activeToolCount: 2, permissionMode: 'plan' });

    expect(frame).toContain('Context:');
    expect(frame).toContain('42%');
    expect(frame).toContain('Mode:');
    expect(frame).toContain('plan');
    expect(frame).toContain('Preset:');
    expect(frame).toContain('test-model');
  });
});
