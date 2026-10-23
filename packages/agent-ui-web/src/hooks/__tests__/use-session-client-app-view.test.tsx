// @vitest-environment jsdom


import { renderHook } from '../../testing/product-provider.js';
import { act } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { appViewKey } from '../use-app-view-requests.js';
import { useSessionClient } from '../useSessionClient.js';

import type { TClientMessage } from '../../client/ws-session-client.js';
import type { TAppToolOutcome, TAppView } from '../../app-view/types.js';
import type { TMakeSessionClient } from '../useSessionClient.js';
import type { TServerMessage } from '@robota-sdk/agent-transport';

type TConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

function setup(options: { connected?: boolean } = {}) {
  const sent: TClientMessage[] = [];
  let onMessage: ((msg: TServerMessage) => void) | null = null;
  let onStatusChange: ((status: TConnectionStatus) => void) | null = null;
  const makeClient: TMakeSessionClient = (callbacks) => {
    onMessage = callbacks.onMessage;
    onStatusChange = callbacks.onStatusChange;
    return { connect: () => {}, disconnect: () => {}, send: (msg) => sent.push(msg) };
  };
  const rendered = renderHook(() => useSessionClient(makeClient));
  const api = {
    ...rendered,
    sent,
    deliver: (msg: TServerMessage) => act(() => onMessage?.(msg)),
    setStatus: (status: TConnectionStatus) => act(() => onStatusChange?.(status)),
    requestsOf: <T extends TClientMessage['type']>(type: T) =>
      sent.filter((msg): msg is Extract<TClientMessage, { type: T }> => msg.type === type),
  };
  if (options.connected !== false) api.setStatus('connected');
  return api;
}

const view: TAppView = {
  sourceId: 'files',
  resourceUri: 'ui://files/list',
  mimeType: 'text/html;profile=mcp-app',
  html: '<main>rows</main>',
  callableTools: { list_files: 'mcp__files__list_files' },
};

type TSettlement<T> =
  { state: 'pending' } | { state: 'resolved'; value: T } | { state: 'rejected'; message: string };


function track<T>(promise: Promise<T>): { readonly current: TSettlement<T> } {
  const box: { current: TSettlement<T> } = { current: { state: 'pending' } };
  promise.then(
    (value) => {
      box.current = { state: 'resolved', value };
    },
    (error: unknown) => {
      box.current = {
        state: 'rejected',
        message: error instanceof Error ? error.message : String(error),
      };
    },
  );
  return box;
}


const flush = (): Promise<void> => act(async () => {});

describe('a live tool_end carrying an app view reference', () => {
  it('keeps the reference on the call, in the live row and in the finished group', () => {
    const { result, deliver } = setup();
    const appView = { viewId: 'view-1', sourceId: 'files', resourceUri: 'ui://files/list' };

    deliver({
      type: 'tool_start',
      state: {
        toolName: 'mcp__files__browse',
        firstArg: '',
        isRunning: true,
        executionId: 'exec-1',
      },
    });
    deliver({
      type: 'tool_end',
      state: {
        toolName: 'mcp__files__browse',
        firstArg: '',
        isRunning: false,
        result: 'success',
        executionId: 'exec-1',
        appView,
      },
    });
    expect(result.current.activeTools[0]?.appView).toEqual(appView);

    deliver({ type: 'complete', result: { response: 'ok' } } as TServerMessage);
    const group = result.current.messages.find((entry) => entry.role === 'tools');
    expect(group?.role === 'tools' && group.tools[0]?.appView).toEqual(appView);
  });

  it('leaves a call without one exactly as it was', () => {
    const { result, deliver } = setup();

    deliver({ type: 'tool_start', state: { toolName: 'Read', firstArg: 'a.ts', isRunning: true } });
    deliver({
      type: 'tool_end',
      state: { toolName: 'Read', firstArg: 'a.ts', isRunning: false, result: 'success' },
    });

    expect(result.current.activeTools[0]).not.toHaveProperty('appView');
  });
});

describe('appViewKey', () => {
  it('is what a tool row’s app view is read and called by, and nothing for a row without one', () => {
    const base = { id: 't1', name: 'mcp__files__browse', status: 'done' as const };
    const appView = { viewId: 'view-1', sourceId: 'files', resourceUri: 'ui://files/list' };

    expect(appViewKey({ ...base, executionId: 'exec-1', appView })).toBe('view-1');
    expect(appViewKey({ ...base, executionId: 'exec-1' })).toBeUndefined();
    expect(appViewKey({ ...base, appView })).toBe('view-1');
  });
});

