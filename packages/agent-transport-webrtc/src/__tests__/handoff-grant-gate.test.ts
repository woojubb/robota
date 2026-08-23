import { createTestInteractiveSession } from '@robota-sdk/agent-interface-session/testing';

import { describe, expect, it, vi } from 'vitest';

import {
  handoffGrantFrame,
  judgeHandoffGrant,
  type IHandoffGrantProof,
} from '../handoff-grant-gate.js';
import { PairingGate, type IPairingGateOptions } from '../pairing-gate.js';
import { type ILocalPeerProof } from '../local-peer-proof.js';

import type { startPairingHandshake, TPairingFrame } from '@robota-sdk/agent-remote-pairing';
import type { IPeerAdmission } from '@robota-sdk/agent-interface-session-mobility';
import type { createWsHandler } from '@robota-sdk/agent-transport-protocol';

/**
 * SEC-011 (issue #1865) — the cross-device grant bound to the admitted channel.
 *
 * Driven with a stub handshake and a stub verifier: this package must implement no cryptographic
 * policy, so what is asserted here is the GATE's ordering and fail-closed behaviour, never the
 * grant's signature, expiry or replay rules — those are proven where they live, in
 * `agent-remote-pairing`.
 */

const ADMITTED: IPeerAdmission = {
  admitted: true,
  trust: 'same-user-different-host',
  origin: { sessionId: 'peer_laptop' },
};
const REFUSED: IPeerAdmission = {
  admitted: false,
  trust: 'unproven',
  reason: 'channel-substituted',
};
const LOCAL_ADMITTED: IPeerAdmission = {
  admitted: true,
  trust: 'same-user-same-host',
  origin: { sessionId: 'peer_a' },
};

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

function makeGate(handoffGrant?: IHandoffGrantProof, over: Partial<IPairingGateOptions> = {}) {
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
    ...(handoffGrant ? { handoffGrant } : {}),
    ...over,
  });
  return { gate, channel, sessionOnMessage, hs };
}

const grantFrame = (grant: unknown = { handoffId: 'h1', signature: 'sig' }) =>
  JSON.stringify(handoffGrantFrame(grant));

