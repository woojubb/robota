// @vitest-environment jsdom
/**
 * The Agents panel detail sheet's protocol state: `openExecutionDetail` sends
 * `read-execution-detail` and tracks the answer by `requestId` (a stale reply for an entry the
 * operator has since closed, or moved past by paging, is dropped); `loadMoreExecutionDetail` pages
 * with the previous `nextCursor` and appends; a page with no `nextCursor` marks the read complete.
 */

import { renderHook } from '../../testing/product-provider.js';
import { act, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useSessionClient } from '../useSessionClient.js';

import type { TClientMessage } from '../../client/ws-session-client.js';
import type { TMakeSessionClient } from '../useSessionClient.js';
import type { TServerMessage } from '@robota-sdk/agent-transport';

function setup(): {
  result: { current: ReturnType<typeof useSessionClient> };
  deliver: (msg: TServerMessage) => void;
  sent: TClientMessage[];
  disconnect: () => void;
} {
  let onStatusChange: ((status: 'disconnected') => void) | undefined;
  let onMessage: ((msg: TServerMessage) => void) | null = null;
  const sent: TClientMessage[] = [];
  const makeClient: TMakeSessionClient = (callbacks) => {
    onMessage = callbacks.onMessage;
    onStatusChange = callbacks.onStatusChange;
    return { connect: () => {}, disconnect: () => {}, send: (msg) => sent.push(msg) };
  };
  const { result } = renderHook(() => useSessionClient(makeClient));
  return {
    result,
    deliver: (msg) => act(() => onMessage?.(msg)),
    sent,
    disconnect: () => act(() => onStatusChange?.('disconnected')),
  };
}

function lastReadRequestId(sent: TClientMessage[]): string {
  const request = [...sent].reverse().find((msg) => msg.type === 'read-execution-detail');
  if (!request || request.type !== 'read-execution-detail') throw new Error('no request sent');
  return request.requestId;
}

