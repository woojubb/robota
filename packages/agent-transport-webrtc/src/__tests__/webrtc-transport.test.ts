import { runTransportLifecycleConformance } from '@robota-sdk/agent-interface-transport/testing';
import { createTestInteractiveSession } from '@robota-sdk/agent-interface-session/testing';

import { describe, expect, expectTypeOf, it, vi } from 'vitest';
import type { IConfigurableTransport } from '@robota-sdk/agent-interface-transport';
import type { IInteractiveSession } from '@robota-sdk/agent-interface-session';
import type { IProtocolSession } from '@robota-sdk/agent-transport';

import { WebRtcTransport } from '../webrtc-transport.js';
import { createInMemorySignalingPair, type ISignalingClient } from '../signaling.js';
import { WebRtcDeliveryLifecycle } from '../webrtc-delivery-lifecycle.js';
import { RtcPeer } from '../rtc-peer.js';
import { fakeDataChannel } from './fake-datachannel.js';

/** Minimal stub session — only `getMessages` + no-op `on`/`off` are exercised by the get-messages round-trip. */
function createStubSession(): IInteractiveSession {
  return Object.assign(createTestInteractiveSession(), {
    getMessages: vi.fn().mockReturnValue([{ role: 'user', content: 'hi' }]),
    // ARCH-012: required. This double feeds `subscribeSessionEvents`, which calls it on every
    // turn-authored event — omitting it throws the moment a case emits one.
    getActiveDriverId: () => null,
    on: vi.fn(),
    off: vi.fn(),
  });
}

/**
 * The remote peer (answerer): consumes the host's offer via the injected signaling, opens the data channel,
 * and speaks the `TClientMessage`/`TServerMessage` protocol. Resolves with the first `TServerMessage` received.
 */
function connectRemote(signaling: ISignalingClient): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const peer = new RtcPeer();
    peer.onLocalCandidate((c) =>
      signaling.send({ kind: 'ice', data: { candidate: c.candidate, sdpMid: c.mid } }),
    );
    let chain: Promise<void> = Promise.resolve();
    signaling.onSignal((message) => {
      chain = chain
        .then(async () => {
          const data = message.data as { sdp?: string; candidate?: string; sdpMid?: string };
          if (message.kind === 'offer') {
            const sdp = await peer.acceptOffer(data.sdp!);
            signaling.send({ kind: 'answer', data: { type: 'answer', sdp } });
          } else if (message.kind === 'ice') {
            peer.addRemoteCandidate({ candidate: data.candidate!, mid: data.sdpMid ?? '0' });
          }
        })
        .catch(reject);
    });
    peer.onDataChannel((channel) => {
      const ask = (): void => channel.send(JSON.stringify({ type: 'get-messages' }));
      if (channel.readyState === 'open') ask();
      else channel.onStateChange((state) => state === 'open' && ask());
      channel.onMessage((text) => resolve(JSON.parse(text) as Record<string, unknown>));
    });
  });
}

