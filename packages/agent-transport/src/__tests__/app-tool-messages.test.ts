/**
 * A driving surface hosting an MCP app view invokes one runtime tool through the session's
 * permission gate and reads a finished call's view on demand. Drive-only: the observer allowlist
 * does not list either message. A call is limited to the tools of the view it names, a connection
 * that goes away cancels its calls, and no answering frame exceeds what the channel carries.
 */
import { createTestInteractiveSession } from '@robota-sdk/agent-interface-session/testing';
import { describe, expect, it, vi } from 'vitest';

import {
  handleAppToolMessage,
  handleAppViewMessage,
  isAppToolMessage,
  isAppViewMessage,
} from '../app-tool-messages.js';
import { MAX_INBOUND_FRAME_BYTES } from '../message-decoders.js';
import { isObserverMessageType } from '../observer-messages.js';
import { createOutboundDelivery } from '../outbound-delivery.js';
import { createSessionMessageHandler } from '../session-message-handler.js';

import type { TOutboundDeliver } from '../outbound-delivery.js';
import type { TClientMessage, TServerMessage } from '../wire-messages.js';
import type { IToolAppView, IToolExecutionResult } from '@robota-sdk/agent-core';
import type {
  IInteractiveSession,
  IRuntimeToolInvokeOptions,
  ISessionRuntimeTools,
  ISessionToolAppViews,
} from '@robota-sdk/agent-interface-session';

function collect(): { sent: TServerMessage[]; deliver: TOutboundDeliver } {
  const sent: TServerMessage[] = [];
  return { sent, deliver: createOutboundDelivery((m) => sent.push(m), vi.fn()) };
}

const view: IToolAppView = {
  sourceId: 'files',
  resourceUri: 'ui://files/list',
  mimeType: 'text/html;profile=mcp-app',
  html: '<main>rows</main>',
  callableTools: { list_files: 'mcp__files__list_files' },
};

type TAppSession = ISessionRuntimeTools & ISessionToolAppViews;

function appSession(overrides: Partial<TAppSession> = {}): TAppSession {
  return {
    listRuntimeTools: vi.fn(),
    invokeRuntimeTool: vi.fn(),
    readToolAppView: vi.fn().mockReturnValue(view),
    ...overrides,
  };
}

function result(overrides: Partial<IToolExecutionResult> = {}): IToolExecutionResult {
  return { success: true, toolName: 'mcp__files__list_files', ...overrides };
}