describe('execution detail sheet protocol state', () => {
  it('starts closed', () => {
    const { result } = setup();
    expect(result.current.openEntryId).toBeNull();
    expect(result.current.executionDetailStatus).toBe('idle');
  });

  it('openExecutionDetail sends read-execution-detail for that entry, with no cursor', () => {
    const { result, sent } = setup();
    act(() => result.current.openExecutionDetail('task:agent_1'));

    expect(result.current.openEntryId).toBe('task:agent_1');
    expect(result.current.executionDetailStatus).toBe('loading');
    const request = sent.find((msg) => msg.type === 'read-execution-detail');
    expect(request).toMatchObject({ type: 'read-execution-detail', entryId: 'task:agent_1' });
    expect((request as { cursor?: unknown }).cursor).toBeUndefined();
  });

  it('applies the matching reply and stores its records', () => {
    const { result, deliver, sent } = setup();
    act(() => result.current.openExecutionDetail('task:agent_1'));
    const requestId = lastReadRequestId(sent);

    deliver({
      type: 'execution_detail',
      requestId,
      page: { entryId: 'task:agent_1', records: [{ id: 'r1', kind: 'message', text: 'hello' }] },
    });

    expect(result.current.executionDetailStatus).toBe('ready');
    expect(result.current.executionDetailRecords).toEqual([
      { id: 'r1', kind: 'message', text: 'hello' },
    ]);
    expect(result.current.executionDetailComplete).toBe(true); // no nextCursor
  });

  it('ignores a reply for a request that is no longer the open one (closed since, or superseded)', () => {
    const { result, deliver, sent } = setup();
    act(() => result.current.openExecutionDetail('task:agent_1'));
    const staleRequestId = lastReadRequestId(sent);
    act(() => result.current.closeExecutionDetail());

    deliver({
      type: 'execution_detail',
      requestId: staleRequestId,
      page: { entryId: 'task:agent_1', records: [{ id: 'r1', kind: 'message', text: 'late' }] },
    });

    expect(result.current.openEntryId).toBeNull();
    expect(result.current.executionDetailRecords).toEqual([]);
  });

  it('a reply with a nextCursor leaves the read incomplete, and loadMoreExecutionDetail pages with it', () => {
    const { result, deliver, sent } = setup();
    act(() => result.current.openExecutionDetail('task:agent_1'));
    const firstRequestId = lastReadRequestId(sent);
    deliver({
      type: 'execution_detail',
      requestId: firstRequestId,
      page: {
        entryId: 'task:agent_1',
        records: [{ id: 'r1', kind: 'message', text: 'page one' }],
        nextCursor: { offset: 1 },
      },
    });
    expect(result.current.executionDetailComplete).toBe(false);

    act(() => result.current.loadMoreExecutionDetail());
    const secondRequest = [...sent].reverse().find((msg) => msg.type === 'read-execution-detail')!;
    expect((secondRequest as { cursor?: { offset: number } }).cursor).toEqual({ offset: 1 });
    const secondRequestId = lastReadRequestId(sent);

    deliver({
      type: 'execution_detail',
      requestId: secondRequestId,
      page: {
        entryId: 'task:agent_1',
        cursor: { offset: 1 },
        records: [{ id: 'r2', kind: 'message', text: 'page two' }],
      },
    });

    expect(result.current.executionDetailRecords).toEqual([
      { id: 'r1', kind: 'message', text: 'page one' },
      { id: 'r2', kind: 'message', text: 'page two' },
    ]);
    expect(result.current.executionDetailComplete).toBe(true);
  });

  it('an error reply sets the error and status, without clearing already-loaded records', () => {
    const { result, deliver, sent } = setup();
    act(() => result.current.openExecutionDetail('task:agent_1'));
    const requestId = lastReadRequestId(sent);

    deliver({ type: 'execution_detail_error', requestId, message: 'not found' });

    expect(result.current.executionDetailStatus).toBe('error');
    expect(result.current.executionDetailError).toBe('not found');
  });

  it('closeExecutionDetail resets everything', () => {
    const { result, deliver, sent } = setup();
    act(() => result.current.openExecutionDetail('task:agent_1'));
    deliver({
      type: 'execution_detail',
      requestId: lastReadRequestId(sent),
      page: { entryId: 'task:agent_1', records: [{ id: 'r1', kind: 'message', text: 'x' }] },
    });

    act(() => result.current.closeExecutionDetail());

    expect(result.current.openEntryId).toBeNull();
    expect(result.current.executionDetailRecords).toEqual([]);
    expect(result.current.executionDetailStatus).toBe('idle');
  });

  it("opening a new entry drops the previous entry's records and resets to loading", () => {
    const { result, deliver, sent } = setup();
    act(() => result.current.openExecutionDetail('task:agent_1'));
    deliver({
      type: 'execution_detail',
      requestId: lastReadRequestId(sent),
      page: { entryId: 'task:agent_1', records: [{ id: 'r1', kind: 'message', text: 'first' }] },
    });

    act(() => result.current.openExecutionDetail('task:agent_2'));

    expect(result.current.openEntryId).toBe('task:agent_2');
    expect(result.current.executionDetailRecords).toEqual([]);
    expect(result.current.executionDetailStatus).toBe('loading');
  });

  it('a session switch closes the detail sheet', () => {
    const { result, deliver, sent } = setup();
    act(() => result.current.openExecutionDetail('task:agent_1'));
    deliver({
      type: 'execution_detail',
      requestId: lastReadRequestId(sent),
      page: { entryId: 'task:agent_1', records: [{ id: 'r1', kind: 'message', text: 'x' }] },
    });

    deliver({
      type: 'session_switched',
      event: { sessionId: 'other' },
    } as unknown as TServerMessage);

    expect(result.current.openEntryId).toBeNull();
    expect(result.current.executionDetailRecords).toEqual([]);
  });
});

