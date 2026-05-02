import React from 'react';
import { describe, expect, it } from 'vitest';
import { render } from 'ink-testing-library';
import BackgroundTaskPanel from '../BackgroundTaskPanel.js';
import type { IBackgroundTaskViewModel } from '../tui-state-manager.js';

function makeTask(
  overrides: Partial<IBackgroundTaskViewModel> & Pick<IBackgroundTaskViewModel, 'id' | 'status'>,
): IBackgroundTaskViewModel {
  const { id, status, statusLabel, ...rest } = overrides;
  return {
    id,
    kind: 'agent',
    label: 'general-purpose',
    status,
    statusLabel: statusLabel ?? status,
    mode: 'background',
    unread: false,
    preview: 'Analyze backlog',
    ...rest,
  };
}

describe('BackgroundTaskPanel', () => {
  it('renders one-level tree rows with compact status markers instead of raw task ids', () => {
    const { lastFrame } = render(
      <BackgroundTaskPanel
        tasks={[
          makeTask({ id: 'agent_1', status: 'running', lastActivityAt: new Date().toISOString() }),
          makeTask({ id: 'agent_2', status: 'completed', resultPreview: 'Done' }),
          makeTask({ id: 'agent_3', status: 'failed', errorPreview: 'Timed out' }),
        ]}
      />,
    );

    const frame = lastFrame()!;
    expect(frame).toContain('Background work');
    expect(frame).toContain('├ □ general-purpose agent');
    expect(frame).toContain('├ ■ general-purpose agent · Done');
    expect(frame).toContain('└ ■ general-purpose agent · failed · Timed out');
    expect(frame).not.toContain('agent_1');
    expect(frame).not.toContain('agent_2');
    expect(frame).not.toContain('agent_3');
    expect(frame).not.toContain('running agent:');
    expect(frame).not.toContain('completed agent:');
    expect(frame).not.toContain('failed agent:');
  });

  it('keeps idle age, timeout reason, and preview text without an unread marker', () => {
    const { lastFrame } = render(
      <BackgroundTaskPanel
        tasks={[
          makeTask({
            id: 'agent_1',
            status: 'failed',
            statusLabel: 'timed out',
            timeoutReason: 'idle',
            unread: true,
            errorPreview: 'Background agent produced no activity',
          }),
        ]}
      />,
    );

    const frame = lastFrame()!;
    expect(frame).toContain('└ ■ general-purpose agent');
    expect(frame).not.toContain('■ !');
    expect(frame).toContain('· timed out · idle');
    expect(frame).toContain('· Background agent produced no activity');
    expect(frame).not.toContain('timed out agent:');
  });
});
