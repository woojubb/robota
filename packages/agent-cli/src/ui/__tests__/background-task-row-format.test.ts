import { describe, expect, it } from 'vitest';
import type { IExecutionWorkspaceEntry } from '@robota-sdk/agent-sdk';
import { formatBackgroundTaskRow } from '../background-task-row-format.js';

function makeEntry(overrides: Partial<IExecutionWorkspaceEntry>): IExecutionWorkspaceEntry {
  return {
    id: 'task:agent_1',
    sourceId: 'agent_1',
    kind: 'background_task',
    origin: { kind: 'slash_command', sessionId: 'session_1', commandName: 'agent' },
    taskKind: 'agent',
    status: 'running',
    title: 'Explore',
    subtitle: 'general-purpose',
    preview: 'Analyze backlog',
    unread: false,
    attention: 'none',
    visibility: 'default',
    updatedAt: '2026-05-09T00:00:00.000Z',
    controls: ['select', 'cancel'],
    ...overrides,
  };
}

describe('formatBackgroundTaskRow', () => {
  it('formats running SDK workspace entries without raw task ids', () => {
    const row = formatBackgroundTaskRow(makeEntry({ id: 'task:agent_1' }), { isLast: true });

    expect(row.connector).toBe('└');
    expect(row.marker).toBe('□');
    expect(row.label).toBe('Explore agent');
    expect(row.segments).toEqual(['running', 'agent · general-purpose']);
    expect(row.preview).toBe('Analyze backlog');
    expect(row.accessibleText).not.toContain('agent_1');
  });

  it('formats failed and completed rows from SDK-owned status and attention', () => {
    const failed = formatBackgroundTaskRow(
      makeEntry({
        id: 'task:agent_2',
        status: 'failed',
        attention: 'failed',
        preview: 'Timed out',
      }),
      { isLast: false },
    );
    const completed = formatBackgroundTaskRow(
      makeEntry({ id: 'task:agent_3', status: 'completed', preview: 'Summary ready' }),
    );

    expect(failed.connector).toBe('├');
    expect(failed.marker).toBe('■');
    expect(failed.color).toBe('red');
    expect(failed.preview).toBe('Timed out');
    expect(completed.marker).toBe('■');
    expect(completed.color).toBe('green');
    expect(completed.preview).toBe('Summary ready');
  });
});