describe('fork follow detail', () => {
  it('refreshes the live page after a workspace update without switching sessions', async () => {
    const { result, deliver, sent } = setup();
    const entry = {
      id: 'task:agent_1',
      sourceId: 'agent_1',
      kind: 'background_task',
      taskKind: 'agent',
      origin: { kind: 'slash_command', sessionId: 'parent' },
      status: 'running',
      state: 'working',
      title: 'fork',
      resumeSessionId: 'fork-session',
      unread: false,
      attention: 'none',
      visibility: 'default',
      updatedAt: '2026-01-01T00:00:00.000Z',
      controls: ['select', 'attach', 'send'],
    };
    const snapshot = {
      sessionId: 'parent',
      updatedAt: '2026-01-01T00:00:00.000Z',
      entries: [entry],
    };
    deliver({ type: 'execution_workspace_event', snapshot } as TServerMessage);
    act(() => result.current.openExecutionDetail(entry.id));
    const firstId = lastReadRequestId(sent);
    deliver({
      type: 'execution_detail',
      requestId: firstId,
      page: { entryId: entry.id, records: [{ id: '1', kind: 'message', text: 'first' }] },
    });
    deliver({
      type: 'execution_workspace_event',
      snapshot: { ...snapshot, updatedAt: '2026-01-01T00:00:01.000Z' },
    } as TServerMessage);
    await waitFor(() => expect(lastReadRequestId(sent)).not.toBe(firstId));
    const second = [...sent].reverse().find((msg) => msg.type === 'read-execution-detail');
    expect(second).toMatchObject({ type: 'read-execution-detail', entryId: entry.id });
    expect(second && 'cursor' in second ? second.cursor : undefined).toBeUndefined();
    expect(sent.some((msg) => msg.type === 'switch-session')).toBe(false);
  });

  it('reads earlier output only on request with an explicit zero cursor', () => {
    const { result, sent, deliver } = setup();
    act(() => result.current.openExecutionDetail('task:agent_1'));
    deliver({
      type: 'execution_detail',
      requestId: lastReadRequestId(sent),
      page: { entryId: 'task:agent_1', records: [] },
    });
    act(() => result.current.showEarlierExecutionDetail?.());
    const request = [...sent].reverse().find((msg) => msg.type === 'read-execution-detail');
    expect(request).toMatchObject({ entryId: 'task:agent_1', cursor: { offset: 0 } });
  });
});

describe('fork follow request coordination', () => {
  it('waits for the live read before starting a requested transcript', () => {
    const { result, sent, deliver } = setup();
    act(() => result.current.openExecutionDetail('task:agent_1'));
    const liveRequest = lastReadRequestId(sent);
    act(() => result.current.showEarlierExecutionDetail?.());
    expect(lastReadRequestId(sent)).toBe(liveRequest);
    deliver({
      type: 'execution_detail',
      requestId: liveRequest,
      page: {
        entryId: 'task:agent_1',
        records: [{ id: 'old', kind: 'message', text: 'old live output' }],
      },
    });
    expect(result.current.executionDetailRecords).toEqual([]);
    const transcriptRequest = [...sent]
      .reverse()
      .find((msg) => msg.type === 'read-execution-detail');
    expect(transcriptRequest).toMatchObject({ entryId: 'task:agent_1', cursor: { offset: 0 } });
    deliver({
      type: 'execution_detail',
      requestId: lastReadRequestId(sent),
      page: {
        entryId: 'task:agent_1',
        cursor: { offset: 0 },
        records: [{ id: '1', kind: 'message', text: 'history' }],
        unreadable: { locked: 1, noKeys: 0, doesNotOpen: 0 },
      },
    });
    expect(result.current.executionDetailRecords[0]?.text).toBe('history');
    expect(result.current.executionDetailUnreadable?.locked).toBe(1);
  });
});

it('coalesces workspace bursts while a live read is in flight', () => {
  vi.useFakeTimers();
  try {
    const { result, deliver, sent } = setup();
    const entry = {
      id: 'task:agent_1',
      sourceId: 'agent_1',
      kind: 'background_task' as const,
      origin: { kind: 'tool_call' as const, sessionId: 'parent' },
      status: 'running' as const,
      state: 'working' as const,
      title: 'fork',
      resumeSessionId: 'fork',
      unread: false,
      attention: 'none' as const,
      visibility: 'default' as const,
      updatedAt: 'now',
      controls: ['attach'] as const,
    };
    const snapshot = { sessionId: 'parent', updatedAt: 'now', entries: [entry] };
    act(() => result.current.openExecutionDetail(entry.id));
    const firstId = lastReadRequestId(sent);
    for (let i = 0; i < 3; i += 1) deliver({ type: 'execution_workspace_event', snapshot });
    act(() => {
      vi.advanceTimersByTime(250);
    });
    expect(lastReadRequestId(sent)).toBe(firstId);
    deliver({
      type: 'execution_detail',
      requestId: firstId,
      page: { entryId: entry.id, records: [] },
    });
    act(() => {
      vi.advanceTimersByTime(0);
    });
    const refreshId = lastReadRequestId(sent);
    expect(refreshId).not.toBe(firstId);
    expect(sent.filter((msg) => msg.type === 'read-execution-detail')).toHaveLength(2);
    act(() => result.current.closeExecutionDetail());
    deliver({
      type: 'execution_detail',
      requestId: refreshId,
      page: { entryId: entry.id, records: [{ id: 'late', kind: 'message', text: 'late' }] },
    });
    expect(result.current.executionDetailRecords).toEqual([]);
  } finally {
    vi.useRealTimers();
  }
});

