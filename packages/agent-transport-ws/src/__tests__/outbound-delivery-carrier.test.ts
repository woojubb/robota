/**
 * ARCH-030 at the real WS carrier: a reply that resolves after the socket closed must reach
 * `WsSessionDelivery`'s cleanup instead of escaping as an unhandled rejection.
 *
 * The protocol suite proves the boundary; this one proves the carrier is actually WIRED to it — the
 * half that was missing before, because the carrier's cleanup was written, idempotent, and never called.
 */

import { createTestInteractiveSession } from '@robota-sdk/agent-interface-session/testing';
import { createWsHandler } from '@robota-sdk/agent-transport-protocol';
import { describe, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';

import { WsSessionDelivery } from '../ws-session-delivery.js';
import { DEFAULT_MAX_PENDING_BYTES } from '@robota-sdk/agent-transport-protocol';

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

/** A socket whose `readyState` and `bufferedAmount` the test controls, so both are deterministic. */
function createControllableSocket(): {
  socket: WebSocket;
  close: () => void;
  setBuffered: (bytes: number) => void;
} {
  const state = { readyState: WebSocket.OPEN as number, bufferedAmount: 0 };
  const socket = {
    get readyState(): number {
      return state.readyState;
    },
    get bufferedAmount(): number {
      return state.bufferedAmount;
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
    setBuffered: (bytes: number) => {
      state.bufferedAmount = bytes;
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

describe("ARCH-030: payload frames share the text protocol's budget", () => {
  it('refuses a binary frame when the socket is over budget, and closes once', () => {
    // Until this path existed, TRANS-001 payload frames went straight to `socket.send` — outside the
    // boundary, with no budget. `bufferedAmount` does not distinguish text from binary, so a peer
    // that stopped reading accumulated payload frames invisibly to a budget guarding only the JSON
    // half of the same socket.
    const { socket, setBuffered } = createControllableSocket();
    const delivery = new WsSessionDelivery(socket);

    delivery.deliverBinary(new Uint8Array([1, 2, 3]));
    expect(socket.send).toHaveBeenCalledTimes(1);

    setBuffered(DEFAULT_MAX_PENDING_BYTES + 1);
    delivery.deliverBinary(new Uint8Array([4, 5, 6]));

    expect(socket.send).toHaveBeenCalledTimes(1); // not sent
    expect(socket.close).toHaveBeenCalledTimes(1);
  });

  it('the SAME budget governs both halves of one socket', () => {
    // The property that makes this shared rather than duplicated: bytes pending because of binary
    // frames close the connection when a JSON reply is attempted, and the reverse. One socket, one
    // reading, one limit.
    const { socket, setBuffered } = createControllableSocket();
    const delivery = new WsSessionDelivery(socket);

    setBuffered(DEFAULT_MAX_PENDING_BYTES + 1);
    delivery.deliver({ type: 'protocol_error', message: 'over budget from binary backlog' });

    expect(socket.send).not.toHaveBeenCalled();
    expect(socket.close).toHaveBeenCalledTimes(1);
  });

  it('does not send on a socket that is not open, and does not close it a second time', () => {
    const { socket, close } = createControllableSocket();
    const delivery = new WsSessionDelivery(socket);
    close();

    delivery.deliverBinary(new Uint8Array([1]));

    expect(socket.send).not.toHaveBeenCalled();
    expect(socket.close).not.toHaveBeenCalled();
  });
});
