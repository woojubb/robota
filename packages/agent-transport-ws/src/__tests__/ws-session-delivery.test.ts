import { createTestInteractiveSession } from '@robota-sdk/agent-interface-transport/testing';
import { createWsHandler } from '@robota-sdk/agent-transport-protocol';
import { describe, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';

import { WsSessionDelivery } from '../ws-session-delivery.js';

import type { IInteractiveSession } from '@robota-sdk/agent-interface-session';

function createSessionHarness(): {
  session: IInteractiveSession;
  fireBranchEvent: () => void;
  handlers: Map<string, (value: unknown) => void>;
} {
  const handlers = new Map<string, (value: unknown) => void>();
  const session = createTestInteractiveSession({
    on: ((event: string, handler: (value: unknown) => void) => {
      handlers.set(event, handler);
    }) as IInteractiveSession['on'],
    off: ((event: string) => {
      handlers.delete(event);
    }) as IInteractiveSession['off'],
  });
  return {
    session,
    handlers,
    fireBranchEvent: () =>
      handlers.get('branch_event')?.({
        kind: 'checkpoint_created',
        checkpointId: 'turn-0001',
        branchId: 'main',
      }),
  };
}

describe('WsSessionDelivery', () => {
  it('routes a non-open synchronous send through one protocol and sink cleanup', () => {
    const socket = {
      readyState: WebSocket.CLOSED,
      send: vi.fn(),
      close: vi.fn(),
    } as unknown as WebSocket;
    const delivery = new WsSessionDelivery(socket);
    const detachSink = vi.fn();
    delivery.bindSinkDetach(detachSink);
    const harness = createSessionHarness();
    // ARCH-030: the carrier's own boundary is what the handler receives — there is no raw sink to pass.
    const handler = createWsHandler({ session: harness.session, deliver: delivery.deliver });
    delivery.bindProtocolCleanup(handler.cleanup);

    expect(harness.fireBranchEvent).not.toThrow();
    expect(detachSink).toHaveBeenCalledTimes(1);
    expect(harness.handlers.size).toBe(0);
    expect(socket.close).not.toHaveBeenCalled();
    delivery.close();
    expect(detachSink).toHaveBeenCalledTimes(1);
  });

  it('routes an asynchronous ws.send callback error through the same idempotent cleanup', () => {
    let sendCallback: ((error?: Error) => void) | undefined;
    const socket = {
      readyState: WebSocket.OPEN,
      send: vi.fn((_data: string, callback: (error?: Error) => void) => {
        sendCallback = callback;
      }),
      close: vi.fn(),
    } as unknown as WebSocket;
    const delivery = new WsSessionDelivery(socket);
    const cleanup = vi.fn();
    const detachSink = vi.fn();
    delivery.bindProtocolCleanup(cleanup);
    delivery.bindSinkDetach(detachSink);

    delivery.deliver({ type: 'history_cleared' });
    expect(sendCallback).toBeDefined();
    sendCallback?.(new Error('asynchronous send failed'));
    sendCallback?.(new Error('duplicate callback'));
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(detachSink).toHaveBeenCalledTimes(1);
    expect(socket.close).toHaveBeenCalledTimes(1);
    expect(socket.close).toHaveBeenCalledWith(1011, 'session event delivery failed');
  });
});