it('closes the detail on disconnect and ignores the lost request reply', () => {
  const { result, deliver, sent, disconnect } = setup();
  act(() => result.current.openExecutionDetail('task:agent_1'));
  const requestId = lastReadRequestId(sent);
  disconnect();
  deliver({
    type: 'execution_detail',
    requestId,
    page: { entryId: 'task:agent_1', records: [{ id: 'late', kind: 'message', text: 'late' }] },
  });
  expect(result.current.openEntryId).toBeNull();
  expect(result.current.executionDetailRecords).toEqual([]);
});

it('keeps unreadable counts from earlier transcript pages', () => {
  const { result, deliver, sent } = setup();
  act(() => result.current.openExecutionDetail('task:agent_1'));
  deliver({
    type: 'execution_detail',
    requestId: lastReadRequestId(sent),
    page: { entryId: 'task:agent_1', records: [] },
  });
  act(() => result.current.showEarlierExecutionDetail?.());
  deliver({
    type: 'execution_detail',
    requestId: lastReadRequestId(sent),
    page: {
      entryId: 'task:agent_1',
      cursor: { offset: 0 },
      nextCursor: { offset: 1 },
      records: [],
      unreadable: { locked: 2, noKeys: 0, doesNotOpen: 0 },
    },
  });
  act(() => result.current.loadMoreExecutionDetail());
  deliver({
    type: 'execution_detail',
    requestId: lastReadRequestId(sent),
    page: {
      entryId: 'task:agent_1',
      cursor: { offset: 1 },
      records: [],
      unreadable: { locked: 0, noKeys: 1, doesNotOpen: 0 },
    },
  });
  expect(result.current.executionDetailUnreadable).toEqual({
    locked: 2,
    noKeys: 1,
    doesNotOpen: 0,
  });
});

it('never displays a superseded transcript when a live update arrives', () => {
  vi.useFakeTimers();
  try {
    const { result, deliver, sent } = setup();
    const entry = {
      id: 'task:agent_1',
      sourceId: 'agent_1',
      kind: 'background_task' as const,
      origin: { kind: 'tool_call' as const, sessionId: 'parent' },
      status: 'running' as const,
      state: 'working' as const,
      title: 'fork',
      resumeSessionId: 'fork',
      unread: false,
      attention: 'none' as const,
      visibility: 'default' as const,
      updatedAt: 'now',
      controls: ['attach'] as const,
    };
    act(() => result.current.openExecutionDetail(entry.id));
    deliver({
      type: 'execution_detail',
      requestId: lastReadRequestId(sent),
      page: { entryId: entry.id, records: [] },
    });
    act(() => result.current.showEarlierExecutionDetail?.());
    const earlierId = lastReadRequestId(sent);
    act(() => result.current.showLiveExecutionDetail?.());
    deliver({
      type: 'execution_workspace_event',
      snapshot: { sessionId: 'parent', updatedAt: 'now', entries: [entry] },
    });
    act(() => {
      vi.advanceTimersByTime(250);
    });
    deliver({
      type: 'execution_detail',
      requestId: earlierId,
      page: {
        entryId: entry.id,
        cursor: { offset: 0 },
        records: [{ id: 'history', kind: 'message', text: 'old history' }],
      },
    });
    expect(result.current.executionDetailRecords).toEqual([]);
    expect(lastReadRequestId(sent)).not.toBe(earlierId);
  } finally {
    vi.useRealTimers();
  }
});

