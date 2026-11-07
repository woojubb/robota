import { Text } from 'ink';
import { render } from 'ink-testing-library';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { useExecutionDetailPage } from '../useExecutionDetailPage.js';

import type {
  IExecutionDetailPage,
  IExecutionWorkspaceEntry,
  IExecutionWorkspaceSnapshot,
} from '@robota-sdk/agent-interface-execution';

const entry: IExecutionWorkspaceEntry = {
  id: 'task:fork',
  sourceId: 'fork',
  kind: 'background_task',
  taskKind: 'agent',
  origin: { kind: 'slash_command', sessionId: 'parent' },
  status: 'running',
  state: 'working',
  title: 'fork',
  unread: false,
  attention: 'none',
  visibility: 'default',
  updatedAt: '2026-11-05',
  controls: ['select', 'send', 'attach'],
  resumeSessionId: 'fork-session',
};
const snapshot = (updatedAt: string): IExecutionWorkspaceSnapshot => ({
  sessionId: 'parent',
  selectedEntryId: entry.id,
  updatedAt,
  entries: [entry],
});

describe('live detail refresh', () => {
  it('coalesces a burst and still renders a read already in flight', async () => {
    let finish!: (page: IExecutionDetailPage) => void;
    const read = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<IExecutionDetailPage>((resolve) => {
            finish = resolve;
          }),
      )
      .mockResolvedValue({
        entryId: entry.id,
        records: [{ id: 'new', kind: 'message', text: 'newest' }],
      });
    function Probe({ state }: { state: IExecutionWorkspaceSnapshot }): React.ReactElement {
      const detail = useExecutionDetailPage({ entry, snapshot: state, read });
      return <Text>{detail.page?.records[0]?.text ?? 'empty'}</Text>;
    }
    const view = render(<Probe state={snapshot('0')} />);
    await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(1));
    for (let i = 1; i <= 10; i++) view.rerender(<Probe state={snapshot(String(i))} />);
    expect(read).toHaveBeenCalledTimes(1);
    finish({ entryId: entry.id, records: [{ id: 'old', kind: 'message', text: 'first' }] });
    await vi.waitFor(() => expect(view.lastFrame()).toContain('first'));
    await vi.waitFor(() => expect(view.lastFrame()).toContain('newest'));
    expect(read).toHaveBeenCalledTimes(2);
    view.unmount();
  });
});
