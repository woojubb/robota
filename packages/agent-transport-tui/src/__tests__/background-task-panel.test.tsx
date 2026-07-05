import React from 'react';
import { describe, expect, it } from 'vitest';
import { render } from 'ink-testing-library';
import type { IExecutionWorkspaceEntry } from '@robota-sdk/agent-interface-transport';
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
    expect(frame).toContain('├ ⟳ general-purpose agent');
    expect(frame).toContain('├ ✓ general-purpose agent · completed');
    expect(frame).toContain('└ ✗ general-purpose agent · failed');
    expect(frame).not.toContain('agent_1');
    expect(frame).not.toContain('agent_2');
    expect(frame).not.toContain('agent_3');
  });

  it('advertises the keyboard drill-in when not focused (SCREEN-013/014)', () => {
    const { lastFrame } = render(
      <BackgroundTaskPanel entries={[makeEntry({ id: 'task:agent_1' })]} />,
    );
    const frame = lastFrame()!;
    // Entry affordance: ↓ to select, Ctrl+B for the full switcher.
    expect(frame).toContain('select');
    expect(frame).toContain('Ctrl+B');
  });

  it('shows the move/open affordance when a row is focused (SCREEN-014)', () => {
    const { lastFrame } = render(
      <BackgroundTaskPanel
        entries={[makeEntry({ id: 'task:agent_1' }), makeEntry({ id: 'task:agent_2' })]}
        focusedIndex={0}
      />,
    );
    const frame = lastFrame()!;
    expect(frame).toContain('Enter open');
    expect(frame).toContain('Esc back');
  });

  it('keeps a long-preview row on a single line (SCREEN-011)', () => {
    const longPreview =
      'Read each of the following backlog files and analyze the current status, implementation ' +
      'difficulty, dependencies, and estimated effort for every item; output a structured summary';
    const { lastFrame } = render(
      <BackgroundTaskPanel entries={[makeEntry({ id: 'task:agent_1', preview: longPreview })]} />,
    );
    const frame = lastFrame()!;
    // The row with the connector must be exactly one line — no wrapped continuation line.
    const rowLines = frame.split('\n').filter((line) => line.includes('⟳'));
    expect(rowLines).toHaveLength(1);
    // The connector + glyph still lead the single row line.
    expect(rowLines[0]).toMatch(/└ ⟳ general-purpose agent/);
  });
});
