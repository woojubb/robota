import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'ink-testing-library';
import type { IExecutionWorkspaceEntry, IExecutionWorkspaceSnapshot } from '@robota-sdk/agent-sdk';
import ExecutionWorkspaceSwitcher from '../ExecutionWorkspaceSwitcher.js';
import ExecutionWorkspaceDetailPane from '../ExecutionWorkspaceDetailPane.js';

function makeEntry(overrides: Partial<IExecutionWorkspaceEntry>): IExecutionWorkspaceEntry {
  return {
    id: 'main:session_1',
    sourceId: 'session_1',
    kind: 'main_thread',
    origin: { kind: 'user_prompt', sessionId: 'session_1' },
    status: 'idle',
    title: 'Main thread',
    subtitle: '2 history entries',
    unread: false,
    attention: 'none',
    visibility: 'default',
    updatedAt: '2026-05-09T00:00:00.000Z',
    controls: ['select'],
    ...overrides,
  };
}

function makeSnapshot(): IExecutionWorkspaceSnapshot {
  return {
    sessionId: 'session_1',
    selectedEntryId: 'main:session_1',
    updatedAt: '2026-05-09T00:00:00.000Z',
    entries: [
      makeEntry({ id: 'main:session_1', kind: 'main_thread', title: 'Main thread' }),
      makeEntry({
        id: 'task:agent_1',
        sourceId: 'agent_1',
        kind: 'background_task',
        taskKind: 'agent',
        status: 'running',
        title: 'Explore',
        subtitle: 'general-purpose',
        preview: 'Inspect task layer',
        controls: ['select', 'cancel'],
      }),
    ],
  };
}

describe('ExecutionWorkspaceSwitcher', () => {
  it('renders main and background entries with selected radio markers', () => {
    const { lastFrame } = render(
      <ExecutionWorkspaceSwitcher
        snapshot={makeSnapshot()}
        selectedEntryId="task:agent_1"
        onSelect={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    const frame = lastFrame()!;
    expect(frame).toContain('Execution workspace');
    expect(frame).toContain('○ Main thread');
    expect(frame).toContain('● Explore agent');
    expect(frame).toContain('Inspect task layer');
  });

  it('commits the highlighted entry on enter without invoking task controls', () => {
    const onSelect = vi.fn();
    const { stdin } = render(
      <ExecutionWorkspaceSwitcher
        snapshot={makeSnapshot()}
        selectedEntryId="main:session_1"
        onSelect={onSelect}
        onClose={vi.fn()}
      />,
    );

    stdin.write('\u001B[B');
    stdin.write('\r');

    expect(onSelect).toHaveBeenCalledWith('task:agent_1');
  });

  it('renders selected entry detail records from the SDK detail page', () => {
    const entry = makeEntry({
      id: 'task:agent_1',
      sourceId: 'agent_1',
      kind: 'background_task',
      taskKind: 'agent',
      status: 'completed',
      title: 'Explore',
      preview: 'Done',
    });
    const { lastFrame } = render(
      <ExecutionWorkspaceDetailPane
        entry={entry}
        page={{
          entryId: 'task:agent_1',
          records: [{ id: 'r1', kind: 'result', text: 'Final background result' }],
        }}
      />,
    );

    const frame = lastFrame()!;
    expect(frame).toContain('Viewing Explore agent');
    expect(frame).toContain('Final background result');
  });
});