describe('readAppView', () => {
  it('sends read-app-view with a fresh request id and resolves with the document the reply carries', async () => {
    const { result, deliver, requestsOf } = setup();

    let read!: ReturnType<typeof track<TAppView>>;
    act(() => {
      read = track(result.current.readAppView('view-1'));
    });
    const [request] = requestsOf('read-app-view');
    expect(request).toMatchObject({ type: 'read-app-view', viewId: 'view-1' });
    expect(request?.requestId).toBeTruthy();
    await flush();
    expect(read.current).toEqual({ state: 'pending' });

    deliver({ type: 'app_view', requestId: request!.requestId, view });
    await flush();

    expect(read.current).toEqual({ state: 'resolved', value: view });
  });

  it('ignores a reply to another request, and a reply of the wrong kind', async () => {
    const { result, deliver, requestsOf } = setup();
    let read!: ReturnType<typeof track<TAppView>>;
    act(() => {
      read = track(result.current.readAppView('view-1'));
    });
    const { requestId } = requestsOf('read-app-view')[0]!;

    deliver({ type: 'app_view', requestId: 'someone-else', view });
    deliver({ type: 'app_tool_result', requestId, success: true });
    await flush();

    expect(read.current).toEqual({ state: 'pending' });
  });

  it('rejects with the session’s reason when it refuses, and shows no toast for it', async () => {
    const { result, deliver, requestsOf } = setup();
    let read!: ReturnType<typeof track<TAppView>>;
    act(() => {
      read = track(result.current.readAppView('view-1'));
    });
    const { requestId } = requestsOf('read-app-view')[0]!;

    deliver({
      type: 'protocol_error',
      message: 'This app view is no longer available.',
      requestId,
    });
    await flush();

    expect(read.current).toEqual({
      state: 'rejected',
      message: 'This app view is no longer available.',
    });
    expect(result.current.sessionNotices).toEqual([]);
  });

  it('still shows a protocol error that answers no app request as the toast it always was', () => {
    const { result, deliver } = setup();

    deliver({ type: 'protocol_error', message: 'Something else', requestId: 'not-an-app-request' });

    expect(result.current.sessionNotices).toMatchObject([
      { kind: 'protocol-error', message: 'Something else' },
    ]);
  });

  it('keeps several outstanding reads apart, whatever order the replies come in', async () => {
    const { result, deliver, requestsOf } = setup();
    let first!: ReturnType<typeof track<TAppView>>;
    let second!: ReturnType<typeof track<TAppView>>;
    act(() => {
      first = track(result.current.readAppView('view-1'));
      second = track(result.current.readAppView('exec-2'));
    });
    const [one, two] = requestsOf('read-app-view');
    const secondView = { ...view, resourceUri: 'ui://files/second' };

    deliver({ type: 'app_view', requestId: two!.requestId, view: secondView });
    await flush();
    expect(first.current).toEqual({ state: 'pending' });
    expect(second.current).toEqual({ state: 'resolved', value: secondView });

    deliver({ type: 'app_view', requestId: one!.requestId, view });
    await flush();
    expect(first.current).toEqual({ state: 'resolved', value: view });
  });
});

describe('callAppTool', () => {
  it('sends call-app-tool with the name and arguments and resolves with the outcome', async () => {
    const { result, deliver, requestsOf } = setup();
    let call!: ReturnType<typeof track<TAppToolOutcome>>;
    act(() => {
      call = track(result.current.callAppTool('view-1', 'mcp__files__list_files', { path: 'src' }));
    });
    const [request] = requestsOf('call-app-tool');
    expect(request).toMatchObject({
      type: 'call-app-tool',
      viewId: 'view-1',
      name: 'mcp__files__list_files',
      arguments: { path: 'src' },
    });

    deliver({
      type: 'app_tool_result',
      requestId: request!.requestId,
      success: true,
      data: { rows: 3 },
      parts: [{ type: 'text', text: 'three rows' }],
    });
    await flush();

    expect(call.current).toEqual({
      state: 'resolved',
      value: { success: true, data: { rows: 3 }, parts: [{ type: 'text', text: 'three rows' }] },
    });
  });

  it('resolves a denied or failed call with its error rather than rejecting it', async () => {
    const { result, deliver, requestsOf } = setup();
    let call!: ReturnType<typeof track<TAppToolOutcome>>;
    act(() => {
      call = track(result.current.callAppTool('view-1', 'mcp__files__save_file', {}));
    });
    const { requestId } = requestsOf('call-app-tool')[0]!;

    deliver({ type: 'app_tool_result', requestId, success: false, error: 'Permission denied' });
    await flush();

    expect(call.current).toEqual({
      state: 'resolved',
      value: { success: false, error: 'Permission denied' },
    });
  });

  it('rejects when the session refuses the call', async () => {
    const { result, deliver, requestsOf } = setup();
    let call!: ReturnType<typeof track<TAppToolOutcome>>;
    act(() => {
      call = track(result.current.callAppTool('view-1', 'mcp__files__list_files', {}));
    });
    const { requestId } = requestsOf('call-app-tool')[0]!;

    deliver({ type: 'protocol_error', message: 'Not a driver.', requestId });
    await flush();

    expect(call.current).toEqual({ state: 'rejected', message: 'Not a driver.' });
  });
});

