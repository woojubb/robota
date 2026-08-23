import { createTestInteractiveSession } from '@robota-sdk/agent-interface-transport/testing';

import { describe, expect, it, vi } from 'vitest';

import { judgeLocalProof, localProofFrame, type ILocalPeerProof } from '../local-peer-proof.js';
import { PairingGate, type IPairingGateOptions } from '../pairing-gate.js';

import type { startPairingHandshake, TPairingFrame } from '@robota-sdk/agent-remote-pairing';
import type { IPeerAdmission } from '@robota-sdk/agent-interface-session-mobility';
import type { createWsHandler } from '@robota-sdk/agent-transport-protocol';

/**
 * SEC-010 TC-08 (#1810) — the rendezvous nonce bound to the admitted channel.
 *
 * Driven with a stub handshake and a stub ledger: this package must implement no cryptographic
 * policy, so what is asserted here is the GATE's ordering and fail-closed behaviour, never the
 * ledger's single-use rules (those are proven where they live).
 */

const ADMITTED: IPeerAdmission = {
  admitted: true,
  trust: 'same-user-same-host',
  origin: { sessionId: 'peer_a' },
};
const REFUSED: IPeerAdmission = { admitted: false, trust: 'unproven', reason: 'replayed' };

function makeHandshakeStub() {
  let resolveResult!: (value: { sessionKey: string }) => void;
  const start: typeof startPairingHandshake = (options) => {
    const controller = {
      result: new Promise<{ sessionKey: string }>((res) => {
        resolveResult = res;
      }),
      onFrame: (_frame: TPairingFrame) => {},
    };
    options.send({ t: 'pair-nonce', nonce: 'stub' });
    return controller;
  };
  return { start, accept: () => resolveResult({ sessionKey: 'k' }) };
}

function makeGate(localPeer?: ILocalPeerProof, over: Partial<IPairingGateOptions> = {}) {
  const channel = { send: vi.fn(), close: vi.fn() };
  const sessionOnMessage = vi.fn();
  const createHandler: typeof createWsHandler = () => ({
    onMessage: sessionOnMessage,
    cleanup: vi.fn(),
  });
  const hs = makeHandshakeStub();
  const gate = new PairingGate({
    channel,
    session: createTestInteractiveSession(),
    secret: 's',
    role: 'initiator',
    localFingerprint: 'AA',
    remoteFingerprint: 'BB',
    startHandshake: hs.start,
    createHandler,
    ...(localPeer ? { localPeer } : {}),
    ...over,
  });
  return { gate, channel, sessionOnMessage, hs };
}

const proofFrame = (nonce = 'n1') => JSON.stringify({ t: 'local-proof', nonce });

