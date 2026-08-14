import {
  createTestInteractiveSession,
  runTransportLifecycleConformance,
} from '@robota-sdk/agent-interface-transport/testing';

import { describe, expect, expectTypeOf, it, vi } from 'vitest';
import { RTCPeerConnection } from 'werift';
import type {
  IConfigurableTransport,
  IInteractiveSession,
} from '@robota-sdk/agent-interface-transport';
import type { IProtocolSession } from '@robota-sdk/agent-transport-protocol';

import { WebRtcTransport } from '../webrtc-transport.js';
import { createInMemorySignalingPair, type ISignalingClient } from '../signaling.js';

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
    const peer = new RTCPeerConnection();
    peer.onIceCandidate.subscribe((c) => {
      if (c) signaling.send({ kind: 'ice', data: c.toJSON() });
    });
    let chain: Promise<void> = Promise.resolve();
    signaling.onSignal((message) => {
      chain = chain
        .then(async () => {
          if (message.kind === 'offer') {
            await peer.setRemoteDescription(
              message.data as Parameters<typeof peer.setRemoteDescription>[0],
            );
            const answer = await peer.createAnswer();
            await peer.setLocalDescription(answer);
            signaling.send({ kind: 'answer', data: peer.localDescription });
          } else if (message.kind === 'ice') {
            await peer.addIceCandidate(message.data as Parameters<typeof peer.addIceCandidate>[0]);
          }
        })
        .catch(reject);
    });
    peer.onDataChannel.subscribe((channel) => {
      channel.stateChanged.subscribe((state) => {
        if (state === 'open') channel.send(JSON.stringify({ type: 'get-messages' }));
      });
      channel.onMessage.subscribe((data) => {
        resolve(JSON.parse(typeof data === 'string' ? data : data.toString()));
      });
    });
  });
}

