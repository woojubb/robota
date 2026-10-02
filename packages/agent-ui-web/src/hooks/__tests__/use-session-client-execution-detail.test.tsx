// @vitest-environment jsdom
/**
 * #3288 §1 — the Agents panel detail sheet's protocol state: `openExecutionDetail` sends
 * `read-execution-detail` and tracks the answer by `requestId` (a stale reply for an entry the
 * operator has since closed, or moved past by paging, is dropped); `loadMoreExecutionDetail` pages
 * with the previous `nextCursor` and appends; a page with no `nextCursor` marks the read complete.
 */

import { renderHook } from '../../testing/product-provider.js';
import { act } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { useSessionClient } from '../useSessionClient.js';

import type { TClientMessage } from '../../client/ws-session-client.js';
import type { TMakeSessionClient } from '../useSessionClient.js';
import type { TServerMessage } from '@robota-sdk/agent-transport';

function setup(): {
  result: { current: ReturnType<typeof useSessionClient> };
  deliver: (msg: TServerMessage) => void;
  sent: TClientMessage[];
} {
  let onMessage: ((msg: TServerMessage) => void) | null = null;
  const sent: TClientMessage[] = [];
  const makeClient: TMakeSessionClient = (callbacks) => {
    onMessage = callbacks.onMessage;
    return { connect: () => {}, disconnect: () => {}, send: (msg) => sent.push(msg) };
  };
  const { result } = renderHook(() => useSessionClient(makeClient));
  return { result, deliver: (msg) => act(() => onMessage?.(msg)), sent };
}

function lastReadRequestId(sent: TClientMessage[]): string {
  const request = [...sent].reverse().find((msg) => msg.type === 'read-execution-detail');
  if (!request || request.type !== 'read-execution-detail') throw new Error('no request sent');
  return request.requestId;
}

describe('#3288 §1 — execution detail sheet protocol state', () => {
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

  it('opening a new entry drops the previous entry\'s records and resets to loading', () => {
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

    deliver({ type: 'session_switched', event: { sessionId: 'other' } } as unknown as TServerMessage);

    expect(result.current.openEntryId).toBeNull();
    expect(result.current.executionDetailRecords).toEqual([]);
  });
});
