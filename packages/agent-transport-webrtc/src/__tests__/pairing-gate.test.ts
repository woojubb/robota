import { describe, expect, it, vi } from 'vitest';

import { PairingGate, type IPairingGateOptions } from '../pairing-gate.js';

import type { startPairingHandshake, TPairingFrame } from '@robota-sdk/agent-remote-pairing';
import type { createWsHandler } from '@robota-sdk/agent-transport-protocol';
import type { IInteractiveSession } from '@robota-sdk/agent-interface-transport';

/**
 * REMOTE-008 Step 1 (SECURITY milestone) — the pairing gate's fail-closed routing switch, driven with a stub
 * channel + injected handshake + injected session-bridge (no real peer/crypto/session).
 */

/** A controllable stub of the pairing handshake: capture frames, resolve/reject on demand. */
function makeHandshakeStub() {
  const sent: TPairingFrame[] = [];
  const received: TPairingFrame[] = [];
  let resolveResult!: (value: { sessionKey: string }) => void;
  let rejectResult!: (error: Error) => void;
  const start: typeof startPairingHandshake = (options) => {
    // Record what the gate asked us to send (it wraps this over the channel).
    const controller = {
      result: new Promise<{ sessionKey: string }>((res, rej) => {
        resolveResult = res;
        rejectResult = rej;
      }),
      onFrame: (frame: TPairingFrame) => received.push(frame),
    };
    // Expose the send seam so a test can assert the gate serialized a frame.
    options.send({ t: 'pair-nonce', nonce: 'stub' });
    return controller;
  };
  return {
    start,
    received,
    sentByGate: sent,
    accept: () => resolveResult({ sessionKey: 'k' }),
    reject: () => rejectResult(new Error('pairing rejected')),
  };
}

function makeGate(over: Partial<IPairingGateOptions> = {}) {
  const channelSends: string[] = [];
  const channel = { send: (d: string) => channelSends.push(d), close: vi.fn() };
  const session = {} as IInteractiveSession;
  const sessionOnMessage = vi.fn();
  const handlerCleanup = vi.fn();
  const createHandler: typeof createWsHandler = () => ({
    onMessage: sessionOnMessage,
    cleanup: handlerCleanup,
  });
  const hs = makeHandshakeStub();
  const gate = new PairingGate({
    channel,
    session,
    secret: 's',
    role: 'initiator',
    localFingerprint: 'AA',
    remoteFingerprint: 'BB',
    startHandshake: hs.start,
    createHandler,
    ...over,
  });
  return { gate, channel, channelSends, sessionOnMessage, handlerCleanup, hs };
}

describe('PairingGate (REMOTE-008 Step 1 — fail-closed routing switch)', () => {
  it('does not expose the session before the handshake accepts (no session bridge built)', () => {
    const { sessionOnMessage } = makeGate();
    // The handshake sent its nonce, but no session handler exists yet.
    expect(sessionOnMessage).not.toHaveBeenCalled();
  });

  it('serializes the handshake frames it sends over the channel', () => {
    const { channelSends } = makeGate();
    // The stub handshake emits a pair-nonce on start; the gate must have serialized it.
    expect(channelSends).toContain(JSON.stringify({ t: 'pair-nonce', nonce: 'stub' }));
  });

  it('pre-accept: routes a pairing frame to the handshake and DROPS a non-pairing frame', () => {
    const { gate, hs, sessionOnMessage } = makeGate();
    gate.onInbound(JSON.stringify({ t: 'pair-confirm', mac: 'm' }));
    expect(hs.received).toEqual([{ t: 'pair-confirm', mac: 'm' }]);
    // A well-formed but non-pairing frame pre-accept must never reach the (nonexistent) session.
    gate.onInbound(JSON.stringify({ type: 'submit', prompt: 'p' }));
    expect(sessionOnMessage).not.toHaveBeenCalled();
    // Undecodable garbage pre-accept is dropped without throwing.
    expect(() => gate.onInbound('not json')).not.toThrow();
  });

  it('on ACCEPT: builds the session bridge and routes subsequent frames to it', async () => {
    const { gate, hs, sessionOnMessage } = makeGate();
    hs.accept();
    await Promise.resolve(); // let the result.then microtask run
    gate.onInbound(JSON.stringify({ type: 'submit', prompt: 'hi' }));
    expect(sessionOnMessage).toHaveBeenCalledWith(JSON.stringify({ type: 'submit', prompt: 'hi' }));
  });

  it('on REJECT: closes the channel and NEVER exposes the session', async () => {
    const { gate, channel, hs, sessionOnMessage } = makeGate();
    hs.reject();
    await Promise.resolve();
    expect(channel.close).toHaveBeenCalledTimes(1);
    // Any frame after a failed pairing is ignored — the session is never reachable.
    gate.onInbound(JSON.stringify({ type: 'submit', prompt: 'hi' }));
    expect(sessionOnMessage).not.toHaveBeenCalled();
  });

  it('post-close (cleanup): ignores further inbound frames', async () => {
    const { gate, hs, sessionOnMessage } = makeGate();
    hs.accept();
    await Promise.resolve();
    gate.cleanup();
    gate.onInbound(JSON.stringify({ type: 'submit', prompt: 'hi' }));
    expect(sessionOnMessage).not.toHaveBeenCalled();
  });

  it('fires onAccept on accept (not onReject)', async () => {
    const onAccept = vi.fn();
    const onReject = vi.fn();
    const { hs } = makeGate({ onAccept, onReject });
    hs.accept();
    await Promise.resolve();
    expect(onAccept).toHaveBeenCalledTimes(1);
    expect(onReject).not.toHaveBeenCalled();
  });

  it('fires onReject on reject (not onAccept)', async () => {
    const onAccept = vi.fn();
    const onReject = vi.fn();
    const { hs } = makeGate({ onAccept, onReject });
    hs.reject();
    await Promise.resolve();
    expect(onReject).toHaveBeenCalledTimes(1);
    expect(onAccept).not.toHaveBeenCalled();
  });

  it('cleanup tears down the session bridge when one was built', async () => {
    const { gate, hs, handlerCleanup } = makeGate();
    hs.accept();
    await Promise.resolve();
    gate.cleanup();
    expect(handlerCleanup).toHaveBeenCalledTimes(1);
  });
});
