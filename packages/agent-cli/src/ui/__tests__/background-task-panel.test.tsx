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
  it('renders compact status markers instead of status words', () => {
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
    expect(frame).toContain('□ agent:general-purpose agent_1');
    expect(frame).toContain('■ agent:general-purpose agent_2');
    expect(frame).toContain('■ agent:general-purpose agent_3');
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
    expect(frame).toContain('■ agent:general-purpose agent_1');
    expect(frame).not.toContain('■ !');
    expect(frame).toContain('(idle)');
    expect(frame).toContain(' - Background agent produced no activity');
    expect(frame).not.toContain('timed out agent:');
  });
});