describe('call-app-tool', () => {
  const call: Extract<TClientMessage, { type: 'call-app-tool' }> = {
    type: 'call-app-tool',
    requestId: 'app-tool-1',
    viewId: 'view-1',
    name: 'mcp__files__list_files',
    arguments: { path: 'src' },
  };

  it('is recognised, and is not a message an observer may send', () => {
    expect(isAppToolMessage(call)).toBe(true);
    expect(isAppToolMessage({ type: 'get-status' })).toBe(false);
    expect(isObserverMessageType('call-app-tool')).toBe(false);
  });

  it('invokes interactively for the connection driver and answers the correlated result', async () => {
    const { sent, deliver } = collect();
    const session = appSession({
      invokeRuntimeTool: vi.fn().mockResolvedValue(
        result({ result: { rows: 3 }, parts: [{ type: 'text', text: 'three rows' }] }),
      ),
    });

    handleAppToolMessage(session, deliver, call, 'attach:7');
    await vi.waitFor(() => expect(sent).toHaveLength(1));

    expect(session.readToolAppView).toHaveBeenCalledExactlyOnceWith('view-1');
    expect(session.invokeRuntimeTool).toHaveBeenCalledExactlyOnceWith(
      'mcp__files__list_files',
      { path: 'src' },
      { permissionInteraction: 'interactive', driverId: 'attach:7' },
    );
    expect(sent).toEqual([
      {
        type: 'app_tool_result',
        requestId: 'app-tool-1',
        success: true,
        data: { rows: 3 },
        parts: [{ type: 'text', text: 'three rows' }],
      },
    ]);
  });

  it('names no driver for a connection that has none, and answers a failure without data', async () => {
    const { sent, deliver } = collect();
    const session = appSession({
      invokeRuntimeTool: vi.fn().mockResolvedValue(result({ success: false, error: 'Permission denied' })),
    });

    handleAppToolMessage(session, deliver, call);
    await vi.waitFor(() => expect(sent).toHaveLength(1));

    expect(session.invokeRuntimeTool).toHaveBeenCalledExactlyOnceWith(
      'mcp__files__list_files',
      { path: 'src' },
      { permissionInteraction: 'interactive' },
    );
    expect(sent).toEqual([
      { type: 'app_tool_result', requestId: 'app-tool-1', success: false, error: 'Permission denied' },
    ]);
  });

  it('answers a refused invocation with a protocol_error carrying the requestId', async () => {
    const { sent, deliver } = collect();
    const session = appSession({
      invokeRuntimeTool: vi
        .fn()
        .mockRejectedValue(new Error('Another prompt or command is already running.')),
    });

    handleAppToolMessage(session, deliver, call, 'attach:7');
    await vi.waitFor(() => expect(sent).toHaveLength(1));

    expect(sent).toEqual([
      {
        type: 'protocol_error',
        message: 'Another prompt or command is already running.',
        requestId: 'app-tool-1',
      },
    ]);
  });

  it('refuses a call for a view the session no longer holds, without invoking anything', () => {
    const { sent, deliver } = collect();
    const session = appSession({ readToolAppView: vi.fn().mockReturnValue(undefined) });

    handleAppToolMessage(session, deliver, call, 'attach:7');

    expect(sent).toEqual([
      {
        type: 'protocol_error',
        message: 'This app view is no longer available.',
        requestId: 'app-tool-1',
      },
    ]);
    expect(session.invokeRuntimeTool).not.toHaveBeenCalled();
  });

  it.each([
    ['a tool of another source', 'mcp__other__delete_everything'],
    ['the source-side name rather than the runtime name', 'list_files'],
    ['a built-in tool', 'Bash'],
    ['a property of the map rather than a tool', 'toString'],
  ])('refuses %s: the view reaches only the tools its own source declared', (_label, name) => {
    const { sent, deliver } = collect();
    const session = appSession();

    handleAppToolMessage(session, deliver, { ...call, name }, 'attach:7');

    expect(sent).toEqual([
      {
        type: 'protocol_error',
        message: 'This tool is not available to this app view.',
        requestId: 'app-tool-1',
      },
    ]);
    expect(session.invokeRuntimeTool).not.toHaveBeenCalled();
  });

  it('answers a tool result too large for the channel with a protocol_error instead of the frame', async () => {
    const { sent, deliver } = collect();
    const session = appSession({
      invokeRuntimeTool: vi.fn().mockResolvedValue(result({ result: 'x'.repeat(2_000) })),
    });

    handleAppToolMessage(session, deliver, call, 'attach:7', { maxFrameBytes: 1_000 });
    await vi.waitFor(() => expect(sent).toHaveLength(1));

    expect(sent).toEqual([
      {
        type: 'protocol_error',
        message: 'This app tool result is too large to send.',
        requestId: 'app-tool-1',
      },
    ]);
  });

  it('sends a tool result that fits the limit', async () => {
    const { sent, deliver } = collect();
    const session = appSession({
      invokeRuntimeTool: vi.fn().mockResolvedValue(result({ result: 'small' })),
    });

    handleAppToolMessage(session, deliver, call, 'attach:7', { maxFrameBytes: 1_000 });
    await vi.waitFor(() => expect(sent).toHaveLength(1));

    expect(sent[0]).toMatchObject({ type: 'app_tool_result', data: 'small' });
  });

  it('keeps the margin the resume bridge needs beneath the inbound limit by default', async () => {
    const { sent, deliver } = collect();
    const nearLimit = 'x'.repeat(MAX_INBOUND_FRAME_BYTES - 500);
    const session = appSession({
      invokeRuntimeTool: vi.fn().mockResolvedValue(result({ result: nearLimit })),
    });

    handleAppToolMessage(session, deliver, call, 'attach:7');
    await vi.waitFor(() => expect(sent).toHaveLength(1));

    // Within the inbound limit, but a `seq` stamp added afterwards would carry it past.
    expect(sent[0]).toMatchObject({ type: 'protocol_error' });
  });

  it('passes the connection signal to the invocation and answers nobody once it aborts', async () => {
    const { sent, deliver } = collect();
    const connection = new AbortController();
    let seen: IRuntimeToolInvokeOptions | undefined;
    let settled = false;
    const session = appSession({
      invokeRuntimeTool: vi.fn(
        (_name: string, _arguments: unknown, options?: IRuntimeToolInvokeOptions) =>
          new Promise<IToolExecutionResult>((resolve) => {
            seen = options;
            options?.signal?.addEventListener('abort', () => {
              settled = true;
              resolve(result({ success: false, error: 'cancelled' }));
            });
          }),
      ),
    });

    handleAppToolMessage(session, deliver, call, 'attach:7', { signal: connection.signal });
    await vi.waitFor(() => expect(seen).toBeDefined());
    expect(seen?.signal).toBe(connection.signal);
    connection.abort();
    await vi.waitFor(() => expect(settled).toBe(true));
    // The handler's continuation runs as a microtask of that settlement; a macrotask is past it.
    await new Promise((resolve) => setImmediate(resolve));

    expect(sent).toEqual([]);
  });
});

