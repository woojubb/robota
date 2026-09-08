import { describe, expect, it } from 'vitest';
import type { IExecutionWorkspaceEntry } from '@robota-sdk/agent-interface-execution';
import {
  BACKGROUND_TASK_CONNECTORS,
  formatBackgroundTaskRow,
} from '../background-task-row-format.js';

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
    expect(row.marker).toBe('⟳'); // running → shared status glyph (SCREEN-005)
    // marker symbol AND colour come from the same glyph now (SCREEN-007): the running
    // glyph is yellow, so the row colour is yellow (was cyan via the old view-model rule).
    expect(row.color).toBe('yellow');
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
    expect(failed.marker).toBe('✗'); // failed → error glyph (SCREEN-005)
    expect(failed.color).toBe('red');
    expect(failed.preview).toBe('Timed out');
    expect(completed.marker).toBe('✓'); // completed → success glyph (SCREEN-005)
    expect(completed.color).toBe('green');
    expect(completed.preview).toBe('Summary ready');
  });
});

/** CLI-2004: the tree connectors are drawing, and a reader announces them on every row. */
describe('formatBackgroundTaskRow in screen-reader mode', () => {
  it('uses the plain connector instead of the box-drawing branch/last glyphs', () => {
    const branch = formatBackgroundTaskRow(makeEntry({}), { isLast: false, screenReader: true });
    const last = formatBackgroundTaskRow(makeEntry({}), { isLast: true, screenReader: true });

    expect(branch.connector).toBe(BACKGROUND_TASK_CONNECTORS.plain);
    expect(last.connector).toBe(BACKGROUND_TASK_CONNECTORS.plain);
    expect(branch.accessibleText.startsWith(BACKGROUND_TASK_CONNECTORS.plain)).toBe(true);
  });

  it('keeps the tree connectors outside the mode', () => {
    expect(formatBackgroundTaskRow(makeEntry({}), { isLast: false }).connector).toBe(
      BACKGROUND_TASK_CONNECTORS.branch,
    );
    expect(formatBackgroundTaskRow(makeEntry({}), { isLast: true }).connector).toBe(
      BACKGROUND_TASK_CONNECTORS.last,
    );
  });
});
