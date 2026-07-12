import { describe, expect, it, vi } from 'vitest';

import { ResponderGate, type IResponderGateOptions } from '../rtc-responder-gate.js';

import type { startPairingHandshake, TPairingFrame } from '@robota-sdk/agent-remote-pairing';
import type { TServerMessage } from '@robota-sdk/agent-transport-protocol';

/**
 * REMOTE-009 Step 2 — the browser responder-side pairing gate's fail-closed routing switch, driven with a
 * stub channel + injected handshake (no real RTCPeerConnection). Mirror of the host PairingGate tests.
 */

function makeHandshakeStub() {
  const received: TPairingFrame[] = [];
  let resolveResult!: (v: { sessionKey: string }) => void;
  let rejectResult!: (e: Error) => void;
  const start: typeof startPairingHandshake = (options) => {
    options.send({ t: 'pair-nonce', nonce: 'stub' }); // responder emits its nonce on start
    return {
      result: new Promise<{ sessionKey: string }>((res, rej) => {
        resolveResult = res;
        rejectResult = rej;
      }),
      onFrame: (frame: TPairingFrame) => received.push(frame),
    };
  };
  return {
    start,
    received,
    accept: () => resolveResult({ sessionKey: 'k' }),
    reject: () => rejectResult(new Error('x')),
  };
}

function makeGate(over: Partial<IResponderGateOptions> = {}) {
  const channelSends: string[] = [];
  const channel = { send: (d: string) => channelSends.push(d), close: vi.fn() };
  const onMessage = vi.fn();
  const hs = makeHandshakeStub();
  const gate = new ResponderGate({
    channel,
    secret: 's',
    localFingerprint: 'AA',
    remoteFingerprint: 'BB',
    onMessage,
    startHandshake: hs.start,
    ...over,
  });
  return { gate, channel, channelSends, onMessage, hs };
}

describe('ResponderGate (REMOTE-009 — browser pairing responder, fail-closed)', () => {
  it('does not deliver any session message before the handshake accepts', () => {
    const { gate, onMessage } = makeGate();
    gate.onInbound(JSON.stringify({ type: 'messages', messages: [] }));
    expect(onMessage).not.toHaveBeenCalled();
  });

  it('serializes its handshake frames over the channel', () => {
    const { channelSends } = makeGate();
    expect(channelSends).toContain(JSON.stringify({ t: 'pair-nonce', nonce: 'stub' }));
  });

  it('pre-accept routes a pairing frame to the handshake and DROPS a non-pairing frame', () => {
    const { gate, hs, onMessage } = makeGate();
    gate.onInbound(JSON.stringify({ t: 'pair-confirm', mac: 'm' }));
    expect(hs.received).toEqual([{ t: 'pair-confirm', mac: 'm' }]);
    gate.onInbound(JSON.stringify({ type: 'messages', messages: [] })); // non-pairing pre-accept → dropped
    expect(onMessage).not.toHaveBeenCalled();
  });

  it('post-accept delivers TServerMessages and allows send(TClientMessage)', async () => {
    const { gate, hs, onMessage, channelSends } = makeGate();
    hs.accept();
    await Promise.resolve();
    gate.onInbound(JSON.stringify({ type: 'text_delta', delta: 'hi' }));
    expect(onMessage).toHaveBeenCalledWith({ type: 'text_delta', delta: 'hi' } as TServerMessage);
    gate.send({ type: 'submit', prompt: 'go' });
    expect(JSON.parse(channelSends.at(-1)!)).toEqual({ type: 'submit', prompt: 'go' });
  });

  it('send is a no-op before accept (nothing leaks pre-pairing)', () => {
    const { gate, channelSends } = makeGate();
    const before = channelSends.length;
    gate.send({ type: 'submit', prompt: 'x' });
    expect(channelSends.length).toBe(before);
  });

  it('on reject: closes the channel and never delivers a session message', async () => {
    const { gate, channel, hs, onMessage } = makeGate();
    hs.reject();
    await Promise.resolve();
    expect(channel.close).toHaveBeenCalledTimes(1);
    gate.onInbound(JSON.stringify({ type: 'messages', messages: [] }));
    expect(onMessage).not.toHaveBeenCalled();
  });

  it('fires onAccept on accept and onReject on reject', async () => {
    const onAccept = vi.fn();
    const onReject = vi.fn();
    const a = makeGate({ onAccept, onReject });
    a.hs.accept();
    await Promise.resolve();
    expect(onAccept).toHaveBeenCalledTimes(1);

    const b = makeGate({ onAccept: vi.fn(), onReject });
    b.hs.reject();
    await Promise.resolve();
    expect(onReject).toHaveBeenCalledTimes(1);
  });

  it('close() is idempotent and stops delivery', async () => {
    const { gate, hs, onMessage } = makeGate();
    hs.accept();
    await Promise.resolve();
    gate.close();
    gate.close();
    gate.onInbound(JSON.stringify({ type: 'text_delta', delta: 'x' }));
    expect(onMessage).not.toHaveBeenCalled();
  });
});