describe('call-app-tool on a connection that is already gone', () => {
  it('answers nobody when the invocation is refused because its signal was already aborted', async () => {
    const { sent, deliver } = collect();
    const connection = new AbortController();
    connection.abort();
    let refused = false;
    const session = appSession({
      invokeRuntimeTool: vi.fn((_name: string, _arguments: unknown, options?: IRuntimeToolInvokeOptions) => {
        refused = true;
        return Promise.reject(options?.signal?.reason ?? new Error('aborted'));
      }),
    });

    handleAppToolMessage(
      session,
      deliver,
      { type: 'call-app-tool', requestId: 'c1', viewId: 'view-1', name: 'mcp__files__list_files', arguments: {} },
      'attach:7',
      { signal: connection.signal },
    );
    await vi.waitFor(() => expect(refused).toBe(true));
    await new Promise((resolve) => setImmediate(resolve));

    expect(sent).toEqual([]);
  });
});

describe('read-app-view', () => {
  const read: Extract<TClientMessage, { type: 'read-app-view' }> = {
    type: 'read-app-view',
    requestId: 'app-view-1',
    viewId: 'view-1',
  };

  it('is recognised, and is not a message an observer may send', () => {
    expect(isAppViewMessage(read)).toBe(true);
    expect(isAppViewMessage({ type: 'get-status' })).toBe(false);
    expect(isObserverMessageType('read-app-view')).toBe(false);
  });

  it('answers the view the session holds under that id', () => {
    const { sent, deliver } = collect();
    const readToolAppView = vi.fn().mockReturnValue(view);
    handleAppViewMessage({ readToolAppView }, deliver, read);
    expect(readToolAppView).toHaveBeenCalledExactlyOnceWith('view-1');
    expect(sent).toEqual([{ type: 'app_view', requestId: 'app-view-1', view }]);
  });

  it('says the view is gone when the session no longer holds it', () => {
    const { sent, deliver } = collect();
    handleAppViewMessage({ readToolAppView: () => undefined }, deliver, read);
    expect(sent).toEqual([
      {
        type: 'protocol_error',
        message: 'This app view is no longer available.',
        requestId: 'app-view-1',
      },
    ]);
  });

  it('refuses a view whose frame would pass the limit instead of sending it', () => {
    const { sent, deliver } = collect();
    const large = { ...view, html: 'x'.repeat(MAX_INBOUND_FRAME_BYTES) };
    handleAppViewMessage({ readToolAppView: () => large }, deliver, read);
    expect(sent).toEqual([
      {
        type: 'protocol_error',
        message: 'This app view is too large to send.',
        requestId: 'app-view-1',
      },
    ]);
  });

  it('refuses a frame in the margin the resume bridge needs beneath the inbound limit', () => {
    const { sent, deliver } = collect();
    const fixed = JSON.stringify({ type: 'app_view', requestId: 'app-view-1', view: { ...view, html: '' } });
    const nearLimit = {
      ...view,
      html: 'x'.repeat(MAX_INBOUND_FRAME_BYTES - Buffer.byteLength(fixed) - 100),
    };
    handleAppViewMessage({ readToolAppView: () => nearLimit }, deliver, read);
    expect(sent).toMatchObject([{ type: 'protocol_error' }]);
  });

  it('counts bytes, not characters, against the limit', () => {
    const { sent, deliver } = collect();
    // Half the limit in characters, but three bytes each: past the limit once encoded.
    const wide = { ...view, html: '€'.repeat(Math.ceil(MAX_INBOUND_FRAME_BYTES / 2)) };
    handleAppViewMessage({ readToolAppView: () => wide }, deliver, read);
    expect(sent).toMatchObject([{ type: 'protocol_error', message: 'This app view is too large to send.' }]);
  });

  it('holds a channel with a smaller limit to that limit, and still sends what fits', () => {
    const { sent, deliver } = collect();
    const medium = { ...view, html: 'x'.repeat(3_000) };
    handleAppViewMessage({ readToolAppView: () => medium }, deliver, read, { maxFrameBytes: 2_000 });
    expect(sent).toMatchObject([{ type: 'protocol_error', message: 'This app view is too large to send.' }]);

    handleAppViewMessage({ readToolAppView: () => medium }, deliver, read, { maxFrameBytes: 4_000 });
    expect(sent[1]).toMatchObject({ type: 'app_view', requestId: 'app-view-1' });
  });
});