it('limits automatic reads to at most one per 250 milliseconds', () => {
  vi.useFakeTimers();
  try {
    const { result, deliver, sent } = setup();
    const entry = {
      id: 'task:agent_1',
      sourceId: 'agent_1',
      kind: 'background_task' as const,
      origin: { kind: 'tool_call' as const, sessionId: 'parent' },
      status: 'running' as const,
      state: 'working' as const,
      title: 'fork',
      resumeSessionId: 'fork',
      unread: false,
      attention: 'none' as const,
      visibility: 'default' as const,
      updatedAt: 'now',
      controls: ['attach'] as const,
    };
    const update = () =>
      deliver({
        type: 'execution_workspace_event',
        snapshot: { sessionId: 'parent', updatedAt: 'now', entries: [entry] },
      });
    act(() => result.current.openExecutionDetail(entry.id));
    deliver({
      type: 'execution_detail',
      requestId: lastReadRequestId(sent),
      page: { entryId: entry.id, records: [] },
    });
    update();
    act(() => {
      vi.advanceTimersByTime(249);
    });
    expect(sent.filter((msg) => msg.type === 'read-execution-detail')).toHaveLength(1);
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(sent.filter((msg) => msg.type === 'read-execution-detail')).toHaveLength(2);
    update();
    act(() => {
      vi.advanceTimersByTime(50);
    });
    deliver({
      type: 'execution_detail',
      requestId: lastReadRequestId(sent),
      page: { entryId: entry.id, records: [] },
    });
    act(() => {
      vi.advanceTimersByTime(199);
    });
    expect(sent.filter((msg) => msg.type === 'read-execution-detail')).toHaveLength(2);
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(sent.filter((msg) => msg.type === 'read-execution-detail')).toHaveLength(3);
  } finally {
    vi.useRealTimers();
  }
});

it('tracks fork send acknowledgements and blocks duplicate in-flight sends', () => {
  const { result, deliver, sent } = setup();
  act(() => {
    result.current.send({
      type: 'send-background-task',
      taskId: 'agent_1',
      input: { prompt: 'Hello' },
    });
    result.current.send({
      type: 'send-background-task',
      taskId: 'agent_1',
      input: { prompt: 'Hello' },
    });
  });
  expect(sent.filter((msg) => msg.type === 'send-background-task')).toHaveLength(1);
  expect(result.current.executionDetailInput).toEqual({ taskId: 'agent_1', status: 'pending' });
  deliver({
    type: 'background_task_control_result',
    action: 'send',
    taskId: 'agent_1',
    success: true,
  });
  expect(result.current.executionDetailInput).toEqual({ taskId: 'agent_1', status: 'sent' });
});

it('keeps an in-flight send pending when an unrelated protocol error arrives', () => {
  const { result, deliver } = setup();
  act(() =>
    result.current.send({
      type: 'send-background-task',
      taskId: 'agent_1',
      input: { prompt: 'Hello' },
    }),
  );
  deliver({ type: 'protocol_error', message: 'Unrelated operation failed' });
  expect(result.current.executionDetailInput).toEqual({ taskId: 'agent_1', status: 'pending' });
  deliver({
    type: 'background_task_control_result',
    action: 'send',
    taskId: 'agent_1',
    success: true,
  });
  expect(result.current.executionDetailInput).toEqual({ taskId: 'agent_1', status: 'sent' });
});

it('preserves retry ability after the host refuses an observer send', () => {
  const { result, deliver, sent } = setup();
  act(() =>
    result.current.send({
      type: 'send-background-task',
      taskId: 'agent_1',
      input: { prompt: 'Hello' },
    }),
  );
  deliver({
    type: 'protocol_error',
    message: 'Not permitted for an observer: send-background-task',
  });
  expect(result.current.executionDetailInput).toEqual({ taskId: 'agent_1', status: 'failed' });
  act(() =>
    result.current.send({
      type: 'send-background-task',
      taskId: 'agent_1',
      input: { prompt: 'Hello' },
    }),
  );
  expect(sent.filter((msg) => msg.type === 'send-background-task')).toHaveLength(2);
});
