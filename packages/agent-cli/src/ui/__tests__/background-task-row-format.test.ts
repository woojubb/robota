import { describe, expect, it } from 'vitest';
import type { IBackgroundTaskViewModel } from '../tui-state-manager.js';
import { formatBackgroundTaskRow } from '../background-task-row-format.js';

const NOW = Date.parse('2026-05-02T00:00:20.000Z');

function makeTask(
  overrides: Partial<IBackgroundTaskViewModel> & Pick<IBackgroundTaskViewModel, 'id' | 'status'>,
): IBackgroundTaskViewModel {
  const { id, status, statusLabel, ...rest } = overrides;
  return {
    id,
    kind: 'agent',
    label: 'Explore',
    status,
    statusLabel: statusLabel ?? status,
    mode: 'background',
    unread: false,
    preview: 'Analyze backlog',
    ...rest,
  };
}

describe('formatBackgroundTaskRow', () => {
  it('formats a running task as a one-level tree row with idle time and no raw task id', () => {
    const row = formatBackgroundTaskRow(
      makeTask({
        id: 'agent_1',
        status: 'running',
        lastActivityAt: '2026-05-02T00:00:03.000Z',
        resultPreview: 'working on the task',
      }),
      { now: NOW, isLast: true },
    );

    expect(row.connector).toBe('└');
    expect(row.marker).toBe('□');
    expect(row.label).toBe('Explore agent');
    expect(row.segments).toEqual(['idle 17s']);
    expect(row.preview).toBe('working on the task');
    expect(row.accessibleText).not.toContain('agent_1');
  });

  it('formats completed rows without raw status words when output is available', () => {
    const row = formatBackgroundTaskRow(
      makeTask({
        id: 'agent_2',
        status: 'completed',
        resultPreview: 'Summary ready',
      }),
      { now: NOW, isLast: false },
    );

    expect(row.connector).toBe('├');
    expect(row.marker).toBe('■');
    expect(row.color).toBe('green');
    expect(row.segments).toEqual([]);
    expect(row.preview).toBe('Summary ready');
    expect(row.accessibleText).not.toContain('completed');
  });

  it('formats failed rows with an error segment and preview', () => {
    const row = formatBackgroundTaskRow(
      makeTask({
        id: 'agent_3',
        status: 'failed',
        errorPreview: 'worker crashed',
      }),
      { now: NOW, isLast: true },
    );

    expect(row.marker).toBe('■');
    expect(row.color).toBe('red');
    expect(row.segments).toEqual(['failed']);
    expect(row.preview).toBe('worker crashed');
  });

  it('formats timeout rows using the timeout label and reason', () => {
    const row = formatBackgroundTaskRow(
      makeTask({
        id: 'agent_4',
        status: 'failed',
        statusLabel: 'timed out',
        timeoutReason: 'idle',
        errorPreview: 'No activity',
      }),
      { now: NOW, isLast: true },
    );

    expect(row.segments).toEqual(['timed out', 'idle']);
    expect(row.preview).toBe('No activity');
  });

  it('keeps long output bounded by the view model preview', () => {
    const longPreview = `${'a'.repeat(120)}...`;
    const row = formatBackgroundTaskRow(
      makeTask({
        id: 'agent_5',
        status: 'running',
        resultPreview: longPreview,
      }),
      { now: NOW, isLast: true },
    );

    expect(row.preview).toHaveLength(123);
    expect(row.preview).toBe(longPreview);
  });

  it('omits empty previews without adding dangling separators', () => {
    const row = formatBackgroundTaskRow(
      makeTask({
        id: 'agent_6',
        status: 'queued',
        preview: '',
      }),
      { now: NOW, isLast: true },
    );

    expect(row.preview).toBeUndefined();
    expect(row.accessibleText).toBe('└ □ Explore agent');
  });

  it('surfaces preserved worktree handoff rows with next action preview', () => {
    const row = formatBackgroundTaskRow(
      makeTask({
        id: 'agent_7',
        status: 'completed',
        resultPreview: 'Changed files',
        worktreePath: '/workspace/.robota/worktrees/agent_7',
        branchName: 'robota/agent_7',
        worktreeStatus: ' M changed.ts',
        worktreeNextAction: 'Review /workspace/.robota/worktrees/agent_7.',
      }),
      { now: NOW, isLast: true },
    );

    expect(row.segments).toEqual(['worktree']);
    expect(row.preview).toBe('Review /workspace/.robota/worktrees/agent_7.');
    expect(row.accessibleText).toContain('worktree');
  });
});