describe('through the session message handler', () => {
  function attach(
    session: IInteractiveSession,
    extra: { role?: 'drive' | 'observe'; maxFrameBytes?: number } = {},
  ) {
    const sent: TServerMessage[] = [];
    const { onMessage, cleanup } = createSessionMessageHandler({
      session,
      deliver: createOutboundDelivery((message) => sent.push(message), vi.fn()),
      driverId: 'attach:3',
      ...(extra.role === undefined ? {} : { role: extra.role }),
      ...(extra.maxFrameBytes === undefined ? {} : { maxFrameBytes: extra.maxFrameBytes }),
    });
    return { sent, send: (message: TClientMessage) => onMessage(JSON.stringify(message)), cleanup };
  }

  const call: TClientMessage = {
    type: 'call-app-tool',
    requestId: 'c1',
    viewId: 'view-1',
    name: 'mcp__files__list_files',
    arguments: {},
  };

  it("runs a driving connection's call for its driver and reads the view for it", async () => {
    const invokeRuntimeTool = vi.fn().mockResolvedValue(result({ result: 'ok' }));
    const readToolAppView = vi.fn().mockReturnValue(view);
    const session = createTestInteractiveSession({ invokeRuntimeTool, readToolAppView });
    const drive = attach(session);

    drive.send(call);
    drive.send({ type: 'read-app-view', requestId: 'v1', viewId: 'view-1' });
    await vi.waitFor(() => expect(drive.sent).toHaveLength(2));

    expect(invokeRuntimeTool).toHaveBeenCalledExactlyOnceWith(
      'mcp__files__list_files',
      {},
      expect.objectContaining({ permissionInteraction: 'interactive', driverId: 'attach:3' }),
    );
    expect(drive.sent).toContainEqual({ type: 'app_view', requestId: 'v1', view });
    expect(drive.sent).toContainEqual({
      type: 'app_tool_result',
      requestId: 'c1',
      success: true,
      data: 'ok',
    });
  });

  it('refuses an observer both messages and touches neither the tools nor the views', () => {
    const invokeRuntimeTool = vi.fn();
    const readToolAppView = vi.fn();
    const session = createTestInteractiveSession({ invokeRuntimeTool, readToolAppView });
    const observer = attach(session, { role: 'observe' });

    observer.send(call);
    observer.send({ type: 'read-app-view', requestId: 'v1', viewId: 'view-1' });

    expect(observer.sent).toEqual([
      { type: 'protocol_error', message: 'Not permitted for an observer: call-app-tool' },
      { type: 'protocol_error', message: 'Not permitted for an observer: read-app-view' },
    ]);
    expect(invokeRuntimeTool).not.toHaveBeenCalled();
    expect(readToolAppView).not.toHaveBeenCalled();
  });

  it('cancels a call still waiting on its prompt when the connection goes away', async () => {
    let seen: IRuntimeToolInvokeOptions | undefined;
    let settled = false;
    const invokeRuntimeTool = vi.fn(
      (_name: string, _arguments: unknown, options?: IRuntimeToolInvokeOptions) =>
        new Promise<IToolExecutionResult>((resolve) => {
          seen = options;
          options?.signal?.addEventListener('abort', () => {
            settled = true;
            resolve(result({ success: false, error: 'denied' }));
          });
        }),
    );
    const session = createTestInteractiveSession({
      invokeRuntimeTool,
      readToolAppView: vi.fn().mockReturnValue(view),
    });
    const drive = attach(session);

    drive.send(call);
    await vi.waitFor(() => expect(seen?.signal).toBeDefined());
    expect(seen?.signal?.aborted).toBe(false);

    drive.cleanup();

    expect(seen?.signal?.aborted).toBe(true);
    // The connection is gone: nothing is sent to it for the call it abandoned.
    await vi.waitFor(() => expect(settled).toBe(true));
    await new Promise((resolve) => setImmediate(resolve));
    expect(drive.sent.filter((frame) => frame.type === 'app_tool_result')).toEqual([]);
  });

  it('holds app answers to the carrier limit it was given', async () => {
    const readToolAppView = vi.fn().mockReturnValue({ ...view, html: 'x'.repeat(3_000) });
    const session = createTestInteractiveSession({ readToolAppView });
    const drive = attach(session, { maxFrameBytes: 2_000 });

    drive.send({ type: 'read-app-view', requestId: 'v1', viewId: 'view-1' });

    expect(drive.sent).toEqual([
      { type: 'protocol_error', message: 'This app view is too large to send.', requestId: 'v1' },
    ]);
  });
});