describe('SEC-010 TC-08 — the session is not exposed until the rendezvous nonce is presented', () => {
  it('a handshake that accepts is NOT enough on its own', async () => {
    // The whole point of the binding. The handshake proves the channel terminates at the peer that
    // knew the secret; it says nothing about where that peer runs, so it must not open the session.
    const redeem = vi.fn(() => ADMITTED);
    const { gate, sessionOnMessage, hs } = makeGate({ redeem });

    hs.accept();
    await Promise.resolve();
    gate.onInbound(JSON.stringify({ type: 'submit', prompt: 'p' }));

    expect(redeem).not.toHaveBeenCalled();
    expect(sessionOnMessage).not.toHaveBeenCalled();
  });

  it('presenting an admitted nonce after the handshake opens the session', async () => {
    const { gate, sessionOnMessage, hs } = makeGate({ redeem: () => ADMITTED });

    hs.accept();
    await Promise.resolve();
    gate.onInbound(proofFrame());
    gate.onInbound(JSON.stringify({ type: 'submit', prompt: 'p' }));

    expect(sessionOnMessage).toHaveBeenCalledTimes(1);
  });

  it('a refused nonce closes the channel and never builds a session handler', async () => {
    // "Fail closed before content" — SEC-010's first failure rule. Refusing after exposure is not
    // refusing.
    const { gate, channel, sessionOnMessage, hs } = makeGate({ redeem: () => REFUSED });

    hs.accept();
    await Promise.resolve();
    gate.onInbound(proofFrame());
    gate.onInbound(JSON.stringify({ type: 'submit', prompt: 'p' }));

    expect(channel.close).toHaveBeenCalled();
    expect(sessionOnMessage).not.toHaveBeenCalled();
  });

  it('the consumer is told about a refusal, not only about a success', async () => {
    // A consumer told only about successes cannot distinguish "no local peer connected" from "a
    // local peer was refused", and those call for different operator responses.
    const onAdmission = vi.fn();
    const { gate, hs } = makeGate({ redeem: () => REFUSED, onAdmission });

    hs.accept();
    await Promise.resolve();
    gate.onInbound(proofFrame());

    expect(onAdmission).toHaveBeenCalledWith(REFUSED);
  });

  it('carries the trust level through to the consumer, not a boolean', async () => {
    // #1810: "a narrow typed authenticated-peer/admission result, not a generic boolean".
    const onAdmission = vi.fn();
    const { gate, hs } = makeGate({ redeem: () => ADMITTED, onAdmission });

    hs.accept();
    await Promise.resolve();
    gate.onInbound(proofFrame());

    expect(onAdmission.mock.calls[0][0].trust).toBe('same-user-same-host');
  });

  it('a frame that is not a proof frame is refused rather than ignored', async () => {
    // Ignoring would leave the gate parked with the channel open — a hang, which is fail-open
    // wearing a stall's clothes.
    const { gate, channel, hs } = makeGate({ redeem: () => ADMITTED });

    hs.accept();
    await Promise.resolve();
    gate.onInbound(JSON.stringify({ t: 'enroll-key', spki: 'x' }));

    expect(channel.close).toHaveBeenCalled();
  });

  it('without the option configured, the gate behaves exactly as before', async () => {
    // A remote peer over WebRTC has no rendezvous to have reached; demanding one unconditionally
    // would refuse every legitimate remote session.
    const { gate, sessionOnMessage, channel, hs } = makeGate();

    hs.accept();
    await Promise.resolve();
    gate.onInbound(JSON.stringify({ type: 'submit', prompt: 'p' }));

    expect(sessionOnMessage).toHaveBeenCalledTimes(1);
    expect(channel.close).not.toHaveBeenCalled();
  });
});

describe('SEC-010 TC-08 — the judge refuses everything that is not an admitted redemption', () => {
  it('refuses when no proof is configured', () => {
    // Unreachable through the gate, but a fail-OPEN if it ever were.
    expect(judgeLocalProof({ t: 'local-proof', nonce: 'n' }, undefined).admitted).toBe(false);
  });

  it.each([
    ['a non-proof frame', { t: 'enroll-key', spki: 'x' }],
    ['a proof frame with no nonce', { t: 'local-proof' }],
    ['a nonce that is not a string', { t: 'local-proof', nonce: 7 }],
    ['null', null],
  ])('refuses %s', (_label, value) => {
    expect(judgeLocalProof(value, { redeem: () => ADMITTED }).admitted).toBe(false);
  });

  it('a ledger that throws is a refusal, not an escape', () => {
    // "Not reached" is not "allowed". Letting it propagate would unwind through the channel's
    // message subscription and leave the gate parked with the channel open.
    const admission = judgeLocalProof(
      { t: 'local-proof', nonce: 'n' },
      {
        redeem: () => {
          throw new Error('ledger unavailable');
        },
      },
    );

    expect(admission.admitted).toBe(false);
    expect(admission.trust).toBe('unproven');
    expect(admission.reason).toMatch(/could not decide/);
  });
});

describe('SEC-010 — the sender and the judge agree on the frame', () => {
  it('a frame built by the helper is accepted by the judge', () => {
    // The two live in one file so they cannot drift. A sender that hand-built the object would keep
    // compiling after the frame gains a field, and the failure would surface as a refusal on the FAR
    // side with no hint that the sender is the stale half.
    const admission = judgeLocalProof(localProofFrame('n1'), { redeem: () => ADMITTED });

    expect(admission.admitted).toBe(true);
  });

  it('the helper carries the nonce through unchanged', () => {
    const seen: string[] = [];

    judgeLocalProof(localProofFrame('the-nonce'), {
      redeem: (nonce) => {
        seen.push(nonce);
        return ADMITTED;
      },
    });

    expect(seen).toEqual(['the-nonce']);
  });
});