describe('a request that can no longer be answered', () => {
  it('rejects every outstanding request when the connection drops', async () => {
    const { result, setStatus } = setup();
    let read!: ReturnType<typeof track<TAppView>>;
    let call!: ReturnType<typeof track<TAppToolOutcome>>;
    act(() => {
      read = track(result.current.readAppView('view-1'));
      call = track(result.current.callAppTool('view-1', 'mcp__files__list_files', {}));
    });

    setStatus('disconnected');
    await flush();

    expect(read.current).toMatchObject({ state: 'rejected' });
    expect(call.current).toMatchObject({ state: 'rejected' });
  });

  it('rejects an outstanding request when the hook unmounts', async () => {
    const { result, unmount } = setup();
    let read!: ReturnType<typeof track<TAppView>>;
    act(() => {
      read = track(result.current.readAppView('view-1'));
    });

    unmount();
    await flush();

    expect(read.current).toMatchObject({ state: 'rejected' });
  });

  it('refuses at once, sending nothing, while there is no connection', async () => {
    const { result, sent } = setup({ connected: false });
    let read!: ReturnType<typeof track<TAppView>>;
    act(() => {
      read = track(result.current.readAppView('view-1'));
    });
    await flush();

    expect(read.current).toMatchObject({ state: 'rejected' });
    expect(sent.filter((msg) => msg.type === 'read-app-view')).toEqual([]);
  });

  it('does not answer a request after the connection came back with a late reply', async () => {
    const { result, deliver, setStatus, requestsOf } = setup();
    let read!: ReturnType<typeof track<TAppView>>;
    act(() => {
      read = track(result.current.readAppView('view-1'));
    });
    const { requestId } = requestsOf('read-app-view')[0]!;
    setStatus('disconnected');
    setStatus('connected');

    deliver({ type: 'app_view', requestId, view });
    await flush();

    expect(read.current).toMatchObject({ state: 'rejected' });
  });
});

describe('app request ownership', () => {
  it.each(['session_switched', 'history_cleared'] as const)(
    'rejects old requests on %s and accepts a fresh request',
    async (type) => {
      const { result, deliver, requestsOf } = setup();
      const read = track(result.current.readAppView('view-old'));
      const call = track(result.current.callAppTool('view-old', 'mcp__files__list_files', {}));
      const oldRead = requestsOf('read-app-view')[0]!;
      const oldCall = requestsOf('call-app-tool')[0]!;
      deliver(type === 'session_switched' ? { type, event: { sessionId: 'next' } } : { type });
      await flush();
      expect(read.current.state).toBe('rejected');
      expect(call.current.state).toBe('rejected');
      const next = track(result.current.readAppView('view-next'));
      deliver({ type: 'app_view', requestId: oldRead.requestId, view });
      deliver({ type: 'app_tool_result', requestId: oldCall.requestId, success: true });
      deliver({
        type: 'protocol_error',
        requestId: oldRead.requestId,
        message: 'Old view expired.',
      });
      await flush();
      expect(result.current.sessionNotices).toEqual([]);
      expect(next.current.state).toBe('pending');
      deliver({ type: 'app_view', requestId: requestsOf('read-app-view')[1]!.requestId, view });
      await flush();
      expect(next.current).toEqual({ state: 'resolved', value: view });
    },
  );

  it('preserves a pending read when switching is refused', async () => {
    const { result, deliver, requestsOf } = setup();
    const read = track(result.current.readAppView('view-current'));
    act(() => result.current.switchSession('missing'));
    deliver({
      type: 'session_change_failed',
      code: 'unknown_session',
      requestId: requestsOf('switch-session')[0]!.requestId,
      message: 'Session not found.',
    });
    await flush();
    expect(read.current.state).toBe('pending');
    deliver({ type: 'app_view', requestId: requestsOf('read-app-view')[0]!.requestId, view });
    await flush();
    expect(read.current.state).toBe('resolved');
  });

  it('rejects an aborted local wait and ignores its late answer without cancelling another view', async () => {
    const { result, deliver, requestsOf } = setup();
    const controller = new AbortController();
    const abandoned = track(result.current.readAppView('view-old', controller.signal));
    const surviving = track(result.current.readAppView('view-other'));
    controller.abort();
    await flush();
    expect(abandoned.current.state).toBe('rejected');
    expect(surviving.current.state).toBe('pending');
    deliver({ type: 'app_view', requestId: requestsOf('read-app-view')[0]!.requestId, view });
    deliver({ type: 'app_view', requestId: requestsOf('read-app-view')[1]!.requestId, view });
    await flush();
    expect(abandoned.current.state).toBe('rejected');
    expect(surviving.current.state).toBe('resolved');
  });
});

describe('local app callback cancellation', () => {
  it('rejects an outstanding callback when its frame closes and sends nothing for an already closed frame', async () => {
    const { result, deliver, requestsOf } = setup();
    const controller = new AbortController();
    const call = track(
      result.current.callAppTool('view-old', 'mcp__files__list_files', {}, controller.signal),
    );
    controller.abort();
    const closed = track(
      result.current.callAppTool('view-old', 'mcp__files__list_files', {}, controller.signal),
    );
    await flush();
    expect(call.current.state).toBe('rejected');
    expect(closed.current.state).toBe('rejected');
    expect(requestsOf('call-app-tool')).toHaveLength(1);
    deliver({
      type: 'app_tool_result',
      requestId: requestsOf('call-app-tool')[0]!.requestId,
      success: true,
    });
    await flush();
    expect(call.current.state).toBe('rejected');
  });
});
