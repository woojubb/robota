/**
 * ARCH-030 at the WebRTC carrier.
 *
 * The item named WebRTC as affected, and its stated reason was wrong in a way worth recording: the
 * PAIRED-with-resume-bridge path was already guarded (the bridge routed replies through its own
 * try/catch). The genuinely unguarded WebRTC exposure was the BARE `createWsHandler` — `PairingGate`'s
 * no-`resumeBridge` branch, taken after the handshake accepts, and `WebRtcTransport`'s no-secret
 * branch, which is the same construction. This suite drives the gate's branch with a stubbed
 * handshake, the way `pairing-gate.test.ts` does, because that is the one that ships by default.
 */

import { createTestInteractiveSession } from '@robota-sdk/agent-interface-session/testing';
import { describe, expect, it, vi } from 'vitest';

import { PairingGate } from '../pairing-gate.js';

import type { startPairingHandshake, TPairingFrame } from '@robota-sdk/agent-remote-pairing';
import type { IInteractiveSession } from '@robota-sdk/agent-interface-session';
import type { RTCDataChannel } from 'werift';

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

/** A controllable handshake stub: the test decides when pairing accepts. */
function makeHandshakeStub(): { start: typeof startPairingHandshake; accept: () => void } {
  let resolveResult!: (value: { sessionKey: string }) => void;
  const start: typeof startPairingHandshake = (options) => {
    const controller = {
      result: new Promise<{ sessionKey: string }>((res) => {
        resolveResult = res;
      }),
      onFrame: (_frame: TPairingFrame) => undefined,
    };
    options.send({ t: 'pair-nonce', nonce: 'stub' });
    return controller;
  };
  return { start, accept: () => resolveResult({ sessionKey: 'k' }) };
}

/** A data channel whose `send` starts throwing once dropped, as werift's does on a closed channel. */
function createDroppableChannel(): {
  channel: RTCDataChannel;
  close: ReturnType<typeof vi.fn>;
  drop: () => void;
} {
  let open = true;
  const close = vi.fn();
  const channel = {
    send: (data: string) => {
      if (!open) throw new Error('RTCDataChannel is not open');
      void data;
    },
    close,
  } as unknown as RTCDataChannel;
  return {
    channel,
    close,
    drop: () => {
      open = false;
    },
  };
}

/** Build an accepted gate on its bare-handler branch (no `resumeBridge`). */
async function acceptedGate(session: IInteractiveSession): Promise<{
  gate: PairingGate;
  channelClose: ReturnType<typeof vi.fn>;
  drop: () => void;
  deliveryErrors: Array<{ message: string; event: string }>;
}> {
  const { channel, close, drop } = createDroppableChannel();
  const deliveryErrors: Array<{ message: string; event: string }> = [];
  const handshake = makeHandshakeStub();
  const gate = new PairingGate({
    channel,
    session,
    secret: 's',
    role: 'initiator',
    localFingerprint: 'AA',
    remoteFingerprint: 'BB',
    startHandshake: handshake.start,
    onDeliveryError: (error, event) => deliveryErrors.push({ message: error.message, event }),
  });
  handshake.accept();
  await new Promise((resolve) => setTimeout(resolve, 0)); // the gate accepts on a microtask
  return { gate, channelClose: close, drop, deliveryErrors };
}

describe('PairingGate bare-handler branch + the outbound boundary (ARCH-030)', () => {
  it('a command resolving after the channel dropped reports once and leaks no rejection', async () => {
    let releaseCommand: (() => void) | undefined;
    const commandGate = new Promise<void>((resolve) => {
      releaseCommand = resolve;
    });
    const executed: string[] = [];
    const session: IInteractiveSession = createTestInteractiveSession({
      executeCommand: (name: string) =>
        commandGate.then(() => {
          executed.push(name);
          return { success: true, message: 'done' };
        }),
    } as Partial<IInteractiveSession>);
    const { gate, channelClose, drop, deliveryErrors } = await acceptedGate(session);

    const rejections = await withUnhandledRejectionCapture(async () => {
      gate.onInbound(JSON.stringify({ type: 'command', name: 'status' }));
      drop();
      releaseCommand?.();
    });

    expect(rejections).toEqual([]);
    expect(executed).toEqual(['status']); // the command committed regardless of delivery
    expect(deliveryErrors).toEqual([
      { message: 'RTCDataChannel is not open', event: 'command_result' },
    ]);
    // Carrier cleanup ran: the gate closed its channel on the delivery failure. Before ARCH-030 the
    // reply threw from a Promise continuation and none of this happened.
    expect(channelClose).toHaveBeenCalledTimes(1);
  });

  // As on the WS side, this is not the boundary latch's own proof — `PairingGate.handleSessionDeliveryError`
  // returns early once its state is `closed`, so the single report predates ARCH-030. It pins that the
  // boundary above it did not change what the gate observes. The latch is red-proved in the protocol suite.
  it('reports once for a burst of replies after the drop', async () => {
    const session = createTestInteractiveSession();
    const { gate, drop, deliveryErrors } = await acceptedGate(session);
    drop();

    gate.onInbound(JSON.stringify({ type: 'get-executing' }));
    gate.onInbound(JSON.stringify({ type: 'get-messages' }));
    gate.onInbound(JSON.stringify({ type: 'get-pending' }));

    expect(deliveryErrors).toEqual([{ message: 'RTCDataChannel is not open', event: 'executing' }]);
  });
});
