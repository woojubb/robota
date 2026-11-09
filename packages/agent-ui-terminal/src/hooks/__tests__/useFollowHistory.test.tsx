import { render } from 'ink-testing-library';
import { Text } from 'ink';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { TuiCliAdapterProvider } from '../../tui-cli-adapter-context.js';
import { useFollowHistory } from '../useFollowHistory.js';

import type { IExecutionWorkspaceEntry } from '@robota-sdk/agent-interface/execution';
import type { ITuiCliAdapter } from '../../tui-cli-adapter.js';
import type { IKeyCustodyPort } from '../../key-custody/key-custody-port.js';

const fork: IExecutionWorkspaceEntry = {
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

function adapter(ensureReadable: IKeyCustodyPort['ensureReadable']): ITuiCliAdapter {
  return {
    getUserSettingsPath: () => '',
    readSettings: () => ({}),
    reloadPluginCommandSource: () => {},
    applyActiveModelChange: () => ({ applied: true }),
    getGitBranch: () => undefined,
    getProviderDisplayName: (type) => type,
    keyCustody: { ensureReadable },
  };
}

describe('follow history', () => {
  it('revisits the last page as a running transcript grows without repeating its rows', async () => {
    const first = { id: 'r1', kind: 'message', text: 'first' };
    const second = { id: 'r2', kind: 'message', text: 'second' };
    const read = vi
      .fn()
      .mockResolvedValueOnce({ entryId: fork.id, records: [] })
      .mockResolvedValueOnce({ entryId: fork.id, records: [first] })
      .mockResolvedValueOnce({ entryId: fork.id, records: [first, second] });
    const addEntry = vi.fn();
    function Probe(): React.ReactElement {
      useFollowHistory({ entry: fork, enabled: true, read, addEntry });
      return <Text>ready</Text>;
    }
    const view = render(
      <TuiCliAdapterProvider value={adapter(vi.fn().mockResolvedValue('readable'))}>
        <Probe />
      </TuiCliAdapterProvider>,
    );
    for (let i = 1; i <= 3; i++) {
      view.stdin.write('\x0f');
      await vi.waitFor(() => expect(addEntry).toHaveBeenCalledTimes(i));
    }
    expect(read).toHaveBeenCalledTimes(3);
    expect(read.mock.calls.every((call) => call[1]?.offset === 0)).toBe(true);
    expect(JSON.stringify(addEntry.mock.calls[1])).toContain('first');
    expect(JSON.stringify(addEntry.mock.calls[2])).toContain('second');
    expect(JSON.stringify(addEntry.mock.calls[2])).not.toContain('first');
    view.unmount();
  });
  it('asks for unlock only after a person requests a locked page, then rereads it', async () => {
    const read = vi
      .fn()
      .mockResolvedValueOnce({
        entryId: fork.id,
        records: [],
        unreadable: { locked: 1, noKeys: 0, doesNotOpen: 0 },
      })
      .mockResolvedValueOnce({
        entryId: fork.id,
        records: [{ id: 'r', kind: 'message', text: 'earlier output' }],
      });
    const ensureReadable = vi.fn().mockResolvedValue('readable');
    const addEntry = vi.fn();
    function Probe(): React.ReactElement {
      useFollowHistory({ entry: fork, enabled: true, read, addEntry });
      return <Text>ready</Text>;
    }
    const view = render(
      <TuiCliAdapterProvider value={adapter(ensureReadable)}>
        <Probe />
      </TuiCliAdapterProvider>,
    );
    expect(read).not.toHaveBeenCalled();
    expect(ensureReadable).not.toHaveBeenCalled();
    view.stdin.write('\x0f');
    await vi.waitFor(() => expect(addEntry).toHaveBeenCalled());
    expect(read).toHaveBeenCalledTimes(2);
    expect(read).toHaveBeenCalledWith(fork.id, { offset: 0 });
    expect(ensureReadable.mock.calls[0]?.[0]).toMatchObject({ purpose: 'follow-history' });
    expect(JSON.stringify(addEntry.mock.calls)).toContain('earlier output');
    view.unmount();
  });

  it('leaves a declined page unread and offers the unlock command', async () => {
    const read = vi.fn().mockResolvedValue({
      entryId: fork.id,
      records: [],
      unreadable: { locked: 1, noKeys: 0, doesNotOpen: 0 },
    });
    const ensureReadable = vi.fn().mockResolvedValue('declined');
    const addEntry = vi.fn();
    function Probe(): React.ReactElement {
      useFollowHistory({ entry: fork, enabled: true, read, addEntry });
      return <Text>ready</Text>;
    }
    const view = render(
      <TuiCliAdapterProvider value={adapter(ensureReadable)}>
        <Probe />
      </TuiCliAdapterProvider>,
    );
    view.stdin.write('\x0f');
    await vi.waitFor(() => expect(addEntry).toHaveBeenCalled());
    expect(read).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(addEntry.mock.calls)).toContain('/unlock');
    view.unmount();
  });

  it('uses the next cursor for another user request', async () => {
    const read = vi
      .fn()
      .mockResolvedValueOnce({
        entryId: fork.id,
        records: [{ id: '1', kind: 'message', text: 'first' }],
        nextCursor: { offset: 3 },
      })
      .mockResolvedValueOnce({
        entryId: fork.id,
        records: [{ id: '2', kind: 'message', text: 'second' }],
      });
    const addEntry = vi.fn();
    const ensureReadable = vi.fn().mockResolvedValue('readable');
    function Probe(): React.ReactElement {
      useFollowHistory({ entry: fork, enabled: true, read, addEntry });
      return <Text>ready</Text>;
    }
    const view = render(
      <TuiCliAdapterProvider value={adapter(ensureReadable)}>
        <Probe />
      </TuiCliAdapterProvider>,
    );
    view.stdin.write('\x0f');
    await vi.waitFor(() => expect(addEntry).toHaveBeenCalledTimes(1));
    view.stdin.write('\x0f');
    await vi.waitFor(() => expect(addEntry).toHaveBeenCalledTimes(2));
    expect(read).toHaveBeenLastCalledWith(fork.id, { offset: 3 });
    expect(ensureReadable).not.toHaveBeenCalled();
    view.unmount();
  });

  it('does not release a page that remains locked after an unlock response', async () => {
    const page = {
      entryId: fork.id,
      records: [{ id: 'r', kind: 'message', text: 'partial' }],
      unreadable: { locked: 1, noKeys: 0, doesNotOpen: 0 },
      nextCursor: { offset: 3 },
    };
    const read = vi.fn().mockResolvedValue(page);
    const addEntry = vi.fn();
    const ensureReadable = vi.fn().mockResolvedValue('readable');
    function Probe(): React.ReactElement {
      useFollowHistory({ entry: fork, enabled: true, read, addEntry });
      return <Text>ready</Text>;
    }
    const view = render(
      <TuiCliAdapterProvider value={adapter(ensureReadable)}>
        <Probe />
      </TuiCliAdapterProvider>,
    );
    view.stdin.write('\x0f');
    await vi.waitFor(() => expect(addEntry).toHaveBeenCalled());
    expect(JSON.stringify(addEntry.mock.calls)).not.toContain('partial');
    view.stdin.write('\x0f');
    await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(4));
    expect(read).toHaveBeenLastCalledWith(fork.id, { offset: 0 });
    view.unmount();
  });
});
