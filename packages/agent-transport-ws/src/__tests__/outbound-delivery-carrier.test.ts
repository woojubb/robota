/**
 * ARCH-030 at the real WS carrier: a reply that resolves after the socket closed must reach
 * `WsSessionDelivery`'s cleanup instead of escaping as an unhandled rejection.
 *
 * The protocol suite proves the boundary; this one proves the carrier is actually WIRED to it — the
 * half that was missing before, because the carrier's cleanup was written, idempotent, and never called.
 */

import { createTestInteractiveSession } from '@robota-sdk/agent-interface-transport/testing';
import { createWsHandler } from '@robota-sdk/agent-transport-protocol';
import { describe, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';

import { WsSessionDelivery } from '../ws-session-delivery.js';

import type { IInteractiveSession } from '@robota-sdk/agent-interface-session';

/** Collect unhandled rejections while `run` executes, then drain the queue Node reports them on. */
async function withUnhandledRejectionCapture(run: () => void | Promise<void>): Promise<unknown[]> {
  const captured: unknown[] = [];
  const existing = process.listeners('unhandledRejection');
  for (const listener of existing) process.off('unhandledRejection', listener);
  const collect = (reason: unknown): void => {
    captured.push(reason);
  };
  process.on('unhandledRejection', collect);
  try {
    await run();
    await new Promise((resolve) => setTimeout(resolve, 20));
  } finally {
    process.off('unhandledRejection', collect);
    for (const listener of existing)
      process.on('unhandledRejection', listener as NodeJS.UnhandledRejectionListener);
  }
  return captured;
}

/** A socket whose `readyState` the test controls, so "disconnected" is deterministic. */
function createControllableSocket(): { socket: WebSocket; close: () => void } {
  const state = { readyState: WebSocket.OPEN as number };
  const socket = {
    get readyState(): number {
      return state.readyState;
    },
    send: vi.fn(),
    close: vi.fn(() => {
      state.readyState = WebSocket.CLOSED;
    }),
  } as unknown as WebSocket;
  return {
    socket,
    close: () => {
      state.readyState = WebSocket.CLOSED;
    },
  };
}

describe('WsSessionDelivery + the outbound boundary (ARCH-030)', () => {
  it('a command resolving after the socket closed runs cleanup once and leaks no rejection', async () => {
    const { socket, close } = createControllableSocket();
    const delivery = new WsSessionDelivery(socket);
    const detachSink = vi.fn();
    delivery.bindSinkDetach(detachSink);

    let releaseCommand: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      releaseCommand = resolve;
    });
    const executed: string[] = [];
    const session: IInteractiveSession = createTestInteractiveSession({
      executeCommand: (name: string) =>
        gate.then(() => {
          executed.push(name);
          return { success: true, message: 'done' };
        }),
    } as Partial<IInteractiveSession>);

    const handler = createWsHandler({ session, deliver: delivery.deliver });
    delivery.bindProtocolCleanup(handler.cleanup);

    const rejections = await withUnhandledRejectionCapture(async () => {
      handler.onMessage(JSON.stringify({ type: 'command', name: 'status' }));
      close();
      releaseCommand?.();
    });

    expect(rejections).toEqual([]);
    expect(executed).toEqual(['status']); // the command still committed
    expect(detachSink).toHaveBeenCalledTimes(1); // the carrier's cleanup finally runs
    // The socket was already CLOSED when the reply failed, so `close()` has nothing left to close —
    // what matters is that the cleanup path ran at all, which it never did before ARCH-030.
    expect(socket.close).not.toHaveBeenCalled();

    // Latched: a second late frame does not run cleanup again.
    delivery.deliver({ type: 'history_cleared' });
    expect(detachSink).toHaveBeenCalledTimes(1);
  });

  // NOT a proof of the boundary latch — `WsSessionDelivery.closed` already made this cleanup idempotent
  // before ARCH-030, so this case would pass either way. It pins that the boundary sitting ABOVE that
  // latch did not change the carrier's observable behaviour. The latch itself is red-proved in the
  // protocol suite (`outbound-delivery.test.ts` → 'latches: a connection reports at most one …').
  it('runs the carrier cleanup once for a burst of outbound frames after the close', () => {
    const { socket, close } = createControllableSocket();
    const delivery = new WsSessionDelivery(socket);
    const cleanup = vi.fn();
    delivery.bindProtocolCleanup(cleanup);
    close();

    delivery.deliver({ type: 'history_cleared' });
    delivery.deliver({ type: 'executing', executing: false });
    delivery.deliver({ type: 'protocol_error', message: 'third' });

    expect(cleanup).toHaveBeenCalledTimes(1);
  });
});
