import React from 'react';
import { describe, expect, it } from 'vitest';
import { render } from 'ink-testing-library';
import type { IExecutionWorkspaceEntry } from '@robota-sdk/agent-sdk';
import BackgroundTaskPanel from '../BackgroundTaskPanel.js';

function makeEntry(overrides: Partial<IExecutionWorkspaceEntry>): IExecutionWorkspaceEntry {
  return {
    id: 'task:agent_1',
    sourceId: 'agent_1',
    kind: 'background_task',
    origin: { kind: 'slash_command', sessionId: 'session_1', commandName: 'agent' },
    taskKind: 'agent',
    status: 'running',
    title: 'general-purpose',
    subtitle: 'agent',
    preview: 'Analyze backlog',
    unread: false,
    attention: 'none',
    visibility: 'default',
    updatedAt: '2026-05-09T00:00:00.000Z',
    controls: ['select', 'cancel'],
    ...overrides,
  };
}

describe('BackgroundTaskPanel', () => {
  it('renders SDK workspace entries with compact markers instead of raw task ids', () => {
    const { lastFrame } = render(
      <BackgroundTaskPanel
        entries={[
          makeEntry({ id: 'task:agent_1', status: 'running' }),
          makeEntry({ id: 'task:agent_2', status: 'completed', preview: 'Done' }),
          makeEntry({
            id: 'task:agent_3',
            status: 'failed',
            attention: 'failed',
            preview: 'Timed out',
          }),
        ]}
      />,
    );

    const frame = lastFrame()!;
    expect(frame).toContain('Background work');
    expect(frame).toContain('├ □ general-purpose agent');
    expect(frame).toContain('├ ■ general-purpose agent · completed');
    expect(frame).toContain('└ ■ general-purpose agent · failed');
    expect(frame).not.toContain('agent_1');
    expect(frame).not.toContain('agent_2');
    expect(frame).not.toContain('agent_3');
  });
});