describe('WebRtcTransport (REMOTE-002 Stage A — loopback)', () => {
  it('accepts only the protocol session roles required by the carrier', () => {
    const transport = new WebRtcTransport({
      signaling: createInMemorySignalingPair()[0],
      open: true,
      openReason: 'type compatibility test',
    });
    expectTypeOf(transport).toMatchTypeOf<IConfigurableTransport<IProtocolSession>>();
    expectTypeOf(transport.attach).toEqualTypeOf<(session: IProtocolSession) => void>();
  });

  it('has the collapsed webrtc metadata and is disabled by default', () => {
    const [sig] = createInMemorySignalingPair();
    const t = new WebRtcTransport({
      signaling: sig,
      open: true,
      openReason: 'SEC-008: Stage-A loopback — this case is about signalling, not pairing',
    });
    expect(t.name).toBe('webrtc');
    expect(t.defaultEnabled).toBe(false);
  });

  it('start() before attach() throws', async () => {
    const [sig] = createInMemorySignalingPair();
    const t = new WebRtcTransport({
      signaling: sig,
      open: true,
      openReason: 'SEC-008: Stage-A loopback — this case is about signalling, not pairing',
    });
    await expect(t.start()).rejects.toMatchObject({
      name: 'TransportLifecycleError',
      code: 'not-attached',
    });
  });

  it('unpaired send failure closes the carrier and reports without escaping the session event', async () => {
    const handlers = new Map<string, (value: unknown) => void>();
    const session = createTestInteractiveSession({
      on: ((event: string, handler: (value: unknown) => void) => {
        handlers.set(event, handler);
      }) as IInteractiveSession['on'],
      off: ((event: string) => {
        handlers.delete(event);
      }) as IInteractiveSession['off'],
    });
    const closeChannel = vi.fn();
    const fake = fakeDataChannel({
      channel: {
        sendMessage: () => {
          throw new Error('unpaired channel closed');
        },
        close: closeChannel,
      },
    });
    const onDeliveryError = vi.fn();
    const onDropped = vi.fn();
    const transport = new WebRtcTransport({
      signaling: { send: () => {}, onSignal: () => () => {}, close: () => {} },
      open: true,
      openReason: 'delivery lifecycle regression',
      onDeliveryError,
      onDropped,
      loadDataChannel: () => fake.module,
    });
    transport.attach(session);
    await transport.start();

    expect(() =>
      handlers.get('branch_event')?.({
        kind: 'checkpoint_created',
        checkpointId: 'turn-0001',
        branchId: 'main',
      }),
    ).not.toThrow();
    expect(closeChannel).toHaveBeenCalledTimes(1);
    expect(onDeliveryError).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'unpaired channel closed' }),
      'branch_event',
    );
    expect(onDropped).not.toHaveBeenCalled();
    expect(handlers.size).toBe(0);
    await transport.stop();
  });

  it('resets pairing and drop guards for every restart generation', () => {
    const cleanup = vi.fn();
    const onDropped = vi.fn();
    const lifecycle = new WebRtcDeliveryLifecycle({
      cleanup,
      onDropped,
      onDeliveryError: vi.fn(),
    });

    lifecycle.reset(1);
    lifecycle.accept(1);
    lifecycle.handleDrop(1);
    lifecycle.handleDrop(1);
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(onDropped).toHaveBeenCalledTimes(1);

    lifecycle.reset(2);
    lifecycle.handleDrop(2);
    lifecycle.accept(2);
    lifecycle.handleDrop(1);
    lifecycle.handleDrop(2);
    expect(cleanup).toHaveBeenCalledTimes(2);
    expect(onDropped).toHaveBeenCalledTimes(2);
  });

  it('ignores queued signaling, ICE, and channel callbacks from an older generation', async () => {
    const sent: Array<{ readonly kind: string }> = [];
    const signalHandlers: Array<(message: { kind: 'answer'; data: object }) => void> = [];
    const setRemoteDescription = vi.fn();
    const onDropped = vi.fn();
    const signaling: ISignalingClient = {
      send: (message) => sent.push(message),
      onSignal: (handler) => {
        signalHandlers.push(handler as (message: { kind: 'answer'; data: object }) => void);
        return () => {};
      },
      close: () => {},
    };
    const fake = fakeDataChannel({ setRemoteDescription });
    const transport = new WebRtcTransport({
      signaling,
      secret: 'pairing-secret',
      onDropped,
      loadDataChannel: () => fake.module,
    });
    transport.attach(createStubSession());
    await transport.start();
    const oldSignal = signalHandlers[0]!;
    const oldIce = fake.connections[0]!.localCandidate!;
    const oldState = fake.connections[0]!.channelClosed!;

    oldSignal({ kind: 'answer', data: { sdp: 'a=fingerprint:sha-256 BB' } });
    await transport.stop();
    transport.attach(createStubSession());
    await transport.start();
    oldIce('a=candidate:stale', '0');
    oldState();
    await Promise.resolve();

    expect(setRemoteDescription).not.toHaveBeenCalled();
    expect(sent.filter(({ kind }) => kind === 'ice')).toEqual([]);
    expect(onDropped).not.toHaveBeenCalled();
    await transport.stop();
  });

  it('invokes the shared lifecycle conformance suite', async () => {
    const sent: Array<{ readonly kind: string }> = [];
    const signaling: ISignalingClient = {
      send: (message) => sent.push(message),
      onSignal: () => () => {},
      close: () => {},
    };
    const fake = fakeDataChannel();

    await runTransportLifecycleConformance({
      subjectId: '@robota-sdk/agent-transport-webrtc#WebRtcTransport',
      kind: 'service',
      createAdapter: () =>
        new WebRtcTransport({
          signaling,
          open: true,
          openReason: 'ARCH-011 lifecycle conformance',
          loadDataChannel: () => fake.module,
        }),
      createSession: createStubSession,
      assertReady: () => {
        if (!sent.some(({ kind }) => kind === 'offer')) throw new Error('offer not published');
      },
      assertStopped: () => {},
    });
  });

  it('REMOTE-010: forceTurn → a relay-only connection, and a TURN url becomes a TURN server with its credentials', async () => {
    // A fake module captures the configuration (a real relay-only peer with a dead TURN would never gather).
    const fake = fakeDataChannel();
    const [sig] = createInMemorySignalingPair();
    const t = new WebRtcTransport({
      open: true,
      openReason: 'SEC-008: Stage-A loopback — this case is about signalling, not pairing',
      signaling: sig,
      iceServers: [
        { urls: 'turn:relay.example:3478', username: 'u', credential: 'c' },
        { urls: 'stun:stun.example' },
      ],
      forceTurn: true,
      loadDataChannel: () => fake.module,
    });
    t.attach(createStubSession());
    await t.start();
    expect(fake.connections[0]!.config).toEqual({
      iceServers: [
        {
          hostname: 'relay.example',
          port: 3478,
          username: 'u',
          password: 'c',
          relayType: 'TurnUdp',
        },
        'stun:stun.example:3478',
      ],
      iceTransportPolicy: 'relay',
      disableAutoNegotiation: true,
    });
    await t.stop();
  });

  it('contacts no ICE server unless one is configured', async () => {
    const fake = fakeDataChannel();
    const [sig] = createInMemorySignalingPair();
    const t = new WebRtcTransport({
      open: true,
      openReason: 'configuration test',
      signaling: sig,
      loadDataChannel: () => fake.module,
    });
    t.attach(createStubSession());
    await t.start();
    expect(fake.connections[0]!.config.iceServers).toEqual([]);
    await t.stop();
  });

  it('TC-03: establishes an RTCDataChannel between two peers and round-trips TClient→session→TServer through the shared handler', async () => {
    const [hostSig, remoteSig] = createInMemorySignalingPair();
    const session = createStubSession();
    const host = new WebRtcTransport({
      signaling: hostSig,
      open: true,
      openReason: 'SEC-008: Stage-A loopback — this case is about signalling, not pairing',
    });
    host.attach(session);

    const remoteReply = connectRemote(remoteSig);
    await host.start();

    const reply = await remoteReply;
    // The remote's `get-messages` reached the session via the reused handler; the host streamed back a
    // `messages` TServerMessage carrying the stub session's messages — a full P2P round-trip, no network.
    expect(reply.type).toBe('messages');
    expect(reply.messages).toEqual([{ role: 'user', content: 'hi' }]);
    expect(session.getMessages).toHaveBeenCalled();

    await host.stop();
  }, 15000);
});
