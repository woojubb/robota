/**
 * A driving surface hosting an MCP app view invokes one runtime tool through the session's
 * permission gate and reads a finished call's view on demand. Drive-only: the observer allowlist
 * does not list either message.
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
import type { IToolAppView } from '@robota-sdk/agent-core';
import type { IInteractiveSession } from '@robota-sdk/agent-interface-session';

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

describe('call-app-tool', () => {
  const call: Extract<TClientMessage, { type: 'call-app-tool' }> = {
    type: 'call-app-tool',
    requestId: 'app-tool-1',
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
    const invokeRuntimeTool = vi.fn().mockResolvedValue({
      success: true,
      toolName: call.name,
      result: { rows: 3 },
      parts: [{ type: 'text', text: 'three rows' }],
    });

    handleAppToolMessage({ invokeRuntimeTool, listRuntimeTools: vi.fn() }, deliver, call, 'attach:7');
    await Promise.resolve();
    await Promise.resolve();

    expect(invokeRuntimeTool).toHaveBeenCalledExactlyOnceWith(
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
    const invokeRuntimeTool = vi
      .fn()
      .mockResolvedValue({ success: false, toolName: call.name, error: 'Permission denied' });

    handleAppToolMessage({ invokeRuntimeTool, listRuntimeTools: vi.fn() }, deliver, call);
    await Promise.resolve();
    await Promise.resolve();

    expect(invokeRuntimeTool).toHaveBeenCalledExactlyOnceWith(
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
    const invokeRuntimeTool = vi
      .fn()
      .mockRejectedValue(new Error('Another prompt or command is already running.'));

    handleAppToolMessage({ invokeRuntimeTool, listRuntimeTools: vi.fn() }, deliver, call, 'attach:7');
    await Promise.resolve();
    await Promise.resolve();

    expect(sent).toEqual([
      {
        type: 'protocol_error',
        message: 'Another prompt or command is already running.',
        requestId: 'app-tool-1',
      },
    ]);
  });
});

describe('read-app-view', () => {
  const read: Extract<TClientMessage, { type: 'read-app-view' }> = {
    type: 'read-app-view',
    requestId: 'app-view-1',
    executionId: 'call-1',
  };

  it('is recognised, and is not a message an observer may send', () => {
    expect(isAppViewMessage(read)).toBe(true);
    expect(isAppViewMessage({ type: 'get-status' })).toBe(false);
    expect(isObserverMessageType('read-app-view')).toBe(false);
  });

  it('answers the view the session holds for that call', () => {
    const { sent, deliver } = collect();
    const readToolAppView = vi.fn().mockReturnValue(view);
    handleAppViewMessage({ readToolAppView }, deliver, read);
    expect(readToolAppView).toHaveBeenCalledExactlyOnceWith('call-1');
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

  it('refuses a view whose frame would pass the inbound limit instead of sending it', () => {
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

  it('counts bytes, not characters, against the limit', () => {
    const { sent, deliver } = collect();
    // Half the limit in characters, but three bytes each: past the limit once encoded.
    const wide = { ...view, html: '\u20ac'.repeat(Math.ceil(MAX_INBOUND_FRAME_BYTES / 2)) };
    handleAppViewMessage({ readToolAppView: () => wide }, deliver, read);
    expect(sent).toEqual([
      {
        type: 'protocol_error',
        message: 'This app view is too large to send.',
        requestId: 'app-view-1',
      },
    ]);
  });
});

describe('through the session message handler', () => {
  function attach(session: IInteractiveSession, role?: 'drive' | 'observe') {
    const sent: TServerMessage[] = [];
    const { onMessage } = createSessionMessageHandler({
      session,
      deliver: createOutboundDelivery((message) => sent.push(message), vi.fn()),
      driverId: 'attach:3',
      ...(role === undefined ? {} : { role }),
    });
    return { sent, send: (message: TClientMessage) => onMessage(JSON.stringify(message)) };
  }

  it("runs a driving connection's call for its driver and reads the view for it", async () => {
    const invokeRuntimeTool = vi
      .fn()
      .mockResolvedValue({ success: true, toolName: 't', result: 'ok' });
    const readToolAppView = vi.fn().mockReturnValue(view);
    const session = createTestInteractiveSession({ invokeRuntimeTool, readToolAppView });
    const drive = attach(session);

    drive.send({ type: 'call-app-tool', requestId: 'c1', name: 't', arguments: {} });
    drive.send({ type: 'read-app-view', requestId: 'v1', executionId: 'call-1' });
    await Promise.resolve();
    await Promise.resolve();

    expect(invokeRuntimeTool).toHaveBeenCalledExactlyOnceWith(
      't',
      {},
      { permissionInteraction: 'interactive', driverId: 'attach:3' },
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
    const observer = attach(session, 'observe');

    observer.send({ type: 'call-app-tool', requestId: 'c1', name: 't', arguments: {} });
    observer.send({ type: 'read-app-view', requestId: 'v1', executionId: 'call-1' });

    expect(observer.sent).toEqual([
      { type: 'protocol_error', message: 'Not permitted for an observer: call-app-tool' },
      { type: 'protocol_error', message: 'Not permitted for an observer: read-app-view' },
    ]);
    expect(invokeRuntimeTool).not.toHaveBeenCalled();
    expect(readToolAppView).not.toHaveBeenCalled();
  });
});