/** The verifier is async, so every case must let its promise settle before asserting. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('the session is not exposed until a grant is presented and verified', () => {
  it('a handshake that accepts is NOT enough on its own', async () => {
    // The whole point of the binding. The handshake proves the channel terminates at the peer that
    // knew the secret; it says nothing about WHO that peer is, so it must not open the session.
    const verify = vi.fn(async () => ADMITTED);
    const { gate, sessionOnMessage, hs } = makeGate({ verify });

    hs.accept();
    await settle();
    gate.onInbound(JSON.stringify({ type: 'submit', prompt: 'p' }));
    await settle();

    expect(verify).not.toHaveBeenCalled();
    expect(sessionOnMessage).not.toHaveBeenCalled();
  });

  it('presenting an admitted grant after the handshake opens the session', async () => {
    const { gate, sessionOnMessage, hs } = makeGate({ verify: async () => ADMITTED });

    hs.accept();
    await settle();
    gate.onInbound(grantFrame());
    await settle();
    gate.onInbound(JSON.stringify({ type: 'submit', prompt: 'p' }));

    expect(sessionOnMessage).toHaveBeenCalledTimes(1);
  });

  it('a refused grant closes the channel and never builds a session handler', async () => {
    // "Fail closed before content". Refusing after exposure is not refusing.
    const { gate, channel, sessionOnMessage, hs } = makeGate({ verify: async () => REFUSED });

    hs.accept();
    await settle();
    gate.onInbound(grantFrame());
    await settle();
    gate.onInbound(JSON.stringify({ type: 'submit', prompt: 'p' }));

    expect(channel.close).toHaveBeenCalled();
    expect(sessionOnMessage).not.toHaveBeenCalled();
  });

  it('with no grant configured the gate is unchanged — the handshake alone opens the session', async () => {
    // The other direction. Without it every case above could be passing because the gate refuses
    // everything, and requiring a grant is opt-in precisely because an ordinary remote peer has
    // none to present.
    const { gate, sessionOnMessage, hs } = makeGate();

    hs.accept();
    await settle();
    gate.onInbound(JSON.stringify({ type: 'submit', prompt: 'p' }));

    expect(sessionOnMessage).toHaveBeenCalledTimes(1);
  });
});

describe('what the consumer is told', () => {
  it('is told about a refusal, not only about a success', async () => {
    // A consumer told only about successes cannot distinguish "no hand-off was offered" from "a
    // hand-off was refused", and the second is the one that belongs in front of a person.
    const onAdmission = vi.fn();
    const { gate, hs } = makeGate({ verify: async () => REFUSED, onAdmission });

    hs.accept();
    await settle();
    gate.onInbound(grantFrame());
    await settle();

    expect(onAdmission).toHaveBeenCalledWith(REFUSED);
  });

  it('carries the trust level through, not a boolean', async () => {
    const onAdmission = vi.fn();
    const { gate, hs } = makeGate({ verify: async () => ADMITTED, onAdmission });

    hs.accept();
    await settle();
    gate.onInbound(grantFrame());
    await settle();

    expect(onAdmission).toHaveBeenCalledWith(
      expect.objectContaining({ trust: 'same-user-different-host' }),
    );
  });
});

describe('a cross-device grant cannot become a same-host claim', () => {
  it('refuses an admission that claims same-user-same-host', async () => {
    // #1812 pins that the two levels are different values, and this is the substitution it forbids
    // by name: a grant proves the USER, not the machine. A verifier returning the stronger level
    // would satisfy every check that wanted the kernel-enforced rendezvous.
    const onAdmission = vi.fn();
    const { gate, channel, sessionOnMessage, hs } = makeGate({
      verify: async () => LOCAL_ADMITTED,
      onAdmission,
    });

    hs.accept();
    await settle();
    gate.onInbound(grantFrame());
    await settle();

    expect(sessionOnMessage).not.toHaveBeenCalled();
    expect(channel.close).toHaveBeenCalled();
    expect(onAdmission).toHaveBeenCalledWith(
      expect.objectContaining({ admitted: false, trust: 'unproven' }),
    );
  });

  it('admits the same verdict when its trust is the cross-device level', async () => {
    // The paired direction: what is refused above is the LEVEL, not the shape. Without this the
    // case above could pass on a gate that refuses every admission it is handed.
    const { gate, sessionOnMessage, hs } = makeGate({ verify: async () => ADMITTED });

    hs.accept();
    await settle();
    gate.onInbound(grantFrame());
    await settle();
    gate.onInbound(JSON.stringify({ type: 'submit', prompt: 'p' }));

    expect(sessionOnMessage).toHaveBeenCalledTimes(1);
  });
});

describe('the rendezvous and the grant are demanded in order, not instead of each other', () => {
  const localProof = (admission: IPeerAdmission): ILocalPeerProof => ({ redeem: () => admission });

  it('the rendezvous alone does not open the session when a grant is also required', async () => {
    const { gate, sessionOnMessage, hs } = makeGate(
      { verify: async () => ADMITTED },
      { localPeer: localProof(LOCAL_ADMITTED) },
    );

    hs.accept();
    await settle();
    gate.onInbound(JSON.stringify({ t: 'local-proof', nonce: 'n1' }));
    await settle();
    // The session frame is sent while the gate is still waiting for the grant. It is refused — and
    // that refusal is the assertion: content reaching the session here would mean the second step
    // was decorative.
    gate.onInbound(JSON.stringify({ type: 'submit', prompt: 'p' }));
    await settle();

    expect(sessionOnMessage).not.toHaveBeenCalled();
  });

  it('a hand-off between two sessions on ONE machine opens it once BOTH are satisfied', async () => {
    const { gate, sessionOnMessage, hs } = makeGate(
      { verify: async () => ADMITTED },
      { localPeer: localProof(LOCAL_ADMITTED) },
    );

    hs.accept();
    await settle();
    gate.onInbound(JSON.stringify({ t: 'local-proof', nonce: 'n1' }));
    await settle();
    gate.onInbound(grantFrame());
    await settle();
    gate.onInbound(JSON.stringify({ type: 'submit', prompt: 'p' }));

    expect(sessionOnMessage).toHaveBeenCalledTimes(1);
  });

  it('anything that is not a grant, in the grant state, closes the channel', async () => {
    // The strict reading of "fail closed before content": while a grant is owed, a frame that is not
    // one is a refusal, not something to ignore and keep waiting through. Ignoring it would leave a
    // peer able to hold the gate open indefinitely by sending noise.
    const { gate, channel, sessionOnMessage, hs } = makeGate({ verify: async () => ADMITTED });

    hs.accept();
    await settle();
    gate.onInbound(JSON.stringify({ type: 'submit', prompt: 'p' }));
    await settle();

    expect(channel.close).toHaveBeenCalled();
    expect(sessionOnMessage).not.toHaveBeenCalled();
  });

  it('a refused rendezvous closes before the grant is ever asked for', async () => {
    const verify = vi.fn(async () => ADMITTED);
    const { gate, channel, hs } = makeGate(
      { verify },
      {
        localPeer: localProof({ admitted: false, trust: 'unproven', reason: 'replayed' }),
      },
    );

    hs.accept();
    await settle();
    gate.onInbound(JSON.stringify({ t: 'local-proof', nonce: 'n1' }));
    await settle();

    expect(channel.close).toHaveBeenCalled();
    expect(verify).not.toHaveBeenCalled();
  });
});

describe('the person at this machine, asked after the proof', () => {
  it('is asked only once the grant verified, and with the PROVEN verdict', async () => {
    // Asking first would let anyone who can open a channel raise a dialog claiming to be any device
    // they like. The order is the control.
    const order: string[] = [];
    const consent = vi.fn(async () => {
      order.push('consent');
      return true;
    });
    const admission = await judgeHandoffGrant(handoffGrantFrame({ h: 1 }), {
      verify: async () => {
        order.push('verify');
        return ADMITTED;
      },
      consent,
    });

    expect(order).toEqual(['verify', 'consent']);
    expect(consent).toHaveBeenCalledWith(ADMITTED);
    expect(admission.admitted).toBe(true);
  });

  it('is NOT asked when the grant did not verify', async () => {
    const consent = vi.fn(async () => true);
    await judgeHandoffGrant(handoffGrantFrame({ h: 1 }), {
      verify: async () => REFUSED,
      consent,
    });
    expect(consent).not.toHaveBeenCalled();
  });

  it('refuses when the person declines, and says which step declined', async () => {
    const admission = await judgeHandoffGrant(handoffGrantFrame({ h: 1 }), {
      verify: async () => ADMITTED,
      consent: async () => false,
    });
    expect(admission.admitted).toBe(false);
    // Not reported as an authorization failure: the operator must not be left reading
    // "unauthorized" when what happened is that they said no.
    expect(admission.reason).toContain('declined');
  });

  it('refuses when asking throws — a prompt that could not be shown is not a yes', async () => {
    const admission = await judgeHandoffGrant(handoffGrantFrame({ h: 1 }), {
      verify: async () => ADMITTED,
      consent: async () => {
        throw new Error('no interactive renderer is attached');
      },
    });
    expect(admission.admitted).toBe(false);
    expect(admission.reason).toContain('no interactive renderer is attached');
  });

  it('admits with no consent configured, so the requirement is opt-in and not vacuous', async () => {
    // The other direction. Without it every case above could be passing on a judge that refuses
    // everything once a grant verifies.
    const admission = await judgeHandoffGrant(handoffGrantFrame({ h: 1 }), {
      verify: async () => ADMITTED,
    });
    expect(admission.admitted).toBe(true);
  });

  it('closes the channel when the person declines, through the whole gate', async () => {
    const { gate, channel, sessionOnMessage, hs } = makeGate({
      verify: async () => ADMITTED,
      consent: async () => false,
    });

    hs.accept();
    await settle();
    gate.onInbound(grantFrame());
    await settle();
    gate.onInbound(JSON.stringify({ type: 'submit', prompt: 'p' }));

    expect(channel.close).toHaveBeenCalled();
    expect(sessionOnMessage).not.toHaveBeenCalled();
  });
});

describe('the judge, asked directly', () => {
  it('refuses when no verifier is configured', async () => {
    // Unreachable through the gate, and a fail-OPEN if it ever were.
    const admission = await judgeHandoffGrant(handoffGrantFrame({}), undefined);
    expect(admission.admitted).toBe(false);
    expect(admission.trust).toBe('unproven');
  });

  it.each([
    ['a frame of the wrong kind', { t: 'local-proof', nonce: 'n1' }],
    ['a grant frame with no grant', { t: 'handoff-grant' }],
    ['not an object at all', 'handoff-grant'],
    ['null', null],
  ])('refuses %s', async (_label, parsed) => {
    const admission = await judgeHandoffGrant(parsed, { verify: async () => ADMITTED });
    expect(admission.admitted).toBe(false);
  });

  it('refuses — rather than throwing — when the verifier throws', async () => {
    // Fail CLOSED. A verifier that throws has not reached a decision, and "not reached" is not
    // "allowed". Letting it propagate would park the gate with the channel open, which is a hang:
    // fail-open wearing a crash's clothes.
    const admission = await judgeHandoffGrant(handoffGrantFrame({ x: 1 }), {
      verify: async () => {
        throw new Error('the key store is unreachable');
      },
    });
    expect(admission.admitted).toBe(false);
    expect(admission.reason).toContain('the key store is unreachable');
  });

  it('hands the verifier exactly what the frame carried', async () => {
    // The gate is an envelope, not an interpreter: a gate that reshaped the grant on the way through
    // would break the signature over claims the verifier then could not check.
    const grant = { handoffId: 'h1', nonce: 'n', signature: 'sig' };
    const verify = vi.fn(async () => ADMITTED);
    await judgeHandoffGrant(handoffGrantFrame(grant), { verify });
    expect(verify).toHaveBeenCalledWith(grant);
  });
});