describe('WebRtcTransport (REMOTE-002 Stage A — loopback)', () => {
  it('preserves the legacy adapter declaration and accepts the named subset', () => {
    const transport = new WebRtcTransport({
      signaling: createInMemorySignalingPair()[0],
      open: true,
      openReason: 'type compatibility test',
    });
    expectTypeOf(transport).toMatchTypeOf<IConfigurableTransport<IInteractiveSession>>();
    expectTypeOf(transport.attach).parameter(0).toMatchTypeOf<IProtocolSession>();
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

  it('resets pairing and drop guards for every restart generation', async () => {
    const sent: Array<{ readonly kind: string }> = [];
    const signaling: ISignalingClient = {
      send: (message) => sent.push(message),
      onSignal: () => () => {},
      close: () => {},
    };
    const fakeWerift = {
      RTCPeerConnection: function () {
        return {
          onIceCandidate: { subscribe: () => {} },
          createDataChannel: () => ({
            onMessage: { subscribe: () => {} },
            send: () => {},
          }),
          createOffer: async () => ({ type: 'offer', sdp: 'a=fingerprint:sha-256 AA' }),
          setLocalDescription: async () => {},
          localDescription: { type: 'offer', sdp: 'a=fingerprint:sha-256 AA' },
          close: async () => {},
        };
      },
    } as unknown as import('../werift-loader.js').IWeriftModule;
    const transport = new WebRtcTransport({
      signaling,
      open: true,
      openReason: 'restart generation regression',
      loadWerift: () => fakeWerift,
    });
    const internal = transport as unknown as { paired: boolean; dropped: boolean };
    internal.paired = true;
    internal.dropped = true;

    transport.attach(createStubSession());
    await transport.start();
    expect(internal.paired).toBe(false);
    expect(internal.dropped).toBe(false);
    await transport.stop();

    internal.paired = true;
    internal.dropped = true;
    transport.attach(createStubSession());
    await transport.start();
    expect(internal.paired).toBe(false);
    expect(internal.dropped).toBe(false);
    await transport.stop();
    expect(sent.filter(({ kind }) => kind === 'offer')).toHaveLength(2);
  });

  it('ignores queued signaling, ICE, and channel callbacks from an older generation', async () => {
    const sent: Array<{ readonly kind: string }> = [];
    const signalHandlers: Array<(message: { kind: 'answer'; data: object }) => void> = [];
    const iceHandlers: Array<(candidate: { toJSON(): object }) => void> = [];
    const stateHandlers: Array<(state: string) => void> = [];
    const setRemoteDescription = vi.fn().mockResolvedValue(undefined);
    const signaling: ISignalingClient = {
      send: (message) => sent.push(message),
      onSignal: (handler) => {
        signalHandlers.push(handler as (message: { kind: 'answer'; data: object }) => void);
        return () => {};
      },
      close: () => {},
    };
    const fakeWerift = {
      RTCPeerConnection: function () {
        return {
          onIceCandidate: {
            subscribe: (handler: (candidate: { toJSON(): object }) => void) =>
              iceHandlers.push(handler),
          },
          createDataChannel: () => ({
            onMessage: { subscribe: () => {} },
            stateChanged: {
              subscribe: (handler: (state: string) => void) => stateHandlers.push(handler),
            },
            send: () => {},
            close: () => {},
          }),
          createOffer: async () => ({ type: 'offer', sdp: 'a=fingerprint:sha-256 AA' }),
          setLocalDescription: async () => {},
          setRemoteDescription,
          addIceCandidate: vi.fn(),
          localDescription: { type: 'offer', sdp: 'a=fingerprint:sha-256 AA' },
          close: async () => {},
        };
      },
    } as unknown as import('../werift-loader.js').IWeriftModule;
    const transport = new WebRtcTransport({
      signaling,
      secret: 'pairing-secret',
      loadWerift: () => fakeWerift,
    });
    transport.attach(createStubSession());
    await transport.start();
    const oldSignal = signalHandlers[0]!;
    const oldIce = iceHandlers[0]!;
    const oldState = stateHandlers[0]!;

    oldSignal({ kind: 'answer', data: { sdp: 'a=fingerprint:sha-256 BB' } });
    await transport.stop();
    transport.attach(createStubSession());
    await transport.start();
    const internal = transport as unknown as { paired: boolean; dropped: boolean };
    internal.paired = true;
    oldIce({ toJSON: () => ({ candidate: 'stale' }) });
    oldState('closed');
    await Promise.resolve();

    expect(setRemoteDescription).not.toHaveBeenCalled();
    expect(sent.filter(({ kind }) => kind === 'ice')).toEqual([]);
    expect(internal.dropped).toBe(false);
    await transport.stop();
  });

  it('invokes the shared lifecycle conformance suite', async () => {
    const sent: Array<{ readonly kind: string }> = [];
    const signaling: ISignalingClient = {
      send: (message) => sent.push(message),
      onSignal: () => () => {},
      close: () => {},
    };
    const fakeWerift = {
      RTCPeerConnection: function () {
        return {
          onIceCandidate: { subscribe: () => {} },
          createDataChannel: () => ({
            onMessage: { subscribe: () => {} },
            send: () => {},
          }),
          createOffer: async () => ({ type: 'offer', sdp: 'a=fingerprint:sha-256 AA' }),
          setLocalDescription: async () => {},
          localDescription: { type: 'offer', sdp: 'a=fingerprint:sha-256 AA' },
          close: async () => {},
        };
      },
    } as unknown as import('../werift-loader.js').IWeriftModule;

    await runTransportLifecycleConformance({
      subjectId: '@robota-sdk/agent-transport-webrtc#WebRtcTransport',
      kind: 'service',
      createAdapter: () =>
        new WebRtcTransport({
          signaling,
          open: true,
          openReason: 'ARCH-011 lifecycle conformance',
          loadWerift: () => fakeWerift,
        }),
      createSession: createStubSession,
      assertReady: () => {
        if (!sent.some(({ kind }) => kind === 'offer')) throw new Error('offer not published');
      },
      assertStopped: () => {},
    });
  });

  it('REMOTE-010: forceTurn → iceTransportPolicy:relay (NOT top-level forceTurn, which werift ignores) + turn: passes through', async () => {
    // Inject a fake werift to capture the config the transport builds (a real relay-only peer + dead TURN would
    // block ICE gathering). The mapping is proven against real werift empirically; this guards the regression:
    // forceTurn MUST become iceTransportPolicy:'relay', never a top-level forceTurn werift silently drops.
    let captured: Record<string, unknown> | undefined;
    const fakeWerift = {
      RTCPeerConnection: function (config?: Record<string, unknown>) {
        captured = config;
        return {
          onIceCandidate: { subscribe: () => {} },
          createDataChannel: () => ({ onMessage: { subscribe: () => {} }, send: () => {} }),
          createOffer: async () => ({ type: 'offer', sdp: 'a=fingerprint:sha-256 AA' }),
          setLocalDescription: async () => {},
          localDescription: { sdp: 'a=fingerprint:sha-256 AA' },
          close: async () => {},
        };
      },
    } as unknown as import('../werift-loader.js').IWeriftModule;

    const [sig] = createInMemorySignalingPair();
    const t = new WebRtcTransport({
      open: true,
      openReason: 'SEC-008: Stage-A loopback — this case is about signalling, not pairing',
      signaling: sig,
      iceServers: [{ urls: 'turn:relay.example:3478', username: 'u', credential: 'c' }],
      forceTurn: true,
      loadWerift: () => fakeWerift,
    });
    t.attach(createStubSession());
    await t.start();
    expect(captured).toEqual({
      iceServers: [{ urls: 'turn:relay.example:3478', username: 'u', credential: 'c' }],
      iceTransportPolicy: 'relay',
    });
    expect(captured).not.toHaveProperty('forceTurn'); // werift ignores it → must not be emitted
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
