import { describe, expect, it } from 'vitest';
import type { IExecutionWorkspaceEntry, IExecutionWorkspaceSnapshot } from '@robota-sdk/agent-sdk';
import {
  countActiveBackgroundWorkspaceEntries,
  formatExecutionDetailRecord,
  formatExecutionWorkspaceEntryRow,
  getDefaultBackgroundWorkspaceEntries,
} from '../execution-workspace-view-model.js';

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
    preview: 'Map the CLI state manager',
    unread: false,
    attention: 'none',
    visibility: 'default',
    updatedAt: '2026-05-09T00:00:00.000Z',
    controls: ['select', 'cancel'],
    ...overrides,
  };
}

function makeSnapshot(entries: readonly IExecutionWorkspaceEntry[]): IExecutionWorkspaceSnapshot {
  return {
    sessionId: 'session_1',
    selectedEntryId: 'main:session_1',
    updatedAt: '2026-05-09T00:00:00.000Z',
    entries,
  };
}

describe('execution workspace view model', () => {
  it('renders selected and inactive entries with radio markers', () => {
    const row = formatExecutionWorkspaceEntryRow(makeEntry({ id: 'task:agent_1' }), {
      selectedEntryId: 'task:agent_1',
    });
    const inactive = formatExecutionWorkspaceEntryRow(makeEntry({ id: 'task:process_1' }), {
      selectedEntryId: 'task:agent_1',
    });

    expect(row.radio).toBe('●');
    expect(row.title).toBe('Explore agent');
    expect(row.subtitle).toBe('agent · general-purpose');
    expect(row.statusLabel).toBe('running');
    expect(inactive.radio).toBe('○');
  });

  it('filters default-visible background task entries for the compact panel', () => {
    const snapshot = makeSnapshot([
      makeEntry({ id: 'main:session_1', kind: 'main_thread', title: 'Main thread' }),
      makeEntry({ id: 'task:agent_1', visibility: 'default' }),
      makeEntry({ id: 'task:agent_2', visibility: 'collapsed' }),
      makeEntry({ id: 'group:group_1', kind: 'background_group', visibility: 'default' }),
    ]);

    expect(getDefaultBackgroundWorkspaceEntries(snapshot).map((entry) => entry.id)).toEqual([
      'task:agent_1',
    ]);
  });

  it('counts active default-visible background tasks without treating collapsed tasks as active', () => {
    const snapshot = makeSnapshot([
      makeEntry({ id: 'task:queued', status: 'queued' }),
      makeEntry({ id: 'task:running', status: 'running' }),
      makeEntry({ id: 'task:permission', status: 'waiting_permission' }),
      makeEntry({ id: 'task:done', status: 'completed' }),
      makeEntry({ id: 'task:hidden', status: 'running', visibility: 'collapsed' }),
    ]);

    expect(countActiveBackgroundWorkspaceEntries(snapshot)).toBe(3);
  });

  it('bounds detail record text without parsing runner-specific output', () => {
    const text = formatExecutionDetailRecord({
      id: 'record_1',
      kind: 'process_output',
      text: ` ${'a'.repeat(180)} `,
    });

    expect(text).toHaveLength(163);
    expect(text.endsWith('...')).toBe(true);
  });
});
